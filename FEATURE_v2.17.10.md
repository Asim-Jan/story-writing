# Feature v2.17.10 - Custom Focus Areas

**Date**: 2026-02-15
**Version**: 2.17.10 (to be deployed)
**Type**: Feature Enhancement
**Status**: ✅ IMPLEMENTED (Ready for Deployment)
**Branch**: feature/cost-tracking-ui
**Commit**: 07d218c
**Related**: Phase 5 of Continuity Checker enhancements

---

## Overview

This feature allows users to create custom focus areas for continuity analysis beyond the 5 predefined ones (timeline, characters, plot, locations, style).

Users can now define book-specific focus areas such as:
- "magic system" (for fantasy books)
- "tech accuracy" (for sci-fi books)
- "world-building", "dialogue", "pacing", "tone"
- "historical accuracy", "medical accuracy"
- Any other aspect specific to their book's needs

### Why Custom Focus Areas?

Different books need different types of continuity checking:
- A fantasy novel needs "magic system" consistency checks
- A sci-fi novel needs "tech consistency" or "physics"
- A historical novel needs "historical accuracy"
- A mystery novel might need "clue placement" or "alibi consistency"

The 5 preset focus areas (timeline, characters, plot, locations, style) are great general-purpose options, but custom focus areas allow for genre-specific and book-specific analysis.

---

## What Changed

### Database Changes

**Migration File**: [server/db/migrations/add_custom_focus_areas.sql](server/db/migrations/add_custom_focus_areas.sql)

```sql
ALTER TABLE books
ADD COLUMN IF NOT EXISTS custom_focus_areas TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE INDEX IF NOT EXISTS idx_books_custom_focus_areas
ON books USING GIN (custom_focus_areas);
```

**Why TEXT[] (array)**:
- Stores multiple custom focus areas per book
- GIN index enables fast searching
- Easy to add/remove individual areas
- Natural fit for PostgreSQL

**Migration Script**: [server/scripts/run-custom-focus-areas-migration.js](server/scripts/run-custom-focus-areas-migration.js)
- Connects to RDS database
- Executes migration SQL
- Verifies column and index created
- Run with: `node server/scripts/run-custom-focus-areas-migration.js`

---

### Backend Changes

**File**: [server/index.js](server/index.js)

#### 1. POST /api/books (Create Book) - Line ~3089
```javascript
const bookData = {
  // ... existing fields
  custom_focus_areas: req.body.customFocusAreas || []
};
```

Added `custom_focus_areas` to new book creation.

#### 2. PUT /api/books/:id (Update Book) - Lines ~3129, ~3152
```javascript
// For creation within PUT
const bookData = {
  // ... existing fields
  custom_focus_areas: req.body.customFocusAreas || []
};

// For updates
const updates = {
  // ... existing fields
  custom_focus_areas: req.body.customFocusAreas
};
```

Added `custom_focus_areas` to book update logic.

**Field Mapping**:
- Frontend sends: `customFocusAreas` (camelCase)
- Backend saves as: `custom_focus_areas` (snake_case for PostgreSQL)
- Returned to frontend as-is from database

---

### Frontend Changes

**File**: [src/components/ContinuityTab.jsx](src/components/ContinuityTab.jsx)

#### 1. New State Variables (after line 13)
```javascript
const [customFocusAreas, setCustomFocusAreas] = useState(data.customFocusAreas || []);
const [newFocusArea, setNewFocusArea] = useState('');
```

**State Management**:
- `customFocusAreas`: Array of custom focus areas for this book
- `newFocusArea`: Temporary input field value

#### 2. New Functions (after line 113)
```javascript
const addCustomFocusArea = () => {
  const trimmed = newFocusArea.trim().toLowerCase();
  if (trimmed && !customFocusAreas.includes(trimmed)) {
    const updated = [...customFocusAreas, trimmed];
    setCustomFocusAreas(updated);
    setData(prev => ({ ...prev, customFocusAreas: updated }));
    setNewFocusArea('');
  }
};

const removeCustomFocusArea = (area) => {
  const updated = customFocusAreas.filter(a => a !== area);
  setCustomFocusAreas(updated);
  setData(prev => ({ ...prev, customFocusAreas: updated }));
  // Also remove from selected focus areas if it was selected
  setFocusAreas(prev => prev.filter(a => a !== area));
};
```

