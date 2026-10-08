// The film's sound track as an ffmpeg filter graph: pure, no imports, so the
// tests can load it without the storage modules (services/videoAssembler.js
// runs it).

export const FPS = 24;
export const FADE_IN = 0.5;
export const FADE_OUT = 0.8;
export const r3 = (n) => Math.max(0, Math.round(n * 1000) / 1000);

// levels for the film's other sound (mean dB), as the SAI Cloud Film Studio
// mixes: narration on top, the clips' own sound under it, music under both
export const VOICE_DB = -17;
export const MUSIC_DB = -26;
const CLIPS_UNDER_DB = -4; // the clip bus drops this much when there is narration or music
export const dbOf = (volume) => (volume > 0 ? 20 * Math.log10(volume) : -60);

/**
 * The sound track's filter graph (exported for tests). clips[i].audioInput is
 * the ffmpeg input number of clip i's sound file, or null for a silent clip.
 * extras (optional): { voice: { input, gainDb, offset }, music: { input, gainDb } }
 * - the voice-over starts at `offset` seconds; the clips' sound and the music
 * dip under it (sidechain). Every bus is padded/trimmed to the film's length
 * first: sidechaincompress ends with its SHORTER input, and a short
 * voice-over keying the music silenced the end of a film in the Film Studio.
 */
export function audioGraph(clips, plan, fp, extras = null) {
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
  const clipChain = `[${a}]dynaudnorm=f=250:g=11:p=0.9:m=6,acompressor=threshold=0.1:ratio=3:attack=10:release=250,afade=t=in:st=0:d=${r3(fadeIn)},afade=t=out:st=${r3(total - fadeOut)}:d=${r3(fadeOut)}`;
  const voice = extras?.voice;
  const music = extras?.music;
  if (!voice && !music) {
    parts.push(`${clipChain},alimiter=limit=0.9[aout]`);
    return parts.join(';');
  }
  const T = r3(total);
  const fmt = 'aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo';
  parts.push(`${clipChain},volume=${CLIPS_UNDER_DB}dB,apad,atrim=0:${T}[clips]`);
  if (voice) {
    const ms = Math.round(Math.max(0, voice.offset || 0) * 1000);
    parts.push(`[${voice.input}:a]${fmt},volume=${voice.gainDb.toFixed(1)}dB,adelay=${ms}|${ms},apad,atrim=0:${T}[vo]`);
  }
  if (music) {
    const out = Math.min(3, total / 4);
    parts.push(`[${music.input}:a]${fmt},volume=${music.gainDb.toFixed(1)}dB,apad,atrim=0:${T},afade=t=in:st=0:d=${r3(Math.min(1.5, total / 4))},afade=t=out:st=${r3(total - out)}:d=${r3(out)}[mu]`);
  }
  const mix = [];
  if (voice) {
    parts.push(`[vo]asplit=${music ? 3 : 2}[vo0][vok1]${music ? '[vok2]' : ''}`);
    parts.push('[clips][vok1]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=500[clipsd]');
    mix.push('[clipsd]');
    if (music) {
      parts.push('[mu][vok2]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=700[mud]');
      mix.push('[mud]');
    }
    mix.push('[vo0]');
  } else {
    mix.push('[clips]', '[mu]');
  }
  parts.push(`${mix.join('')}amix=inputs=${mix.length}:normalize=0:duration=first,alimiter=limit=0.9[aout]`);
  return parts.join(';');
}

