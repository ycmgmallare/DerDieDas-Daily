// Content seam — WHAT the email says (decoupled from WHO gets it, see subscribers.js).
//
// The daily email's body is read from a content FILE at send time:
//   CONTENT_FILE (default "content.md") — markdown with optional frontmatter, OR
//   a .json file: { "subject": "...", "title": "...", "html": "...", "text": "..." }
//
// This lets another skill own the writing. e.g. run `/write-post`, have it save the
// result to content.md, and this automation sends whatever's there — no code change.
//
// Returned shape (consumed by email-template.js):
//   { subject, title, bodyHtml, bodyText }

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, resolve } from 'node:path';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Read the content file, tolerating different working directories. Serverless
 * hosts (e.g. Vercel) run functions from a CWD that isn't the project root, so a
 * bare relative path like "content.md" won't resolve against the process CWD.
 * Try the path as given (CWD-relative / absolute) first, then fall back to a path
 * resolved against this module's directory (the project root).
 */
async function readContentFile(path) {
  if (isAbsolute(path)) return readFile(path, 'utf8');
  try {
    return await readFile(path, 'utf8');
  } catch {
    return readFile(resolve(MODULE_DIR, path), 'utf8');
  }
}

/** A safe fallback used for previews when no content file exists yet. */
export const SAMPLE_CONTENT = {
  subject: 'Hello from your daily email',
  title: 'Your first post',
  bodyHtml:
    '<p>This is <strong>sample</strong> content shown in the preview. Create your ' +
    'content file (default <code>content.md</code>) — or generate it with a skill like ' +
    '<code>/write-post</code> — and the automation will send that instead.</p>',
  bodyText:
    'This is sample content shown in the preview. Create your content file ' +
    '(default content.md) — or generate it with a skill like /write-post — and the ' +
    'automation will send that instead.',
};

/**
 * Load the email content from the content file.
 * @returns {Promise<{subject:string,title:string,bodyHtml:string,bodyText:string}>}
 * @throws if the file is missing/empty (so a scheduled send fails loudly rather
 *         than mailing an empty message).
 */
export async function getContent() {
  const path = process.env.CONTENT_FILE || 'content.md';
  let raw;
  try {
    raw = await readContentFile(path);
  } catch {
    throw new Error(
      `Content file not found: "${path}". Create it (e.g. run /write-post to write ${path}) ` +
      `or set CONTENT_FILE in .env.`
    );
  }
  if (!raw.trim()) throw new Error(`Content file "${path}" is empty.`);

  // Normalize a leading BOM and Windows CRLF endings so frontmatter parsing is
  // reliable regardless of how the content file was authored/checked out.
  raw = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

  return path.endsWith('.json') ? parseJsonContent(raw, path) : parseMarkdownContent(raw);
}

/** Like getContent(), but returns SAMPLE_CONTENT instead of throwing (for previews). */
export async function getContentOrSample() {
  try {
    return await getContent();
  } catch {
    return SAMPLE_CONTENT;
  }
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function parseJsonContent(raw, path) {
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new Error(`Content file "${path}" is not valid JSON.`);
  }
  const subject = (obj.subject || obj.title || 'Untitled').trim();
  const title = (obj.title || '').trim();
  const text = (obj.text || stripTags(obj.html || '') || '').trim();
  const bodyHtml = obj.html ? String(obj.html) : mdToHtml(text);
  return { subject, title, bodyHtml, bodyText: text || stripTags(bodyHtml) };
}

function parseMarkdownContent(raw) {
  const { meta, body } = splitFrontmatter(raw);
  const title = (meta.title || '').trim();
  // First markdown heading, if any, makes a good default title.
  const firstHeading = (body.match(/^\s*#{1,6}\s+(.+)$/m) || [])[1];
  const subject = (meta.subject || title || firstHeading || 'Untitled').trim();
  return {
    subject,
    title: title || (meta.subject ? '' : firstHeading || ''),
    bodyHtml: mdToHtml(body),
    bodyText: body.trim(),
  };
}

/** Pull a leading `--- ... ---` frontmatter block of simple `key: value` lines. */
function splitFrontmatter(raw) {
  const m = raw.match(/^﻿?---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (kv) meta[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { meta, body: m[2] };
}

const escHtml = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Inline markdown: **bold**, *italic*, `code`, [text](url). Operates on escaped text. */
function inline(s) {
  return escHtml(s)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

/**
 * Minimal, dependency-free markdown → HTML for email bodies: headings, unordered
 * lists, and paragraphs with inline formatting. Good enough for posts written by a
 * content skill; swap in a real markdown lib if you need tables/images/etc.
 */
function mdToHtml(md) {
  const blocks = String(md).trim().split(/\n{2,}/);
  const html = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const heading = block.match(/^\s*(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 6); // h1 reserved for the title
      html.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`);
      continue;
    }
    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
      const items = lines.map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('');
      html.push(`<ul>${items}</ul>`);
      continue;
    }
    html.push(`<p>${lines.map((l) => inline(l)).join('<br>')}</p>`);
  }
  return html.join('\n');
}

function stripTags(html) {
  return String(html).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}
