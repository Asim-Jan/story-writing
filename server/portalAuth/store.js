// The Postgres persistence behind account resolution (see accounts.js for the interface). PostgreSQL only:
// the Redis-only user store of the old migration phases cannot hold a unique sub, and production runs PG only.
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { UserRepository } from '../db/repositories/UserRepository.js';

// nobody knows this password: a bcrypt hash of 48 random bytes
const unusablePasswordHash = () => bcrypt.hash(crypto.randomBytes(48).toString('base64'), 10);

export const pgStore = {
  findByPortalSub: (sub) => UserRepository.findByPortalSub(sub),
  /** every account with this email (case-insensitive), at most 2: more than one means case-duplicates */
  findUsersByEmail: (email) => UserRepository.findUsersByEmail(email, 2),
  /**
   * accounts under another SPELLING of the email (plus-tag, Gmail dots): detection only, and only accounts that prove
   * their address (email_verified or portal-linked): anyone can register an unverified lookalike without a mailbox.
   */
  findUsersByEmailKey: (key) => UserRepository.findUsersByEmailKey(key, 2, { trustedOnly: true }),
  findById: (id) => UserRepository.findById(id),
  /** opts.invalidatePassword: replace the local password by one nobody knows (automatic links) */
  async linkPortal(userId, sub, { markEmailVerified = false, invalidatePassword = false } = {}) {
    return UserRepository.linkPortal(userId, sub, { markEmailVerified, passwordHash: invalidatePassword ? await unusablePasswordHash() : null });
  },
  async createPortalUser({ email, name, sub }) {
    return UserRepository.createPortalUser({ email, name, sub, passwordHash: await unusablePasswordHash() });
  },
};
