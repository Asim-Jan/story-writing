# Phase 2: PostgreSQL Migration Plan

**Status**: Ready to implement
**Timeline**: 3-4 weeks
**Goal**: Migrate from Redis to PostgreSQL for ACID transactions, concurrent editing support, and better multi-user scalability

---

## Why PostgreSQL?

### Current Issues with Redis

1. **No ACID Transactions**: Last write wins, data loss on concurrent edits
2. **No Relationships**: Cannot enforce referential integrity
3. **No Query Flexibility**: Cannot JOIN data, filter efficiently
4. **No Version History**: Cannot track changes or rollback
5. **Limited Concurrency**: No optimistic locking, race conditions

### Benefits of PostgreSQL

1. ✅ **ACID Transactions**: Atomic operations, consistent state
2. ✅ **Referential Integrity**: Foreign keys, cascading deletes
3. ✅ **Complex Queries**: JOINs, aggregations, full-text search
4. ✅ **Optimistic Locking**: Version column to detect conflicts
5. ✅ **Scalability**: Read replicas, connection pooling
6. ✅ **Proven Technology**: Battle-tested for multi-user applications

---

## Architecture Overview

### What Stays in Redis
- ✅ Sessions (connect-redis) - Fast lookups
- ✅ Job queue (Bull) - Works well
- ✅ Rate limit counters - Fast increments
- ✅ Temporary cache - Media mappings (optional)

### What Moves to PostgreSQL
- ✅ Users, books, chapters - Need transactions
- ✅ Job metadata - Need query history
- ✅ API keys (encrypted) - Authorization data
- ✅ Version history - Track changes

---

## Week 1: Setup & Schema Design

### 1.1 PostgreSQL Setup (AWS RDS)

**Create RDS Instance**:
```bash
# Using AWS Console or Terraform
- Instance type: db.t3.small (2 vCPU, 2 GB RAM)
- Storage: 50 GB gp3 SSD
- Multi-AZ: No (enable later for production)
- Backup retention: 7 days
- Encryption: AES-256
```

**Security Group**:
- Allow inbound on port 5432 from ECS security group only
- No public access

**Environment Variables**:
```bash
POSTGRES_HOST=story-writing-db.xxx.eu-west-2.rds.amazonaws.com
POSTGRES_PORT=5432
POSTGRES_DB=story_writing
POSTGRES_USER=story_admin
POSTGRES_PASSWORD=<secure-random-string>
```

### 1.2 Database Schema

**File**: `server/db/schema.sql`

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  password_hash TEXT NOT NULL,
  tier VARCHAR(20) DEFAULT 'free' CHECK (tier IN ('free', 'basic', 'premium')),

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ, -- Soft delete

  -- Optimistic locking
  version INTEGER DEFAULT 1 NOT NULL,

  -- Indexes
  INDEX idx_users_email (email),
  INDEX idx_users_tier (tier),
  INDEX idx_users_deleted_at (deleted_at) WHERE deleted_at IS NULL
);

-- User settings (encrypted API keys, preferences)
CREATE TABLE user_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

  -- Encrypted AI API keys
  openai_api_key_encrypted TEXT,
  gemini_api_key_encrypted TEXT,

  -- Preferences (JSONB for flexibility)
  preferences JSONB DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Books table
CREATE TABLE books (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Basic info
  title VARCHAR(500) NOT NULL,
  description TEXT,
  genre VARCHAR(100),
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'completed', 'published')),

  -- Flexible data (JSONB for characters, locations, plotlines)
  characters JSONB DEFAULT '[]',
  locations JSONB DEFAULT '[]',
  plotlines JSONB DEFAULT '[]',
  notes TEXT,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ, -- Soft delete

  -- Optimistic locking
  version INTEGER DEFAULT 1 NOT NULL,

  -- Full-text search
  title_search TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', title)) STORED,
  description_search TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', COALESCE(description, ''))) STORED,

  -- Indexes
  INDEX idx_books_owner (owner_id),
  INDEX idx_books_status (status),
  INDEX idx_books_deleted_at (deleted_at) WHERE deleted_at IS NULL,
  INDEX idx_books_title_search USING GIN (title_search),
  INDEX idx_books_description_search USING GIN (description_search)
);

-- Collaborators (many-to-many relationship)
CREATE TABLE book_collaborators (
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'viewer' CHECK (role IN ('owner', 'editor', 'viewer')),
  invited_at TIMESTAMPTZ DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,

  PRIMARY KEY (book_id, email),
  INDEX idx_collaborators_email (email)
);

