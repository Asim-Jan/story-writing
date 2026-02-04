---
name: debug-production
description: Systematic approach to debugging issues in production environment. Use this when something isn't working in production, data isn't persisting, or errors are occurring.
allowed-tools: [Write, Terminal, Read, Grep]
---

# Debug Production Issues

Systematic approach to debugging issues in production environment.

## When to Use This Skill

- Feature not working in production
- Data not persisting to database
- Errors in production logs
- API endpoints returning errors
- Authentication issues
- Deployment problems

## General Debugging Workflow

### Step 1: Identify the Issue

**Questions to ask:**
- What exactly is not working?
- When did it start?
- What changed recently (deployments, commits)?
- Can you reproduce it consistently?

### Step 2: Check Logs First

**Backend logs are your first stop:**

```bash
# View recent logs
aws logs tail /ecs/story-writing-backend --since 5m --region eu-west-2

# Filter for errors
aws logs tail /ecs/story-writing-backend --since 10m --region eu-west-2 | grep -i error

# Follow logs in real-time
aws logs tail /ecs/story-writing-backend --follow --region eu-west-2
```

### Step 3: Verify System State

```bash
# Check database status
node scripts/check-db-status.js

# Check PostgreSQL data
node scripts/check-postgres-data.js

# Check service status
aws ecs describe-services \
  --cluster story-writing-cluster-sai \
  --services story-writing-backend story-writing-frontend \
  --region eu-west-2 \
  --query 'services[*].{name:serviceName,status:status,running:runningCount}'
```

## Common Issues and Solutions

### Issue 1: Data Not Persisting

#### Symptoms
- Data saves but doesn't appear after refresh
- Updates don't take effect
- New records not created

#### Debugging Steps

**1. Check backend logs for errors:**
```bash
aws logs tail /ecs/story-writing-backend --since 5m --region eu-west-2 | grep -i error
```

**2. Verify database connection:**
```bash
node scripts/check-db-status.js
```

**3. Check if data reached the database:**
```bash
node -e "
import { getBook } from './server/db/dataService.js';
const book = await getBook('<book-id>');
console.log(JSON.stringify(book, null, 2));
"
```

**4. Verify API endpoint includes all fields:**
```bash
# Check POST /api/books
grep -A 20 "app.post('/api/books'" server/index.js

# Check PUT /api/books/:id
grep -A 30 "app.put('/api/books/:id'" server/index.js
```

**5. Check field mapping in dataService:**
```bash
grep -A 50 "_mapBookFields" server/db/dataService.js
```

#### Common Causes

**Missing field in API endpoint:**
```javascript
// ❌ WRONG
const bookData = {
  title: req.body.title,
  // Missing chapters!
};

// ✅ CORRECT
const bookData = {
  title: req.body.title,
  chapters: req.body.chapters || [],
};
```

**Field not in BookRepository:**
```javascript
// Check allowedFields in BookRepository.update()
const allowedFields = ['title', 'description', /* your field here */];
```

**Missing JSON.stringify/parse:**
```javascript
// BookRepository: MUST stringify JSONB
JSON.stringify(field_name)

// dataService: MUST parse JSONB
JSON.parse(book.field_name)
```

### Issue 2: Chapters Not Persisting

#### Special Considerations
Chapters are in a SEPARATE table, not JSONB in books!

**Debugging steps:**

```bash
# Check if chapters field is in API endpoint
grep -A 20 "app.post('/api/books'" server/index.js | grep chapters
grep -A 30 "app.put('/api/books/:id'" server/index.js | grep chapters

# Check syncChapters is being called
grep -A 10 "syncChapters" server/db/dataService.js

# Query chapters table directly
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

const result = await pool.query('SELECT * FROM chapters WHERE book_id = \$1', ['<book-id>']);
console.log(result.rows);
await pool.end();
"
```

### Issue 3: API Endpoint Errors

#### Symptoms
- 500 Internal Server Error
- 401 Unauthorized
- 404 Not Found
- CORS errors

#### Debugging Steps

**1. Test API directly:**
```bash
# Test GET endpoint
curl -X GET "https://story-writing.com/api/books/123" \
  -H "Authorization: Bearer <token>" \
  -v

# Test POST endpoint
curl -X POST "https://story-writing.com/api/books" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"title":"Test Book"}' \
  -v
```

**2. Check backend logs during request:**
```bash
aws logs tail /ecs/story-writing-backend --follow --region eu-west-2
# Then make the API request in browser
```

**3. Verify field name mappings:**
Frontend sends camelCase, backend expects data in both formats

**4. Check authentication:**
```bash
# In browser console
localStorage.getItem('token')
```

### Issue 4: User Settings Not Saving

#### Symptoms
- API keys not saving
- User preferences not persisting

#### Debugging Steps

**1. Check if using correct data service method:**
```bash
# Search for wrong method usage
grep -r "setRedisValue\|getRedisValue" server/ --include="*.js"

# Should use:
# getUserSettings()
# updateUserSettings()
```

**2. Verify user_settings table:**
```bash
node -e "
import { getUserSettings } from './server/db/dataService.js';
const settings = await getUserSettings('<user-id>');
console.log(settings);
"
```

**3. Check API key encryption:**
```bash
# API keys should be encrypted before storage
grep -A 5 "encrypt(" server/index.js
```

### Issue 5: Deployment Issues

#### Symptoms
- ECS tasks not starting
- Deployment stuck
- Health checks failing

#### Debugging Steps

