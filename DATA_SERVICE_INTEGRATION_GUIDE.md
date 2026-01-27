# Data Service Integration Guide

**Status**: Ready to integrate
**File**: [server/services/dataAdapter.js](server/services/dataAdapter.js)

---

## Overview

The Data Adapter provides a backward-compatible wrapper around the Data Service layer, allowing us to gradually migrate from direct Redis calls to PostgreSQL-backed operations.

---

## Migration Pattern

### Before (Direct Redis)

```javascript
// Get book from Redis
const data = await redisClient.get(`book:${bookId}`);
const book = data ? JSON.parse(data) : null;

// Update book in Redis
book.title = "New Title";
await redisClient.set(`book:${bookId}`, JSON.stringify(book));
```

### After (Data Adapter)

```javascript
import { getBook, updateBook } from './services/dataAdapter.js';

// Get book (routes to Redis or PostgreSQL based on feature flags)
const book = await getBook(bookId);

// Update book (dual-writes if enabled)
const updatedBook = await updateBook(bookId, userId, { title: "New Title" });
```

---

## Step-by-Step Integration

### Step 1: Update Redis Client Initialization

**File**: [server/index.js](server/index.js)

**Find** (around line 122):
```javascript
import { createClient } from 'redis';

// Initialize Redis Client
const redisClient = createClient({
  socket: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6380'),
  },
  password: process.env.REDIS_PASSWORD || undefined,
});

redisClient.on('error', (err) => console.error('❌ Redis Client Error:', err));
await redisClient.connect();
console.log('✅ Redis connected');
```

**Replace with**:
```javascript
import { initializeRedis, getRedisClient } from './services/dataAdapter.js';

// Initialize Redis Client (for sessions, jobs, rate limiting)
const redisClient = await initializeRedis();
```

---

### Step 2: Import Data Adapter Functions

**File**: [server/index.js](server/index.js)

**Add** (at top with other imports):
```javascript
import {
  // User operations
  getUser,
  getUserByEmail,
  createUser,
  updateUser,
  updateUserSettings,
  getUserSettings,

  // Book operations
  getBook,
  getUserBooks,
  createBook,
  updateBook,
  deleteBook,
  checkBookAccess,

  // Chapter operations
  getBookChapters,
  createChapter,
  updateChapter,

  // Temporary data (stays in Redis)
  setPasswordResetToken,
  getPasswordResetToken,
  deletePasswordResetToken,
  setImportData,
  getImportData,
  setApiKeyData,
  getApiKeyData,
  deleteApiKeyData,
  getUserApiKeys,
  setUserApiKeys,
  getStats,
  setStats,
  getRPGData,
  setRPGData,
  deleteRPGData,

  // Raw Redis access
  getRedisValue,
  setRedisValue,

  // Status
  getMigrationStatus,
} from './services/dataAdapter.js';
```

---

### Step 3: Update User Operations

#### 3.1 User Registration

**Find** (around line 438):
```javascript
await redisClient.set(getUserKey(userId), JSON.stringify(user));
await redisClient.set(getUserEmailKey(email), userId);
```

**Replace with**:
```javascript
await createUser({
  id: userId,
  email,
  name,
  password_hash: hashedPassword,
  tier: 'free'
});
```

#### 3.2 User Login

**Find** (around line 474-482):
```javascript
const userId = await redisClient.get(getUserEmailKey(email));
if (!userId) {
  return res.status(401).json(ApiResponse.error('Invalid email or password'));
}

const userData = await redisClient.get(getUserKey(userId));
if (!userData) {
  return res.status(401).json(ApiResponse.error('Invalid email or password'));
}
const user = JSON.parse(userData);
```

**Replace with**:
```javascript
const user = await getUserByEmail(email);
if (!user) {
  return res.status(401).json(ApiResponse.error('Invalid email or password'));
}
```

#### 3.3 Get User (in authenticateToken)

**Find** (around line 333):
```javascript
const userData = await redisClient.get(getUserKey(decoded.userId));
if (!userData) {
  return res.status(401).json(ApiResponse.error('User not found'));
}
req.user = JSON.parse(userData);
```

