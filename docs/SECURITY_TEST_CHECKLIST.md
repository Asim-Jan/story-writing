# Phase 1 Security Testing Checklist

This document provides manual and automated testing procedures for all Phase 1 security improvements deployed in v1.3.0.

## Overview

**Version Tested**: 1.3.0
**Date Deployed**: 2026-01-27
**Security Fixes**: 6 critical improvements

---

## 🔐 Test 1: Book Deletion Authorization

**Critical Fix**: Book deletion now requires ownership verification.

### Automated Tests
Run: `./test-security.sh`

### Manual Tests

#### 1.1 Test unauthorized deletion (should fail)

```bash
# Get two user accounts: User A and User B
# User A creates a book
# User B tries to delete User A's book

curl -X DELETE https://your-app.com/api/books/{book-id-from-user-a} \
  -H "Authorization: Bearer {user-b-token}"

# Expected: HTTP 403 Forbidden
# Response: { "error": "Not authorized to access this book" }
```

#### 1.2 Test owner deletion (should succeed)

```bash
# User A deletes their own book

curl -X DELETE https://your-app.com/api/books/{book-id-from-user-a} \
  -H "Authorization: Bearer {user-a-token}"

# Expected: HTTP 200 OK
# Response: { "message": "Book deleted successfully" }
```

#### 1.3 Test collaborator deletion (should fail)

```bash
# User A adds User B as editor collaborator
# User B tries to delete the book

curl -X DELETE https://your-app.com/api/books/{book-id} \
  -H "Authorization: Bearer {user-b-token}"

# Expected: HTTP 403 Forbidden
# Note: Only owners can delete, not collaborators
```

### Verification
- [ ] Unauthorized users cannot delete books
- [ ] Owners can delete their own books
- [ ] Collaborators cannot delete books (owner-only action)
- [ ] Error messages are clear and appropriate

---

## 🆔 Test 2: UUID Implementation

**Fix**: User and book IDs now use UUIDs instead of timestamps.

### Manual Tests

#### 2.1 Create a new user

```bash
curl -X POST https://your-app.com/api/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@example.com",
    "password": "securepass123",
    "name": "New User"
  }'

# Check response for user ID
# Expected format: "id": "550e8400-e29b-41d4-a716-446655440000"
# Should be UUID v4 (8-4-4-4-12 hexadecimal)
```

#### 2.2 Create a new book

```bash
curl -X POST https://your-app.com/api/books \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Book",
    "description": "Security test"
  }'

# Check response for book ID
# Expected format: "id": "a3bb189e-8bf9-3888-9912-ace4e6543002"
```

#### 2.3 Check Redis directly

```bash
# SSH into your server or connect to Redis
redis-cli

# List all user keys
KEYS user:*

# Expected: Keys like "user:550e8400-e29b-41d4-a716-446655440000"
# NOT "user:1738012345678" (timestamp format)
```

### Verification
- [ ] New user IDs are UUIDs (not timestamps)
- [ ] New book IDs are UUIDs (not timestamps)
- [ ] UUIDs are v4 format (random, not predictable)
- [ ] Old users/books with timestamp IDs still work (backward compatible)

---

## 🔒 Test 3: API Key Encryption

**Critical Fix**: User API keys (OpenAI, Gemini) now encrypted at rest.

### Manual Tests

#### 3.1 Add API keys via UI or API

```bash
curl -X PUT https://your-app.com/api/user/settings \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "aiConfig": {
      "openaiApiKey": "sk-test123456789",
      "geminiApiKey": "AIza-test987654321"
    }
  }'

# Expected: HTTP 200 OK
```

#### 3.2 Check Redis storage (encrypted)

```bash
redis-cli

# Get user data
GET user:{user-id}

# Check aiConfig field in the JSON
# Expected: Keys should be encrypted (long base64 strings)
# Example: "openaiApiKey": "U2FsdGVkX1+..."
# NOT plaintext: "openaiApiKey": "sk-test123456789"
```

#### 3.3 Verify decryption works

```bash
# Generate content using AI (this will use the stored API key)
curl -X POST https://your-app.com/api/books/{book-id}/generate/description \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{ "prompt": "A fantasy story" }'

# Expected: HTTP 200 OK with generated content
# This proves the key was decrypted and used successfully
```

#### 3.4 Check environment variable

```bash
# On server
echo $ENCRYPTION_KEY

# Expected: A 32+ character random string
# If not set, falls back to SESSION_SECRET
```

### Verification
- [ ] API keys stored in encrypted format in Redis
- [ ] API keys are NOT visible in plaintext
- [ ] Decryption works (AI generation succeeds)
- [ ] ENCRYPTION_KEY environment variable is set
- [ ] Different users have different encrypted keys

