import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { mediaStorage } from './mediaStorage.js';
import { setMediaBookMapping } from '../utils/mediaMapping.js';
import { TRANSITIONS, TRANSITION_IDS, transitionOf } from './filmShots.js';

export { TRANSITIONS, TRANSITION_IDS, transitionOf };

// Joins a film's scene clips into one video. Until 2.23.55 this was a plain
// concat: every scene change was a hard cut (the "fade" option was a stub),
// each clip kept its own generated sound at its own level (24 dB apart in a
// real film) and many clips opened on a still frame for up to a second. Now:
//   - each boundary gets the scene's transition: continue (the clip starts
//     from the previous clip's last frame; a 3-frame blend), cut (a soft
//     0.25 s dissolve), dissolve (0.8 s) or fade (through black, 1.2 s);
//   - sound is brought to one level per clip, crossfaded at every cut, and
//     evened out and gently compressed over the whole film;
//   - a still opening (before the video model starts moving) is trimmed,
//     except where the scene continues the previous shot;
//   - the film fades in from and out to black.
// Memory: one ffmpeg graph over every clip held each clip's decoded frames
// until its turn (5 GB for 13 real clips; it OOM-killed the 2 GiB backend
// on 2026-10-07). Now every step opens at most two clips: each clip is
// normalised alone, each scene body and each blend is encoded as its own
// piece, the pieces are joined without re-encoding, and the (light) sound
// track is built separately. One join at a time per process.

const FPS = 24;
const ENCODE = ['-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-threads', '2', '-video_track_timescale', '24000', '-an'];
const TARGET_DB = -20; // mean level every clip is brought to
const FADE_IN = 0.5;
const FADE_OUT = 0.8;
const MAX_HEAD_TRIM = 1.0;

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
  // the join shares the API's CPU: let requests go first
  try { os.setPriority(p.pid, 10); } catch { /* not permitted here: run at normal priority */ }
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

/**
 * The pieces of the film, in frames: per clip the body (between its blends)
 * and per boundary the blend. frames[i] is clip i's frame count after
 * normalising; plan comes from planJoin. Exported for tests.
 */
export function framePlan(frames, plan) {
  const blend = plan.map(b => Math.max(1, Math.round(b.seconds * FPS)));
  const bodies = frames.map((n, i) => {
    const start = i > 0 ? blend[i - 1] : 0;
    const end = n - (i < frames.length - 1 ? blend[i] : 0);
    return { start, end: Math.max(start + 1, end) };
  });
  const total = frames.reduce((s, n) => s + n, 0) - blend.reduce((s, d) => s + d, 0);
  return { blend, bodies, total };
}

/**
 * The sound track's filter graph (exported for tests). clips[i].audioInput is
 * the ffmpeg input number of clip i's sound file, or null for a silent clip.
 */
