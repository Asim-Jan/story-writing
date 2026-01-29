import { query, transaction } from '../postgres.js';

export class BookRepository {
  /**
   * Create a new book
   * @param {object} bookData - Book data
   * @returns {Promise<object>} Created book
   */
  static async create(bookData) {
    const {
      id,
      owner_id,
      title,
      description = '',
      genre = '',
      target_audience = '',
      characters = [],
      locations = [],
      plotlines = [],
      world_building = {},
      settings = {},
      notes = [],
      timelines = [],
      visuals = [],
      audio_files = {},
      comic_pages = [],
      character_refs = {},
      animation_projects = [],
      metadata = {},
      status = 'draft'
    } = bookData;

    // If ID is provided, include it in the INSERT
    if (id) {
      const result = await query(
        `INSERT INTO books (
          id, owner_id, title, description, genre, target_audience,
          characters, locations, plotlines, world_building, settings, notes, timelines, visuals,
          audio_files, comic_pages, character_refs, animation_projects, metadata, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
        RETURNING *`,
        [
          id,
          owner_id,
          title,
          description,
          genre,
          target_audience,
          JSON.stringify(characters),
          JSON.stringify(locations),
          JSON.stringify(plotlines),
          JSON.stringify(world_building),
          JSON.stringify(settings),
          JSON.stringify(notes),
          JSON.stringify(timelines),
          JSON.stringify(visuals),
          JSON.stringify(audio_files),
          JSON.stringify(comic_pages),
          JSON.stringify(character_refs),
          JSON.stringify(animation_projects),
          JSON.stringify(metadata),
          status
        ]
      );
      return result.rows[0];
    }

    // Otherwise, let PostgreSQL generate the ID
    const result = await query(
      `INSERT INTO books (
        owner_id, title, description, genre, target_audience,
        characters, locations, plotlines, world_building, settings, notes, timelines, visuals,
        audio_files, comic_pages, character_refs, animation_projects, metadata, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      RETURNING *`,
      [
        owner_id,
        title,
        description,
        genre,
        target_audience,
        JSON.stringify(characters),
        JSON.stringify(locations),
        JSON.stringify(plotlines),
        JSON.stringify(world_building),
        JSON.stringify(settings),
        JSON.stringify(notes),
        JSON.stringify(timelines),
        JSON.stringify(visuals),
        JSON.stringify(audio_files),
        JSON.stringify(comic_pages),
        JSON.stringify(character_refs),
        JSON.stringify(animation_projects),
        JSON.stringify(metadata),
        status
      ]
    );

    return result.rows[0];
  }

  /**
   * Find book by ID
   * @param {string} bookId - Book UUID
   * @returns {Promise<object|null>} Book or null
   */
  static async findById(bookId) {
    const result = await query(
      'SELECT * FROM books WHERE id = $1 AND deleted_at IS NULL',
      [bookId]
    );
    return result.rows[0] || null;
  }

  /**
   * Find book by ID with collaborators
   * @param {string} bookId - Book UUID
   * @returns {Promise<object|null>} Book with collaborators or null
   */
  static async findByIdWithCollaborators(bookId) {
    const result = await query(
      `SELECT
        b.*,
        COALESCE(
          json_agg(
            json_build_object(
              'id', c.id,
              'email', c.email,
              'role', c.role,
              'status', c.status,
              'user_id', c.user_id
            )
          ) FILTER (WHERE c.id IS NOT NULL),
          '[]'
        ) as collaborators
       FROM books b
       LEFT JOIN collaborators c ON b.id = c.book_id AND c.status = 'active'
       WHERE b.id = $1 AND b.deleted_at IS NULL
       GROUP BY b.id`,
      [bookId]
    );
    return result.rows[0] || null;
  }

  /**
   * Find all books for a user (owned + collaborated)
   * @param {string} userId - User UUID
   * @param {object} options - Query options (limit, offset, status)
   * @returns {Promise<Array>} Books
   */
  static async findByUser(userId, options = {}) {
    const { limit = 50, offset = 0, status = null } = options;

    let whereClause = 'WHERE b.deleted_at IS NULL AND (b.owner_id = $1 OR c.user_id = $1)';
    const params = [userId];
    let paramCount = 2;

    if (status) {
      whereClause += ` AND b.status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    params.push(limit, offset);

    const result = await query(
      `SELECT DISTINCT b.*
       FROM books b
       LEFT JOIN collaborators c ON b.id = c.book_id AND c.status = 'active'
       ${whereClause}
       ORDER BY b.updated_at DESC
       LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
      params
    );

    return result.rows;
  }

