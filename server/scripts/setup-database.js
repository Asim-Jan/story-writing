import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();
import crypto from 'crypto';

const { Client } = pg;

async function setupDatabase() {
  // Connect to default postgres database as master user
  const masterClient = new Client({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    user: 'postgres',
    password: process.env.POSTGRES_PASSWORD,
    database: 'postgres',
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false
  });

  try {
    await masterClient.connect();
    console.log('✓ Connected to RDS PostgreSQL');

    // Check if database exists
    const dbCheck = await masterClient.query(
      "SELECT 1 FROM pg_database WHERE datname = 'story_writing'"
    );

    if (dbCheck.rows.length === 0) {
      // Create application database
      await masterClient.query('CREATE DATABASE story_writing');
      console.log('✓ Created database: story_writing');
    } else {
      console.log('✓ Database story_writing already exists');
    }

    // Create application user
    const userCheck = await masterClient.query(
      "SELECT 1 FROM pg_user WHERE usename = 'story_user'"
    );

    if (userCheck.rows.length === 0) {
      // Generate a secure password for the application user
      const appUserPassword = crypto.randomBytes(24).toString('base64');

      await masterClient.query(
        `CREATE USER story_user WITH PASSWORD '${appUserPassword}'`
      );
      console.log('✓ Created user: story_user');
      console.log(`\n⚠️  Application User Password: ${appUserPassword}`);
      console.log('⚠️  Save this password and update .env file POSTGRES_PASSWORD');
      console.log('⚠️  Add this to RDS_CREDENTIALS.txt\n');
    } else {
      console.log('✓ User story_user already exists');
    }

    await masterClient.end();

    // Connect to story_writing database to grant privileges
    const appDbClient = new Client({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      user: 'postgres',
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DB || 'story_writing',
      ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false
    });

    await appDbClient.connect();

    // Grant privileges to application user
    await appDbClient.query('GRANT ALL PRIVILEGES ON DATABASE story_writing TO story_user');
    await appDbClient.query('GRANT ALL PRIVILEGES ON SCHEMA public TO story_user');
    await appDbClient.query('GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO story_user');
    await appDbClient.query('GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO story_user');

    // Enable UUID extension
    await appDbClient.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    console.log('✓ Enabled uuid-ossp extension');

    await appDbClient.end();

    console.log('\n✅ Database setup complete!');
    console.log('\nNext steps:');
    console.log('1. Update .env file with POSTGRES_PASSWORD');
    console.log('2. Run schema migration: node server/scripts/run-schema.js');

  } catch (error) {
    console.error('❌ Error setting up database:', error.message);
    throw error;
  }
}

setupDatabase().catch(console.error);