**Logic**:
- `addCustomFocusArea`: Validates, lowercases, prevents duplicates, updates state and book data
- `removeCustomFocusArea`: Removes from custom list and from selected focus areas

**Why lowercase?**: Ensures consistency ("Magic System" === "magic system") and prevents duplicates.

#### 3. Sync Effect (after line 30)
```javascript
useEffect(() => {
  if (data.customFocusAreas && Array.isArray(data.customFocusAreas)) {
    setCustomFocusAreas(data.customFocusAreas);
  }
}, [data.customFocusAreas]);
```

Syncs custom focus areas when book data changes (e.g., when switching books).

#### 4. Updated UI (lines ~330-390)

**Before**:
```jsx
<div className="flex flex-wrap gap-2">
  {focusAreaOptions.map(area => (
    <button onClick={() => toggleFocusArea(area)}>
      {area}
    </button>
  ))}
</div>
```

**After**:
```jsx
{/* Preset Focus Areas */}
<div className="flex flex-wrap gap-2 mb-3">
  {focusAreaOptions.map(area => (
    <button
      onClick={() => toggleFocusArea(area)}
      className={focusAreas.includes(area) ? 'bg-purple-600' : 'bg-white'}
    >
      {area}
    </button>
  ))}
</div>

{/* Custom Focus Areas (indigo color) */}
{customFocusAreas.length > 0 && (
  <div className="flex flex-wrap gap-2 mb-3">
    {customFocusAreas.map(area => (
      <button
        onClick={() => toggleFocusArea(area)}
        className={focusAreas.includes(area) ? 'bg-indigo-600' : 'border-indigo-300'}
      >
        {area}
        <Trash2
          size={12}
          onClick={(e) => {
            e.stopPropagation();
            removeCustomFocusArea(area);
          }}
        />
      </button>
    ))}
  </div>
)}

{/* Add Custom Focus Area Input */}
<div className="flex items-center gap-2 mt-2">
  <input
    type="text"
    value={newFocusArea}
    onChange={(e) => setNewFocusArea(e.target.value)}
    onKeyPress={(e) => e.key === 'Enter' && addCustomFocusArea()}
    placeholder="Add custom focus area (e.g., magic system, dialogue)"
    className="flex-1 px-3 py-1.5 text-sm border"
  />
  <button
    onClick={addCustomFocusArea}
    disabled={!newFocusArea.trim()}
    className="px-3 py-1.5 bg-indigo-600 text-white"
  >
    Add
  </button>
</div>

<p className="text-xs text-gray-600 mt-2">
  Select areas to focus the analysis. Custom areas shown in blue.
</p>
```

**UI Design Choices**:
- **Purple**: Preset focus areas (timeline, characters, etc.)
- **Indigo (blue)**: Custom focus areas
- **Trash icon**: Appears on custom focus area buttons to delete
- **Input field**: Below focus areas, Enter key or Add button to add
- **Disabled state**: Add button disabled when input is empty

---

## How It Works

### Scenario 1: Adding a Custom Focus Area

```
User: Types "magic system" in input field
      Presses Enter (or clicks Add button)
↓
Frontend: addCustomFocusArea()
          - Trims and lowercases: "magic system"
          - Checks for duplicates: not found
          - Adds to customFocusAreas array
          - Updates data.customFocusAreas
          - Clears input field
↓
UI: New indigo button appears: "magic system"
↓
User: Saves book (auto-save or manual)
↓
Frontend: PUT /api/books/:id with customFocusAreas: ["magic system"]
↓
Backend: Saves to books.custom_focus_areas column
```

### Scenario 2: Using a Custom Focus Area in Analysis

