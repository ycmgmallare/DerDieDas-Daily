// Local daily scheduler.
//
// Uses node-cron to run the send pipeline every day at SEND_CRON (default 7:00 AM)
// in SEND_TZ. The `timezone` option means it fires at that wall-clock regardless
// of the machine's system timezone.
//
//   node scheduler.mjs          start the scheduler (stays running)
//   node scheduler.mjs --now    fire one send immediately, then keep scheduling
//
// Tunables via .env (optional):
//   SEND_CRON=0 7 * * *         cron expression (default: 7:00 AM)
//   SEND_TZ=Asia/Manila         IANA timezone (default: Asia/Manila)
//   EMAIL_PROVIDER=resend       gmail | resend
//   EMAIL_AUDIENCE=personal     personal | domain
//
// NOTE: this in-process scheduler is for LOCAL use. In the cloud (Render Cron Job)
// we run `node index.js` on a schedule instead — see render.yaml. node-cron only
// fires while THIS script runs and the machine is awake.

import 'dotenv/config';
import cron from 'node-cron';
import { runEmail } from './run.js';

const CRON = process.env.SEND_CRON || '0 7 * * *'; // 7:00 AM daily
const TZ = process.env.SEND_TZ || 'Asia/Manila';

function stamp() {
  return new Date().toLocaleString('en-US', { timeZone: TZ, hour12: false });
}

async function runDaily() {
  console.log(`\n[${stamp()} ${TZ}] Running daily send…`);
  try {
    const { result } = await runEmail({ send: true });
    console.log(`[${stamp()} ${TZ}] ✅ Sent via ${result.provider} → ${result.to} (id: ${result.id})`);
  } catch (err) {
    // Log and keep the scheduler alive — one bad run shouldn't kill the job.
    console.error(`[${stamp()} ${TZ}] ❌ Send failed: ${err.message}`);
  }
}

if (!cron.validate(CRON)) {
  console.error(`Invalid SEND_CRON expression: "${CRON}"`);
  process.exit(1);
}

const task = cron.schedule(CRON, runDaily, {
  timezone: TZ,
  name: 'daily-email',
  noOverlap: true, // skip a run if the previous one is still in flight
});

const next = task.getNextRun();
console.log('📅 Daily email scheduler armed.');
console.log(`   Schedule : ${CRON}  (${TZ})`);
console.log(`   Provider : ${(process.env.EMAIL_PROVIDER || 'resend')}`);
console.log(`   Audience : ${(process.env.EMAIL_AUDIENCE || 'personal')}`);
console.log(`   Next run : ${next ? next.toLocaleString('en-US', { timeZone: TZ, hour12: true }) + ` ${TZ}` : 'unknown'}`);
console.log('   Keep this process running. Stop with Ctrl+C.\n');

// --now: fire one immediate send for testing, then keep scheduling.
if (process.argv.includes('--now')) {
  console.log('▶ --now: sending one email immediately…');
  task.execute();
}
