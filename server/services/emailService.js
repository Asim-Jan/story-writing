/**
 * Email Service
 * Handles sending emails for verification, password reset, notifications, etc.
 *
 * IMPORTANT: This uses nodemailer. Install with: npm install nodemailer
 * Configure environment variables:
 * - SMTP_HOST (e.g., smtp.gmail.com)
 * - SMTP_PORT (e.g., 587)
 * - SMTP_USER (your email)
 * - SMTP_PASS (app password)
 * - FROM_EMAIL (sender email)
 * - FROM_NAME (sender name)
 */

import nodemailer from 'nodemailer';

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://story-writing.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@story-writing.com';
const FROM_NAME = process.env.FROM_NAME || 'Fiction Writing Studio';

// Create transporter
let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  // For development: use ethereal email (test email service)
  if (process.env.NODE_ENV === 'development' && !process.env.SMTP_HOST) {
    console.log('⚠️  Using development email mode (emails logged to console)');
    return null;
  }

  // Production: use real SMTP
  transporter = nodemailer.createTransporter({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  return transporter;
}

/**
 * Send email verification email
 */
async function sendVerificationEmail(email, name, verificationToken) {
  const verificationUrl = `${FRONTEND_URL}/verify-email?token=${verificationToken}`;

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      text-align: center;
      border-radius: 10px 10px 0 0;
    }
    .content {
      background: #f9f9f9;
      padding: 30px;
      border-radius: 0 0 10px 10px;
    }
    .button {
      display: inline-block;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 15px 30px;
      text-decoration: none;
      border-radius: 5px;
      margin: 20px 0;
      font-weight: bold;
    }
    .footer {
      text-align: center;
      margin-top: 30px;
      color: #666;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>📚 Fiction Writing Studio</h1>
    <p>Verify Your Email Address</p>
  </div>
  <div class="content">
    <h2>Hi ${name}!</h2>
    <p>Welcome to Fiction Writing Studio! We're excited to have you on board.</p>
    <p>To get started and unlock all features, please verify your email address by clicking the button below:</p>
    <div style="text-align: center;">
      <a href="${verificationUrl}" class="button">Verify Email Address</a>
    </div>
    <p>Or copy and paste this link into your browser:</p>
    <p style="background: white; padding: 10px; border-radius: 5px; word-break: break-all;">
      ${verificationUrl}
    </p>
    <p><strong>This link will expire in 24 hours.</strong></p>
    <p>If you didn't create an account with us, you can safely ignore this email.</p>
  </div>
  <div class="footer">
    <p>&copy; ${new Date().getFullYear()} Fiction Writing Studio. All rights reserved.</p>
    <p>This is an automated message, please do not reply to this email.</p>
  </div>
</body>
</html>
  `;

  const textContent = `
Hi ${name}!

Welcome to Fiction Writing Studio! We're excited to have you on board.

To get started and unlock all features, please verify your email address by clicking this link:
${verificationUrl}

This link will expire in 24 hours.

If you didn't create an account with us, you can safely ignore this email.

---
© ${new Date().getFullYear()} Fiction Writing Studio. All rights reserved.
This is an automated message, please do not reply to this email.
  `;

  return sendEmail({
    to: email,
    subject: 'Verify Your Email - Fiction Writing Studio',
    html: htmlContent,
    text: textContent
  });
}

/**
 * Send welcome email after verification
 */
async function sendWelcomeEmail(email, name) {
  const loginUrl = `${FRONTEND_URL}`;

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
    .button { display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
    .feature-list { background: white; padding: 20px; border-radius: 5px; margin: 20px 0; }
    .feature-list li { margin: 10px 0; }
    .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🎉 Welcome to Fiction Writing Studio!</h1>
  </div>
  <div class="content">
    <h2>Hi ${name}!</h2>
    <p>Your email has been verified successfully! You now have full access to all features.</p>

    <h3>🚀 Get Started:</h3>
    <div class="feature-list">
      <ul>
        <li>✍️ Create your first book or start from a template</li>
        <li>🤖 Use AI writing tools to enhance your creativity</li>
        <li>🎨 Generate character images and visual content</li>
        <li>📊 Track your writing goals and progress</li>
        <li>🔄 Enable autosave and version control</li>
      </ul>
    </div>

    <div style="text-align: center;">
      <a href="${loginUrl}" class="button">Start Writing</a>
    </div>

    <p>Need help getting started? Check out our tutorials and guides in your profile settings.</p>
    <p>Happy writing!</p>
  </div>
  <div class="footer">
    <p>&copy; ${new Date().getFullYear()} Fiction Writing Studio. All rights reserved.</p>
  </div>
</body>
</html>
  `;

  const textContent = `
Welcome to Fiction Writing Studio!

Hi ${name}!

Your email has been verified successfully! You now have full access to all features.

Get Started:
- Create your first book or start from a template
- Use AI writing tools to enhance your creativity
- Generate character images and visual content
- Track your writing goals and progress
- Enable autosave and version control

Visit ${loginUrl} to start writing!

Need help getting started? Check out our tutorials and guides in your profile settings.

Happy writing!

---
© ${new Date().getFullYear()} Fiction Writing Studio. All rights reserved.
  `;

  return sendEmail({
    to: email,
    subject: 'Welcome to Fiction Writing Studio! 🎉',
    html: htmlContent,
    text: textContent
  });
}

/**
 * Generic send email function
 */
async function sendEmail({ to, subject, html, text }) {
  const transport = getTransporter();

  // Development mode: just log the email
  if (!transport) {
    console.log('\n📧 EMAIL (Development Mode):');
    console.log('To:', to);
    console.log('Subject:', subject);
    console.log('Text:', text);
    console.log('HTML:', html.substring(0, 200) + '...');
    console.log('---\n');
    return { success: true, messageId: 'dev-mode' };
  }

  try {
    const info = await transport.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to,
      subject,
      text,
      html
    });

    console.log('✅ Email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Error sending email:', error);
    throw new Error('Failed to send email');
  }
}

export {
  sendVerificationEmail,
  sendWelcomeEmail,
  sendEmail
};
