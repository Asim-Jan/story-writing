import { query, transaction } from '../postgres.js';

export class ChapterRepository {
  /**
   * Create a new chapter
   * @param {object} chapterData - Chapter data
   * @returns {Promise<object>} Created chapter
   */
  static async create(chapterData) {
    const {
      book_id,
      chapter_number,
      title = '',
      content = '',
      scenes = [],
      notes = '',
      status = 'draft'
    } = chapterData;

    // Calculate word count
    const word_count = content.trim().split(/\s+/).filter(w => w.length > 0).length;

    const result = await query(
      `INSERT INTO chapters (book_id, chapter_number, title, content, scenes, notes, word_count, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [book_id, chapter_number, title, content, JSON.stringify(scenes), notes, word_count, status]
    );

    const chapter = result.rows[0];

    // Create initial version
    await query(
      `INSERT INTO chapter_versions (chapter_id, version_number, content, scenes, word_count)
       VALUES ($1, $2, $3, $4, $5)`,
      [chapter.id, 1, content, JSON.stringify(scenes), word_count]
    );

    return chapter;
  }

  /**
   * Find chapter by ID
   * @param {string} chapterId - Chapter UUID
   * @returns {Promise<object|null>} Chapter or null
   */
  static async findById(chapterId) {
    const result = await query(
      'SELECT * FROM chapters WHERE id = $1 AND deleted_at IS NULL',
      [chapterId]
    );
    return result.rows[0] || null;
  }

  /**
   * Find all chapters for a book
   * @param {string} bookId - Book UUID
   * @returns {Promise<Array>} Chapters ordered by chapter_number
   */
  static async findByBookId(bookId) {
    const result = await query(
      `SELECT * FROM chapters
       WHERE book_id = $1 AND deleted_at IS NULL
       ORDER BY chapter_number ASC`,
      [bookId]
    );
    return result.rows;
  }

  /**
   * Find single chapter by book and chapter number
   * @param {string} bookId - Book UUID
   * @param {number} chapterNumber - Chapter number
   * @returns {Promise<object|null>} Chapter or null
   */
  static async findByNumber(bookId, chapterNumber) {
    const result = await query(
      `SELECT * FROM chapters
       WHERE book_id = $1 AND chapter_number = $2 AND deleted_at IS NULL`,
      [bookId, chapterNumber]
    );
    return result.rows[0] || null;
  }

  /**
   * Update chapter with optimistic locking and version history
   * @param {string} chapterId - Chapter UUID
   * @param {object} updates - Fields to update
   * @param {number} expectedVersion - Expected version
   * @param {string} userId - User making the update (for version history)
   * @returns {Promise<object>} Updated chapter
   */
  static async update(chapterId, updates, expectedVersion, userId = null, existingClient = null) {
    const run = async (client) => {
      const fields = [];
      const values = [];
      let paramCount = 1;

      // Allowed fields
      const allowedFields = ['chapter_number', 'title', 'content', 'scenes', 'notes', 'status', 'cover_image', 'cover_image_filename'];

      let newContent = null;
      let newScenes = null;

      Object.keys(updates).forEach(key => {
        if (allowedFields.includes(key)) {
          if (key === 'content') {
            newContent = updates[key];
            // Recalculate word count
            const word_count = newContent.trim().split(/\s+/).filter(w => w.length > 0).length;
            fields.push(`word_count = $${paramCount}`);
            values.push(word_count);
            paramCount++;
          }

          if (key === 'scenes') {
            newScenes = updates[key];
            fields.push(`${key} = $${paramCount}`);
            values.push(JSON.stringify(newScenes));
          } else if (key !== 'content') {
            fields.push(`${key} = $${paramCount}`);
            values.push(updates[key]);
          } else {
            fields.push(`${key} = $${paramCount}`);
            values.push(newContent);
          }
          paramCount++;
        }
      });

      if (fields.length === 0) {
        throw new Error('No valid fields to update');
      }

      values.push(chapterId, expectedVersion);

      const result = await client.query(
        `UPDATE chapters SET ${fields.join(', ')}
         WHERE id = $${paramCount} AND version = $${paramCount + 1} AND deleted_at IS NULL
         RETURNING *`,
        values
      );

      if (result.rowCount === 0) {
        const chapter = await client.query('SELECT * FROM chapters WHERE id = $1', [chapterId]);
        if (chapter.rows.length === 0) {
          throw new Error('Chapter not found');
        }
        throw new Error('CONFLICT: Chapter was modified by another user. Please refresh and try again.');
      }

      const updatedChapter = result.rows[0];

      // Save version history if content or scenes changed
      // Only create versions periodically to avoid excessive version creation
      if (newContent !== null || newScenes !== null) {
        // Get the most recent version for this chapter
        const lastVersionResult = await client.query(
          `SELECT created_at, word_count FROM chapter_versions
           WHERE chapter_id = $1
           ORDER BY version_number DESC
           LIMIT 1`,
          [chapterId]
        );

        let shouldCreateVersion = false;

        if (lastVersionResult.rows.length === 0) {
          // No versions exist yet, create the first one
          shouldCreateVersion = true;
        } else {
          const lastVersion = lastVersionResult.rows[0];
          const timeSinceLastVersion = Date.now() - new Date(lastVersion.created_at).getTime();
          const minutesSinceLastVersion = timeSinceLastVersion / (1000 * 60);

          // Calculate word count difference
          const wordCountDiff = Math.abs(updatedChapter.word_count - (lastVersion.word_count || 0));

          // Create a version if:
          // 1. More than 5 minutes have passed since last version, OR
          // 2. Word count changed by more than 100 words (significant edit)
          if (minutesSinceLastVersion >= 5 || wordCountDiff >= 100) {
            shouldCreateVersion = true;
          }
        }

        if (shouldCreateVersion) {
          await client.query(
            `INSERT INTO chapter_versions (chapter_id, version_number, content, scenes, word_count, created_by)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [
              chapterId,
              updatedChapter.version,
              newContent || updatedChapter.content,
              JSON.stringify(newScenes || updatedChapter.scenes),
              updatedChapter.word_count,
              userId
            ]
          );
        }
      }

      return updatedChapter;
    };
    // existingClient: run on the CALLER'S transaction (the save-path book save
    // syncs chapters inside the book-update transaction; a nested BEGIN would
    // error or silently commit early).
    return existingClient ? await run(existingClient) : await transaction(run);
  }

  /**
   * Soft delete chapter
   * @param {string} chapterId - Chapter UUID
   * @returns {Promise<boolean>} Success
   */
  static async delete(chapterId) {
    const result = await query(
      'UPDATE chapters SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
      [chapterId]
    );
    return result.rowCount > 0;
  }

  /**
   * Get chapter version history
   * @param {string} chapterId - Chapter UUID
   * @param {object} options - Query options
   * @returns {Promise<Array>} Version history
   */
  static async getVersionHistory(chapterId, options = {}) {
    const { limit = 10, offset = 0 } = options;

    const result = await query(
      `SELECT cv.*, u.name as created_by_name, u.email as created_by_email
       FROM chapter_versions cv
       LEFT JOIN users u ON cv.created_by = u.id
       WHERE cv.chapter_id = $1
       ORDER BY cv.version_number DESC
       LIMIT $2 OFFSET $3`,
      [chapterId, limit, offset]
    );

    return result.rows;
  }

  /**
   * Restore chapter to a previous version
   * @param {string} chapterId - Chapter UUID
   * @param {number} versionNumber - Version to restore to
   * @param {number} currentVersion - Current version for optimistic locking
   * @param {string} userId - User making the restore
   * @returns {Promise<object>} Updated chapter
   */
  static async restoreVersion(chapterId, versionNumber, currentVersion, userId) {
    return await transaction(async (client) => {
      // Get the version to restore
      const versionResult = await client.query(
        'SELECT * FROM chapter_versions WHERE chapter_id = $1 AND version_number = $2',
        [chapterId, versionNumber]
      );

      if (versionResult.rows.length === 0) {
        throw new Error('Version not found');
      }

      const version = versionResult.rows[0];

      // Update chapter with version content
      const updateResult = await client.query(
        `UPDATE chapters
         SET content = $1, scenes = $2, word_count = $3, version = version + 1
         WHERE id = $4 AND version = $5 AND deleted_at IS NULL
         RETURNING *`,
        [version.content, version.scenes, version.word_count, chapterId, currentVersion]
      );

      if (updateResult.rowCount === 0) {
        throw new Error('CONFLICT: Chapter was modified. Please refresh and try again.');
      }

      const updatedChapter = updateResult.rows[0];

      // Create new version entry for the restore
      await client.query(
        `INSERT INTO chapter_versions (chapter_id, version_number, content, scenes, word_count, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          chapterId,
          updatedChapter.version,
          version.content,
          version.scenes,
          version.word_count,
          userId
        ]
      );

      return updatedChapter;
    });
  }

  /**
   * Reorder chapters
   * @param {string} bookId - Book UUID
   * @param {Array} chapterOrders - Array of {id, chapter_number}
   * @returns {Promise<Array>} Updated chapters
   */
  static async reorder(bookId, chapterOrders) {
    return await transaction(async (client) => {
      const updatedChapters = [];

      for (const { id, chapter_number } of chapterOrders) {
        const result = await client.query(
          `UPDATE chapters SET chapter_number = $1
           WHERE id = $2 AND book_id = $3 AND deleted_at IS NULL
           RETURNING *`,
          [chapter_number, id, bookId]
        );

        if (result.rows[0]) {
          updatedChapters.push(result.rows[0]);
        }
      }

      return updatedChapters;
    });
  }

  /**
   * Search chapters by content
   * @param {string} bookId - Book UUID
   * @param {string} searchTerm - Search term
   * @param {object} options - Query options
   * @returns {Promise<Array>} Matching chapters
   */
  static async search(bookId, searchTerm, options = {}) {
    const { limit = 10, offset = 0 } = options;

    const result = await query(
      `SELECT c.*, ts_rank(c.content_search, query) as rank
       FROM chapters c, plainto_tsquery('english', $1) query
       WHERE c.book_id = $2
       AND c.deleted_at IS NULL
       AND c.content_search @@ query
       ORDER BY rank DESC, c.chapter_number ASC
       LIMIT $3 OFFSET $4`,
      [searchTerm, bookId, limit, offset]
    );

    return result.rows;
  }

  /**
   * Bulk create chapters (for imports)
   * @param {Array} chaptersData - Array of chapter data
   * @returns {Promise<Array>} Created chapters
   */
  static async bulkCreate(chaptersData) {
    return await transaction(async (client) => {
      const chapters = [];

      for (const chapterData of chaptersData) {
        const {
          book_id,
          chapter_number,
          title = '',
          content = '',
          scenes = [],
          notes = '',
          status = 'draft'
        } = chapterData;

        const word_count = content.trim().split(/\s+/).filter(w => w.length > 0).length;

        const result = await client.query(
          `INSERT INTO chapters (book_id, chapter_number, title, content, scenes, notes, word_count, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [book_id, chapter_number, title, content, JSON.stringify(scenes), notes, word_count, status]
        );

        const chapter = result.rows[0];

        // Create initial version
        await client.query(
          `INSERT INTO chapter_versions (chapter_id, version_number, content, scenes, word_count)
           VALUES ($1, $2, $3, $4, $5)`,
          [chapter.id, 1, content, JSON.stringify(scenes), word_count]
        );

        chapters.push(chapter);
      }

      return chapters;
    });
  }
}

export default ChapterRepository;