**1. Check service status:**
```bash
aws ecs describe-services \
  --cluster story-writing-cluster-sai \
  --services story-writing-backend \
  --region eu-west-2 \
  --query 'services[0].{status:status,deployments:deployments[*].{status:status,rolloutState:rolloutState,runningCount:runningCount}}'
```

**2. Check recent service events:**
```bash
aws ecs describe-services \
  --cluster story-writing-cluster-sai \
  --services story-writing-backend \
  --region eu-west-2 \
  --query 'services[0].events[0:10]'
```

**3. Check task status:**
```bash
# List running tasks
aws ecs list-tasks \
  --cluster story-writing-cluster-sai \
  --service-name story-writing-backend \
  --region eu-west-2

# Describe specific task
aws ecs describe-tasks \
  --cluster story-writing-cluster-sai \
  --tasks <task-arn> \
  --region eu-west-2
```

**4. Check stopped tasks (if failing to start):**
```bash
aws ecs list-tasks \
  --cluster story-writing-cluster-sai \
  --service-name story-writing-backend \
  --desired-status STOPPED \
  --region eu-west-2

# Get stopped task details
aws ecs describe-tasks \
  --cluster story-writing-cluster-sai \
  --tasks <stopped-task-arn> \
  --region eu-west-2 \
  --query 'tasks[0].{stoppedReason:stoppedReason,containers:containers[*].{reason:reason,exitCode:exitCode}}'
```

**5. Verify environment variables:**
```bash
aws ecs describe-task-definition \
  --task-definition story-writing-backend \
  --region eu-west-2 \
  --query 'taskDefinition.containerDefinitions[0].environment[*].{name:name,value:value}' \
  --output table
```

**Expected environment variables:**
- `USE_POSTGRES=true`
- `DUAL_WRITE=false`
- `READ_FROM_POSTGRES=true`
- `NODE_ENV=production`

### Issue 6: Frontend Issues

#### Symptoms
- API calls failing
- Console errors
- Data not loading

#### Debugging Steps

**1. Check browser console:**
- Press `F12` or Right-click → Inspect
- Go to Console tab
- Look for red errors
- Check Network tab for failed requests

**2. Check frontend logs:**
```bash
aws logs tail /ecs/story-writing-frontend --since 5m --region eu-west-2
```

**3. Common frontend issues:**

**CORS errors:**
Check backend CORS configuration in `server/index.js`:
```javascript
app.use(cors({
  origin: ['https://story-writing.com', 'http://localhost:5173'],
  credentials: true
}));
```

**401 Unauthorized:**
Token expired or invalid. Check:
```javascript
// In browser console
localStorage.getItem('token')
```

**API pointing to wrong URL:**
Check VITE_API_URL was set during build:
```bash
# Frontend must be built with:
docker buildx build --build-arg VITE_API_URL="https://story-writing.com" ...
```

### Issue 7: Authentication Issues

#### Symptoms
- Can't log in
- Token errors
- User not found

#### Debugging Steps

**1. Test authentication endpoint:**
```bash
curl -X POST "https://story-writing.com/api/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"<username>","password":"<password>"}' \
  -v
```

**2. Verify user exists:**
```bash
node -e "
import { getUserByUsername } from './server/db/dataService.js';
const user = await getUserByUsername('<username>');
console.log(user);
"
```

**3. Check JWT token:**
```bash
# Test token validation
curl -X GET "https://story-writing.com/api/user/me" \
  -H "Authorization: Bearer <token>" \
  -v
```

## Useful Debugging Commands

### Database Queries

**Count books:**
```bash
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
const result = await pool.query('SELECT COUNT(*) FROM books');
console.log('Total books:', result.rows[0].count);
await pool.end();
"
```

**Get specific book:**
```bash
node -e "
import { getBook } from './server/db/dataService.js';
const book = await getBook('<book-id>');
console.log(JSON.stringify(book, null, 2));
"
```

**Check recent books:**
```bash
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
const result = await pool.query('SELECT id, title, created_at FROM books ORDER BY created_at DESC LIMIT 5');
console.log(result.rows);
await pool.end();
"
```

## Debugging Checklist

When debugging any issue:
- [ ] Check backend logs for errors
- [ ] Verify database connection and data
- [ ] Check service deployment status
- [ ] Verify feature flags in task definition
- [ ] Check API endpoint includes all required fields
- [ ] Verify field name mappings (camelCase ↔ snake_case)
- [ ] Test API directly with curl
- [ ] Check browser console for frontend errors
- [ ] Verify environment variables are correct
- [ ] Review recent code changes
- [ ] Check if issue exists in previous version

## Common Pitfalls

### ❌ Wrong Data Service Method
Using `setRedisValue()` instead of `updateUserSettings()`

### ❌ Missing Field in API Endpoint
Forgetting to add field to `bookData` or `updates` object

### ❌ Wrong Field Name
Using camelCase in backend instead of snake_case

### ❌ Not Waiting for Deployment
Testing immediately after deploy without waiting 60 seconds

### ❌ Not Encrypting API Keys
Storing API keys in plain text

### ❌ Missing JSON.stringify/parse
Forgetting to stringify JSONB before database or parse after

## Fix and Re-deploy Workflow

Once issue is identified:

1. Make fix on feature branch
2. Commit changes
3. Push to remote
4. Deploy: `./deploy.sh backend patch`
5. Wait 60 seconds
6. Test again
7. Repeat if needed

## Getting Additional Help

If still stuck:
1. Review `.claude/instructions.md` for detailed context
2. Check `MIGRATION_STATUS.md` for system architecture
3. Review `server/db/schema.sql` for database schema
4. Check related skills in `.claude/skills/`

