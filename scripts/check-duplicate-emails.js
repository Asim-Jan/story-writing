#!/usr/bin/env node
// Counts only (no email is ever printed): users, case-duplicate email groups, users linked to SAI Cloud.
// Run before turning on Sign in with SAI Cloud; the duplicate groups must be 0. Needs POSTGRES_* in the environment.
// The logic lives in server/portalAuth/duplicateEmails.js because the backend image carries server/ only:
//   kubectl -n story-writing exec deploy/backend -- node server/portalAuth/duplicateEmails.js
import { main } from '../server/portalAuth/duplicateEmails.js';

main();
