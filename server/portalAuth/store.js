// The Postgres persistence behind account resolution (see accounts.js for the interface). PostgreSQL only:
// the Redis-only user store of the old migration phases cannot hold a unique sub, and production runs PG only.
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { UserRepository } from '../db/repositories/UserRepository.js';

export const pgStore = {
  findByPortalSub: (sub) => UserRepository.findByPortalSub(sub),
  findByEmail: (email) => UserRepository.findByEmail(email),
  findById: (id) => UserRepository.findById(id),
  linkPortal: (userId, sub, opts) => UserRepository.linkPortal(userId, sub, opts),
  async createPortalUser({ email, name, sub }) {
    // nobody knows this password: a bcrypt hash of 48 random bytes. The account signs in through SAI Cloud.
    const passwordHash = await bcrypt.hash(crypto.randomBytes(48).toString('base64'), 10);
    return UserRepository.createPortalUser({ email, name, sub, passwordHash });
  },
};
