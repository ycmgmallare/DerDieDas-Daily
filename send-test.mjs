import 'dotenv/config';
import nodemailer from 'nodemailer';

const { GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;

// Recipient: first CLI arg, or fall back to your own address (sends to yourself).
const to = process.argv[2] || GMAIL_USER;

if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
  console.error(
    'Missing credentials. Set GMAIL_USER and GMAIL_APP_PASSWORD in .env first.\n' +
    'GMAIL_APP_PASSWORD must be a 16-char Google App Password, NOT your normal login password.'
  );
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: GMAIL_USER,
    // App Passwords are often shown with spaces ("abcd efgh ...") — strip them so either form works.
    pass: GMAIL_APP_PASSWORD.replace(/\s+/g, ''),
  },
});

try {
  // Confirm the connection + credentials before attempting to send.
  await transporter.verify();
  console.log(`SMTP connection OK — sending as ${GMAIL_USER} → ${to}`);

  const info = await transporter.sendMail({
    from: `"Morning Briefing" <${GMAIL_USER}>`,
    to,
    subject: 'NodeMailer test email ✅',
    text: 'Plain-text body — if you can read this, SMTP works.',
    html: '<p>HTML body — if you can read this, <b>SMTP works</b>.</p>',
  });

  console.log('Sent:', info.messageId);
} catch (err) {
  console.error('Failed to send:', err.message);
  process.exit(1);
}
