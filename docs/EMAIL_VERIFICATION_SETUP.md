# Email Verification Setup Guide

## Overview

This document describes the email verification system implemented in Fiction Writing Studio v2.22.0. The system requires users to verify their email addresses to ensure account ownership and prevent spam registrations.

## Features

### 🔒 Security Enhancements
- **Strong Password Requirements**: Minimum 8 characters with uppercase, lowercase, numbers, and special characters
- **Password Strength Indicator**: Real-time visual feedback on password strength
- **Rate Limiting**: 3 registrations per hour per IP to prevent spam
- **Email Verification**: Users must verify email within 24 hours
- **Audit Trail**: All verification actions are logged

### 📧 Email System
- Verification emails sent automatically on registration
- Welcome emails sent after successful verification
- Resend verification email option
- Development mode (logs to console) and production mode (SMTP)

## Database Setup

### Run Migration

The email verification system requires database schema changes:

```bash
# Run the migration script
node server/scripts/run-email-verification-migration.js
```

### What the Migration Does

1. **Adds columns to `users` table**:
   - `email_verified` (BOOLEAN) - Default: false
   - `email_verification_token` (VARCHAR 255) - Unique token
   - `email_verification_token_expires` (TIMESTAMPTZ) - 24-hour expiry

2. **Creates `email_verification_log` table**:
   - Tracks all verification actions (sent, verified, resent, expired)
   - Includes user_id, email, action type, token, IP address, user agent
   - Used for audit trail and security monitoring

### Verify Migration

```bash
# Check if columns were added
psql -d story_writing -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users' AND column_name LIKE 'email%';"

# Check if log table was created
psql -d story_writing -c "\dt email_verification_log"
```

## Email Configuration

### Environment Variables

Add these to your `.env` file:

```env
# Email Configuration (Production)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
FROM_EMAIL=noreply@story-writing.com
FROM_NAME=Fiction Writing Studio

# Frontend URL (for verification links)
FRONTEND_URL=https://story-writing.com
```

### Gmail Setup (Recommended for Testing)

1. Enable 2-Factor Authentication in your Google account
2. Generate an App Password:
   - Go to: https://myaccount.google.com/apppasswords
   - Select "Mail" and "Other"
   - Copy the 16-character password
   - Use this as `SMTP_PASS`

### Development Mode

If `SMTP_HOST` is not configured, emails are logged to console:

```
📧 EMAIL (Development Mode):
To: user@example.com
Subject: Verify Your Email - Fiction Writing Studio
Text: [email content]
---
```

### Production SMTP Providers

**Gmail**:
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
```

**SendGrid**:
```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=your-sendgrid-api-key
```

**AWS SES**:
```env
SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=your-ses-smtp-username
SMTP_PASS=your-ses-smtp-password
```

**Mailgun**:
```env
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_USER=postmaster@your-domain.mailgun.org
SMTP_PASS=your-mailgun-smtp-password
```

## User Flow

### Registration Flow

1. **User Registers**:
   - Frontend validates password strength (client-side)
   - Backend validates password requirements (server-side)
   - Backend enforces rate limiting (3/hour per IP)

2. **Account Creation**:
   - User account created with `email_verified = false`
   - Verification token generated (UUID v4)
   - Token expires in 24 hours

3. **Verification Email Sent**:
   - Email contains verification link: `https://story-writing.com/verify-email?token=xxx`
   - Link valid for 24 hours
   - Action logged in `email_verification_log`

4. **User Logs In**:
   - Login allowed even if email not verified
   - Verification banner shown on all pages
   - "Resend Email" button available

### Verification Flow

1. **User Clicks Link**:
   - Opens `/verify-email?token=xxx` page
   - Backend validates token and expiry
   - If valid: sets `email_verified = true`, clears token
   - If invalid/expired: shows error message

2. **After Verification**:
   - Welcome email sent
   - User redirected to app
   - Verification banner removed
   - Full feature access granted

### Resend Flow

1. **User Clicks "Resend Email"**:
   - New token generated (old token invalidated)
   - New 24-hour expiry set
   - Verification email sent again
   - Action logged

## API Endpoints

### POST /api/auth/register

Register a new user account.

**Request**:
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "name": "John Doe"
}
```

**Password Requirements**:
- Minimum 8 characters
- At least 1 uppercase letter
- At least 1 lowercase letter
- At least 1 number
- At least 1 special character (!@#$%^&*...)

**Response (Success)**:
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "user",
    "tier": "free",
    "status": "active",
    "emailVerified": false
  },
  "token": "jwt-token",
  "message": "Registration successful! Please check your email to verify your account."
}
```

**Rate Limiting**: 3 requests per hour per IP

### POST /api/auth/verify-email

Verify email with token.

**Request**:
```json
{
  "token": "verification-token-from-email"
}
```

**Response (Success)**:
```json
{
  "message": "Email verified successfully!",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "emailVerified": true
  }
}
```

**Errors**:
- `400`: Invalid or expired verification token
- `500`: Server error

### POST /api/auth/resend-verification

Resend verification email (authenticated).

**Headers**:
```
Authorization: Bearer <jwt-token>
```

**Response (Success)**:
```json
{
  "message": "Verification email sent! Please check your inbox."
}
```

**Errors**:
- `400`: Email already verified
- `404`: User not found
- `500`: Failed to send email

## Frontend Components

