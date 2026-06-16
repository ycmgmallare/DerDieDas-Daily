// Shared pipeline — the single source of truth for "load the content and
// (optionally) send it". Used by the CLI (index.js), the local scheduler
// (scheduler.mjs), the cron function (api/cron.js), and the console (app.js).
//
//   content.js    → WHAT the email says (read from the content file)
//   subscribers.js→ WHO it goes to (personal recipient | domain subscribers)
//   email.js      → renders + delivers, fanning out per recipient

import { getContent } from './content.js';
import { sendEmail } from './email.js';

/**
 * Load the content file and (optionally) send it to the configured audience.
 * @param {object} [opts]
 * @param {'gmail'|'resend'} [opts.provider]  override EMAIL_PROVIDER
 * @param {boolean} [opts.send=true]          set false to load without sending
 * @returns {Promise<{ content: object, result: object|null }>}
 */
export async function runEmail({ provider, send = true } = {}) {
  const content = await getContent();

  let result = null;
  if (send) {
    result = await sendEmail({ content, provider });
  }

  return { content, result };
}
