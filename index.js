// Email automation runner (CLI).
//
// Flow: read the content file -> print it -> send to the configured audience
// (EMAIL_AUDIENCE: personal | domain). The pipeline lives in run.js (shared with
// scheduler.mjs, api/cron.js, and the web console).
//
// Usage:
//   node index.js                 # send the current content to the audience
//   node index.js --no-send       # load + print only, no email
//   node index.js --provider gmail

import 'dotenv/config';
import { runEmail } from './run.js';
import { renderText } from './email-template.js';

function parseArgs(argv) {
  const args = { provider: undefined, send: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--provider') args.provider = argv[++i];
    else if (arg === '--no-send') args.send = false;
  }
  return args;
}

async function main() {
  const { provider, send } = parseArgs(process.argv.slice(2));

  console.log(`\n📧 ${process.env.BRAND_NAME || 'Daily Email'} — audience: ${process.env.EMAIL_AUDIENCE || 'personal'}\n`);

  const { content, result } = await runEmail({ provider, send });

  console.log('─'.repeat(60));
  console.log(`Subject: ${content.subject}`);
  console.log(renderText(content));
  console.log('─'.repeat(60) + '\n');

  if (result) {
    console.log(`✅ Sent via ${result.provider} → ${result.to} (id: ${result.id})`);
  } else {
    console.log('Skipping send (--no-send).');
  }
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}\n`);
  process.exit(1);
});