**Replace with**:
```javascript
const user = await getUser(decoded.userId);
if (!user) {
  return res.status(401).json(ApiResponse.error('User not found'));
}
req.user = user;
```

#### 3.4 Update User Settings

**Find** (around line 4608):
```javascript
await redisClient.set(settingsKey, JSON.stringify(settings));
```

**Replace with**:
```javascript
await updateUserSettings(req.user.id, {
  ai_config: settings.aiConfig,
  preferences: settings.preferences
});
```

---

### Step 4: Update Book Operations

#### 4.1 Create Book

**Find** (around line 692):
```javascript
await redisClient.set(getBookKey(bookId), JSON.stringify(bookData));
```

**Replace with**:
```javascript
const book = await createBook({
  id: bookId,
  owner_id: req.user.id,
  title: bookData.title,
  description: bookData.description,
  genre: bookData.genre,
  target_audience: bookData.targetAudience,
  characters: bookData.characters,
  locations: bookData.locations,
  plotlines: bookData.plotlines,
  world_building: bookData.worldBuilding,
  settings: bookData.settings,
  status: 'draft'
});
```

#### 4.2 Get Book

**Find** (around line 752):
```javascript
const data = await redisClient.get(getBookKey(id));
if (!data) {
  return res.status(404).json(ApiResponse.error('Book not found'));
}
const book = JSON.parse(data);
```

**Replace with**:
```javascript
const book = await getBook(id);
if (!book) {
  return res.status(404).json(ApiResponse.error('Book not found'));
}
```

#### 4.3 Update Book

**Find** (around line 821):
```javascript
await redisClient.set(getBookKey(id), JSON.stringify(bookData));
```

**Replace with**:
```javascript
await updateBook(id, req.user.id, {
  title: bookData.title,
  description: bookData.description,
  characters: bookData.characters,
  locations: bookData.locations,
  plotlines: bookData.plotlines,
  world_building: bookData.worldBuilding,
  settings: bookData.settings
});
```

#### 4.4 Delete Book

**Find** (around line 878):
```javascript
await redisClient.del(getBookKey(id));
```

**Replace with**:
```javascript
await deleteBook(id, req.user.id);
```

#### 4.5 Get User's Books

**Find** (around line 731):
```javascript
for await (const key of redisClient.scanIterator({ MATCH: 'book:*', COUNT: 100 })) {
  const data = await redisClient.get(key);
  const book = JSON.parse(data);
  if (book.ownerId === req.user.id) {
    books.push(book);
  }
}
```

**Replace with**:
```javascript
const books = await getUserBooks(req.user.id);
```

---

### Step 5: Update Temporary Data Operations

These operations use Redis directly (no PostgreSQL migration needed):

#### 5.1 Password Reset

**Find**:
```javascript
await redisClient.set(getPasswordResetKey(resetToken), userId, { EX: 3600 });
```

**Replace with**:
```javascript
await setPasswordResetToken(resetToken, userId, 3600);
```

**Find**:
```javascript
const userId = await redisClient.get(getPasswordResetKey(token));
```

**Replace with**:
```javascript
const userId = await getPasswordResetToken(token);
```

**Find**:
```javascript
await redisClient.del(getPasswordResetKey(token));
```

**Replace with**:
```javascript
await deletePasswordResetToken(token);
```

#### 5.2 Import Data

**Find**:
```javascript
await redisClient.set(`import:${importId}`, JSON.stringify(importData));
```

**Replace with**:
```javascript
await setImportData(importId, importData);
```

**Find**:
```javascript
const importData = await redisClient.get(`import:${importId}`);
```

**Replace with**:
```javascript
const importData = await getImportData(importId);
```

#### 5.3 API Keys

**Find**:
```javascript
await redisClient.set(`apikey:${apiKey}`, JSON.stringify(apiKeyData));
```

**Replace with**:
```javascript
await setApiKeyData(apiKey, apiKeyData);
```