-- Chapters (normalized for better concurrent editing)
CREATE TABLE chapters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,

  -- Chapter info
  chapter_number INTEGER NOT NULL,
  title VARCHAR(500),
  content TEXT,

  -- Scenes (JSONB for flexibility)
  scenes JSONB DEFAULT '[]',

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,

  -- Optimistic locking
  version INTEGER DEFAULT 1 NOT NULL,

  -- Full-text search
  content_search TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', COALESCE(content, ''))) STORED,

  -- Constraints
  UNIQUE (book_id, chapter_number),
  INDEX idx_chapters_book (book_id, chapter_number),
  INDEX idx_chapters_deleted_at (deleted_at) WHERE deleted_at IS NULL,
  INDEX idx_chapters_content_search USING GIN (content_search)
);

-- Chapter versions (for rollback/history)
CREATE TABLE chapter_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chapter_id UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,

  -- Version info
  version_number INTEGER NOT NULL,
  title VARCHAR(500),
  content TEXT,
  scenes JSONB,

  -- Who made the change
  changed_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  INDEX idx_chapter_versions_chapter (chapter_id, version_number DESC)
);

-- Transcripts
CREATE TABLE transcripts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,

  -- Transcript info
  title VARCHAR(500),
  content TEXT,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,

  INDEX idx_transcripts_book (book_id)
);

-- Animation projects
CREATE TABLE animation_projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  transcript_id UUID REFERENCES transcripts(id) ON DELETE SET NULL,

  -- Animation info
  video_url TEXT,
  scenes JSONB DEFAULT '[]',

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),

  INDEX idx_animation_projects_book (book_id)
);

-- Jobs (background task tracking)
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id UUID REFERENCES books(id) ON DELETE CASCADE,

  -- Job info
  type VARCHAR(50) NOT NULL CHECK (type IN ('image_generation', 'audio_generation', 'video_generation', 'comic_generation', 'book_import')),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'failed', 'cancelled')),
  progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  message TEXT,
  error TEXT,

  -- Job data (JSONB for flexibility)
  data JSONB DEFAULT '{}',
  result JSONB,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  INDEX idx_jobs_user (user_id, created_at DESC),
  INDEX idx_jobs_book (book_id, created_at DESC),
  INDEX idx_jobs_status (status)
);

-- Imports (book import tracking)
CREATE TABLE imports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id UUID REFERENCES books(id) ON DELETE SET NULL,

  -- Import info
  filename VARCHAR(500),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  progress INTEGER DEFAULT 0,
  error TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  INDEX idx_imports_user (user_id, created_at DESC)
);

-- Triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  NEW.version = OLD.version + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all tables with updated_at
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER user_settings_updated_at BEFORE UPDATE ON user_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER books_updated_at BEFORE UPDATE ON books FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER chapters_updated_at BEFORE UPDATE ON chapters FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER transcripts_updated_at BEFORE UPDATE ON transcripts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### 1.3 Connection Pool Setup

**File**: `server/db/postgres.js`

```javascript
import pg from 'pg';
const { Pool } = pg;

let pool = null;

/**
 * Initialize PostgreSQL connection pool
 */
export function initPostgresPool() {
  if (pool) return pool;

  pool = new Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT) || 5432,
    database: process.env.POSTGRES_DB || 'story_writing',
    user: process.env.POSTGRES_USER || 'story_admin',
    password: process.env.POSTGRES_PASSWORD,

    // Connection pool settings
    max: 20, // Maximum connections
    min: 2, // Minimum idle connections
    idleTimeoutMillis: 30000, // Close idle connections after 30s
    connectionTimeoutMillis: 10000, // Timeout if connection takes > 10s

    // Statement timeout (prevent long-running queries)
    statement_timeout: 30000, // 30 seconds

    // SSL for production
    ssl: process.env.NODE_ENV === 'production' ? {
      rejectUnauthorized: true
    } : false
  });

  // Log connection events
  pool.on('connect', () => {
    console.log('✓ PostgreSQL connection established');
  });

  pool.on('error', (err) => {
    console.error('PostgreSQL pool error:', err);
  });

  return pool;
}

/**
 * Get pool instance
 */
export function getPool() {
  if (!pool) {
    return initPostgresPool();
  }
  return pool;
}

/**
 * Execute a query
 */
export async function query(text, params) {
  const pool = getPool();
  const start = Date.now();

  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;

    if (duration > 1000) {
      console.warn(`Slow query (${duration}ms):`, text);
    }

    return result;
  } catch (error) {
    console.error('Query error:', error.message, text);
    throw error;
  }
}

/**
 * Transaction helper
 */
export async function transaction(callback) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Close pool (for graceful shutdown)
 */
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('✓ PostgreSQL pool closed');
  }
}
```

