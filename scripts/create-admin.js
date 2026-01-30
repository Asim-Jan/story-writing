#!/usr/bin/env node

/**
 * Create admin user for the Story Writing Studio
 *
 * Usage:
 *   node scripts/create-admin.js <email> <password> <name>
 *
 * Example:
 *   node scripts/create-admin.js admin@example.com SecurePass123 "Admin User"
 */

import pg from 'pg';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

const { Pool } = pg;

dotenv.config();

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  ssl: process.env.POSTGRES_SSL === 'true' ? {
    rejectUnauthorized: false
  } : false
});

async function createAdmin() {
  const client = await pool.connect();

  try {
    const email = process.argv[2];
    const password = process.argv[3];
    const name = process.argv[4];

    // Validate arguments
    if (!email || !password || !name) {
      console.error('\n❌ Error: Missing required arguments\n');
      console.log('Usage:');
      console.log('  node scripts/create-admin.js <email> <password> <name>\n');
      console.log('Example:');
      console.log('  node scripts/create-admin.js admin@example.com SecurePass123 "Admin User"\n');
      process.exit(1);
    }

    console.log(`\n🔧 Creating admin user: ${email}\n`);

    // Check if user exists
    const existingUser = await client.query(
      'SELECT id, role FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      const user = existingUser.rows[0];

      if (user.role === 'admin') {
        console.log(`ℹ️  User ${email} already exists and is an admin\n`);
        return;
      }

      // Update existing user to admin
      await client.query(
        `UPDATE users SET role = 'admin', tier = 'premium' WHERE email = $1`,
        [email]
      );

      // Update quotas to premium
      await client.query(
        `UPDATE quotas SET
          max_books = 999999,
          max_words = 999999999,
          max_chapters = 999999,
          max_ai_requests_per_day = 200,
          max_concurrent_jobs = 10
         WHERE user_id = $1`,
        [user.id]
      );

      console.log(`✅ Updated existing user ${email} to admin role with premium tier\n`);
      return;
    }

    // Create new admin user
    const hashedPassword = await bcrypt.hash(password, 10);

    await client.query('BEGIN');

    // Create user
    const userResult = await client.query(
      `INSERT INTO users (email, name, password_hash, tier, role, status)
       VALUES ($1, $2, $3, 'premium', 'admin', 'active')
       RETURNING id`,
      [email, name, hashedPassword]
    );

    const userId = userResult.rows[0].id;

    // Create premium quotas
    await client.query(
      `INSERT INTO quotas (
        user_id,
        max_books,
        max_words,
        max_chapters,
        max_ai_requests_per_day,
        max_concurrent_jobs,
        current_books,
        current_words,
        current_chapters,
        ai_requests_today
      )
      VALUES ($1, 999999, 999999999, 999999, 200, 10, 0, 0, 0, 0)`,
      [userId]
    );

    // Create user settings
    await client.query(
      `INSERT INTO user_settings (user_id, ai_config, preferences)
       VALUES ($1, '{}'::jsonb, '{}'::jsonb)`,
      [userId]
    );

    await client.query('COMMIT');

    console.log(`✅ Successfully created admin user!\n`);
    console.log(`📧 Email: ${email}`);
    console.log(`👤 Name: ${name}`);
    console.log(`🔑 Password: ${password}`);
    console.log(`👑 Role: admin`);
    console.log(`💎 Tier: premium`);
    console.log(`\n⚠️  Important: Please save these credentials securely and change the password after first login!\n`);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('\n❌ Error creating admin:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the script
createAdmin().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