```
User: Clicks "magic system" button (turns indigo background)
      Clicks "Run Analysis"
↓
Frontend: onAnalyze(data, ["magic system"], [])
↓
Backend: POST /api/analyze-continuity
         focusAreas = ["magic system"]
         systemPrompt += "FOCUS AREAS: Prioritize analysis of: magic system"
↓
AI: Analyzes book with special attention to magic system consistency
    - Magic rules consistent across chapters?
    - Power levels consistent?
    - Magical elements introduced properly?
↓
Response: Issues focused on magic system inconsistencies
```

### Scenario 3: Combining Preset and Custom Focus Areas

```
User: Selects "timeline" (preset, purple)
      Selects "magic system" (custom, indigo)
      Runs analysis
↓
focusAreas = ["timeline", "magic system"]
↓
AI: Prioritizes both timeline AND magic system in analysis
```

### Scenario 4: Deleting a Custom Focus Area

```
User: Hovers over "magic system" button
      Clicks trash icon
↓
Frontend: removeCustomFocusArea("magic system")
          - Removes from customFocusAreas
          - Removes from focusAreas (if selected)
          - Updates data.customFocusAreas
↓
UI: "magic system" button disappears
↓
User: Saves book
↓
Backend: custom_focus_areas no longer includes "magic system"
```

---

## Benefits

### 1. Genre-Specific Analysis
- **Fantasy**: magic system, world-building, mythological accuracy
- **Sci-Fi**: tech consistency, physics, future world-building
- **Historical**: historical accuracy, period language, cultural details
- **Mystery**: clue placement, alibi consistency, red herrings
- **Romance**: emotional continuity, relationship progression

### 2. Book-Specific Needs
Different books in the same genre may need different focus areas:
- Book 1: "dragon lore", "kingdom politics"
- Book 2: "spaceship mechanics", "alien biology"

### 3. Flexible and Extensible
Users can add as many custom focus areas as needed, delete them when no longer relevant, and change them as the book evolves.

### 4. Better AI Analysis
By focusing on book-specific aspects, the AI provides more relevant and actionable feedback.

---

## API Contract

### POST /api/books

**Request**:
```json
{
  "title": "The Magic Chronicles",
  "customFocusAreas": ["magic system", "dragon lore"]
}
```

**Response**:
```json
{
  "id": "uuid",
  "title": "The Magic Chronicles",
  "custom_focus_areas": ["magic system", "dragon lore"]
}
```

### PUT /api/books/:id

**Request**:
```json
{
  "title": "The Magic Chronicles",
  "customFocusAreas": ["magic system", "dragon lore", "kingdom politics"]
}
```

**Response**:
```json
{
  "id": "uuid",
  "title": "The Magic Chronicles",
  "custom_focus_areas": ["magic system", "dragon lore", "kingdom politics"]
}
```

**Note**: Backend converts `customFocusAreas` (camelCase) to `custom_focus_areas` (snake_case) for database.

---

## Deployment Instructions

### ⚠️ IMPORTANT: Migration Required

This feature requires a database migration to add the `custom_focus_areas` column to the books table.

### Step 1: Run Database Migration

**Option A: Using Migration Script** (Recommended)
```bash
# SSH into backend container or EC2 instance
docker exec -it <backend-container> sh

# Run migration
node server/scripts/run-custom-focus-areas-migration.js

# Expected output:
# ✓ Connected to story_writing database
# ✓ Read migration file: add_custom_focus_areas.sql
# 📝 Executing Custom Focus Areas migration...
# ✅ Migration executed successfully!
# 📊 Column added to books table:
#   ✓ custom_focus_areas (ARRAY)
# 📊 Index created:
#   ✓ idx_books_custom_focus_areas
# ✅ Custom Focus Areas migration complete!
```

**Option B: Manual SQL Execution**
```bash
# Connect to RDS
psql -h story-writing-postgres.cxsu2memgs31.eu-west-2.rds.amazonaws.com \
     -U story_user \
     -d story_writing

# Run migration SQL
ALTER TABLE books
ADD COLUMN IF NOT EXISTS custom_focus_areas TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE INDEX IF NOT EXISTS idx_books_custom_focus_areas
ON books USING GIN (custom_focus_areas);

# Verify
\d books
# Should show custom_focus_areas | ARRAY
```

