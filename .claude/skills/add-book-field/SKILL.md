---
name: add-book-field
description: Complete workflow for adding a new JSONB field to the books table (like notes, timelines, visuals, etc.). Use this when you need to add a new book component field that stores JSON data.
allowed-tools: [Write, Terminal, Read, Grep]
---

# Add New Book Component Field

Complete workflow for adding a new JSONB field to the books table (e.g., notes, timelines, visuals, audio files, etc.)

## When to Use This Skill

- Adding a new JSONB field to books table
- Adding a new book component (notes, timelines, etc.)
- Storing structured data (arrays or objects) with books
- Frontend needs to save/load new book-related data

## Prerequisites

- ✅ Feature branch created
- ✅ Database credentials in .env file
- ✅ PostgreSQL connection working
- ✅ Clear understanding of field structure (array vs object)

## Field Naming Conventions

**Frontend → Backend Mapping:**
- Frontend: camelCase (e.g., `audioFiles`)
- Backend/Database: snake_case (e.g., `audio_files`)
- Always map between them in dataService

## Complete Workflow

### Step 1: Create Database Migration

Create file: `server/db/migrations/add_<field_name>.sql`

```sql
-- Add new JSONB field to books table
ALTER TABLE books ADD COLUMN IF NOT EXISTS <field_name> JSONB DEFAULT '[]'::jsonb;

-- Add GIN index for performance (optional but recommended)
CREATE INDEX IF NOT EXISTS idx_books_<field_name> ON books USING GIN (<field_name>);
```

**Notes:**
- Use `'[]'::jsonb` for arrays (e.g., notes, timelines)
- Use `'{}'::jsonb` for objects (e.g., single metadata object)
- Include `IF NOT EXISTS` to make migration idempotent

### Step 2: Update BookRepository Create Method

File: `server/db/repositories/BookRepository.js`

Find the `create()` method and update:

```javascript
async create(bookData, userId) {
  // 1. Add to destructuring with default value
  const {
    title,
    // ... existing fields
    <field_name> = [],  // or {} for objects
  } = bookData;

  // 2. Add to INSERT columns
  const query = `
    INSERT INTO books (
      user_id,
      title,
      // ... existing columns
      <field_name>
    ) VALUES ($1, $2, ..., $${n})
    RETURNING *
  `;

  // 3. Add to VALUES array with JSON.stringify
  const values = [
    userId,
    title,
    // ... existing values
    JSON.stringify(<field_name>),  // ← MUST stringify JSONB!
  ];

  const result = await this.query(query, values);
  return result.rows[0];
}
```

### Step 3: Update BookRepository Update Method

File: `server/db/repositories/BookRepository.js`

Find the `update()` method and update:

```javascript
async update(bookId, updates, userId) {
  // 1. Add to allowedFields array
  const allowedFields = [
    'title',
    'description',
    // ... existing fields
    '<field_name>',  // ← Add your field
  ];

  // 2. Add to JSONB fields list
  const jsonbFields = [
    'components',
    'notes',
    'timelines',
    // ... existing JSONB fields
    '<field_name>',  // ← Add your field
  ];

  // JSON.stringify is already handled in the loop
  // No additional changes needed here
}
```

### Step 4: Update API Endpoints

File: `server/index.js`

#### POST /api/books Endpoint

Find `app.post('/api/books', ...)` and update:

```javascript
app.post('/api/books', authenticateToken, async (req, res) => {
  try {
    const bookData = {
      title: req.body.title || req.body.bookTitle,
      description: req.body.description,
      // ... existing fields
      chapters: req.body.chapters || [],
      <field_name>: req.body.<camelCaseName> || [],  // ← Add your field
    };

    const book = await bookDataService.create(bookData, req.user.userId);
    res.status(201).json(book);
  } catch (error) {
    // ...
  }
});
```

#### PUT /api/books/:id Endpoint

Find `app.put('/api/books/:id', ...)` and update:

```javascript
app.put('/api/books/:id', authenticateToken, async (req, res) => {
  try {
    const updates = {
      title: req.body.title || req.body.bookTitle,
      // ... existing fields
      chapters: req.body.chapters,
      <field_name>: req.body.<camelCaseName>,  // ← Add your field
    };

    const book = await bookDataService.update(bookId, updates, req.user.userId);
    res.json(book);
  } catch (error) {
    // ...
  }
});
```

### Step 5: Update DataService Field Mapping

File: `server/db/dataService.js`

Find the `_mapBookFields()` method and update:

```javascript
_mapBookFields(book) {
  if (!book) return null;

  // ... existing mappings

  // Parse JSONB field if it's a string
  if (typeof book.<field_name> === 'string') {
    try {
      book.<field_name> = JSON.parse(book.<field_name>);
    } catch (e) {
      book.<field_name> = [];  // or {} for objects
    }
  }

  // Ensure field exists and is correct type
  book.<camelCaseName> = book.<field_name> || [];  // or {}

  // Delete snake_case version if different from camelCase
  if ('<field_name>' !== '<camelCaseName>') {
    delete book.<field_name>;
  }

  return book;
}
```

### Step 6: Test Migration Locally

