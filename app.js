// Email-automation web console — the request handler, shared by the local server
// (serve.mjs) and the Vercel serverless function (api/index.js).
//
// IMPORTANT: this module has NO side effects on import — it does not bind a port.
// serve.mjs wraps `handler` in http.createServer().listen(); Vercel imports it.
//
// Separation of concerns:
//   content.js     → WHAT the email says (read from the content file)
//   subscribers.js → WHO it goes to (personal recipient | domain subscribers)
//
// Routes:
//   GET  /            dashboard
//   GET  /signup      public signup form  (collects domain subscribers)
//   POST /signup      insert the signup
//   GET  /admin       recipient/subscriber manager + content status + Send now
//   POST /send-now    run the pipeline now
//   POST /settings    save the personal-mode recipient email
//   POST /seed|/clear|/delete   manage the subscriber list
//   GET  /preview     preview the email (content file, or sample)
//   GET  /unsubscribe confirm page (token) — PUBLIC, no auth
//   POST /unsubscribe mark the token's signup unsubscribed — PUBLIC, no auth
//   GET  /healthz     plain "ok" (always open)
//
// Auth: if CONSOLE_PASSWORD is set, every route except /healthz and /unsubscribe
// requires HTTP Basic Auth (user = CONSOLE_USER || "admin"). Unset = open (local).
//
// Audience (EMAIL_AUDIENCE): personal (one recipient) | domain (fan out to subscribers).

import 'dotenv/config';
import { renderEmail } from './email-template.js';
import { getContent, getContentOrSample } from './content.js';
import {
  addSignup, listSubscribers, deleteSubscriber, clearSubscribers, seedSubscribers,
  getRecipient, setRecipient, getActiveSubscribers, getSignupByToken, unsubscribeByToken,
} from './subscribers.js';
import { runEmail } from './run.js';

const brand = () => process.env.BRAND_NAME || 'Daily Email';
const audience = () => (process.env.EMAIL_AUDIENCE || 'personal').toLowerCase();
const isDomain = () => audience() === 'domain';