**Find**:
```javascript
const data = await redisClient.get(`apikey:${apiKey}`);
```

**Replace with**:
```javascript
const data = await getApiKeyData(apiKey);
```

---

## What Stays in Redis

These operations continue to use Redis directly (no changes needed):

1. **Sessions** - Handled by `connect-redis`
2. **Job Queue** - Handled by Bull
3. **Rate Limiting** - Handled by express-rate-limit
4. **Temporary data**:
   - Password reset tokens (ephemeral)
   - Import tracking (temporary)
   - API key cache (temporary)
   - Stats (ephemeral)
   - RPG data (metadata)

---

## Testing the Integration

### 1. Test with Redis Only (Current State)

```bash
# .env file
USE_POSTGRES=false
DUAL_WRITE=false
READ_FROM_POSTGRES=false

# Start server
npm start

# Test operations - should work exactly as before
```

### 2. Test with Dual-Write

```bash
# .env file
USE_POSTGRES=true
DUAL_WRITE=true
READ_FROM_POSTGRES=false

# Start server
npm start

# Test operations - should write to both Redis and PostgreSQL
# Read from Redis (backward compatible)
```

### 3. Test with PostgreSQL Reads

```bash
# .env file
USE_POSTGRES=true
DUAL_WRITE=true
READ_FROM_POSTGRES=true

# Start server
npm start

# Test operations - should write to both, read from PostgreSQL
```

### 4. Test PostgreSQL Only

```bash
# .env file
USE_POSTGRES=true
DUAL_WRITE=false
READ_FROM_POSTGRES=true

# Start server
npm start

# Test operations - should use only PostgreSQL for application data
```

---

## Rollback Plan

If issues arise, revert changes:

```bash
# 1. Update .env
USE_POSTGRES=false
DUAL_WRITE=false
READ_FROM_POSTGRES=false

# 2. Restart server
npm start

# Application reverts to Redis-only mode
```

---

## Common Patterns

### Pattern 1: Simple Get/Set

**Before**:
```javascript
const data = await redisClient.get(key);
const obj = JSON.parse(data);
```

**After**:
```javascript
const obj = await getBook(id); // or getUser(id)
```

### Pattern 2: Update with Authorization

**Before**:
```javascript
const data = await redisClient.get(getBookKey(bookId));
const book = JSON.parse(data);
if (book.ownerId !== userId) {
  throw new Error('Not authorized');
}
book.title = "New Title";
await redisClient.set(getBookKey(bookId), JSON.stringify(book));
```

**After**:
```javascript
// Authorization is built-in
await updateBook(bookId, userId, { title: "New Title" });
```

### Pattern 3: Scan and Filter

**Before**:
```javascript
const books = [];
for await (const key of redisClient.scanIterator({ MATCH: 'book:*' })) {
  const data = await redisClient.get(key);
  const book = JSON.parse(data);
  if (book.ownerId === userId) {
    books.push(book);
  }
}
```

**After**:
```javascript
const books = await getUserBooks(userId);
```

---

## Benefits

1. **Gradual Migration**: Update code incrementally without breaking existing functionality
2. **Feature Flags**: Control migration via environment variables
3. **Dual-Write Safety**: Write to both databases during transition
4. **Easy Rollback**: Revert to Redis-only by changing feature flags
5. **Cleaner Code**: Simpler API, less boilerplate
6. **Authorization Built-in**: Book/chapter operations check ownership automatically
7. **Type Safety**: Returns objects, not JSON strings

---

## Next Steps

1. ✅ Data Adapter created
2. 🔜 **Update server/index.js** with new functions
3. 🔜 **Test with USE_POSTGRES=false** (ensure backward compatibility)
4. 🔜 **Enable dual-write** (USE_POSTGRES=true, DUAL_WRITE=true)
5. 🔜 **Monitor and verify** data consistency
6. 🔜 **Switch to PostgreSQL reads**
7. 🔜 **Disable dual-write** (final state)

---

**Document Version**: 1.0
**Status**: Ready for Integration