### 1.4 Repository Pattern

**File**: `server/db/repositories/UserRepository.js`

```javascript
import { query, transaction } from '../postgres.js';
import bcrypt from 'bcrypt';
import { encryptApiKey, decryptApiKey } from '../../utils/encryption.js';

export class UserRepository {
  /**
   * Create new user
   */
  static async create({ email, name, password }) {
    const passwordHash = await bcrypt.hash(password, 10);

    const result = await query(
      `INSERT INTO users (email, name, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, email, name, tier, created_at`,
      [email, name, passwordHash]
    );

    return result.rows[0];
  }

  /**
   * Find user by ID
   */
  static async findById(userId) {
    const result = await query(
      `SELECT id, email, name, tier, created_at, updated_at, last_login_at, version
       FROM users
       WHERE id = $1 AND deleted_at IS NULL`,
      [userId]
    );

    return result.rows[0] || null;
  }

  /**
   * Find user by email
   */
  static async findByEmail(email) {
    const result = await query(
      `SELECT id, email, name, password_hash, tier, created_at, version
       FROM users
       WHERE email = $1 AND deleted_at IS NULL`,
      [email]
    );

    return result.rows[0] || null;
  }

  /**
   * Update user settings (API keys, preferences)
   */
  static async updateSettings(userId, { openaiApiKey, geminiApiKey, preferences }) {
    const updates = [];
    const params = [userId];
    let paramIndex = 2;

    if (openaiApiKey !== undefined) {
      const encrypted = encryptApiKey(openaiApiKey);
      updates.push(`openai_api_key_encrypted = $${paramIndex++}`);
      params.push(encrypted);
    }

    if (geminiApiKey !== undefined) {
      const encrypted = encryptApiKey(geminiApiKey);
      updates.push(`gemini_api_key_encrypted = $${paramIndex++}`);
      params.push(encrypted);
    }

    if (preferences !== undefined) {
      updates.push(`preferences = $${paramIndex++}`);
      params.push(JSON.stringify(preferences));
    }

    if (updates.length === 0) return;

    await query(
      `INSERT INTO user_settings (user_id, ${updates.join(', ')})
       VALUES ($1, ${params.slice(1).map((_, i) => `$${i + 2}`).join(', ')})
       ON CONFLICT (user_id) DO UPDATE SET ${updates.join(', ')}, updated_at = NOW()`,
      params
    );
  }

  /**
   * Get user settings (decrypt API keys)
   */
  static async getSettings(userId) {
    const result = await query(
      `SELECT openai_api_key_encrypted, gemini_api_key_encrypted, preferences
       FROM user_settings
       WHERE user_id = $1`,
      [userId]
    );

    if (!result.rows[0]) return null;

    const settings = result.rows[0];

    return {
      openaiApiKey: settings.openai_api_key_encrypted ? decryptApiKey(settings.openai_api_key_encrypted) : null,
      geminiApiKey: settings.gemini_api_key_encrypted ? decryptApiKey(settings.gemini_api_key_encrypted) : null,
      preferences: settings.preferences || {}
    };
  }

  /**
   * Update last login time
   */
  static async updateLastLogin(userId) {
    await query(
      `UPDATE users SET last_login_at = NOW() WHERE id = $1`,
      [userId]
    );
  }

  /**
   * Soft delete user
   */
  static async softDelete(userId) {
    await query(
      `UPDATE users SET deleted_at = NOW() WHERE id = $1`,
      [userId]
    );
  }
}
```

**File**: `server/db/repositories/BookRepository.js`

```javascript
import { query, transaction } from '../postgres.js';

export class BookRepository {
  /**
   * Create new book
   */
  static async create({ ownerId, title, description, genre }) {
    const result = await query(
      `INSERT INTO books (owner_id, title, description, genre)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [ownerId, title, description, genre]
    );

    return result.rows[0];
  }

  /**
   * Find book by ID (with authorization check)
   */
  static async findById(bookId, userId) {
    const result = await query(
      `SELECT b.*,
              (b.owner_id = $2) AS is_owner,
              EXISTS(SELECT 1 FROM book_collaborators bc
                     WHERE bc.book_id = b.id AND bc.email = u.email) AS is_collaborator
       FROM books b
       LEFT JOIN users u ON u.id = $2
       WHERE b.id = $1 AND b.deleted_at IS NULL`,
      [bookId, userId]
    );

    const book = result.rows[0];

    // Authorization check
    if (!book || (!book.is_owner && !book.is_collaborator)) {
      return null;
    }

    return book;
  }

  /**
   * List user's books
   */
  static async listByUser(userId) {
    const result = await query(
      `SELECT b.*
       FROM books b
       LEFT JOIN book_collaborators bc ON bc.book_id = b.id
       LEFT JOIN users u ON u.email = bc.email
       WHERE (b.owner_id = $1 OR u.id = $1) AND b.deleted_at IS NULL
       ORDER BY b.updated_at DESC`,
      [userId]
    );

    return result.rows;
  }

  /**
   * Update book (with optimistic locking)
   */
  static async update(bookId, userId, updates, expectedVersion) {
    const { title, description, genre, characters, locations, plotlines, notes } = updates;

    const result = await query(
      `UPDATE books
       SET title = COALESCE($3, title),
           description = COALESCE($4, description),
           genre = COALESCE($5, genre),
           characters = COALESCE($6, characters),
           locations = COALESCE($7, locations),
           plotlines = COALESCE($8, plotlines),
           notes = COALESCE($9, notes),
           version = version + 1
       WHERE id = $1
         AND owner_id = $2
         AND version = $10
         AND deleted_at IS NULL
       RETURNING *`,
      [
        bookId,
        userId,
        title,
        description,
        genre,
        characters ? JSON.stringify(characters) : null,
        locations ? JSON.stringify(locations) : null,
        plotlines ? JSON.stringify(plotlines) : null,
        notes,
        expectedVersion
      ]
    );

    if (result.rowCount === 0) {
      // Version mismatch = conflict
      throw new Error('CONFLICT: Book was modified by another user');
    }

    return result.rows[0];
  }

  /**
   * Delete book (owner only)
   */
  static async delete(bookId, ownerId) {
    await query(
      `UPDATE books SET deleted_at = NOW()
       WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
      [bookId, ownerId]
    );
  }

  /**
   * Add collaborator
   */
  static async addCollaborator(bookId, email, role) {
    await query(
      `INSERT INTO book_collaborators (book_id, email, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (book_id, email) DO UPDATE SET role = $3`,
      [bookId, email, role]
    );
  }

  /**
   * Remove collaborator
   */
  static async removeCollaborator(bookId, email) {
    await query(
      `DELETE FROM book_collaborators WHERE book_id = $1 AND email = $2`,
      [bookId, email]
    );
  }
}
```

---

## Week 2: Dual-Write Implementation

### 2.1 Feature Flags

**File**: `server/config/features.js`

```javascript
export const features = {
  // PostgreSQL feature flags
  USE_POSTGRES: process.env.USE_POSTGRES === 'true',
  DUAL_WRITE: process.env.DUAL_WRITE === 'true',
  READ_FROM_POSTGRES: process.env.READ_FROM_POSTGRES === 'true',

  // Log feature states
  log() {
    console.log('Feature Flags:');
    console.log(`  USE_POSTGRES: ${this.USE_POSTGRES}`);
    console.log(`  DUAL_WRITE: ${this.DUAL_WRITE}`);
    console.log(`  READ_FROM_POSTGRES: ${this.READ_FROM_POSTGRES}`);
  }
};
```

### 2.2 Data Service Abstraction

**File**: `server/db/dataService.js`

```javascript
import { features } from '../config/features.js';
import { UserRepository } from './repositories/UserRepository.js';
import { BookRepository } from './repositories/BookRepository.js';
import { createClient } from 'redis';

// Redis client (existing)
let redisClient = null;

async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({
      url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`
    });
    await redisClient.connect();
  }
  return redisClient;
}

