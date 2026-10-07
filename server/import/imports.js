import crypto from 'crypto';
import path from 'path';
import { query } from '../db/postgres.js';
import { parseEpub } from './epub.js';
import { parseDocx, parseMarkdown, parsePdf, parsePlainText } from './formats.js';
import { classifySections, detectChapters } from './classify.js';
import { cleanText, preview, wordCount } from './text.js';

// Book imports, kept in Postgres (book_imports) so a review survives closing
// the window, a reload or a deploy. Upload → parse in the background → the
// user reviews and edits the chapters with small ops → create the book once.
// An import that never made a book is removed after 14 days.

export const FORMATS = { '.epub': 'epub', '.docx': 'docx', '.pdf': 'pdf', '.txt': 'txt', '.md': 'md', '.markdown': 'md' };

const row2import = (row, { withChapters = true } = {}) => ({
  id: row.id,
  status: row.status,
  format: row.format,
  fileName: row.file_name,
  fileSize: row.file_size,
  title: row.title,
  author: row.author,
  language: row.language,
  progress: row.progress || {},
  warnings: row.warnings || [],
  duplicateOf: row.duplicate_of || null,
  bookId: row.book_id,
  error: row.error,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...(withChapters ? {
    chapters: (row.chapters || []).map((c, index) => ({
      index, title: c.title, kind: c.kind, wordCount: wordCount(c.content), preview: preview(c.content), source: c.source,
    })),
  } : { chapterCount: (row.chapters || []).filter(c => c.kind === 'chapter').length }),
});

export async function getImportRow(ownerId, id) {
  const { rows } = await query('SELECT * FROM book_imports WHERE id = $1 AND owner_id = $2', [id, ownerId]);
  return rows[0] || null;
}

async function update(id, fields) {
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  const values = keys.map(k => (['chapters', 'progress', 'warnings', 'duplicate_of'].includes(k) ? JSON.stringify(fields[k]) : fields[k]));
  const { rows } = await query(`UPDATE book_imports SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`, [id, ...values]);
  return rows[0];
}

export async function listImports(ownerId) {
  const { rows } = await query(
    `SELECT * FROM book_imports WHERE owner_id = $1 AND created_at > NOW() - INTERVAL '14 days' ORDER BY created_at DESC LIMIT 50`,
    [ownerId]
  );
  return rows.map(r => row2import(r, { withChapters: false }));
}

/** Store the upload and start parsing in the background. */
export async function startImport({ ownerId, fileName, buffer }) {
  const ext = path.extname(fileName || '').toLowerCase();
  const format = FORMATS[ext];
  if (!format) throw Object.assign(new Error('Import an ePub, Word (.docx), PDF, Markdown or text file'), { status: 400 });
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const prior = await query(
    `SELECT i.book_id, b.title FROM book_imports i JOIN books b ON b.id = i.book_id
     WHERE i.owner_id = $1 AND i.file_hash = $2 AND b.deleted_at IS NULL ORDER BY i.created_at DESC LIMIT 1`,
    [ownerId, hash]
  );
  const duplicateOf = prior.rows[0] ? { bookId: prior.rows[0].book_id, title: prior.rows[0].title } : null;
  const { rows } = await query(
    `INSERT INTO book_imports (owner_id, status, format, file_name, file_size, file_hash, duplicate_of, progress)
     VALUES ($1, 'parsing', $2, $3, $4, $5, $6, $7) RETURNING *`,
    [ownerId, format, String(fileName).slice(0, 255), buffer.length, hash, JSON.stringify(duplicateOf), JSON.stringify({ message: 'Reading the file...' })]
  );
  const record = rows[0];
  parseInBackground(record.id, format, buffer, fileName).catch(err => console.error(`import ${record.id} crashed:`, err.message));
  return row2import(record);
}

// The app shows "Chapter N: <title>", so a title that carries its own number
// ("2. The Map", "Chapter 3: The Storm", "One: The Storm", "IV - The Bell") would read twice.
// Only a number prefix with real text after it goes; "Chapter 3" stays.
const NUMBER_WORD = '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?';
const NUMBER_PREFIX = new RegExp(`^\\s*(?:chapter\\s+(?:\\d{1,3}|[ivxlc]{1,7}|${NUMBER_WORD})|\\d{1,3}|[IVXLC]{1,7}|${NUMBER_WORD})\\s*[.:)\\-–—]\\s*(\\S.*)$`, 'i');
export function stripChapterNumber(title) {
  const m = NUMBER_PREFIX.exec(String(title || ''));
  return m ? m[1].trim() : title;
}

