import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { mediaStorage } from './mediaStorage.js';
import { setMediaBookMapping } from '../utils/mediaMapping.js';

// Joins a film's scene clips into one video. Until 2.23.55 this was a plain
// concat: every scene change was a hard cut (the "fade" option was a stub),
// each clip kept its own generated sound at its own level (24 dB apart in a
// real film) and many clips opened on a still frame for up to a second. Now:
//   - each boundary gets the scene's transition: continue (the clip starts
//     from the previous clip's last frame; a 3-frame blend), cut (a soft
//     0.25 s dissolve), dissolve (0.8 s) or fade (through black, 1.2 s);
//   - sound is brought to one level per clip and crossfaded at every cut;
//   - a still opening (before the video model starts moving) is trimmed,
//     except where the scene continues the previous shot;
//   - the film fades in from and out to black.

export const TRANSITIONS = {
  continue: { xfade: 'fade', seconds: 0.12 },
  cut: { xfade: 'fade', seconds: 0.25 },
  dissolve: { xfade: 'fade', seconds: 0.8 },
  fade: { xfade: 'fadeblack', seconds: 1.2 },
};
export const TRANSITION_IDS = Object.keys(TRANSITIONS);

const FPS = 24;
const TARGET_DB = -20; // mean level every clip is brought to
const FADE_IN = 0.5;
const FADE_OUT = 0.8;
const MAX_HEAD_TRIM = 1.0;

const sameText = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/**
 * How a scene begins after the previous one. The scene's own transition when
 * it has a valid one; otherwise inferred: the same place is a cut, a new
 * place a dissolve. The first scene has none (the film fades in).
 */
export function transitionOf(scene, previous) {
  if (!previous) return null;
  const own = String(scene?.transition || '').trim().toLowerCase();
  if (TRANSITIONS[own]) return own;
  return scene?.location && sameText(scene.location, previous.location) ? 'cut' : 'dissolve';
}

/**
 * The join plan for the usable clips, in order. A scene after a failed one
 * cannot "continue" (its previous shot is missing): it dissolves instead.
 * clips: [{ scene, length, head }]; returns the boundary list
 * [{ transition, xfade, seconds }] (one fewer than the clips).
 */
export function planJoin(clips) {
  const out = [];
  for (let i = 1; i < clips.length; i++) {
    const { scene } = clips[i];
    const previous = clips[i - 1].scene;
    let transition = transitionOf(scene, previous);
    if (transition === 'continue' && clips[i].gapBefore) transition = 'dissolve';
    const spec = TRANSITIONS[transition];
    // never more than 40% of either clip, so a blend cannot swallow a short shot
    const room = Math.min(clips[i - 1].length - clips[i - 1].head, clips[i].length - clips[i].head) * 0.4;
    out.push({ transition, xfade: spec.xfade, seconds: Math.max(0.04, Math.min(spec.seconds, room)) });
  }
  return out;
}