/**
 * Data service with dual-write support
 */
export class DataService {
  /**
   * Create user (dual-write if enabled)
   */
  static async createUser(userData) {
    let user;

    // PostgreSQL (primary if enabled)
    if (features.USE_POSTGRES) {
      user = await UserRepository.create(userData);
    }

    // Redis (fallback or dual-write)
    if (!features.USE_POSTGRES || features.DUAL_WRITE) {
      const redis = await getRedisClient();
      const redisUser = {
        id: user?.id || Date.now().toString(),
        ...userData,
        createdAt: new Date().toISOString()
      };
      await redis.set(`user:${redisUser.id}`, JSON.stringify(redisUser));

      if (!user) user = redisUser;
    }

    return user;
  }

  /**
   * Get user by ID (read from configured source)
   */
  static async getUserById(userId) {
    // Read from PostgreSQL if enabled
    if (features.READ_FROM_POSTGRES) {
      return await UserRepository.findById(userId);
    }

    // Otherwise read from Redis
    const redis = await getRedisClient();
    const data = await redis.get(`user:${userId}`);
    return data ? JSON.parse(data) : null;
  }

  /**
   * Create book (dual-write if enabled)
   */
  static async createBook(bookData) {
    let book;

    // PostgreSQL (primary if enabled)
    if (features.USE_POSTGRES) {
      book = await BookRepository.create(bookData);
    }

    // Redis (fallback or dual-write)
    if (!features.USE_POSTGRES || features.DUAL_WRITE) {
      const redis = await getRedisClient();
      const redisBook = {
        id: book?.id || Date.now().toString(),
        ...bookData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await redis.set(`book:${redisBook.id}`, JSON.stringify(redisBook));

      if (!book) book = redisBook;
    }

    return book;
  }

  /**
   * Get book by ID (read from configured source, with authorization)
   */
  static async getBookById(bookId, userId) {
    // Read from PostgreSQL if enabled (includes authorization)
    if (features.READ_FROM_POSTGRES) {
      return await BookRepository.findById(bookId, userId);
    }

    // Otherwise read from Redis (manual authorization check)
    const redis = await getRedisClient();
    const data = await redis.get(`book:${bookId}`);
    if (!data) return null;

    const book = JSON.parse(data);

    // Authorization check
    const isOwner = book.ownerId === userId;
    const isCollaborator = book.collaborators?.some(c => c.email === userId);

    if (!isOwner && !isCollaborator) {
      return null;
    }

    return book;
  }

  /**
   * Update book (dual-write if enabled, with optimistic locking)
   */
  static async updateBook(bookId, userId, updates, expectedVersion) {
    let book;

    // PostgreSQL (primary if enabled)
    if (features.USE_POSTGRES) {
      try {
        book = await BookRepository.update(bookId, userId, updates, expectedVersion);
      } catch (error) {
        if (error.message.includes('CONFLICT')) {
          throw error; // Re-throw conflict errors
        }
        throw error;
      }
    }

    // Redis (fallback or dual-write)
    if (!features.USE_POSTGRES || features.DUAL_WRITE) {
      const redis = await getRedisClient();
      const existing = await redis.get(`book:${bookId}`);

      if (existing) {
        const existingBook = JSON.parse(existing);

        // Check version (optimistic locking)
        if (expectedVersion && existingBook.version !== expectedVersion) {
          throw new Error('CONFLICT: Book was modified by another user');
        }

        const updatedBook = {
          ...existingBook,
          ...updates,
          updatedAt: new Date().toISOString(),
          version: (existingBook.version || 1) + 1
        };

        await redis.set(`book:${bookId}`, JSON.stringify(updatedBook));

        if (!book) book = updatedBook;
      }
    }

    return book;
  }

  /**
   * Delete book (dual-write if enabled)
   */
  static async deleteBook(bookId, ownerId) {
    // PostgreSQL (primary if enabled)
    if (features.USE_POSTGRES) {
      await BookRepository.delete(bookId, ownerId);
    }

    // Redis (fallback or dual-write)
    if (!features.USE_POSTGRES || features.DUAL_WRITE) {
      const redis = await getRedisClient();
      await redis.del(`book:${bookId}`);
    }
  }
}
```

### 2.3 Migration Script

**File**: `server/scripts/migrate-to-postgres.js`

```javascript
import { createClient } from 'redis';
import { UserRepository } from '../db/repositories/UserRepository.js';
import { BookRepository } from '../db/repositories/BookRepository.js';

async function migrateData() {
  console.log('Starting Redis → PostgreSQL migration...');

  const redis = createClient({
    url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`
  });
  await redis.connect();

  let userCount = 0;
  let bookCount = 0;
  let errorCount = 0;

  try {
    // Migrate users
    const userKeys = [];
    for await (const key of redis.scanIterator({ MATCH: 'user:*', COUNT: 100 })) {
      userKeys.push(key);
    }

    console.log(`Found ${userKeys.length} users to migrate`);

    for (const key of userKeys) {
      try {
        const userData = await redis.get(key);
        const user = JSON.parse(userData);

        // Check if user already exists
        const existing = await UserRepository.findById(user.id);
        if (existing) {
          console.log(`  ✓ User ${user.email} already exists, skipping`);
          continue;
        }

        // Insert user
        await UserRepository.create({
          email: user.email,
          name: user.name,
          password: user.password || 'PLACEHOLDER' // Handle old data
        });

        userCount++;
        console.log(`  ✓ Migrated user: ${user.email}`);
      } catch (error) {
        console.error(`  ✗ Failed to migrate user ${key}:`, error.message);
        errorCount++;
      }
    }

    // Migrate books
    const bookKeys = [];
    for await (const key of redis.scanIterator({ MATCH: 'book:*', COUNT: 100 })) {
      bookKeys.push(key);
    }

    console.log(`Found ${bookKeys.length} books to migrate`);

    for (const key of bookKeys) {
      try {
        const bookData = await redis.get(key);
        const book = JSON.parse(bookData);

        // Check if book already exists
        const existing = await BookRepository.findById(book.id, book.ownerId);
        if (existing) {
          console.log(`  ✓ Book "${book.title}" already exists, skipping`);
          continue;
        }

        // Insert book
        await BookRepository.create({
          ownerId: book.ownerId,
          title: book.title,
          description: book.description,
          genre: book.genre,
          characters: book.characters || [],
          locations: book.locations || [],
          plotlines: book.plotlines || []
        });

        bookCount++;
        console.log(`  ✓ Migrated book: ${book.title}`);
      } catch (error) {
        console.error(`  ✗ Failed to migrate book ${key}:`, error.message);
        errorCount++;
      }
    }

    console.log('');
    console.log('Migration complete!');
    console.log(`  Users migrated: ${userCount}`);
    console.log(`  Books migrated: ${bookCount}`);
    console.log(`  Errors: ${errorCount}`);

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await redis.quit();
  }
}

// Run migration
migrateData();
```

---

## Week 3: Flip Reads to PostgreSQL

### 3.1 Enable Read from PostgreSQL

```bash
# Update .env
USE_POSTGRES=true
DUAL_WRITE=true
READ_FROM_POSTGRES=true  # ← Flip this

# Restart services
./deploy.sh all patch
```

### 3.2 Monitor for 3 Days

**CloudWatch Alarms**:
- Database connection errors
- Slow queries (> 1 second)
- Failed transactions
- Authorization failures

**Key Metrics**:
- Response time before/after
- Error rate before/after
- Query performance
- Connection pool usage

---

## Week 4: Disable Redis Writes

### 4.1 Disable Dual-Write

```bash
# Update .env
USE_POSTGRES=true
DUAL_WRITE=false  # ← Disable dual-write
READ_FROM_POSTGRES=true

# Restart services
./deploy.sh all patch
```

### 4.2 Cleanup Redis

```bash
# Backup Redis data first
redis-cli --rdb /backup/redis-backup.rdb

# Delete migrated data
redis-cli FLUSHDB
```

---

## Rollback Plan

If issues occur:

```bash
# Immediate rollback (< 5 minutes)
export READ_FROM_POSTGRES=false
export USE_POSTGRES=false
./deploy.sh all patch

# Data is still in Redis, no data loss
```

---

## Testing Checklist

- [ ] PostgreSQL connection successful
- [ ] Schema created without errors
- [ ] User registration works
- [ ] User login works
- [ ] Book CRUD operations work
- [ ] Optimistic locking detects conflicts
- [ ] Authorization checks work
- [ ] Collaborators can access books
- [ ] Full-text search works
- [ ] Migration script runs without errors
- [ ] Dual-write works correctly
- [ ] Performance is acceptable (< 100ms)
- [ ] Rollback plan tested

---

## Success Criteria

✅ 100% data migrated from Redis to PostgreSQL
✅ Zero downtime during migration
✅ Response time < 100ms for common queries
✅ Optimistic locking prevents data loss
✅ Authorization works correctly
✅ Rollback plan tested and working

---

## Next Steps

1. ✅ Review this plan
2. ✅ Get approval to proceed
3. Set up AWS RDS PostgreSQL instance
4. Create database schema
5. Implement repositories
6. Implement dual-write layer
7. Test migration script locally
8. Deploy to staging
9. Monitor and validate
10. Deploy to production

---

**Status**: ✅ Plan complete, ready for implementation
**Timeline**: 3-4 weeks
**Risk Level**: Medium (mitigated with dual-write approach)
