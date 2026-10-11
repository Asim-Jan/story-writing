import crypto from 'crypto';
import pg from 'pg';
// seed the fake drive directly via HTTP PUT
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==','base64');
async function put(path, ref) {
  const r = await fetch(`http://127.0.0.1:56999/app/v1/projects/story-writing/files?path=${encodeURIComponent(path)}&ref=${encodeURIComponent(ref)}&tag=source`, {
    method: 'PUT', headers: { 'content-type': 'image/png', 'x-app-id': 'stories', 'x-app-secret': 'drive-test-secret-0123456789abcdef0123456789abcdef', 'x-sub': 'u_f37d34dea1d20271' }, body: PNG });
  return r.json();
}
await put('u_f37d34dea1d20271/Covers/rehome-a.png', 'story:images:rehome-a.png');
await put('u_f37d34dea1d20271/Covers/rehome-b.png', 'story:images:rehome-b.png');
await put('u_f37d34dea1d20271/Films/rehome-c.mp4', 'story:videos:rehome-c.mp4');
const db = new pg.Client({host:'127.0.0.1',port:55432,user:'postgres',password:'x',database:'rg_drive'});
await db.connect();
for (const [bt, fn] of [['images','rehome-a.png'],['images','rehome-b.png'],['videos','rehome-c.mp4']]) {
  await db.query(`INSERT INTO media_owners (bucket_type, filename, owner_id, drive_ref, drive_node, drive_size, drive_owner) VALUES ($1,$2,'11111111-1111-1111-1111-111111111111',$3,'n_x',$4,'u_f37d34dea1d20271') ON CONFLICT (bucket_type, filename) DO UPDATE SET drive_ref=EXCLUDED.drive_ref, drive_node=EXCLUDED.drive_node, drive_owner=EXCLUDED.drive_owner`, [bt, fn, `story:${bt}:${fn}`, PNG.length]);
}
await db.end();
console.log('seeded');
process.exit(0);
