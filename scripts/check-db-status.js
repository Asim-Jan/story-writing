import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: parseInt(process.env.POSTGRES_PORT),
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  ssl: { rejectUnauthorized: false }
});

async function check() {
  try {
    console.log('\n📊 Current Database Status:\n');

    // Check users
    const usersResult = await pool.query('SELECT COUNT(*) FROM users');
    console.log('Users:', usersResult.rows[0].count);

    // Check books
    const booksResult = await pool.query(`
      SELECT id, title, updated_at
      FROM books
      WHERE deleted_at IS NULL
      ORDER BY updated_at DESC
      LIMIT 3
    `);
    console.log('Books:', booksResult.rows.length);

    for (const book of booksResult.rows) {
      console.log(`\n  📚 ${book.title}`);
      console.log(`     ID: ${book.id}`);
      console.log(`     Last updated: ${book.updated_at}`);

      // Check chapters
      const chaptersResult = await pool.query(
        'SELECT COUNT(*) FROM chapters WHERE book_id = $1',
        [book.id]
      );
      console.log(`     Chapters: ${chaptersResult.rows[0].count}`);
    }

    // Total chapters
    const totalChapters = await pool.query('SELECT COUNT(*) FROM chapters');
    console.log(`\n📖 Total chapters across all books: ${totalChapters.rows[0].count}`);

    console.log('\n✅ PostgreSQL connection successful!\n');

    await pool.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    await pool.end();
    process.exit(1);
  }
}

check();