export function audioGraph(clips, plan, fp) {
  const parts = [];
  clips.forEach((c, i) => {
    const len = r3(c.frames / FPS);
    parts.push(Number.isInteger(c.audioInput)
      ? `[${c.audioInput}:a]apad,atrim=0:${len}[a${i}]`
      : `anullsrc=r=44100:cl=stereo,atrim=0:${len},aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
  });
  let a = 'a0';
  plan.forEach((b, k) => {
    parts.push(`[${a}][a${k + 1}]acrossfade=d=${r3(fp.blend[k] / FPS)}:c1=tri:c2=tri[xa${k + 1}]`);
    a = `xa${k + 1}`;
  });
  const total = fp.total / FPS;
  const fadeIn = Math.min(FADE_IN, total / 4);
  const fadeOut = Math.min(FADE_OUT, total / 4);
  // the clips' own sound bursts from quiet to loud inside a shot (31 dB in a
  // quarter second in a real film): even the level out over a few seconds,
  // then compress the peaks gently (measured: worst step 31.7 -> 23.8 dB,
  // spread 11.0 -> 6.4 dB, no clipping)
  parts.push(`[${a}]dynaudnorm=f=250:g=11:p=0.9:m=6,acompressor=threshold=0.1:ratio=3:attack=10:release=250,afade=t=in:st=0:d=${r3(fadeIn)},afade=t=out:st=${r3(total - fadeOut)}:d=${r3(fadeOut)},alimiter=limit=0.9[aout]`);
  return parts.join(';');
}

const ffmpegOk = async (args, what) => {
  const { code, err } = await run(['-y', '-loglevel', 'error', ...args]);
  if (code !== 0) throw new Error(`ffmpeg could not ${what}: ${err.slice(-400)}`);
};
const frameCount = async (file) => {
  const { err } = await run(['-i', file, '-map', '0:v:0', '-c', 'copy', '-f', 'null', '-']);
  return [...err.matchAll(/frame=\s*(\d+)/g)].map(m => Number(m[1])).pop() || 0;
};

// one join at a time in this process: each holds an encoder's worth of memory
let joining = Promise.resolve();

export class VideoAssembler {
  constructor(bookId = null) {
    this.bookId = bookId;
  }

  /**
   * Join the completed scene clips into the film.
   * @param {Array<Object>} scenes  scene results in film order (filename, status, transition, location)
   * @returns {Promise<Object>} the stored film: videoUrl, filename, duration (seconds), transitions
   */
  assembleFilm(scenes, options = {}) {
    const job = joining.then(() => this.join(scenes, options));
    joining = job.catch(() => {});
    return job;
  }

  async join(scenes, options = {}) {
    const { title = 'Animation' } = options;
    // a private folder per join: two films joining at once used to share
    // temp-video/scene-001.mp4
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'film-join-'));
    const at = (name) => path.join(dir, name);
    try {
      const clips = [];
      let gap = false;
      for (const scene of scenes) {
        const usable = scene?.filename && !scene.error && (scene.status === 'completed' || scene.status === undefined);
        if (!usable) { gap = clips.length > 0; continue; }
        const file = at(`src-${clips.length}.mp4`);
        fs.writeFileSync(file, await mediaStorage.getFile('videos', scene.filename));
        const info = await probe(file);
        if (!info.length) { gap = clips.length > 0; continue; }
        clips.push({ scene, file, ...info, gapBefore: gap, head: 0, gainDb: 0 });
        gap = false;
      }
      if (!clips.length) throw new Error('No valid scene videos to assemble');

      const roughPlan = planJoin(clips);
      const W = clips[0].width - (clips[0].width % 2);
      const H = clips[0].height - (clips[0].height % 2);
      // 1. each clip alone: trim a still opening (not where the shot continues
      // the last one: there the first frame IS the match), one size and frame
      // rate, and its sound at one level in a separate file
      for (let i = 0; i < clips.length; i++) {
        const c = clips[i];
        const continues = i > 0 && roughPlan[i - 1].transition === 'continue';
        if (!continues) {
          const still = await stillHead(c.file);
          const head = Math.min(MAX_HEAD_TRIM, Math.max(0, still - 0.08));
          if (head > 0.1 && c.length - head >= Math.max(1.5, c.length * 0.6)) c.head = head;
        }
        c.norm = at(`norm-${i}.mp4`);
        await ffmpegOk(['-threads', '2', '-i', c.file, '-map', '0:v:0',
          '-vf', `trim=start=${r3(c.head)},setpts=PTS-STARTPTS,fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p`,
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-threads', '2', '-an', c.norm], `prepare scene ${i + 1}`);
        c.frames = await frameCount(c.norm);
        if (c.hasAudio) {
          const mean = await meanVolume(c.file);
          // silence stays silence; otherwise towards one level, within reason
          c.gainDb = mean === null || mean < -60 ? 0 : Math.max(-15, Math.min(18, TARGET_DB - mean));
          c.wav = at(`aud-${i}.wav`);
          await ffmpegOk(['-i', c.file, '-map', '0:a:0', '-af', `atrim=start=${r3(c.head)},asetpts=PTS-STARTPTS,aresample=44100,aformat=sample_fmts=s16:channel_layouts=stereo,volume=${c.gainDb.toFixed(1)}dB`,
            '-c:a', 'pcm_s16le', c.wav], `take scene ${i + 1}'s sound`);
        }
        fs.rmSync(c.file, { force: true });
        c.length = c.frames / FPS; // what planJoin sizes the blends from
        c.head = 0;
      }

      // 2. the pieces: each body, and each blend from the two clips it joins
      const plan = planJoin(clips);
      const fp = framePlan(clips.map(c => c.frames), plan);
      const pieces = [];
      const last = clips.length - 1;
      for (let i = 0; i < clips.length; i++) {
        const { start, end } = fp.bodies[i];
        const len = (end - start) / FPS;
        const fades = [];
        if (i === 0) fades.push(`fade=t=in:st=0:d=${r3(Math.min(FADE_IN, len / 2))}`);
        if (i === last) fades.push(`fade=t=out:st=${r3(len - Math.min(FADE_OUT, len / 2))}:d=${r3(Math.min(FADE_OUT, len / 2))}`);
        const body = at(`piece-${pieces.length}.mp4`);
        await ffmpegOk(['-threads', '2', '-i', clips[i].norm, '-vf', [`trim=start_frame=${start}:end_frame=${end}`, 'setpts=PTS-STARTPTS', ...fades].join(','), ...ENCODE, body], `cut scene ${i + 1}`);
        pieces.push(body);
        if (i < last) {
          const d = fp.blend[i];
          const blend = at(`piece-${pieces.length}.mp4`);
          await ffmpegOk(['-threads', '2', '-i', clips[i].norm, '-threads', '2', '-i', clips[i + 1].norm, '-filter_complex',
            `[0:v]trim=start_frame=${clips[i].frames - d},setpts=PTS-STARTPTS[a];[1:v]trim=end_frame=${d},setpts=PTS-STARTPTS[b];[a][b]xfade=transition=${plan[i].xfade}:duration=${r3(d / FPS)}:offset=0[v]`,
            '-map', '[v]', ...ENCODE, blend], `blend scenes ${i + 1} and ${i + 2}`);
          pieces.push(blend);
        }
      }

      // 3. the pieces end to end, no re-encode; 4. the sound track; 5. both together
      const list = at('pieces.txt');
      fs.writeFileSync(list, pieces.map(p => `file '${p}'`).join('\n'));
      await ffmpegOk(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', at('video.mp4')], 'join the pieces');
      const audioArgs = [];
      for (const c of clips) {
        c.audioInput = c.wav ? audioArgs.length / 2 : null;
        if (c.wav) audioArgs.push('-i', c.wav);
      }
      fs.writeFileSync(at('audio.txt'), audioGraph(clips, plan, fp));
      await ffmpegOk([...audioArgs, '-filter_complex_script', at('audio.txt'), '-map', '[aout]', '-c:a', 'aac', '-b:a', '160k', at('audio.m4a')], 'build the sound track');
      const outputFilename = `film-${Date.now()}.mp4`;
      const outputPath = at(outputFilename);
      await ffmpegOk(['-i', at('video.mp4'), '-i', at('audio.m4a'), '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-movflags', '+faststart', outputPath], 'put picture and sound together');

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
        duration: Math.round((fp.total / FPS) * 100) / 100,
        width: W,
        height: H,
        joinVersion: 2,
        transitions: plan.map((b, j) => ({ into: clips[j + 1].scene.sceneNumber ?? j + 2, transition: b.transition, seconds: r3(fp.blend[j] / FPS) })),
      };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}
