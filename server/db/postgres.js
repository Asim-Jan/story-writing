import pg from 'pg';
import dotenv from 'dotenv';

const { Pool } = pg;

dotenv.config();

// Connection pool configuration
const poolConfig = {
  host: process.env.POSTGRES_HOST,
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,

  // Connection pool settings
  max: 20, // Maximum connections
  min: 2, // Minimum idle connections
  idleTimeoutMillis: 30000, // Close idle connections after 30 seconds
  connectionTimeoutMillis: 10000, // Timeout after 10 seconds

  // Statement timeout (30 seconds)
  statement_timeout: 30000,

  // SSL configuration (required for AWS RDS)
  ssl: process.env.POSTGRES_SSL === 'false' ? false : {
    rejectUnauthorized: false
  }
};

// Create connection pool
let pool = null;

export function getPool() {
  if (!pool) {
    pool = new Pool(poolConfig);

    // Handle pool errors
    pool.on('error', (err, client) => {
      console.error('Unexpected error on idle PostgreSQL client', err);
    });

    // Log pool statistics periodically
    if (process.env.NODE_ENV !== 'production') {
      setInterval(() => {
        console.log('PostgreSQL Pool Stats:', {
          total: pool.totalCount,
          idle: pool.idleCount,
          waiting: pool.waitingCount
        });
      }, 60000); // Every minute
    }
  }

  return pool;
}

/**
 * Execute a query with automatic connection handling
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<object>} Query result
 */
export async function query(text, params) {
  const start = Date.now();
  const pool = getPool();

  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;

    // Log slow queries (> 1 second)
    if (duration > 1000) {
      console.warn('Slow query detected:', {
        duration: `${duration}ms`,
        query: text.substring(0, 100),
        rows: result.rowCount
      });
    }

    return result;
  } catch (error) {
    console.error('PostgreSQL query error:', {
      error: error.message,
      query: text.substring(0, 100),
      params: params?.length
    });
    throw error;
  }
}

/**
 * Get a client from the pool for transactions
 * @returns {Promise<object>} Pool client
 */
export async function getClient() {
  const pool = getPool();
  return await pool.connect();
}

/**
 * Execute a transaction with automatic rollback on error
 * @param {Function} callback - Async function that receives the client
 * @returns {Promise<any>} Result from callback
 */
export async function transaction(callback) {
  const client = await getClient();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Transaction rolled back:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Check database connection health
 * @returns {Promise<boolean>} True if healthy
 */
export async function healthCheck() {
  try {
    const result = await query('SELECT 1 as health');
    return result.rows[0].health === 1;
  } catch (error) {
    console.error('PostgreSQL health check failed:', error.message);
    return false;
  }
}

/**
 * Close all connections (for graceful shutdown)
 */
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('PostgreSQL connection pool closed');
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing PostgreSQL pool...');
  await closePool();
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing PostgreSQL pool...');
  await closePool();
});

export default {
  getPool,
  query,
  getClient,
  transaction,
  healthCheck,
  closePool
};
