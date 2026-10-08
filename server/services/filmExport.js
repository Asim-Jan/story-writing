import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { v4 as uuidv4 } from 'uuid';
import { mediaStorage } from './mediaStorage.js';
import { recordMediaOwner } from '../utils/mediaMapping.js';

// A finished film in another format, as the SAI Cloud Film Studio offers:
//   whatsapp  H.264 Main 3.1, long side at most 720 px, ~2.5 Mbit/s, AAC 128k:
//             chat apps keep it as it is (no second compression)
//   gif       480 px wide, 12 fps, its own palette: no sound
// One ffmpeg at a time per process (the join's lesson: never two encoders
// in the 2 GiB backend), at low priority.

export const EXPORT_FORMATS = {
  whatsapp: { label: 'WhatsApp', ext: '.mp4', bucket: 'videos' },
  gif: { label: 'GIF', ext: '.gif', bucket: 'images' },
};

const run = (args) => new Promise((resolve, reject) => {
  const p = spawn(ffmpegPath, ['-hide_banner', '-y', '-loglevel', 'error', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
  try { os.setPriority(p.pid, 10); } catch { /* not permitted: normal priority */ }
  let err = '';
  p.stderr.on('data', d => { err += d; if (err.length > 50000) err = err.slice(-20000); });
  p.on('error', reject);
  p.on('exit', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg could not convert the film: ${err.slice(-300)}`))));
});

let exporting = Promise.resolve();

export function exportFilm(args) {
  const job = exporting.then(() => convert(args));
  exporting = job.catch(() => {});
  return job;
}

async function convert({ user, bookId, filename, format }) {
  const spec = EXPORT_FORMATS[format];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'film-export-'));
  try {
    const src = path.join(dir, 'film.mp4');
    fs.writeFileSync(src, await mediaStorage.getFile('videos', filename));
    const out = path.join(dir, `out${spec.ext}`);
    if (format === 'whatsapp') {
      await run(['-threads', '2', '-i', src, '-vf', "scale='if(gt(iw,ih),min(720,iw),-2)':'if(gt(iw,ih),-2,min(720,ih))'",
        '-c:v', 'libx264', '-profile:v', 'main', '-level', '3.1', '-preset', 'medium', '-crf', '21', '-maxrate', '2500k', '-bufsize', '5000k',
        '-pix_fmt', 'yuv420p', '-threads', '2', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-movflags', '+faststart', out]);
    } else {
      await run(['-threads', '2', '-i', src, '-vf', 'fps=12,scale=480:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', '-loop', '0', out]);
    }
    const buffer = fs.readFileSync(out);
    const name = `film-${format}-${uuidv4()}${spec.ext}`;
    await mediaStorage.upload(spec.bucket, buffer, name, { 'x-amz-meta-type': `film-export-${format}` });
    await recordMediaOwner(spec.bucket, name, { ownerId: user.id || user.userId, bookId });
    return { format, url: `/api/media/${spec.bucket}/${name}`, filename: name, size: buffer.length };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