async function parseInBackground(id, format, buffer, fileName = '') {
  const fileTitle = path.basename(fileName, path.extname(fileName)).replace(/[_-]+/g, ' ').trim() || null;
  try {
    let parsed;
    if (format === 'epub') parsed = await parseEpub(buffer);
    else if (format === 'docx') parsed = await parseDocx(buffer);
    else if (format === 'pdf') parsed = await parsePdf(buffer);
    else if (format === 'md') parsed = parseMarkdown(buffer);
    else parsed = parsePlainText(buffer);
    const warnings = [...(parsed.warnings || [])];
    let sections = parsed.sections.filter(s => cleanText(s.content) || s.title);

    // no structure found: one long block → ask the model where chapters start
    const words = sections.reduce((n, s) => n + wordCount(s.content), 0);
    if (sections.length <= 1 && words > 3000) {
      await update(id, { progress: { message: 'Finding the chapters...' } });
      try {
        sections = await detectChapters(sections.map(s => s.content).join('\n\n'));
        warnings.push('No chapter headings found: the chapters were found by AI. Check the splits.');
      } catch (err) {
        warnings.push(`The text has no chapter headings and could not be split automatically (${err.message}). Split it by hand below.`);
      }
    }

    await update(id, { progress: { message: 'Sorting front matter, story and back matter...' } });
    sections = await classifySections(sections.map(s => ({ ...s, content: cleanText(s.content) })));
    let n = 0;
    const othersTitled = sections.slice(1).some(x => x.title);
    const chapters = sections.map((s, i) => {
      if (s.kind === 'chapter') n++;
      // untitled text before the first heading reads as an opening, not "Chapter 1"
      const fallback = i === 0 && othersTitled ? 'Opening'
        : s.kind === 'chapter' ? `Chapter ${n}` : s.kind === 'front' ? 'Front matter' : 'Back matter';
      const title = s.kind === 'chapter' ? stripChapterNumber(s.title) : s.title;
      return { title: title || fallback, kind: s.kind, content: s.content, source: s.source || 'whole' };
    });
    const short = chapters.filter(c => c.kind === 'chapter' && wordCount(c.content) < 100).length;
    if (short) warnings.push(`${short} very short chapter${short === 1 ? '' : 's'} (under 100 words): check ${short === 1 ? 'it' : 'them'}`);
    if (!chapters.some(c => c.kind === 'chapter')) warnings.push('Nothing was recognised as story: mark the right sections as chapters');

    await update(id, {
      status: 'review',
      chapters,
      warnings,
      // formats with no title metadata start from the file name (editable in review)
      title: parsed.meta?.title || fileTitle,
      author: parsed.meta?.author || null,
      language: parsed.meta?.language || null,
      progress: { message: 'Ready to review' },
    });
  } catch (err) {
    console.error(`import ${id} failed:`, err.message);
    await update(id, { status: 'failed', error: err.status ? err.message : `Could not read this file: ${err.message}`, progress: {} }).catch(() => {});
  }
}

export async function getImport(ownerId, id) {
  let row = await getImportRow(ownerId, id);
  // parsing runs in the API process; a restart (a deploy) mid-parse would
  // leave it 'parsing' forever
  if (row && row.status === 'parsing' && Date.now() - Date.parse(row.updated_at) > 10 * 60 * 1000) {
    row = await update(id, { status: 'failed', error: 'Reading the file was interrupted (the server restarted). Upload it again.' });
  }
  return row ? row2import(row) : null;
}

export async function getImportChapter(ownerId, id, index) {
  const row = await getImportRow(ownerId, id);
  const c = row?.chapters?.[index];
  return c ? { index, title: c.title, kind: c.kind, content: c.content } : null;
}