const run = (args) => new Promise((resolve, reject) => {
  const p = spawn(ffmpegPath, ['-hide_banner', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', d => { err += d; if (err.length > 200000) err = err.slice(-100000); });
  p.on('error', reject);
  p.on('exit', code => resolve({ code, err }));
});

// Frames / fps from a full read: the container duration includes the audio,
// which can run past the last picture, and an xfade offset past the end fails.
async function probe(file) {
  const { err } = await run(['-i', file, '-map', '0:v:0', '-c', 'copy', '-f', 'null', '-']);
  const fps = Number((err.match(/(\d+(?:\.\d+)?) fps/) || [])[1]) || FPS;
  const frames = [...err.matchAll(/frame=\s*(\d+)/g)].map(m => Number(m[1])).pop() || 0;
  const size = (err.match(/Video:[^\n]*?(\d{2,5})x(\d{2,5})/) || []);
  const length = frames ? frames / fps : Number((err.match(/Duration: (\d+):(\d+):([\d.]+)/) || []).slice(1).reduce((s, v, i) => s + Number(v) * [3600, 60, 1][i], 0)) || 0;
  return { length, width: Number(size[1]) || 1280, height: Number(size[2]) || 720, hasAudio: /Stream #[^\n]*Audio:/.test(err) };
}

async function meanVolume(file) {
  const { err } = await run(['-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-']);
  const mean = Number((err.match(/mean_volume: (-?[\d.]+) dB/) || [])[1]);
  return Number.isFinite(mean) ? mean : null;
}

// Seconds the clip holds still at its start (image-to-video models often do).
async function stillHead(file) {
  const { err } = await run(['-t', '1.6', '-i', file, '-map', '0:v:0', '-vf', 'freezedetect=n=0.003:d=0.15', '-f', 'null', '-']);
  const start = Number((err.match(/freeze_start: ([\d.]+)/) || [])[1]);
  if (!Number.isFinite(start) || start > 0.05) return 0;
  const duration = Number((err.match(/freeze_duration: ([\d.]+)/) || [])[1]);
  return Number.isFinite(duration) ? duration : 1.6; // still to the end of the probe
}

const r3 = (n) => Math.max(0, Math.round(n * 1000) / 1000);

/** The ffmpeg filter graph for the clips and plan (exported for tests). */
export function joinGraph(clips, plan, { width, height }) {
  const parts = [];
  clips.forEach((c, i) => {
    const end = r3(c.length);
    const len = r3(c.length - c.head);
    parts.push(`[${i}:v]trim=start=${r3(c.head)}:end=${end},setpts=PTS-STARTPTS,fps=${FPS},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,settb=AVTB[v${i}]`);
    parts.push(c.hasAudio
      ? `[${i}:a]atrim=start=${r3(c.head)},asetpts=PTS-STARTPTS,aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${c.gainDb.toFixed(1)}dB,apad,atrim=0:${len}[a${i}]`
      : `anullsrc=r=44100:cl=stereo,atrim=0:${len},aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
  });
  let v = 'v0';
  let a = 'a0';
  let total = clips[0].length - clips[0].head;
  plan.forEach((b, k) => {
    const i = k + 1;
    const offset = r3(total - b.seconds);
    parts.push(`[${v}][v${i}]xfade=transition=${b.xfade}:duration=${r3(b.seconds)}:offset=${offset}[xv${i}]`);
    parts.push(`[${a}][a${i}]acrossfade=d=${r3(b.seconds)}:c1=tri:c2=tri[xa${i}]`);
    v = `xv${i}`;
    a = `xa${i}`;
    total += clips[i].length - clips[i].head - b.seconds;
  });
  const fadeIn = Math.min(FADE_IN, total / 4);
  const fadeOut = Math.min(FADE_OUT, total / 4);
  parts.push(`[${v}]fade=t=in:st=0:d=${r3(fadeIn)},fade=t=out:st=${r3(total - fadeOut)}:d=${r3(fadeOut)}[vout]`);
  parts.push(`[${a}]afade=t=in:st=0:d=${r3(fadeIn)},afade=t=out:st=${r3(total - fadeOut)}:d=${r3(fadeOut)},alimiter=limit=0.9[aout]`);
  return { graph: parts.join(';'), length: total };
}

export class VideoAssembler {
  constructor(bookId = null) {
    this.bookId = bookId;
  }

  /**
   * Join the completed scene clips into the film.
   * @param {Array<Object>} scenes  scene results in film order (filename, status, transition, location)
   * @returns {Promise<Object>} the stored film: videoUrl, filename, duration (seconds), transitions
   */
  async assembleFilm(scenes, options = {}) {
    const { title = 'Animation' } = options;
    // a private folder per join: two films joining at once used to share
    // temp-video/scene-001.mp4
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'film-join-'));
    try {
      const clips = [];
      let gap = false;
      for (const scene of scenes) {
        const usable = scene?.filename && !scene.error && (scene.status === 'completed' || scene.status === undefined);
        if (!usable) { gap = clips.length > 0; continue; }
        const file = path.join(dir, `scene-${String(clips.length + 1).padStart(3, '0')}.mp4`);
        fs.writeFileSync(file, await mediaStorage.getFile('videos', scene.filename));
        const info = await probe(file);
        if (!info.length) { gap = clips.length > 0; continue; }
        clips.push({ scene, file, ...info, gapBefore: gap, head: 0, gainDb: 0 });
        gap = false;
      }
      if (!clips.length) throw new Error('No valid scene videos to assemble');

      const plan = planJoin(clips);
      for (let i = 0; i < clips.length; i++) {
        const c = clips[i];
        // trim a still opening, but not where the shot continues the last
        // one (there the first frame IS the match), and keep most of the clip
        const continues = i > 0 && plan[i - 1].transition === 'continue';
        if (!continues) {
          const still = await stillHead(c.file);
          const head = Math.min(MAX_HEAD_TRIM, Math.max(0, still - 0.08));
          if (head > 0.1 && c.length - head >= Math.max(1.5, c.length * 0.6)) c.head = head;
        }
        if (c.hasAudio) {
          const mean = await meanVolume(c.file);
          // silence stays silence; otherwise towards one level, within reason
          c.gainDb = mean === null || mean < -60 ? 0 : Math.max(-15, Math.min(18, TARGET_DB - mean));
        }
      }
      // the boundaries were sized before trimming; size them again
      const finalPlan = planJoin(clips);
      const { width, height } = clips[0];
      const W = width - (width % 2);
      const H = height - (height % 2);
      const { graph, length } = joinGraph(clips, finalPlan, { width: W, height: H });

      const outputFilename = `film-${Date.now()}.mp4`;
      const outputPath = path.join(dir, outputFilename);
      const graphFile = path.join(dir, 'graph.txt');
      fs.writeFileSync(graphFile, graph);
      const args = ['-y', '-loglevel', 'error'];
      clips.forEach(c => args.push('-i', c.file));
      args.push('-filter_complex_script', graphFile, '-map', '[vout]', '-map', '[aout]',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', outputPath);
      const { code, err } = await run(args);
      if (code !== 0) throw new Error(`ffmpeg could not join the scenes: ${err.slice(-400)}`);

      const finalBuffer = fs.readFileSync(outputPath);
      const uploadResult = await mediaStorage.upload('videos', finalBuffer, outputFilename, {
        'x-amz-meta-type': 'final-animation',
        'x-amz-meta-title': title,
        'x-amz-meta-scene-count': String(clips.length),
        bookId: this.bookId, // for access control
      }, setMediaBookMapping);

      return {
        success: true,
        videoUrl: `/api/media/videos/${outputFilename}`,
        storageKey: uploadResult.storageKey,
        bucket: uploadResult.bucket,
        filename: outputFilename,
        sceneCount: clips.length,
        size: finalBuffer.length,
        duration: Math.round(length * 100) / 100,
        width: W,
        height: H,
        joinVersion: 2,
        transitions: finalPlan.map((b, k) => ({ into: clips[k + 1].scene.sceneNumber ?? k + 2, transition: b.transition, seconds: r3(b.seconds) })),
      };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}