---

## 📁 Test 4: Media File Access Control

**Critical Fix**: Media files now require authentication and ownership verification.

### Manual Tests

#### 4.1 Test unauthenticated access (should fail)

```bash
# Try to access media without token
curl -v https://your-app.com/api/media/images/some-image.png

# Expected: HTTP 401 Unauthorized
# Response: { "error": "Unauthorized" }
```

#### 4.2 Test unauthorized access (should fail)

```bash
# User A uploads an image to their book
# User B tries to access User A's image

curl -v https://your-app.com/api/media/images/chapter-123-image.png \
  -H "Authorization: Bearer {user-b-token}"

# Expected: HTTP 403 Forbidden
# Response: { "error": "Not authorized to access this media" }
```

#### 4.3 Test authorized access (should succeed)

```bash
# User A accesses their own image

curl -v https://your-app.com/api/media/images/chapter-123-image.png \
  -H "Authorization: Bearer {user-a-token}"

# Expected: HTTP 200 OK
# Response: Binary image data
```

#### 4.4 Test collaborator access (should succeed)

```bash
# User A adds User B as collaborator
# User B accesses image from User A's book

curl -v https://your-app.com/api/media/images/chapter-123-image.png \
  -H "Authorization: Bearer {user-b-token}"

# Expected: HTTP 200 OK
# Response: Binary image data
```

#### 4.5 Check Redis mappings

```bash
redis-cli

# Check for media-to-book mappings
KEYS media:*

# Expected: Keys like "media:images:chapter-123-image.png"
GET media:images:chapter-123-image.png

# Expected: Book ID value
```

#### 4.6 Test legacy files (no mapping)

```bash
# If you have old media files uploaded before v1.3.0
# They should still be accessible (backward compatible)

curl -v https://your-app.com/api/media/images/old-file.png \
  -H "Authorization: Bearer {token}"

# Expected: HTTP 200 OK (with warning in logs)
```

### Verification
- [ ] Unauthenticated users cannot access media
- [ ] Unauthorized users cannot access other users' media
- [ ] Owners can access their own media
- [ ] Collaborators can access media from books they collaborate on
- [ ] Redis mappings are created for new uploads
- [ ] Legacy files without mappings still work (backward compatible)

---

## 🚦 Test 5: Per-User Rate Limiting

**Fix**: Rate limits now per-user, not per-IP.

### Manual Tests

#### 5.1 Test independent user limits

```bash
# Setup: Create 2 users behind same IP (use VPN or proxy)

# User A makes 50 AI requests rapidly
for i in {1..50}; do
  curl -X POST https://your-app.com/api/books/{book-id}/generate/scene \
    -H "Authorization: Bearer {user-a-token}" \
    -H "Content-Type: application/json" \
    -d '{"prompt":"test"}' &
done
wait

# Expected: All 50 should succeed

# User B makes 50 AI requests from SAME IP
for i in {1..50}; do
  curl -X POST https://your-app.com/api/books/{book-id}/generate/scene \
    -H "Authorization: Bearer {user-b-token}" \
    -H "Content-Type: application/json" \
    -d '{"prompt":"test"}' &
done
wait

# Expected: All 50 should succeed
# Proves rate limits are per-user, not per-IP
```

#### 5.2 Test rate limit enforcement

```bash
# Make 51 requests rapidly (exceeds limit of 50)
for i in {1..51}; do
  curl -X POST https://your-app.com/api/books/{book-id}/generate/description \
    -H "Authorization: Bearer {token}" \
    -H "Content-Type: application/json" \
    -d '{"prompt":"test"}' &
done
wait

# Expected: Request #51 should return HTTP 429
# Response: { "message": "Too many AI generation requests, please try again later" }
```

#### 5.3 Check Redis rate limit keys

```bash
redis-cli

# Check for rate limit keys
KEYS *user:*

# Expected: Keys like "rl:user:550e8400-e29b-41d4-a716-446655440000"
# NOT "rl:192.168.1.1"
```

#### 5.4 Test auth rate limiting

```bash
# Try 6 failed login attempts with same email
for i in {1..6}; do
  curl -X POST https://your-app.com/api/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"wrongpass"}' &
done
wait

# Expected: Attempt #6 should return HTTP 429
# Response: { "message": "Too many login attempts, please try again later" }
```

### Verification
- [ ] Users behind same IP have independent rate limits
- [ ] Rate limits are enforced after 50 AI requests per 15 min
- [ ] Auth rate limit is 5 attempts per 15 min per email
- [ ] Redis keys use user IDs, not IP addresses
- [ ] Rate limits reset after 15 minutes

---

## 🛡️ Test 6: Authorization Middleware