/** Apply review edits (rename, kind, merge, split, delete, move) in order. */
export async function applyOps(ownerId, id, ops) {
  const row = await getImportRow(ownerId, id);
  if (!row) return null;
  if (row.status !== 'review') throw Object.assign(new Error(`This import is ${row.status}, not in review`), { status: 409 });
  const chapters = (row.chapters || []).map(c => ({ ...c }));
  const bad = (i, msg) => Object.assign(new Error(`op ${i + 1}: ${msg}`), { status: 400 });
  const has = (k) => Number.isInteger(k) && k >= 0 && k < chapters.length;
  if (!Array.isArray(ops) || ops.length === 0 || ops.length > 200) throw Object.assign(new Error('Send 1-200 ops'), { status: 400 });
  ops.forEach((op, i) => {
    switch (op?.op) {
      case 'rename':
        if (!has(op.index)) throw bad(i, 'no such section');
        chapters[op.index].title = String(op.title || '').trim().slice(0, 200) || chapters[op.index].title;
        break;
      case 'kind':
        if (!has(op.index) || !['chapter', 'front', 'back'].includes(op.kind)) throw bad(i, 'kind must be chapter, front or back');
        chapters[op.index].kind = op.kind;
        break;
      case 'merge':
        if (!has(op.index) || !has(op.index + 1)) throw bad(i, 'nothing to merge with');
        chapters[op.index].content = `${chapters[op.index].content}\n\n${chapters[op.index + 1].content}`.trim();
        chapters.splice(op.index + 1, 1);
        break;
      case 'split': {
        if (!has(op.index)) throw bad(i, 'no such section');
        const c = chapters[op.index];
        const at = Number(op.at);
        if (!Number.isInteger(at) || at <= 0 || at >= c.content.length) throw bad(i, 'split point must be inside the text');
        chapters.splice(op.index + 1, 0, { title: String(op.title || '').trim().slice(0, 200) || 'New chapter', kind: c.kind, content: c.content.slice(at).trim(), source: 'manual' });
        c.content = c.content.slice(0, at).trim();
        break;
      }
      case 'delete':
        if (!has(op.index)) throw bad(i, 'no such section');
        chapters.splice(op.index, 1);
        break;
      case 'move': {
        if (!has(op.from) || !Number.isInteger(op.to) || op.to < 0 || op.to >= chapters.length) throw bad(i, 'from/to out of range');
        const [c] = chapters.splice(op.from, 1);
        chapters.splice(op.to, 0, c);
        break;
      }
      default:
        throw bad(i, `unknown op "${op?.op}"`);
    }
  });
  return row2import(await update(id, { chapters }));
}

export async function patchImport(ownerId, id, { title, author }) {
  const row = await getImportRow(ownerId, id);
  if (!row) return null;
  const fields = {};
  if (typeof title === 'string') fields.title = title.trim().slice(0, 255) || null;
  if (typeof author === 'string') fields.author = author.trim().slice(0, 255) || null;
  return row2import(Object.keys(fields).length ? await update(id, fields) : row);
}

/**
 * Create the book once. A second call (double click, retry) returns the same
 * book; the status flips to 'creating' atomically so two calls can't race.
 * createBook is the app's own (quota checks are the caller's).
 */
export async function createFromImport(ownerId, id, { includeFront = false, includeBack = false }, createBook) {
  const row = await getImportRow(ownerId, id);
  if (!row) return null;
  if (row.book_id) return { bookId: row.book_id, created: false };
  const claim = await query(`UPDATE book_imports SET status = 'creating', updated_at = NOW() WHERE id = $1 AND status = 'review' RETURNING id`, [id]);
  if (claim.rowCount === 0) {
    // another request is creating it right now (a double click): wait for its book
    for (let i = 0; i < 60; i++) {
      const again = await getImportRow(ownerId, id);
      if (again?.book_id) return { bookId: again.book_id, created: false };
      if (again?.status !== 'creating') throw Object.assign(new Error(`This import is ${again?.status}`), { status: 409 });
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw Object.assign(new Error('The book is still being created; try again in a moment'), { status: 409 });
  }
  try {
    const keep = (row.chapters || []).filter(c => c.kind === 'chapter' || (includeFront && c.kind === 'front') || (includeBack && c.kind === 'back'));
    if (keep.length === 0) throw Object.assign(new Error('Mark at least one section as a chapter'), { status: 400 });
    const book = await createBook({
      owner_id: ownerId,
      title: row.title || path.basename(row.file_name, path.extname(row.file_name)),
      description: '',
      chapters: keep.map((c, i) => ({ number: i + 1, title: c.title, content: c.content, status: 'draft' })),
      metadata: {
        importedFrom: { fileName: row.file_name, format: row.format, author: row.author, language: row.language, importId: row.id, importedAt: new Date().toISOString() },
        importAnalysis: { status: 'pending' },
      },
    });
    await update(id, { status: 'created', book_id: book.id, progress: { message: 'Book created' } });
    return { bookId: book.id, created: true };
  } catch (err) {
    await update(id, { status: 'review' }).catch(() => {});
    throw err;
  }
}

export async function deleteImport(ownerId, id) {
  const { rowCount } = await query('DELETE FROM book_imports WHERE id = $1 AND owner_id = $2 AND book_id IS NULL', [id, ownerId]);
  return rowCount > 0;
}

/** Imports that never became a book are kept 14 days. */
export async function pruneImports() {
  const { rowCount } = await query(`DELETE FROM book_imports WHERE book_id IS NULL AND created_at < NOW() - INTERVAL '14 days'`);
  if (rowCount) console.log(`[imports] removed ${rowCount} abandoned import(s)`);
}
