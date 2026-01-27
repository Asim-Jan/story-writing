import dotenv from 'dotenv';

dotenv.config();

/**
 * Feature flags for Phase 2 PostgreSQL migration
 *
 * Migration Strategy:
 * 1. USE_POSTGRES=false, DUAL_WRITE=false, READ_FROM_POSTGRES=false → Redis only (current state)
 * 2. USE_POSTGRES=true, DUAL_WRITE=true, READ_FROM_POSTGRES=false → Write to both, read from Redis
 * 3. USE_POSTGRES=true, DUAL_WRITE=true, READ_FROM_POSTGRES=true → Write to both, read from PostgreSQL
 * 4. USE_POSTGRES=true, DUAL_WRITE=false, READ_FROM_POSTGRES=true → PostgreSQL only (final state)
 */

export const features = {
  /**
   * Enable PostgreSQL database
   * When false: Redis only (current state)
   * When true: PostgreSQL is available
   */
  USE_POSTGRES: process.env.USE_POSTGRES === 'true',

  /**
   * Enable dual-write to both Redis and PostgreSQL
   * Only used during migration phase
   * When true: All writes go to BOTH databases
   */
  DUAL_WRITE: process.env.DUAL_WRITE === 'true',

  /**
   * Read from PostgreSQL instead of Redis
   * When false: Read from Redis
   * When true: Read from PostgreSQL
   */
  READ_FROM_POSTGRES: process.env.READ_FROM_POSTGRES === 'true',

  /**
   * Get current migration phase
   * @returns {string} Phase name
   */
  getMigrationPhase() {
    if (!this.USE_POSTGRES) {
      return 'REDIS_ONLY';
    }

    if (this.DUAL_WRITE && !this.READ_FROM_POSTGRES) {
      return 'DUAL_WRITE_READ_REDIS';
    }

    if (this.DUAL_WRITE && this.READ_FROM_POSTGRES) {
      return 'DUAL_WRITE_READ_POSTGRES';
    }

    if (!this.DUAL_WRITE && this.READ_FROM_POSTGRES) {
      return 'POSTGRES_ONLY';
    }

    return 'UNKNOWN';
  },

  /**
   * Check if we should write to Redis
   * @returns {boolean}
   */
  shouldWriteToRedis() {
    return !this.USE_POSTGRES || this.DUAL_WRITE;
  },

  /**
   * Check if we should write to PostgreSQL
   * @returns {boolean}
   */
  shouldWriteToPostgres() {
    return this.USE_POSTGRES;
  },

  /**
   * Check if we should read from Redis
   * @returns {boolean}
   */
  shouldReadFromRedis() {
    return !this.USE_POSTGRES || !this.READ_FROM_POSTGRES;
  },

  /**
   * Check if we should read from PostgreSQL
   * @returns {boolean}
   */
  shouldReadFromPostgres() {
    return this.USE_POSTGRES && this.READ_FROM_POSTGRES;
  },

  /**
   * Log current feature flag state
   */
  logState() {
    console.log('='.repeat(60));
    console.log('Feature Flags - PostgreSQL Migration');
    console.log('='.repeat(60));
    console.log(`Migration Phase: ${this.getMigrationPhase()}`);
    console.log(`USE_POSTGRES: ${this.USE_POSTGRES}`);
    console.log(`DUAL_WRITE: ${this.DUAL_WRITE}`);
    console.log(`READ_FROM_POSTGRES: ${this.READ_FROM_POSTGRES}`);
    console.log('');
    console.log(`Write to Redis: ${this.shouldWriteToRedis()}`);
    console.log(`Write to PostgreSQL: ${this.shouldWriteToPostgres()}`);
    console.log(`Read from Redis: ${this.shouldReadFromRedis()}`);
    console.log(`Read from PostgreSQL: ${this.shouldReadFromPostgres()}`);
    console.log('='.repeat(60));
  }
};

/**
 * Validation: Ensure feature flags are in a valid combination
 */
function validateFeatureFlags() {
  const phase = features.getMigrationPhase();

  if (phase === 'UNKNOWN') {
    console.error('⚠️  WARNING: Invalid feature flag combination detected!');
    console.error('   USE_POSTGRES:', features.USE_POSTGRES);
    console.error('   DUAL_WRITE:', features.DUAL_WRITE);
    console.error('   READ_FROM_POSTGRES:', features.READ_FROM_POSTGRES);
    console.error('');
    console.error('   Valid combinations:');
    console.error('   1. USE_POSTGRES=false, DUAL_WRITE=false, READ_FROM_POSTGRES=false (Redis only)');
    console.error('   2. USE_POSTGRES=true, DUAL_WRITE=true, READ_FROM_POSTGRES=false (Dual-write, read Redis)');
    console.error('   3. USE_POSTGRES=true, DUAL_WRITE=true, READ_FROM_POSTGRES=true (Dual-write, read PostgreSQL)');
    console.error('   4. USE_POSTGRES=true, DUAL_WRITE=false, READ_FROM_POSTGRES=true (PostgreSQL only)');
  }

  // Can't read from PostgreSQL if USE_POSTGRES is false
  if (!features.USE_POSTGRES && features.READ_FROM_POSTGRES) {
    throw new Error('Invalid configuration: READ_FROM_POSTGRES=true requires USE_POSTGRES=true');
  }

  // Can't dual-write if USE_POSTGRES is false
  if (!features.USE_POSTGRES && features.DUAL_WRITE) {
    throw new Error('Invalid configuration: DUAL_WRITE=true requires USE_POSTGRES=true');
  }
}

// Validate on module load
validateFeatureFlags();

export default features;
