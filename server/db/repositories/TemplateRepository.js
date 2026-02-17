/**
 * TemplateRepository
 * Handles all database operations for template books
 */

import { query, transaction } from '../postgres.js';
import { v4 as uuidv4 } from 'uuid';

export class TemplateRepository {
  /**
   * Get all available templates with optional filtering
   * @param {Object} options - Filter options
   * @param {string} options.category - Filter by template_category
   * @param {number} options.limit - Maximum results to return
   * @param {number} options.offset - Pagination offset
   * @returns {Promise<Array>} Array of template books
   */
  static async getTemplates(options = {}) {
    const { category = null, limit = 50, offset = 0 } = options;

    let whereClause = 'WHERE is_template = TRUE AND deleted_at IS NULL';
    const params = [];
    let paramCount = 1;

    if (category) {
      whereClause += ` AND template_category = $${paramCount}`;
      params.push(category);
      paramCount++;
    }

    params.push(limit, offset);

    const result = await query(
      `SELECT
        id, title, description, genre, target_audience,
        template_category, template_description, template_preview_image,
        template_tags, template_order, clone_count, word_count, chapter_count,
        created_at, updated_at
       FROM books
       ${whereClause}
       ORDER BY template_order ASC, created_at DESC
       LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
      params
    );

    return result.rows;
  }

  /**
   * Get template by ID with full details (for preview)
   * @param {string} templateId - Template UUID
   * @returns {Promise<Object|null>} Template with all data
   */
  static async getTemplateById(templateId) {
    const result = await query(
      `SELECT * FROM books
       WHERE id = $1 AND is_template = TRUE AND deleted_at IS NULL`,
      [templateId]
    );
    return result.rows[0] || null;
  }

  /**
   * Get chapters for a template (for preview)
   * @param {string} templateId - Template UUID
   * @returns {Promise<Array>} Array of chapters
   */
  static async getTemplateChapters(templateId) {
    const result = await query(
      `SELECT id, chapter_number, title, content, word_count, created_at
       FROM chapters
       WHERE book_id = $1
       ORDER BY chapter_number ASC`,
      [templateId]
    );
    return result.rows;
  }

  /**
   * Clone template to user's library
   * @param {string} templateId - Template UUID
   * @param {string} userId - User UUID
   * @param {Object} customizations - Optional customizations
   * @param {string} customizations.title - Custom title for cloned book
   * @returns {Promise<Object>} Cloned book
   */
  static async cloneTemplate(templateId, userId, customizations = {}) {
    return await transaction(async (client) => {

      // Get template with all data
      const templateResult = await client.query(
        'SELECT * FROM books WHERE id = $1 AND is_template = TRUE AND deleted_at IS NULL',
        [templateId]
      );

      if (templateResult.rows.length === 0) {
        throw new Error('Template not found');
      }

      const template = templateResult.rows[0];

      // Create new book from template
      const newTitle = customizations.title || `${template.title} (My Copy)`;
      const newBookId = uuidv4();

      const bookResult = await client.query(
        `INSERT INTO books (
          id, owner_id, title, description, genre, target_audience,
          characters, locations, plotlines, world_building, settings,
          notes, timelines, visuals, audio_files, comic_pages,
          character_refs, animation_projects, metadata, status,
          custom_focus_areas
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
        RETURNING *`,
        [
          newBookId,
          userId,
          newTitle,
          template.description,
          template.genre,
          template.target_audience,
          JSON.stringify(template.characters || []),
          JSON.stringify(template.locations || []),
          JSON.stringify(template.plotlines || []),
          JSON.stringify(template.world_building || {}),
          JSON.stringify(template.settings || {}),
          JSON.stringify(template.notes || []),
          JSON.stringify(template.timelines || []),
          JSON.stringify(template.visuals || []),
          JSON.stringify(template.audio_files || {}),
          JSON.stringify(template.comic_pages || []),
          JSON.stringify(template.character_refs || {}),
          JSON.stringify(template.animation_projects || []),
          JSON.stringify(template.metadata || {}),
          'draft',
          template.custom_focus_areas || [],  // TEXT[] - pass as array, not JSON string
        ]
      );

      const newBook = bookResult.rows[0];

      // Clone chapters
      const chaptersResult = await client.query(
        `SELECT * FROM chapters
         WHERE book_id = $1
         ORDER BY chapter_number ASC`,
        [templateId]
      );

      for (const chapter of chaptersResult.rows) {
        await client.query(
          `INSERT INTO chapters (
            id, book_id, chapter_number, title, content, scenes, notes, word_count, status
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            uuidv4(),
            newBook.id,
            chapter.chapter_number,
            chapter.title,
            chapter.content,
            chapter.scenes || '[]',
            chapter.notes,
            chapter.word_count,
            'draft'
          ]
        );
      }

      // Update clone count
      await client.query(
        'UPDATE books SET clone_count = clone_count + 1 WHERE id = $1',
        [templateId]
      );

      // Record clone event
      await client.query(
        `INSERT INTO template_clones (id, template_id, cloned_book_id, user_id)
         VALUES ($1, $2, $3, $4)`,
        [uuidv4(), templateId, newBook.id, userId]
      );

      // Update book stats (chapter count and word count)
      await client.query(
        `UPDATE books b
         SET chapter_count = (SELECT COUNT(*) FROM chapters WHERE book_id = b.id),
             word_count = (SELECT COALESCE(SUM(word_count), 0) FROM chapters WHERE book_id = b.id)
         WHERE b.id = $1`,
        [newBook.id]
      );

      // Get updated book
      const updatedResult = await client.query(
        'SELECT * FROM books WHERE id = $1',
        [newBook.id]
      );

      return updatedResult.rows[0];
    });
  }

  /**
   * Create or update template (Admin only)
   * @param {Object} templateData - Template data
   * @returns {Promise<Object>} Created template
   */
  static async createTemplate(templateData) {
    const {
      title,
      description,
      genre,
      target_audience,
      template_category,
      template_description,
      template_preview_image,
      template_tags = [],
      template_order = 0,
      characters = [],
      locations = [],
      plotlines = [],
      world_building = {},
      settings = {},
      notes = [],
      timelines = [],
      visuals = [],
      metadata = {}
    } = templateData;

    const newId = uuidv4();

    // Templates have NULL owner_id as they're system-owned
    const result = await query(
      `INSERT INTO books (
        id, owner_id, title, description, genre, target_audience,
        is_template, template_category, template_description,
        template_preview_image, template_tags, template_order,
        characters, locations, plotlines, world_building, settings,
        notes, timelines, visuals, metadata, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
      RETURNING *`,
      [
        newId,
        null, // Templates don't have owners
        title,
        description,
        genre,
        target_audience,
        true,
        template_category,
        template_description,
        template_preview_image,
        JSON.stringify(template_tags),
        template_order,
        JSON.stringify(characters),
        JSON.stringify(locations),
        JSON.stringify(plotlines),
        JSON.stringify(world_building),
        JSON.stringify(settings),
        JSON.stringify(notes),
        JSON.stringify(timelines),
        JSON.stringify(visuals),
        JSON.stringify(metadata),
        'completed' // Templates are always "completed"
      ]
    );

    return result.rows[0];
  }

  /**
   * Update template (Admin only)
   * @param {string} templateId - Template UUID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated template
   */
  static async updateTemplate(templateId, updates) {
    // Build dynamic SET clause
    const setFields = [];
    const values = [];
    let paramIndex = 1;

    const allowedFields = [
      'title', 'description', 'genre', 'target_audience',
      'template_category', 'template_description', 'template_preview_image',
      'template_tags', 'template_order',
      'characters', 'locations', 'plotlines', 'world_building', 'settings',
      'notes', 'timelines', 'visuals', 'metadata'
    ];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setFields.push(`${key} = $${paramIndex}`);
        // JSON fields need to be stringified
        if (['characters', 'locations', 'plotlines', 'world_building', 'settings',
             'notes', 'timelines', 'visuals', 'metadata', 'template_tags'].includes(key)) {
          values.push(JSON.stringify(value));
        } else {
          values.push(value);
        }
        paramIndex++;
      }
    }

    if (setFields.length === 0) {
      throw new Error('No valid fields to update');
    }

    values.push(templateId);

    const result = await query(
      `UPDATE books
       SET ${setFields.join(', ')}, updated_at = NOW()
       WHERE id = $${paramIndex} AND is_template = TRUE
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      throw new Error('Template not found');
    }

    return result.rows[0];
  }

  /**
   * Delete template (Admin only - soft delete)
   * @param {string} templateId - Template UUID
   * @returns {Promise<boolean>} Success
   */
  static async deleteTemplate(templateId) {
    const result = await query(
      `UPDATE books SET deleted_at = NOW()
       WHERE id = $1 AND is_template = TRUE
       RETURNING id`,
      [templateId]
    );
    return result.rowCount > 0;
  }

  /**
   * Get template analytics (Admin only)
   * @returns {Promise<Array>} Analytics data
   */
  static async getTemplateAnalytics() {
    const result = await query(`
      SELECT
        t.id, t.title, t.template_category, t.clone_count,
        COUNT(tc.id) as total_clones,
        COUNT(DISTINCT tc.user_id) as unique_users,
        MAX(tc.created_at) as last_cloned_at
      FROM books t
      LEFT JOIN template_clones tc ON t.id = tc.template_id
      WHERE t.is_template = TRUE AND t.deleted_at IS NULL
      GROUP BY t.id, t.title, t.template_category, t.clone_count
      ORDER BY t.clone_count DESC, t.title ASC
    `);

    return result.rows;
  }
}

export default TemplateRepository;