### Step 2: Deploy Code

```bash
# Ensure AWS credentials are valid
aws sts get-caller-identity

# Deploy backend and frontend
./deploy.sh all patch

# This will bump version: 2.17.8 → 2.17.9
```

### Step 3: Verify Deployment

**1. Check Migration**:
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'books'
AND column_name = 'custom_focus_areas';

-- Should return:
-- custom_focus_areas | ARRAY
```

**2. Test Custom Focus Areas**:
- Open a book
- Go to Continuity tab
- Type "magic system" in custom focus area input
- Click Add button
- Should see indigo button appear
- Click button to select it (should turn darker indigo)
- Save book
- Reload page → Custom focus area should persist

**3. Test Analysis with Custom Focus Area**:
- Select custom focus area
- Run continuity analysis
- Check backend logs: Should show "Prioritize analysis of: magic system"

**4. Test Deletion**:
- Hover over custom focus area button
- Click trash icon
- Button should disappear
- Save book
- Reload → Should not reappear

---

## Testing Checklist

- [ ] Migration runs successfully
- [ ] Column `custom_focus_areas` exists in books table
- [ ] Index `idx_books_custom_focus_areas` created
- [ ] Can add custom focus area via input field
- [ ] Enter key adds custom focus area
- [ ] Add button adds custom focus area
- [ ] Duplicate custom focus areas prevented
- [ ] Custom focus areas shown in indigo color
- [ ] Can select/deselect custom focus areas
- [ ] Trash icon appears on custom focus areas
- [ ] Can delete custom focus areas
- [ ] Deleting custom focus area removes it from selected areas
- [ ] Custom focus areas saved with book
- [ ] Custom focus areas persist after page reload
- [ ] Custom focus areas passed to AI analysis
- [ ] AI prompt includes custom focus areas
- [ ] Can combine preset and custom focus areas
- [ ] Multiple custom focus areas work correctly
- [ ] Empty input prevents adding
- [ ] Whitespace-only input prevents adding
- [ ] Case-insensitive duplicate detection works

---

## Edge Cases Handled

### 1. Duplicate Prevention (Case-Insensitive)
**Scenario**: User adds "Magic System", then tries to add "magic system"
**Behavior**: Second addition is ignored (duplicate detected via lowercase comparison)
```javascript
const trimmed = newFocusArea.trim().toLowerCase();
if (trimmed && !customFocusAreas.includes(trimmed)) { ... }
```

### 2. Empty/Whitespace Input
**Scenario**: User tries to add "" or "   "
**Behavior**: Add button is disabled, pressing Enter does nothing
```javascript
disabled={!newFocusArea.trim()}
```

### 3. Deleting Selected Custom Focus Area
**Scenario**: User selects "magic system", then deletes it
**Behavior**: Removed from both customFocusAreas and focusAreas (selected list)
```javascript
setFocusAreas(prev => prev.filter(a => a !== area));
```

### 4. Book Without Custom Focus Areas
**Scenario**: Old book created before this feature
**Behavior**: `customFocusAreas` defaults to empty array
```javascript
const [customFocusAreas, setCustomFocusAreas] = useState(data.customFocusAreas || []);
```

### 5. Switching Books
**Scenario**: User switches from Book A (has "magic system") to Book B (has "tech accuracy")
**Behavior**: Custom focus areas update via useEffect
```javascript
useEffect(() => {
  if (data.customFocusAreas && Array.isArray(data.customFocusAreas)) {
    setCustomFocusAreas(data.customFocusAreas);
  }
}, [data.customFocusAreas]);
```

---

## Future Enhancements

### Potential Improvements:

1. **Suggested Custom Focus Areas**: Based on book genre
   - Fantasy → Suggest "magic system", "world-building", "mythological accuracy"
   - Sci-Fi → Suggest "tech consistency", "physics", "alien biology"

2. **User-Level Custom Focus Areas**: Save across all user's books
   - User creates "magic system" in Book 1
   - Offered as suggestion in Book 2

3. **Focus Area Templates**: Pre-made sets for different genres
   - "Fantasy Bundle": magic, world-building, creatures, lore
   - "Mystery Bundle": clues, alibis, red herrings, suspects

4. **Focus Area Descriptions**: Help text for each custom area
   - User can add description: "magic system - ensure spell costs are consistent"

5. **Analysis Quality Metrics**: Track which focus areas find the most issues

6. **Bulk Import/Export**: Share custom focus area sets with other users

---

## Performance Impact

### Database
- GIN index on `custom_focus_areas` enables fast searching
- Array column is efficient for small lists (typically <10 items per book)
- No additional JOIN queries needed (data embedded in books table)

### Frontend
- Minimal state overhead (one array per book)
- No additional API calls (custom areas loaded with book)
- Instant UI updates when adding/removing

### Backend
- Custom focus areas concatenated to AI prompt string
- No performance impact on analysis speed

---

## Lessons Learned

### 1. Per-Book vs User-Level Storage
**Decision**: Store custom focus areas per-book (not user-level)
**Reason**: Different books need different focus areas even for the same user

Could add user-level in future for suggestions.

### 2. Lowercase Normalization
**Decision**: Store all custom focus areas as lowercase
**Reason**: Prevents duplicates like "Magic System" vs "magic system"
**Trade-off**: Display capitalization lost (acceptable)

### 3. Color Coding
**Decision**: Purple for presets, Indigo for custom
**Reason**: Visual distinction helps users understand which are standard vs custom
**Alternative considered**: Icons (⭐ for preset, ✨ for custom) - felt cluttered

### 4. Inline Delete
**Decision**: Trash icon on custom focus area button itself
**Reason**: Discoverable, no extra UI needed
**Alternative considered**: Separate "Manage" modal - too complex

### 5. Auto-Save Integration
**Decision**: Update `data` object immediately, let auto-save handle persistence
**Reason**: Consistent with how other book fields work
**Benefit**: No special save logic needed

---

## Status

✅ **IMPLEMENTED & READY FOR DEPLOYMENT**

**Code Status**:
- Migration SQL: ✅ Created
- Migration script: ✅ Created
- Backend changes: ✅ Committed (07d218c)
- Frontend changes: ✅ Committed (07d218c)
- Pushed to branch: ✅ feature/cost-tracking-ui

**Next Steps**:
1. **Run migration**: `node server/scripts/run-custom-focus-areas-migration.js`
2. **Deploy code**: `./deploy.sh all patch` (will bump to v2.17.9)
3. **Verify**: Follow testing checklist above
4. **Monitor**: Check logs for any errors with custom_focus_areas

**Deployment Date**: Pending (AWS credentials expired)

---

## Commit Message

```
07d218c feat: Add custom focus areas for continuity analysis (Phase 5)

- Add custom_focus_areas TEXT[] column to books table
- Create migration script to add column and GIN index
- Update backend PUT /api/books/:id to save/load custom focus areas
- Add UI for creating custom focus areas with input field
- Display custom focus areas with indigo color scheme (vs purple for presets)
- Add delete button for each custom focus area (trash icon)
- Custom focus areas saved with book automatically

Users can now define their own focus areas beyond the 5 presets
(timeline, characters, plot, locations, style). Examples: 'magic system',
'world-building', 'dialogue', 'tech accuracy', etc.

Custom focus areas are per-book, allowing different books to have
different custom areas based on genre and specific needs.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```

---

## Related Documentation

- **Phase 3**: FEATURE_v2.17.9.md (Continuity History)
- **Phase 4**: FEATURE_v2.17.7.md (Incremental Chapter Analysis)
- **Plan File**: `/Users/asim.solutionsai/.claude/plans/glistening-twirling-bumblebee.md`
- **Pull Request**: #12 (AI Cost Tracking + Continuity enhancements)