**Fix**: All book endpoints now verify ownership/collaboration.

### Manual Tests

#### 6.1 Test all book endpoints

```bash
# User A creates a book
# User B tries to access/modify User A's book

# GET /api/books/:id
curl https://your-app.com/api/books/{book-id} \
  -H "Authorization: Bearer {user-b-token}"
# Expected: HTTP 403

# PUT /api/books/:id
curl -X PUT https://your-app.com/api/books/{book-id} \
  -H "Authorization: Bearer {user-b-token}" \
  -d '{"title":"hacked"}'
# Expected: HTTP 403

# DELETE /api/books/:id
curl -X DELETE https://your-app.com/api/books/{book-id} \
  -H "Authorization: Bearer {user-b-token}"
# Expected: HTTP 403

# POST /api/books/:id/chapters
curl -X POST https://your-app.com/api/books/{book-id}/chapters \
  -H "Authorization: Bearer {user-b-token}" \
  -d '{"title":"hacked"}'
# Expected: HTTP 403
```

#### 6.2 Test job endpoints

```bash
# User B tries to access User A's jobs

curl https://your-app.com/api/jobs/{job-id} \
  -H "Authorization: Bearer {user-b-token}"
# Expected: HTTP 403 if job belongs to User A
```

#### 6.3 Test with valid collaborator

```bash
# User A adds User B as editor
# User B should now have access

curl https://your-app.com/api/books/{book-id} \
  -H "Authorization: Bearer {user-b-token}"
# Expected: HTTP 200 OK

curl -X PUT https://your-app.com/api/books/{book-id} \
  -H "Authorization: Bearer {user-b-token}" \
  -d '{"title":"new title"}'
# Expected: HTTP 200 OK (editors can modify)
```

### Verification
- [ ] All GET /api/books/:id endpoints check ownership
- [ ] All PUT /api/books/:id endpoints check ownership
- [ ] All DELETE /api/books/:id endpoints check ownership (owner only)
- [ ] All chapter endpoints check book ownership
- [ ] All job endpoints check book ownership
- [ ] Collaborators have appropriate access levels
- [ ] Error messages are clear (403 with explanation)

---

## 📊 Security Metrics Dashboard

### Key Metrics to Monitor

```bash
# Failed authorization attempts (should be logged)
grep "Not authorized to access this book" /var/log/app.log | wc -l

# Media access violations
grep "Not authorized to access this media" /var/log/app.log | wc -l

# Rate limit hits
grep "Too many.*requests" /var/log/app.log | wc -l

# UUID format violations (should be 0)
redis-cli KEYS "user:*" | grep -v "-" | wc -l
redis-cli KEYS "book:*" | grep -v "-" | wc -l
```

### Production Monitoring

Add these to your monitoring dashboard:

1. **Authorization Failures**: Count of 403 responses
2. **Media Access Violations**: Count of unauthorized media access attempts
3. **Rate Limit Hits**: Count of 429 responses
4. **Encryption Status**: Verify ENCRYPTION_KEY is set
5. **UUID Adoption**: Percentage of users/books with UUIDs vs timestamps

---

## 🔍 Regression Testing

Ensure existing functionality still works:

- [ ] User registration works
- [ ] User login works
- [ ] Book creation works
- [ ] Chapter creation works
- [ ] Image generation works
- [ ] Audio generation works
- [ ] Video generation works
- [ ] Book import works
- [ ] Book export works
- [ ] Collaborator invites work

---

## 🚨 Rollback Plan

If critical issues are found:

```bash
# 1. Immediately rollback to v1.2.0
aws ecs update-service --cluster story-writing-cluster-sai \
  --service story-writing-backend \
  --task-definition story-writing-backend:PREVIOUS_VERSION \
  --region eu-west-2

# 2. Check logs for root cause
aws logs tail /ecs/story-writing-backend --follow

# 3. Fix issue and re-deploy
./deploy.sh all patch
```

---

## ✅ Sign-Off

Once all tests pass, document the results:

**Tested By**: _______________
**Date**: _______________
**Version**: 1.3.0
**Environment**: Production

**Test Results**:
- [ ] Test 1: Book Deletion Authorization - ✅ PASSED
- [ ] Test 2: UUID Implementation - ✅ PASSED
- [ ] Test 3: API Key Encryption - ✅ PASSED
- [ ] Test 4: Media File Access Control - ✅ PASSED
- [ ] Test 5: Per-User Rate Limiting - ✅ PASSED
- [ ] Test 6: Authorization Middleware - ✅ PASSED

**Issues Found**: _______________ (or "None")

**Overall Status**: ✅ Ready for Production / ⚠️ Needs Review / ❌ Failed

**Signed Off**: _______________