// ---------------------------------------------------------------------------
// Design tokens — shared with email-template.js for a cohesive editorial look
// ---------------------------------------------------------------------------
const C = {
  paper: '#efe9dd', surface: '#fbf8f2', ink: '#1d1b26', muted: '#75727f',
  hair: '#e3ddd0', gold: '#b07d35', high: '#bb432f', low: '#4f6f6b',
};
const FONT_DISPLAY = "'Fraunces', Georgia, 'Times New Roman', serif";
const FONT_BODY = "'Inter Tight', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------
function page({ title, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<title>${esc(title)} · ${esc(brand())}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;1,9..144,500&family=Inter+Tight:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root { --paper:${C.paper}; --surface:${C.surface}; --ink:${C.ink}; --muted:${C.muted}; --hair:${C.hair}; --gold:${C.gold}; --high:${C.high}; --low:${C.low}; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; color: var(--ink);
    font-family: ${FONT_BODY};
    background:
      radial-gradient(900px 420px at 12% -8%, rgba(176,125,53,0.10), transparent 60%),
      radial-gradient(820px 480px at 100% 0%, rgba(79,111,107,0.08), transparent 55%),
      var(--paper);
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 600px; margin: 0 auto; padding: 44px 20px 72px; }
  .eyebrow { font-size: 11px; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase; color: var(--gold); }
  h1 { font-family: ${FONT_DISPLAY}; font-weight: 600; letter-spacing: -0.03em; line-height: 1.08; font-size: 38px; margin: 14px 0 0; }
  .lede { font-size: 15px; line-height: 1.65; color: var(--muted); margin: 10px 0 0; max-width: 46ch; }
  nav.top { display: flex; gap: 18px; margin-top: 16px; }
  nav.top a { font-size: 13px; font-weight: 600; color: var(--muted); text-decoration: none; padding-bottom: 2px; border-bottom: 1.5px solid transparent; transition: color .18s ease, border-color .18s ease; }
  nav.top a:hover { color: var(--ink); border-color: var(--gold); }
  nav.top a:focus-visible { outline: 2px solid var(--gold); outline-offset: 3px; border-radius: 2px; }

  .card { background: var(--surface); border: 1px solid var(--hair); border-radius: 18px; padding: 26px; margin-top: 22px; box-shadow: 0 1px 2px rgba(29,27,38,0.04), 0 18px 40px -22px rgba(29,27,38,0.22); }
  .card h2 { font-family: ${FONT_DISPLAY}; font-weight: 600; letter-spacing: -0.02em; font-size: 21px; margin: 0 0 4px; }
  .card p.sub { font-size: 13.5px; line-height: 1.6; color: var(--muted); margin: 0 0 18px; }

  label { display: block; font-size: 12.5px; font-weight: 600; letter-spacing: 0.01em; color: var(--ink); margin: 16px 0 7px; }
  label .opt { color: var(--muted); font-weight: 500; }
  input[type=text], input[type=email] { width: 100%; font-family: ${FONT_BODY}; font-size: 15px; color: var(--ink); background: #fff; border: 1px solid var(--hair); border-radius: 11px; padding: 12px 14px; transition: border-color .16s ease, box-shadow .16s ease; }
  input::placeholder { color: #b7b3ad; }
  input:focus-visible { outline: none; border-color: var(--gold); box-shadow: 0 0 0 3px rgba(176,125,53,0.18); }

  .consent { display: flex; gap: 11px; align-items: flex-start; margin-top: 20px; padding: 14px 15px; background: rgba(176,125,53,0.06); border: 1px solid rgba(176,125,53,0.22); border-radius: 12px; }
  .consent input { margin-top: 2px; width: 17px; height: 17px; accent-color: var(--gold); flex: none; }
  .consent label { margin: 0; font-weight: 500; font-size: 13.5px; line-height: 1.5; color: var(--ink); }

  .btn { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-family: ${FONT_BODY}; font-size: 14px; font-weight: 600; letter-spacing: 0.01em; color: #fbf8f2; background: var(--ink); border: none; border-radius: 11px; padding: 13px 20px; transition: transform .14s cubic-bezier(.34,1.56,.64,1), box-shadow .18s ease, background .18s ease; box-shadow: 0 10px 22px -12px rgba(29,27,38,0.6); }
  .btn:hover { transform: translateY(-2px); box-shadow: 0 16px 30px -14px rgba(29,27,38,0.6); }
  .btn:active { transform: translateY(0); }
  .btn:focus-visible { outline: 2px solid var(--gold); outline-offset: 3px; }
  .btn.gold { background: var(--gold); box-shadow: 0 10px 22px -12px rgba(176,125,53,0.7); }
  .btn.ghost { background: transparent; color: var(--ink); border: 1px solid var(--hair); box-shadow: none; }
  .btn.ghost:hover { border-color: var(--gold); }
  .btn-row { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 22px; }
  .full { width: 100%; justify-content: center; margin-top: 24px; }

  .note { font-size: 12.5px; line-height: 1.6; color: var(--muted); margin-top: 16px; }
  .note strong { color: var(--ink); font-weight: 600; }
  .kv { display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; font-size: 13.5px; margin: 0; }
  .kv dt { color: var(--muted); }
  .kv dd { margin: 0; font-weight: 600; }
  .pill { display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; padding: 4px 10px; border-radius: 999px; }
  .ok { color: var(--low); background: #e6eeec; }
  .bad { color: var(--high); background: #f7e9e4; }
  .stat { display: flex; gap: 26px; margin: 4px 0 2px; }
  .stat .n { font-family: ${FONT_DISPLAY}; font-size: 30px; font-weight: 600; letter-spacing: -0.02em; line-height: 1; }
  .stat .l { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin-top: 6px; }
  .list { margin-top: 16px; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 0; border-top: 1px solid var(--hair); }
  .row:first-child { border-top: none; }
  .row-name { font-size: 14.5px; font-weight: 600; color: var(--ink); }
  .row-co { color: var(--muted); font-weight: 500; }
  .row-sub { font-size: 12.5px; color: var(--muted); margin-top: 2px; }
  .btn.sm { padding: 7px 13px; font-size: 12.5px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em; background: rgba(29,27,38,0.05); padding: 1px 5px; border-radius: 5px; }
  a.back { display: inline-block; margin-top: 26px; font-size: 13px; font-weight: 600; color: var(--muted); text-decoration: none; }
  a.back:hover { color: var(--ink); }
  @media (max-width: 520px) { h1 { font-size: 30px; } }
</style>
</head>
<body>
  <div class="wrap">
    <div class="eyebrow">◆&nbsp;&nbsp;${esc(brand())}</div>
    ${body}
  </div>
</body>
</html>`;
}

const masthead = (title, lede) => `
  <h1>${esc(title)}</h1>
  ${lede ? `<p class="lede">${esc(lede)}</p>` : ''}
  <nav class="top">
    <a href="/signup">Sign up</a>
    <a href="/admin">Console</a>
    <a href="/preview">Email preview</a>
  </nav>`;

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------
function dashboardPage() {
  const body = `
  ${masthead('Console', `${esc(brand())} — a cockpit for your daily email: collect signups, set your content, then send on demand or on schedule.`)}
  ${isDomain() ? `<div class="card">
    <h2>1 · Collect subscribers</h2>
    <p class="sub">Share the signup page; new people land in your subscriber list.</p>
    <a class="btn gold" href="/signup">Open signup form →</a>
  </div>` : ''}
  <div class="card">
    <h2>${isDomain() ? '2 · ' : ''}Send a test</h2>
    <p class="sub">Set your recipient/content and send the current email instantly.</p>
    <a class="btn" href="/admin">Open console →</a>
  </div>
  <div class="card">
    <h2>Email preview</h2>
    <p class="sub">See the email rendered from your content file (or a sample).</p>
    <a class="btn ghost" href="/preview">View preview →</a>
  </div>`;
  return page({ title: 'Console', body });
}

function signupPage({ values = {}, error = '' } = {}) {
  const v = (k) => esc(values[k] || '');
  const body = `
  ${masthead('Sign up', `Join the ${brand()} list. We'll email you the latest.`)}
  <form class="card" method="POST" action="/signup" novalidate>
    <h2>New signup</h2>
    <p class="sub">Name and email are required. Company is optional.</p>
    ${error ? `<div class="consent bad" style="background:#f7e9e4;border-color:rgba(187,67,47,.3)"><span class="pill bad">!</span><label style="color:var(--high)">${esc(error)}</label></div>` : ''}

    <label for="name">Name</label>
    <input id="name" name="name" type="text" required placeholder="Jane Doe" value="${v('name')}">

    <label for="email">Email</label>
    <input id="email" name="email" type="email" required placeholder="jane@company.com" value="${v('email')}">

    <label for="company">Company <span class="opt">— optional</span></label>
    <input id="company" name="company" type="text" placeholder="Acme Corp" value="${v('company')}">

    <div class="consent">
      <input id="consent" name="consent" type="checkbox" required>
      <label for="consent">Yes, sign me up for the ${esc(brand())} list.</label>
    </div>

    <button class="btn gold full" type="submit">Sign up →</button>
  </form>
  <a class="back" href="/">← Back to console</a>`;
  return page({ title: 'Sign up', body });
}

function signupSuccessPage(row) {
  const body = `
  ${masthead('You’re on the list', '')}
  <div class="card">
    <h2>Signup saved <span class="pill ok">added</span></h2>
    <dl class="kv">
      <dt>Name</dt><dd>${esc(row.name)}</dd>
      <dt>Email</dt><dd>${esc(row.email)}</dd>
      <dt>Company</dt><dd>${esc(row.company || '—')}</dd>
    </dl>
    <div class="btn-row">
      <a class="btn gold" href="/admin">Go to console →</a>
      <a class="btn ghost" href="/signup">Add another</a>
    </div>
  </div>
  <a class="back" href="/">← Back to console</a>`;
  return page({ title: 'Signed up', body });
}

// Recipient (personal) vs subscriber count (domain).
async function audienceCard() {
  if (isDomain()) {
    let count = null;
    try { count = (await getActiveSubscribers()).length; } catch { /* Supabase maybe absent */ }
    return `
    <div class="card">
      <h2>Subscribers <span class="pill ok">domain</span></h2>
      <p class="sub">Domain mode fans the email out to every active subscriber.</p>
      <div class="stat"><div><div class="n">${count ?? '—'}</div><div class="l">Active</div></div></div>
      <p class="note">People join at <code>/signup</code> and opt out via the unsubscribe link in each
      email. Set <code>PUBLIC_BASE_URL</code> so those links resolve.</p>
    </div>`;
  }
  const to = await getRecipient();
  return `
  <div class="card">
    <h2>Recipient <span class="pill ok">personal</span></h2>
    <p class="sub">Personal mode sends to this one address.</p>
    <form method="POST" action="/settings">
      <label for="recipient">Recipient email</label>
      <input id="recipient" name="recipient" type="email" required placeholder="you@example.com" value="${esc(to || '')}">
      <button class="btn gold full" type="submit">Save recipient →</button>
    </form>
    <p class="note">Saved in the Supabase <code>settings</code> table. No Supabase yet? It falls back to
    <code>RESEND_TO</code> from <code>.env</code>.</p>
  </div>`;
}

// Current email content (from the content file) + Send now.
async function contentCard() {
  const path = process.env.CONTENT_FILE || 'content.md';
  let found = true, content;
  try { content = await getContent(); } catch { found = false; }

  const status = found
    ? `<dl class="kv">
         <dt>File</dt><dd><code>${esc(path)}</code> <span class="pill ok">found</span></dd>
         <dt>Subject</dt><dd>${esc(content.subject)}</dd>
         ${content.title ? `<dt>Title</dt><dd>${esc(content.title)}</dd>` : ''}
       </dl>`
    : `<p class="note" style="color:var(--high)">No content file at <code>${esc(path)}</code>.
       Create it — e.g. run <code>/write-post</code> to write ${esc(path)} — or set
       <code>CONTENT_FILE</code>. (The preview falls back to a sample.)</p>`;

  return `
  <div class="card">
    <h2>Email content</h2>
    <p class="sub">What gets sent. Written by you or another skill into the content file.</p>
    ${status}
    <div class="btn-row">
      <form method="POST" action="/send-now" style="display:inline"><button class="btn gold" type="submit">Send now</button></form>
      <a class="btn ghost" href="/preview">Preview</a>
    </div>
  </div>`;
}

// Subscriber list (domain mode only).
async function subscribersListCard() {
  if (!isDomain()) return '';
  try {
    const rows = await listSubscribers();
    const tz = process.env.SEND_TZ || 'Asia/Manila';
    const rowHtml = (r) => {
      const time = new Date(r.created_at).toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric' });
      const unsubbed = r.unsubscribed_at ? ` <span class="pill bad" style="vertical-align:1px">unsubscribed</span>` : '';
      return `
      <div class="row">
        <div>
          <div class="row-name">${esc(r.name)}${r.company ? ` <span class="row-co">· ${esc(r.company)}</span>` : ''}${unsubbed}</div>
          <div class="row-sub">${esc(r.email)} — ${esc(time)}</div>
        </div>
        <form method="POST" action="/delete" onsubmit="return confirm('Delete this subscriber?')">
          <input type="hidden" name="id" value="${esc(r.id)}">
          <button class="btn ghost sm" type="submit">Delete</button>
        </form>
      </div>`;
    };
    const list = rows.length
      ? `<div class="list">${rows.map(rowHtml).join('')}</div>`
      : `<p class="note">No subscribers yet. Use the signup form, or <strong>Seed test data</strong> below.</p>`;
    return `
    <div class="card">
      <h2>Subscriber list</h2>
      <p class="sub">All signups, newest first.</p>
      ${list}
    </div>
    <div class="card">
      <h2>Test data</h2>
      <p class="sub">Populate or reset the list with ${6} sample subscribers (additive).</p>
      <div class="btn-row">
        <form method="POST" action="/seed" style="display:inline"><button class="btn gold" type="submit">Seed test data</button></form>
        <form method="POST" action="/clear" style="display:inline" onsubmit="return confirm('Delete ALL subscribers?')"><button class="btn ghost" type="submit">Clear all</button></form>
      </div>
    </div>`;
  } catch (err) {
    return `<div class="card"><h2>Subscriber list</h2>
      <p class="note" style="color:var(--high)">Supabase not connected yet: ${esc(err.message)}<br>Fill SUPABASE_URL / SUPABASE_KEY to enable subscribers.</p></div>`;
  }
}

async function adminPage({ flash = '' } = {}) {
  const recipient = await getRecipient();
  const sendsTo = isDomain() ? 'active subscribers' : (recipient || 'unset');
  const body = `
  ${masthead('Console', 'Set your recipient/content and send the current email. Sends are real.')}
  ${flash}
  <div class="card">
    <h2>Current setup</h2>
    <dl class="kv">
      <dt>Mode</dt><dd>${esc(audience())}</dd>
      <dt>Email provider</dt><dd>${esc(process.env.EMAIL_PROVIDER || 'resend')}</dd>
      <dt>Sends to</dt><dd>${esc(sendsTo)}</dd>
    </dl>
  </div>
  ${await audienceCard()}
  ${await contentCard()}
  ${await subscribersListCard()}
  <a class="back" href="/">← Back to console</a>`;
  return page({ title: 'Console', body });
}

function sendResultFlash({ ok, content, result, error }) {
  if (!ok) {
    return `<div class="card"><h2>Send failed <span class="pill bad">error</span></h2><p class="sub">${esc(error)}</p></div>`;
  }
  return `<div class="card">
    <h2>Sent <span class="pill ok">${esc(result.provider)}</span></h2>
    <p class="sub">Sent “${esc(content.subject)}”${result.count > 1 ? ` to <strong>${result.count}</strong> subscribers` : ''}.</p>
    <dl class="kv">
      <dt>To</dt><dd>${esc(result.to)}</dd>
      <dt>Message id</dt><dd style="font-weight:500;color:var(--muted)">${esc(result.id || '—')}</dd>
    </dl>
    <p class="note">Check the <strong>${esc(result.to)}</strong> inbox.</p>
  </div>`;
}

/** Run a manage action (seed/clear/delete/settings) and return a flash card. */
async function manageFlash(fn, okMsg) {
  try {
    const result = await fn();
    return `<div class="card"><h2>Done <span class="pill ok">ok</span></h2><p class="sub">${esc(okMsg(result))}</p></div>`;
  } catch (err) {
    return `<div class="card"><h2>Failed <span class="pill bad">error</span></h2><p class="sub">${esc(err.message)}</p></div>`;
  }
}

// Public unsubscribe pages (domain mode) — reachable without the console password.
function unsubscribeConfirmPage({ token, name, error = '', already = false }) {
  if (error) {
    return page({ title: 'Unsubscribe', body: `${masthead('Unsubscribe', '')}
      <div class="card"><h2>Link problem <span class="pill bad">error</span></h2><p class="sub">${esc(error)}</p></div>` });
  }
  if (already) {
    return page({ title: 'Unsubscribe', body: `${masthead('Already unsubscribed', '')}
      <div class="card"><h2>You're unsubscribed <span class="pill ok">done</span></h2>
      <p class="sub">${esc(name || 'This address')} won't receive these emails. Nothing more to do.</p></div>` });
  }
  return page({ title: 'Unsubscribe', body: `${masthead('Unsubscribe', '')}
    <form class="card" method="POST" action="/unsubscribe">
      <h2>Stop these emails?</h2>
      <p class="sub">Confirm to remove ${esc(name || 'this address')} from the ${esc(brand())} list. You can re-sign up any time.</p>
      <input type="hidden" name="token" value="${esc(token)}">
      <button class="btn gold full" type="submit">Yes, unsubscribe me</button>
    </form>` });
}

function unsubscribeDonePage(email) {
  return page({ title: 'Unsubscribed', body: `${masthead('Unsubscribed', '')}
    <div class="card"><h2>Done <span class="pill ok">unsubscribed</span></h2>
    <p class="sub">${esc(email || 'You')} won't receive ${esc(brand())} anymore. Sorry to see you go.</p></div>` });
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

/** Parse a form body. Uses Vercel's pre-parsed req.body when present, else the stream. */
function readForm(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') return Promise.resolve(new URLSearchParams(req.body));
    if (typeof req.body === 'object') {
      const params = new URLSearchParams();
      for (const [k, val] of Object.entries(req.body)) params.append(k, String(val));
      return Promise.resolve(params);
    }
  }
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) reject(new Error('Body too large')); // crude guard
    });
    req.on('end', () => resolve(new URLSearchParams(data)));
    req.on('error', reject);
  });
}