  /**
   * Update book with optimistic locking
   * @param {string} bookId - Book UUID
   * @param {string} userId - User UUID (for ownership check)
   * @param {object} updates - Fields to update
   * @param {number} expectedVersion - Expected version for optimistic locking
   * @returns {Promise<object>} Updated book
   */
  static async update(bookId, userId, updates, expectedVersion) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    // Allowed fields for update
    const allowedFields = [
      'title', 'description', 'genre', 'target_audience',
      'characters', 'locations', 'plotlines', 'world_building',
      'settings', 'notes', 'timelines', 'visuals',
      'audio_files', 'comic_pages', 'character_refs', 'animation_projects', 'metadata',
      'status', 'word_count', 'chapter_count'
    ];

    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key)) {
        // JSON fields need to be stringified
        if (['characters', 'locations', 'plotlines', 'world_building', 'settings',
             'notes', 'timelines', 'visuals',
             'audio_files', 'comic_pages', 'character_refs', 'animation_projects', 'metadata'].includes(key)) {
          fields.push(`${key} = $${paramCount}`);
          values.push(JSON.stringify(updates[key]));
        } else {
          fields.push(`${key} = $${paramCount}`);
          values.push(updates[key]);
        }
        paramCount++;
      }
    });

    if (fields.length === 0) {
      throw new Error('No valid fields to update');
    }

    values.push(bookId, userId, expectedVersion);

    const result = await query(
      `UPDATE books SET ${fields.join(', ')}
       WHERE id = $${paramCount} AND owner_id = $${paramCount + 1} AND version = $${paramCount + 2} AND deleted_at IS NULL
       RETURNING *`,
      values
    );

    if (result.rowCount === 0) {
      // Check if book exists
      const book = await this.findById(bookId);
      if (!book) {
        throw new Error('Book not found');
      }
      if (book.owner_id !== userId) {
        throw new Error('Not authorized to update this book');
      }
      throw new Error('CONFLICT: Book was modified by another user. Please refresh and try again.');
    }

    return result.rows[0];
  }

  /**
   * Soft delete book
   * @param {string} bookId - Book UUID
   * @param {string} userId - User UUID (owner only)
   * @returns {Promise<boolean>} Success
   */
  static async delete(bookId, userId) {
    const result = await query(
      `UPDATE books SET deleted_at = NOW()
       WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
      [bookId, userId]
    );
    return result.rowCount > 0;
  }

  /**
   * Check if user has access to book (owner or collaborator)
   * @param {string} bookId - Book UUID
   * @param {string} userId - User UUID
   * @returns {Promise<object|null>} Access info or null
   */
  static async checkAccess(bookId, userId) {
    const result = await query(
      `SELECT
        b.id,
        b.owner_id,
        CASE WHEN b.owner_id = $2 THEN 'owner' ELSE c.role END as access_role,
        CASE WHEN b.owner_id = $2 THEN true ELSE (c.status = 'active') END as has_access
       FROM books b
       LEFT JOIN collaborators c ON b.id = c.book_id AND c.user_id = $2
       WHERE b.id = $1 AND b.deleted_at IS NULL`,
      [bookId, userId]
    );

    const access = result.rows[0];
    return access && access.has_access ? access : null;
  }

  /**
   * Add collaborator to book
   * @param {string} bookId - Book UUID
   * @param {string} email - Collaborator email
   * @param {string} role - Role (viewer, commenter, editor)
   * @returns {Promise<object>} Created collaborator
   */
  static async addCollaborator(bookId, email, role = 'viewer') {
    const result = await query(
      `INSERT INTO collaborators (book_id, email, role, status)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (book_id, email)
       DO UPDATE SET role = $3, status = 'pending', invited_at = NOW()
       RETURNING *`,
      [bookId, email, role]
    );
    return result.rows[0];
  }

  /**
   * Accept collaboration invite
   * @param {string} bookId - Book UUID
   * @param {string} userId - User UUID
   * @param {string} email - User email
   * @returns {Promise<object>} Updated collaborator
   */
  static async acceptCollaboration(bookId, userId, email) {
    const result = await query(
      `UPDATE collaborators
       SET user_id = $1, status = 'active', accepted_at = NOW()
       WHERE book_id = $2 AND email = $3 AND status = 'pending'
       RETURNING *`,
      [userId, bookId, email]
    );

    if (result.rowCount === 0) {
      throw new Error('Collaboration invite not found or already accepted');
    }

    return result.rows[0];
  }

  /**
   * Remove collaborator
   * @param {string} bookId - Book UUID
   * @param {string} collaboratorId - Collaborator UUID
   * @returns {Promise<boolean>} Success
   */
  static async removeCollaborator(bookId, collaboratorId) {
    const result = await query(
      'DELETE FROM collaborators WHERE id = $1 AND book_id = $2',
      [collaboratorId, bookId]
    );
    return result.rowCount > 0;
  }

  /**
   * Search books by title or description
   * @param {string} userId - User UUID
   * @param {string} searchTerm - Search term
   * @param {object} options - Query options
   * @returns {Promise<Array>} Matching books
   */
  static async search(userId, searchTerm, options = {}) {
    const { limit = 20, offset = 0 } = options;

    const result = await query(
      `SELECT b.*, ts_rank(b.title_search, query) + ts_rank(b.description_search, query) as rank
       FROM books b, plainto_tsquery('english', $1) query
       WHERE (b.owner_id = $2 OR EXISTS (
         SELECT 1 FROM collaborators c
         WHERE c.book_id = b.id AND c.user_id = $2 AND c.status = 'active'
       ))
       AND b.deleted_at IS NULL
       AND (b.title_search @@ query OR b.description_search @@ query)
       ORDER BY rank DESC, b.updated_at DESC
       LIMIT $3 OFFSET $4`,
      [searchTerm, userId, limit, offset]
    );

    return result.rows;
  }

  /**
   * Update book statistics (word count, chapter count)
   * @param {string} bookId - Book UUID
   * @returns {Promise<object>} Updated book
   */
  static async updateStats(bookId) {
    const result = await query(
      `UPDATE books b
       SET
         chapter_count = (SELECT COUNT(*) FROM chapters WHERE book_id = b.id AND deleted_at IS NULL),
         word_count = (SELECT COALESCE(SUM(word_count), 0) FROM chapters WHERE book_id = b.id AND deleted_at IS NULL)
       WHERE b.id = $1 AND b.deleted_at IS NULL
       RETURNING *`,
      [bookId]
    );
    return result.rows[0];
  }
}

export default BookRepository;
