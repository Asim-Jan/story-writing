#!/usr/bin/env node
// A FAKE SAI Drive app API for local development (in memory: every restart starts empty).
// Story Writing stores ALL media in SAI Drive (MinIO is retired); with no Drive configured every media
// route answers 503. This serves the /app/v1 subset the app's vendored _drive-client speaks — the same
// fake the test suites use (server/tests/fake-drive-http.mjs).
//
//   npm run dev:drive                     # listens on 127.0.0.1:8150
//   node scripts/fake-drive.mjs --host 0.0.0.0 --port 8150 --quiet
// then run the backend (and worker) with the three variables it prints (also in .env.example).
import { fakeDrive, FAKE_DRIVE_SECRET } from '../server/tests/fake-drive-http.mjs';

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const host = arg('--host', '127.0.0.1');
const port = Number(arg('--port', '8150'));
const drive = await fakeDrive({ host, port, log: !process.argv.includes('--quiet') });
console.log(`fake SAI Drive listening on ${host}:${port} (in memory). Point Story Writing at it with:
  DRIVE_APP_API_URL=${drive.url}
  DRIVE_APP_API_SECRET=${FAKE_DRIVE_SECRET}
  DRIVE_CARETAKER_SUB=u_0000000000000001`);
const stop = () => drive.close().then(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