### EmailVerificationBanner

Shows on all pages when email is not verified.

**Features**:
- Dismissible (shows again on page refresh)
- "Resend Email" button
- Success/error message display
- Mobile responsive

**Usage**:
```jsx
<EmailVerificationBanner user={user} />
```

### EmailVerificationPage

Standalone page for email verification via link.

**Route**: `/verify-email?token=xxx`

**Features**:
- Verifies token automatically on load
- Shows verification status (verifying/success/error)
- Auto-redirects to app after 3 seconds on success
- "Go to App" button

### AuthPage Updates

**New Features**:
- Password strength meter with color coding
- Real-time requirements checklist
- Show/hide password toggle (eye icon)
- Client-side validation before submission

## Security Considerations

### Password Security
- ✅ Strong password requirements enforced
- ✅ Passwords hashed with bcrypt (10 rounds)
- ✅ Real-time strength feedback to users
- ✅ Server-side validation (not just client-side)

### Email Security
- ✅ Verification tokens are UUID v4 (cryptographically secure)
- ✅ Tokens expire after 24 hours
- ✅ Tokens invalidated after use
- ✅ One-time use only

### Rate Limiting
- ✅ Registration: 3 per hour per IP
- ✅ Login: 5 failed attempts per 15 minutes
- ✅ Prevents automated attacks

### Audit Trail
- ✅ All verification actions logged
- ✅ IP address and user agent tracked
- ✅ Timestamps for all events
- ✅ Useful for security investigations

## Monitoring & Debugging

### Check Verification Status

```sql
-- Count verified vs unverified users
SELECT
  email_verified,
  COUNT(*) as count
FROM users
GROUP BY email_verified;

-- Find unverified users
SELECT email, name, created_at
FROM users
WHERE email_verified = false
ORDER BY created_at DESC
LIMIT 10;

-- Find expired tokens
SELECT email, email_verification_token_expires
FROM users
WHERE email_verified = false
  AND email_verification_token_expires < NOW()
LIMIT 10;
```

### Check Verification Log

```sql
-- Recent verification actions
SELECT
  u.email,
  v.action,
  v.ip_address,
  v.created_at
FROM email_verification_log v
JOIN users u ON v.user_id = u.id
ORDER BY v.created_at DESC
LIMIT 20;

-- Count actions by type
SELECT action, COUNT(*) as count
FROM email_verification_log
GROUP BY action
ORDER BY count DESC;
```

### Email Delivery Issues

Check server logs for email sending errors:

```bash
# Check recent logs
tail -f logs/app.log | grep -i email

# Check for email failures
grep "Failed to send" logs/app.log
```

Common issues:
1. **SMTP credentials wrong**: Check `.env` file
2. **Port blocked**: Try port 465 (SSL) instead of 587 (TLS)
3. **Gmail blocking**: Use App Password, not regular password
4. **Rate limiting**: Gmail has sending limits (500/day for free accounts)

## Testing

### Manual Testing Checklist

- [ ] Register with weak password → Should show error
- [ ] Register with strong password → Should succeed
- [ ] Check email inbox → Verification email received
- [ ] Click verification link → Should verify successfully
- [ ] Try verification link again → Should show error (already verified)
- [ ] Login before verifying → Should show banner
- [ ] Click "Resend Email" → Should receive new email
- [ ] Wait 24 hours → Token should expire
- [ ] Try 4 registrations in 1 hour → 4th should be rate limited

### Automated Testing

```bash
# Test password validation
npm test -- password-validation

# Test email sending (development mode)
NODE_ENV=development node server/test-email.js

# Test registration endpoint
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"SecurePass123!","name":"Test User"}'
```

## Troubleshooting

### "Invalid or expired verification token"

- Token expired (>24 hours old)
- Token already used
- User already verified
- **Solution**: Click "Resend Email" button

### Verification email not received

1. Check spam folder
2. Check server logs for email errors
3. Verify SMTP configuration in `.env`
4. Try "Resend Email" button
5. In development mode, check console logs

### Rate limiting blocking registrations

- Wait 1 hour
- Or clear rate limit in Redis:
  ```bash
  redis-cli
  KEYS register:*
  DEL register:192.168.1.1
  ```

### Users created before migration

Existing users won't have `email_verified` set. You can:

**Option 1: Mark all existing users as verified**:
```sql
UPDATE users
SET email_verified = true
WHERE created_at < '2026-02-18'  -- Date of migration
  AND email_verified IS NULL;
```

**Option 2: Send verification emails to all unverified users**:
```javascript
// Create admin script to bulk send verification emails
// See server/scripts/send-bulk-verification.js
```

## Future Enhancements

Potential improvements for Phase 2+:

1. **Two-Factor Authentication (2FA)**
   - Authenticator app support
   - SMS codes
   - Backup codes

2. **Social Login**
   - Google OAuth
   - GitHub OAuth
   - Faster registration

3. **Email Preferences**
   - Opt-in for newsletters
   - Notification settings
   - Marketing emails

4. **Account Recovery**
   - Security questions
   - Backup email
   - Phone number verification

5. **Session Management**
   - View active sessions
   - Remote logout
   - Device fingerprinting

## Support

For issues or questions:
- GitHub Issues: https://github.com/Asim-Jan/story-writing/issues
- Documentation: See `/docs` folder
- Security Issues: See SECURITY.md
