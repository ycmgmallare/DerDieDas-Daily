// Shared email render layer — generic (subject + title + body).
//
// One source of truth for how the email looks, used by BOTH the web preview
// (app.js /preview) and the real sends (email.js). The HTML is email-safe
// (table layout + inline styles) so it renders the same in Gmail/Resend and a
// browser, with a refined editorial look. The BODY is arbitrary HTML produced by
// content.js — this layer only frames it (masthead, title, footer).
//
// Both renderers take an optional opts.unsubscribeUrl (domain mode); when present
// an "Unsubscribe" line is appended to the footer.

// ---------------------------------------------------------------------------
// Design tokens (kept here so the whole template stays consistent)
// ---------------------------------------------------------------------------
const C = {
  paper: '#efe9dd', // warm page background
  surface: '#fbf8f2', // card surface
  ink: '#1d1b26', // primary text
  muted: '#75727f', // secondary text
  hair: '#e3ddd0', // hairline borders
  gold: '#b07d35', // brand accent (honey/amber)
};

const FONT_DISPLAY = "'Fraunces', Georgia, 'Times New Roman', serif";
const FONT_BODY =
  "'Inter Tight', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

const brand = () => process.env.BRAND_NAME || 'Daily Email';

function esc(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Public: full HTML email document
// @param {{subject:string,title?:string,bodyHtml:string}} content
// @param {{unsubscribeUrl?:string|null}} [opts]
// ---------------------------------------------------------------------------
export function renderEmail(content, opts = {}) {
  const { title = '', bodyHtml = '' } = content || {};
  const unsub = opts.unsubscribeUrl
    ? `<br><a href="${esc(opts.unsubscribeUrl)}" style="color:${C.muted}; text-decoration:underline;">Unsubscribe</a> from these emails.`
    : '';

  const heading = title
    ? `<div style="font-family:${FONT_DISPLAY}; font-size:34px; line-height:1.12; font-weight:600; color:${C.ink}; letter-spacing:-0.03em; margin-top:14px;">${esc(title)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<title>${esc(content?.subject || brand())}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter+Tight:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  body { margin:0; padding:0; background:${C.paper}; }
  .bg-wrap {
    background:
      radial-gradient(900px 420px at 12% -8%, rgba(176,125,53,0.10), transparent 60%),
      radial-gradient(820px 480px at 100% 0%, rgba(79,111,107,0.08), transparent 55%),
      ${C.paper};
  }
  a { color:${C.gold}; }
  .post p { font-family:${FONT_BODY}; font-size:15px; line-height:1.7; color:${C.ink}; margin:0 0 16px; }
  .post h2 { font-family:${FONT_DISPLAY}; font-size:21px; font-weight:600; color:${C.ink}; letter-spacing:-0.01em; margin:26px 0 10px; }
  .post h3 { font-family:${FONT_DISPLAY}; font-size:17px; font-weight:600; color:${C.ink}; margin:22px 0 8px; }
  .post ul { font-family:${FONT_BODY}; font-size:15px; line-height:1.7; color:${C.ink}; padding-left:20px; margin:0 0 16px; }
  .post code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:0.92em; background:rgba(29,27,38,0.05); padding:1px 5px; border-radius:5px; }
  @media (max-width:620px){ .container { width:100% !important; } .pad { padding-left:18px !important; padding-right:18px !important; } }
</style>
</head>
<body>
<div class="bg-wrap" style="padding:40px 12px;">
  <table role="presentation" class="container" width="600" align="center" cellpadding="0" cellspacing="0" style="width:600px; max-width:600px; margin:0 auto; border-collapse:collapse;">

    <!-- Masthead -->
    <tr>
      <td class="pad" style="padding:4px 8px 18px 8px;">
        <div style="font-family:${FONT_BODY}; font-size:11px; font-weight:700; letter-spacing:0.22em; text-transform:uppercase; color:${C.gold};">
          ◆&nbsp;&nbsp;${esc(brand())}
        </div>
        ${heading}
      </td>
    </tr>

    <!-- Body card -->
    <tr>
      <td class="pad" style="padding:0 8px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate; background:${C.surface}; border:1px solid ${C.hair}; border-radius:18px; box-shadow:0 1px 2px rgba(29,27,38,0.04), 0 18px 40px -22px rgba(29,27,38,0.22);">
          <tr>
            <td class="post" style="padding:28px 28px 12px;">
              ${bodyHtml}
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td class="pad" style="padding:16px 8px 8px 8px;">
        <div style="border-top:1px solid ${C.hair}; padding-top:18px; font-family:${FONT_BODY}; font-size:12px; line-height:1.6; color:${C.muted};">
          Sent by ${esc(brand())}.${unsub}
        </div>
      </td>
    </tr>

  </table>
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Public: plain-text version (email fallback + console output)
// ---------------------------------------------------------------------------
export function renderText(content, opts = {}) {
  const { title = '', bodyText = '' } = content || {};
  const lines = [];
  if (title) {
    lines.push(title);
    lines.push('='.repeat(Math.min(title.length, 52)));
    lines.push('');
  }
  lines.push(bodyText.trim());
  lines.push('');
  lines.push(`— ${brand()}`);
  if (opts.unsubscribeUrl) {
    lines.push('');
    lines.push(`Unsubscribe: ${opts.unsubscribeUrl}`);
  }
  return lines.join('\n');
}
