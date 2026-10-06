/**
 * Email Service
 * Verification, password reset and account notices, sent over SMTP.
 *
 * Production sends through the SAI Workspace mailbox (the same one SAI Cloud uses), mounted from
 * the `story-writing-smtp` Secret:
 *   SMTP_HOST, SMTP_PORT (465 = implicit TLS, 587 = STARTTLS), SMTP_USER, SMTP_PASS
 *   MAIL_FROM   `Name <addr>` or a bare address. Gmail rewrites any From that is not the account
 *               or one of its verified aliases, so the ADDRESS must be one of those; the display
 *               name is ours (MAIL_FROM_NAME, default "Fiction Writing Studio").
 *   APP_URL     where links in emails point (falls back to CLIENT_URL).
 *
 * With no SMTP_HOST, development logs the email instead; production throws, so a caller never
 * reports "sent" for a mail that went nowhere.
 */

import nodemailer from 'nodemailer';

const APP_NAME = 'Fiction Writing Studio';
const APP_URL = (process.env.APP_URL || process.env.CLIENT_URL || 'https://story-writing.solutionsai.co.uk').replace(/\/+$/, '');
const IS_PROD = process.env.NODE_ENV === 'production';

function parseFrom() {
  const raw = (process.env.MAIL_FROM || process.env.SMTP_USER || '').trim();
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(raw);
  const address = m ? m[2].trim() : raw;
  const name = process.env.MAIL_FROM_NAME || APP_NAME;
  return { name, address };
}

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) return null;
  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
  return transporter;
}

function isConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && parseFrom().address);
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* One plain layout for every email: ORDNANCE paper and ink, no images, no emoji. */
function layout({ heading, paragraphs, action, footnote }) {
  const p = paragraphs.map((t) => `<p style="margin:0 0 14px">${t}</p>`).join('');
  const button = action ? `
      <p style="margin:24px 0">
        <a href="${escapeHtml(action.url)}" style="display:inline-block;background:#1f3a5f;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:4px;font-weight:600">${escapeHtml(action.label)}</a>
      </p>
      <p style="margin:0 0 14px;font-size:13px;color:#5b6470">Or paste this link into your browser:<br>
        <span style="word-break:break-all">${escapeHtml(action.url)}</span></p>` : '';
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:24px;background:#f4f1ea;font-family:Georgia,'Times New Roman',serif;color:#1d2329">
  <div style="max-width:560px;margin:0 auto;background:#fffdf8;border:1px solid #d9d3c4;border-radius:6px">
    <div style="padding:20px 28px;border-bottom:1px solid #d9d3c4;font-family:Arial,sans-serif;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#1f3a5f">${APP_NAME}</div>
    <div style="padding:28px;font-size:16px;line-height:1.55">
      <h1 style="margin:0 0 18px;font-size:22px;font-weight:600">${heading}</h1>
      ${p}${button}
      ${footnote ? `<p style="margin:18px 0 0;font-size:13px;color:#5b6470">${footnote}</p>` : ''}
    </div>
  </div>
  <p style="max-width:560px;margin:14px auto 0;font-family:Arial,sans-serif;font-size:12px;color:#7a8089;text-align:center">Sent by ${APP_NAME} &middot; ${escapeHtml(APP_URL.replace(/^https?:\/\//, ''))}. Replies to this address are not read.</p>
</body></html>`;
}

function text({ heading, paragraphs, action, footnote }) {
  const strip = (s) => String(s).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return [strip(heading), '', ...paragraphs.map(strip).flatMap((t) => [t, '']),
    ...(action ? [`${action.label}: ${action.url}`, ''] : []),
    ...(footnote ? [strip(footnote), ''] : []),
    '--', `${APP_NAME} - ${APP_URL}`].join('\n');
}

async function sendVerificationEmail(email, name, verificationToken) {
  const url = `${APP_URL}/verify-email?token=${encodeURIComponent(verificationToken)}`;
  const body = {
    heading: 'Confirm your email address',
    paragraphs: [
      `Hi ${escapeHtml(name)},`,
      `Thanks for signing up to ${APP_NAME}. Confirm this is your email address to unlock every feature.`,
    ],
    action: { label: 'Confirm email address', url },
    footnote: 'This link expires in 24 hours. If you did not create an account, you can ignore this email.',
  };
  return sendEmail({ to: email, subject: `Confirm your email - ${APP_NAME}`, html: layout(body), text: text(body) });
}

async function sendWelcomeEmail(email, name) {
  const body = {
    heading: 'Your email is confirmed',
    paragraphs: [
      `Hi ${escapeHtml(name)},`,
      'Your account is fully set up. Start a new book, pick a template, or bring in a manuscript you already have.',
    ],
    action: { label: 'Start writing', url: APP_URL },
  };
  return sendEmail({ to: email, subject: `Welcome to ${APP_NAME}`, html: layout(body), text: text(body) });
}

async function sendPasswordResetEmail(email, name, resetToken) {
  const url = `${APP_URL}/reset-password?token=${encodeURIComponent(resetToken)}`;
  const body = {
    heading: 'Reset your password',
    paragraphs: [
      `Hi ${escapeHtml(name || 'there')},`,
      'Someone asked to reset the password for this account. If it was you, choose a new one with the button below.',
    ],
    action: { label: 'Choose a new password', url },
    footnote: 'This link expires in 1 hour and works once. If you did not ask for this, ignore this email; your password stays the same.',
  };
  return sendEmail({ to: email, subject: `Reset your password - ${APP_NAME}`, html: layout(body), text: text(body) });
}

async function sendPasswordChangedEmail(email, name) {
  const body = {
    heading: 'Your password was changed',
    paragraphs: [
      `Hi ${escapeHtml(name || 'there')},`,
      `The password for your ${APP_NAME} account was just changed.`,
      'If this was not you, reset your password straight away using "Forgot password" on the sign-in page.',
    ],
    action: { label: 'Sign in', url: APP_URL },
  };
  return sendEmail({ to: email, subject: `Your password was changed - ${APP_NAME}`, html: layout(body), text: text(body) });
}

async function sendEmail({ to, subject, html, text: plain }) {
  const transport = getTransporter();
  if (!transport || !isConfigured()) {
    if (IS_PROD) throw new Error('Email is not configured (SMTP_HOST/SMTP_USER/SMTP_PASS/MAIL_FROM)');
    console.log(`\n[email:dev] to=${to} subject=${subject}\n${plain}\n`);
    return { success: true, messageId: 'dev-mode' };
  }
  const from = parseFrom();
  try {
    const info = await transport.sendMail({ from: { name: from.name, address: from.address }, to, subject, text: plain, html });
    console.log(`[email] sent "${subject}" id=${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    // Never log the message body: it carries live verification and reset tokens.
    console.error(`[email] send failed "${subject}": ${error.code || ''} ${error.responseCode || ''} ${error.message}`);
    throw new Error('Failed to send email');
  }
}

/* Boot-time check, so a wrong app password shows up in the logs at startup, not at the first signup. */
async function verifyEmailTransport() {
  const transport = getTransporter();
  if (!transport || !isConfigured()) {
    console.warn(`[email] not configured${IS_PROD ? ' - verification and reset emails will FAIL' : ' (dev: emails are logged)'}`);
    return false;
  }
  try {
    await transport.verify();
    console.log(`[email] SMTP ready (${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 465}, from ${parseFrom().address})`);
    return true;
  } catch (error) {
    console.error(`[email] SMTP check failed: ${error.code || ''} ${error.message}`);
    return false;
  }
}

export {
  sendVerificationEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
  sendEmail,
  verifyEmailTransport,
  isConfigured as isEmailConfigured,
};
