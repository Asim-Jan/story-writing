#!/bin/bash

# Security Testing Script for Phase 1 Fixes
# Tests all 6 security improvements deployed in v1.3.0

set -e

# Configuration
API_URL="${API_URL:-https://your-production-url.com}"
TEST_USER_EMAIL="test@example.com"
TEST_USER_PASSWORD="testpass123"

echo "🔐 Phase 1 Security Testing Suite"
echo "=================================="
echo "API URL: $API_URL"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test results
PASSED=0
FAILED=0

test_passed() {
  echo -e "${GREEN}✓ PASSED${NC}: $1"
  ((PASSED++))
}

test_failed() {
  echo -e "${RED}✗ FAILED${NC}: $1"
  ((FAILED++))
}

test_warning() {
  echo -e "${YELLOW}⚠ WARNING${NC}: $1"
}

# ============================================================================
# Test 1: Book Deletion Authorization
# ============================================================================
echo ""
echo "Test 1: Book Deletion Authorization"
echo "-----------------------------------"

# 1.1 Try to delete a book owned by another user (should fail with 403)
echo "Testing: Unauthorized book deletion should fail..."
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake.token"  # Fake token
RESPONSE=$(curl -s -w "\n%{http_code}" -X DELETE \
  "$API_URL/api/books/some-book-id" \
  -H "Authorization: Bearer $TOKEN" \
  2>/dev/null || echo "000")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
if [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "403" ]; then
  test_passed "Unauthorized deletion blocked (HTTP $HTTP_CODE)"
else
  test_failed "Expected 401/403, got HTTP $HTTP_CODE"
fi

# 1.2 Try to delete without authentication (should fail with 401)
echo "Testing: Unauthenticated deletion should fail..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X DELETE \
  "$API_URL/api/books/some-book-id" \
  2>/dev/null || echo "000")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
if [ "$HTTP_CODE" = "401" ]; then
  test_passed "Unauthenticated deletion blocked (HTTP $HTTP_CODE)"
else
  test_failed "Expected 401, got HTTP $HTTP_CODE"
fi

# ============================================================================
# Test 2: UUID Implementation
# ============================================================================
echo ""
echo "Test 2: UUID Implementation"
echo "---------------------------"

echo "Testing: New users should get UUIDs, not timestamps..."
# Register a new user and check ID format
RANDOM_EMAIL="test_$(date +%s)@example.com"
RESPONSE=$(curl -s -X POST "$API_URL/api/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$RANDOM_EMAIL\",\"password\":\"testpass123\",\"name\":\"Test User\"}" \
  2>/dev/null)

USER_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")

if [ -n "$USER_ID" ]; then
  # Check if it's a UUID (8-4-4-4-12 format)
  if echo "$USER_ID" | grep -qE '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'; then
    test_passed "User ID is a valid UUID: $USER_ID"
  else
    test_failed "User ID is not a UUID: $USER_ID"
  fi
else
  test_warning "Could not verify UUID (user might already exist or registration failed)"
fi

# ============================================================================
# Test 3: API Key Encryption
# ============================================================================
echo ""
echo "Test 3: API Key Encryption"
echo "--------------------------"

echo "Testing: API keys should be encrypted in storage..."
test_warning "Manual verification required: Check Redis directly to ensure API keys are encrypted"
echo "  Run: redis-cli GET user:<user-id>"
echo "  Look for: aiConfig field should contain encrypted data, not plaintext keys"

# ============================================================================
# Test 4: Media File Access Control
# ============================================================================
echo ""
echo "Test 4: Media File Access Control"
echo "---------------------------------"

# 4.1 Try to access media without authentication (should fail)
echo "Testing: Unauthenticated media access should fail..."
RESPONSE=$(curl -s -w "\n%{http_code}" \
  "$API_URL/api/media/images/test-image.png" \
  2>/dev/null || echo "000")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
if [ "$HTTP_CODE" = "401" ]; then
  test_passed "Unauthenticated media access blocked (HTTP $HTTP_CODE)"
else
  test_failed "Expected 401, got HTTP $HTTP_CODE"
fi

# 4.2 Try to access media from another user's book (should fail with 403)
echo "Testing: Unauthorized media access should fail..."
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake.token"
RESPONSE=$(curl -s -w "\n%{http_code}" \
  "$API_URL/api/media/images/test-image.png" \
  -H "Authorization: Bearer $TOKEN" \
  2>/dev/null || echo "000")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
if [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "403" ] || [ "$HTTP_CODE" = "404" ]; then
  test_passed "Unauthorized media access blocked (HTTP $HTTP_CODE)"
else
  test_failed "Expected 401/403/404, got HTTP $HTTP_CODE"
fi

# ============================================================================
# Test 5: Per-User Rate Limiting
# ============================================================================
echo ""
echo "Test 5: Per-User Rate Limiting"
echo "------------------------------"

echo "Testing: Different users should have independent rate limits..."
test_warning "Rate limit testing requires multiple authenticated users"
echo "  Expected behavior:"
echo "  - User A can make 50 AI requests per 15 min"
echo "  - User B can make 50 AI requests per 15 min (independent of User A)"
echo "  - Same IP address should not affect rate limits"

# ============================================================================
# Test 6: Authorization Middleware
# ============================================================================
echo ""
echo "Test 6: Authorization Middleware"
echo "--------------------------------"

echo "Testing: All book endpoints should check ownership..."

# Test GET /api/books/:id
RESPONSE=$(curl -s -w "\n%{http_code}" \
  "$API_URL/api/books/fake-book-id" \
  -H "Authorization: Bearer invalid-token" \
  2>/dev/null || echo "000")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
if [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "403" ]; then
  test_passed "GET /api/books/:id requires authentication (HTTP $HTTP_CODE)"
else
  test_failed "Expected 401/403, got HTTP $HTTP_CODE"
fi

# Test PUT /api/books/:id
RESPONSE=$(curl -s -w "\n%{http_code}" -X PUT \
  "$API_URL/api/books/fake-book-id" \
  -H "Authorization: Bearer invalid-token" \
  -H "Content-Type: application/json" \
  -d '{"title":"test"}' \
  2>/dev/null || echo "000")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
if [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "403" ]; then
  test_passed "PUT /api/books/:id requires authentication (HTTP $HTTP_CODE)"
else
  test_failed "Expected 401/403, got HTTP $HTTP_CODE"
fi

# ============================================================================
# Summary
# ============================================================================
echo ""
echo "=================================="
echo "Security Test Results"
echo "=================================="
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}✓ All automated tests passed!${NC}"
  exit 0
else
  echo -e "${RED}✗ Some tests failed. Please review.${NC}"
  exit 1
fi
