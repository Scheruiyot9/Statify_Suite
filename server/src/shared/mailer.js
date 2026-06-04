const nodemailer = require('nodemailer');
const env = require('../config/env');

let _transporter = null;

function buildTransporter() {
  return nodemailer.createTransport({
    host:   env.email.host,
    port:   env.email.port,
    secure: env.email.secure,
    auth:   { user: env.email.user, pass: env.email.pass },
  });
}

function getTransporter() {
  if (_transporter) return _transporter;
  if (!env.email.host || !env.email.user || !env.email.pass) return null;
  _transporter = buildTransporter();
  return _transporter;
}

// Call once at server startup to surface config problems early
async function verifyMailer() {
  if (!env.email.host || !env.email.user || !env.email.pass) {
    console.log('[MAILER] SMTP not configured — emails will log to console only');
    return;
  }
  try {
    const t = buildTransporter();
    await t.verify();
    console.log(`[MAILER] SMTP ready: ${env.email.user} → ${env.email.host}:${env.email.port}`);
    _transporter = t;
  } catch (err) {
    console.error(`[MAILER] SMTP verification failed: ${err.message}`);
    _transporter = null;
  }
}

async function sendMail({ to, subject, html, text }) {
  const transport = getTransporter();

  if (!transport) {
    console.log('\n[MAILER — no SMTP] would send:');
    console.log(`  To     : ${to}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  Body   : ${text || '(html)'}\n`);
    return;
  }

  try {
    await transport.sendMail({ from: env.email.from, to, subject, html, text });
    console.log(`[MAILER] Sent "${subject}" → ${to}`);
  } catch (err) {
    _transporter = null;
    console.error(`[MAILER] Failed to send to ${to}: ${err.message}`);
  }
}

module.exports = { sendMail, verifyMailer };