```bash
# Run the migration
node scripts/run-migration.js add_<field_name>.sql

# Verify migration succeeded
node scripts/check-db-status.js

# Check the schema
node -e "
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
  host: process.env.POSTGRES_HOST,
  port: parseInt(process.env.POSTGRES_PORT),
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  ssl: { rejectUnauthorized: false }
});

const result = await pool.query(\"
  SELECT column_name, data_type, column_default
  FROM information_schema.columns
  WHERE table_name = 'books' AND column_name = '<field_name>'
\");
console.log(result.rows);
await pool.end();
"
```

### Step 7: Commit Changes

```bash
git add server/db/migrations/add_<field_name>.sql
git add server/db/repositories/BookRepository.js
git add server/index.js
git add server/db/dataService.js

git commit -m "feat: Add <field_name> field to books

- Created migration: add_<field_name>.sql
- Updated BookRepository create/update methods
- Added field to POST /api/books endpoint
- Added field to PUT /api/books/:id endpoint
- Added <camelCaseName> mapping in dataService
- Field type: JSONB <array|object>
- Default value: <[] or {}>

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

git push
```

### Step 8: Deploy to Production

```bash
./deploy.sh backend patch

# Wait 60-90 seconds for deployment
```

### Step 9: Run Migration in Production

The migration should run automatically when the container starts. Verify by checking logs:

```bash
aws logs tail /ecs/story-writing-backend --since 2m --region eu-west-2 | grep migration
```

Or run manually if needed:
```bash
# SSH to container or run migration script
node scripts/run-migration.js add_<field_name>.sql
```

### Step 10: Test in Production

1. Go to https://story-writing.com
2. Log in
3. Open or create a book
4. Add data to the new field
5. Save the book
6. Refresh the page
7. Verify data persists

### Step 11: Verify in Database

```bash
node scripts/check-db-status.js
```

Or query directly:

```bash
node -e "
import { getBook } from './server/db/dataService.js';
const book = await getBook('<book-id>');
console.log('Field value:', book.<camelCaseName>);
"
```

### Step 12: Wait for User Confirmation

**CRITICAL: Wait for user to test and confirm before creating PR!**

## Field Name Reference

### Common Mappings

```javascript
// Frontend → Backend
bookTitle → title
targetAudience → target_audience
worldBuilding → world_building
chapterNumber → chapter_number
audioFiles → audio_files
comicPages → comic_pages
characterRefs → character_refs
animationProjects → animation_projects
```

### Naming Rules

- Frontend: camelCase
- Backend/Database: snake_case
- Always map in dataService `_mapBookFields()`

## Complete Checklist

- [ ] Migration file created (add_<field_name>.sql)
- [ ] BookRepository.create() updated
- [ ] BookRepository.update() updated
- [ ] POST /api/books endpoint updated
- [ ] PUT /api/books/:id endpoint updated
- [ ] dataService._mapBookFields() updated
- [ ] Migration tested locally
- [ ] Changes committed with proper message
- [ ] Feature branch pushed to remote
- [ ] Deployed to production
- [ ] Migration ran on production database
- [ ] Tested in production UI
- [ ] Data persists after page refresh
- [ ] No errors in production logs
- [ ] User confirmed it works
- [ ] PR created (after user confirmation)

## Common Issues and Solutions

### Issue: Field not persisting

**Causes:**
- Field missing from API endpoint `bookData`/`updates` object
- Field not in BookRepository allowed fields
- Missing JSON.stringify in repository

**Solution:**
1. Check all 5 files are updated correctly
2. Verify field is in API endpoint objects
3. Check logs for errors

### Issue: Field returns as string instead of array/object

**Cause:** Missing JSON.parse in dataService

**Solution:** Add parsing in `_mapBookFields()`:
```javascript
if (typeof book.<field_name> === 'string') {
  book.<field_name> = JSON.parse(book.<field_name>);
}
```

### Issue: Migration fails

**Causes:**
- Field already exists
- SQL syntax error
- Database connection issue

**Solution:**
1. Use `IF NOT EXISTS` in ALTER TABLE
2. Verify SQL syntax
3. Check database connection

### Issue: Data structure is wrong

**Cause:** Using array default for object field (or vice versa)

**Solution:** Match the default to expected structure:
- Arrays: `DEFAULT '[]'::jsonb`
- Objects: `DEFAULT '{}'::jsonb`

## Examples

### Array Field (e.g., notes, timelines)

```sql
ALTER TABLE books ADD COLUMN IF NOT EXISTS notes JSONB DEFAULT '[]'::jsonb;
```

```javascript
// BookRepository.create()
notes = [],

// API endpoint
notes: req.body.notes || [],

// dataService
book.notes = book.notes || [];
```

### Object Field (e.g., metadata, settings)

```sql
ALTER TABLE books ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
```

```javascript
// BookRepository.create()
metadata = {},

// API endpoint
metadata: req.body.metadata || {},

// dataService
book.metadata = book.metadata || {};
```

## Next Steps

After adding field successfully:
1. Use `create-pull-request` skill (after user confirms)
2. Wait for user to review and merge PR
3. Clean up local feature branch