/** Parse the query string off a request URL. */
function readQuery(req) {
  const qs = (req.url || '').split('?')[1] || '';
  return new URLSearchParams(qs);
}

const send = (res, status, html, type = 'text/html; charset=utf-8') => {
  res.writeHead(status, { 'Content-Type': type });
  res.end(html);
};

/** HTTP Basic Auth gate. Returns true if allowed; otherwise writes a 401 and returns false. */
function authorized(req, res) {
  const pass = process.env.CONSOLE_PASSWORD;
  if (!pass) return true; // no gate configured (local dev)

  const user = process.env.CONSOLE_USER || 'admin';
  const header = req.headers['authorization'] || '';
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const i = decoded.indexOf(':');
    if (decoded.slice(0, i) === user && decoded.slice(i + 1) === pass) return true;
  }

  res.writeHead(401, {
    'WWW-Authenticate': `Basic realm="${brand()} console", charset="UTF-8"`,
    'Content-Type': 'text/plain; charset=utf-8',
  });
  res.end('Authentication required.');
  return false;
}

// ---------------------------------------------------------------------------
// The handler (no server here — see serve.mjs / api/index.js)
// ---------------------------------------------------------------------------
export async function handler(req, res) {
  const url = (req.url || '/').split('?')[0];
  const method = req.method || 'GET';

  try {
    if (method === 'GET' && url === '/healthz') return send(res, 200, 'ok', 'text/plain; charset=utf-8');

    // Unsubscribe is PUBLIC (recipients click it from an email) — handle before the gate.
    if (url === '/unsubscribe') {
      if (method === 'GET') {
        const token = readQuery(req).get('token') || '';
        if (!token) return send(res, 400, unsubscribeConfirmPage({ token, error: 'Missing unsubscribe token.' }));
        try {
          const row = await getSignupByToken(token);
          if (!row) return send(res, 404, unsubscribeConfirmPage({ token, error: 'This unsubscribe link is not valid.' }));
          return send(res, 200, unsubscribeConfirmPage({ token, name: row.name, already: Boolean(row.unsubscribed_at) }));
        } catch (err) {
          return send(res, 500, unsubscribeConfirmPage({ token, error: err.message }));
        }
      }
      if (method === 'POST') {
        const token = (await readForm(req)).get('token') || '';
        try {
          const row = await unsubscribeByToken(token);
          if (!row) return send(res, 404, unsubscribeConfirmPage({ token, error: 'This unsubscribe link is not valid.' }));
          return send(res, 200, unsubscribeDonePage(row.email));
        } catch (err) {
          return send(res, 500, unsubscribeConfirmPage({ token, error: err.message }));
        }
      }
    }

    // Everything else is behind the password gate (when configured).
    if (!authorized(req, res)) return;

    if (method === 'GET' && (url === '/' || url === '/index.html')) return send(res, 200, dashboardPage());
    if (method === 'GET' && url === '/preview') return send(res, 200, renderEmail(await getContentOrSample()));
    if (method === 'GET' && url === '/signup') return send(res, 200, signupPage());

    if (method === 'POST' && url === '/signup') {
      const form = await readForm(req);
      const values = { name: form.get('name'), email: form.get('email'), company: form.get('company') };
      if (!form.get('consent')) {
        return send(res, 200, signupPage({ values, error: 'Please tick the box to confirm you want to sign up.' }));
      }
      if (!values.name?.trim() || !values.email?.trim()) {
        return send(res, 200, signupPage({ values, error: 'Name and email are both required.' }));
      }
      try {
        const row = await addSignup(values);
        return send(res, 200, signupSuccessPage(row));
      } catch (err) {
        return send(res, 200, signupPage({ values, error: err.message }));
      }
    }

    if (method === 'GET' && url === '/admin') return send(res, 200, await adminPage());

    if (method === 'POST' && url === '/settings') {
      const form = await readForm(req);
      const flash = await manageFlash(() => setRecipient(form.get('recipient')), (email) => `Recipient saved: ${email}`);
      return send(res, 200, await adminPage({ flash }));
    }

    if (method === 'POST' && url === '/send-now') {
      let flash;
      try {
        const { content, result } = await runEmail({ send: true });
        flash = sendResultFlash({ ok: true, content, result });
      } catch (err) {
        flash = sendResultFlash({ ok: false, error: err.message });
      }
      return send(res, 200, await adminPage({ flash }));
    }

    if (method === 'POST' && url === '/seed') {
      const flash = await manageFlash(() => seedSubscribers(), (n) => `Seeded ${n} subscribers.`);
      return send(res, 200, await adminPage({ flash }));
    }

    if (method === 'POST' && url === '/clear') {
      const flash = await manageFlash(() => clearSubscribers(), (n) => `Cleared ${n} subscriber${n === 1 ? '' : 's'}.`);
      return send(res, 200, await adminPage({ flash }));
    }

    if (method === 'POST' && url === '/delete') {
      const form = await readForm(req);
      const flash = await manageFlash(() => deleteSubscriber(form.get('id')), () => 'Deleted subscriber.');
      return send(res, 200, await adminPage({ flash }));
    }

    return send(res, 404, page({ title: 'Not found', body: `${masthead('404', 'No such page.')}<a class="back" href="/">← Back to console</a>` }));
  } catch (err) {
    return send(res, 500, page({ title: 'Error', body: `${masthead('Something broke', esc(err.message))}<a class="back" href="/">← Back to console</a>` }));
  }
}
