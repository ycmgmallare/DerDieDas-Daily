// Provider-agnostic email sender.
//
// Picks the transport from EMAIL_PROVIDER (default "resend"), or an explicit
// `provider` argument. The HTML body comes from the shared template
// (email-template.js) wrapping the content from content.js.
//   - resend : Resend transactional API
//   - gmail  : NodeMailer over Gmail SMTP
//
// Recipient resolution is keyed on EMAIL_AUDIENCE:
//   personal — one recipient: the stored setting / RESEND_TO.
//   domain   — every active subscriber, each emailed individually so the footer
//              can carry that person's own unsubscribe link.

import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { renderEmail, renderText } from './email-template.js';
import { getRecipient, getActiveSubscribers } from './subscribers.js';

/**
 * Send the given content to the audience configured by EMAIL_AUDIENCE.
 * @param {{ content: {subject:string,title?:string,bodyHtml:string,bodyText:string}, provider?: 'gmail'|'resend' }} opts
 * @returns {Promise<{ provider: string, to: string, id: string, count: number }>}
 */
export async function sendEmail({ content, provider }) {
  const chosen = (provider || process.env.EMAIL_PROVIDER || 'resend').toLowerCase();
  if (chosen !== 'resend' && chosen !== 'gmail') {
    throw new Error(`Unknown EMAIL_PROVIDER "${chosen}". Use "gmail" or "resend".`);
  }
  const subject = content?.subject || process.env.BRAND_NAME || 'Daily Email';

  const recipients = await resolveRecipients();
  if (recipients.length === 0) {
    throw new Error(
      isDomain()
        ? 'No active subscribers to send to. Add signups via /signup.'
        : 'No recipient configured. Set one on /admin, or set RESEND_TO in .env.'
    );
  }

  const results = [];
  for (const r of recipients) {
    const html = renderEmail(content, { unsubscribeUrl: r.unsubscribeUrl });
    const text = renderText(content, { unsubscribeUrl: r.unsubscribeUrl });
    const one =
      chosen === 'resend'
        ? await sendViaResend({ to: r.email, subject, text, html })
        : await sendViaGmail({ to: r.email, subject, text, html });
    results.push(one);
  }

  return {
    provider: chosen,
    to: results.length === 1 ? results[0].to : `${results.length} subscribers`,
    id: results[0]?.id,
    count: results.length,
  };
}

const isDomain = () => (process.env.EMAIL_AUDIENCE || 'personal').toLowerCase() === 'domain';

/**
 * Build the recipient list for the current audience.
 * @returns {Promise<Array<{ email: string, unsubscribeUrl: string|null }>>}
 */
async function resolveRecipients() {
  if (isDomain()) {
    const subs = await getActiveSubscribers();
    return subs
      .filter((s) => s.email)
      .map((s) => ({ email: s.email, unsubscribeUrl: unsubscribeUrl(s.token) }));
  }
  const to = await getRecipient();
  return to ? [{ email: to, unsubscribeUrl: null }] : [];
}

/** Build an unsubscribe URL from PUBLIC_BASE_URL + token (null if base unset). */
function unsubscribeUrl(token) {
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  if (!base || !token) return null;
  return `${base}/unsubscribe?token=${encodeURIComponent(token)}`;
}

async function sendViaGmail({ to, subject, text, html }) {
  const { GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    throw new Error(
      'Missing Gmail credentials. Set GMAIL_USER and GMAIL_APP_PASSWORD (16-char App Password) in .env.'
    );
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: GMAIL_USER,
      // App Passwords are often shown with spaces — strip them so either form works.
      pass: GMAIL_APP_PASSWORD.replace(/\s+/g, ''),
    },
  });

  await transporter.verify();
  const info = await transporter.sendMail({
    from: `"${process.env.BRAND_NAME || 'Daily Email'}" <${GMAIL_USER}>`,
    to,
    subject,
    text,
    html,
  });

  return { provider: 'gmail', id: info.messageId, to };
}

async function sendViaResend({ to, subject, text, html }) {
  const { RESEND_API_KEY, RESEND_FROM } = process.env;
  if (!RESEND_API_KEY || !RESEND_FROM) {
    throw new Error('Missing Resend config. Set RESEND_API_KEY and RESEND_FROM in .env.');
  }

  const resend = new Resend(RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: RESEND_FROM,
    to,
    subject,
    text,
    html,
  });

  if (error) {
    throw new Error(`Resend failed: ${error.message || JSON.stringify(error)}`);
  }
  return { provider: 'resend', id: data?.id, to };
}
