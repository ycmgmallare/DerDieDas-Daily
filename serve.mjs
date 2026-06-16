// Local launcher for the Morning Briefing web console.
//
// The request handler lives in app.js (shared with the Vercel function in
// api/index.js). This file just wraps it in a Node HTTP server for local use.
//
//   node serve.mjs            -> http://localhost:3000
//
// Routes (see app.js): / · /signup · /admin · /preview · /unsubscribe · /healthz
//
// Auth: set CONSOLE_PASSWORD in .env to require a login (otherwise open locally).
// NOTE: /admin can send real email and write/delete your database.

import 'dotenv/config';
import http from 'node:http';
import { handler } from './app.js';

const PORT = process.env.PORT || 3000;

http.createServer(handler).listen(PORT, () => {
  console.log(`\n📨 Morning Briefing — web console:`);
  console.log(`   → http://localhost:${PORT}\n`);
  console.log(`   /signup   add a signup to Supabase`);
  console.log(`   /admin    manage signups, set recipient + send a briefing now`);
  console.log(`   /preview  email template preview`);
  console.log(`\n   ${process.env.CONSOLE_PASSWORD ? 'Password gate ON.' : 'No password (set CONSOLE_PASSWORD to enable).'} Sends real email. Ctrl+C to stop.\n`);
});
