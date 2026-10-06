import { saiSpeech, VOICE_MAP } from '../../saiClient.js';
import { BookDataService } from '../../db/dataService.js';
import { mediaStorage } from '../../services/mediaStorage.js';
import { updateJobStatus } from '../queue.js';
import { setMediaBookMapping } from '../../utils/mediaMapping.js';

function chunkText(text, maxChars = 4000) {
  const chunks = [];
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let currentChunk = '';

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > maxChars) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence;
      } else {
        // Sentence itself is too long, split by words
        const words = sentence.split(' ');
        for (const word of words) {
          if ((currentChunk + ' ' + word).length > maxChars) {
            chunks.push(currentChunk.trim());
            currentChunk = word;
          } else {
            currentChunk += ' ' + word;
          }
        }
      }
    } else {
      currentChunk += sentence;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

export async function processAudioGeneration(job) {
  const { userId, bookId, chapterId, text, voice = 'alloy' } = job.data;

  try {
    await updateJobStatus(job.id, { status: 'active', progress: 10 });

    // Friendly voice names map onto the SAI bridge's vibevoice set.
    const selectedVoice = VOICE_MAP[voice] || voice;

    // Check if text needs chunking
    const chunks = text.length > 4000 ? chunkText(text) : [text];

    await updateJobStatus(job.id, {
      status: 'active',
      progress: 20,
      message: `Generating audio in ${chunks.length} chunk(s)...`
    });

    // Generate audio for each chunk
    const audioBuffers = [];
    for (let i = 0; i < chunks.length; i++) {
      await updateJobStatus(job.id, {
        status: 'active',
        progress: 20 + (i / chunks.length) * 50,
        message: `Generating chunk ${i + 1}/${chunks.length}...`
      });

      const buffer = await saiSpeech({
        text: chunks[i],
        voice: selectedVoice,
      });
      audioBuffers.push(buffer);
    }

    await updateJobStatus(job.id, { status: 'active', progress: 70, message: 'Combining audio chunks...' });

    // Concatenate WAV chunks CORRECTLY. Buffer.concat glued whole WAV files
    // together — every chunk after the first carried its own 44-byte header
    // mid-stream, which players render as a click and some refuse entirely.
    // Take the first chunk's header (same voice + bridge = same format) and
    // append only the PCM data of the rest.
    const wavDataStart = (buf) => {
      // find the 'data' chunk: standard files have it at offset 36+8, but the
      // bridge may include LIST chunks — scan instead of assuming 44
      if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') return 44;
      let off = 12;
      while (off + 8 <= buf.length) {
        const id = buf.toString('ascii', off, off + 4);
        const size = buf.readUInt32LE(off + 4);
        if (id === 'data') return off + 8;
        off += 8 + size + (size % 2); // chunks are word-aligned
      }
      return 44;
    };
    const first = audioBuffers[0];
    const header = first.subarray(0, wavDataStart(first));
    const pcmParts = [first.subarray(wavDataStart(first))];
    for (let i = 1; i < audioBuffers.length; i++) {
      const b = audioBuffers[i];
      pcmParts.push(b.subarray(wavDataStart(b)));
    }
    const pcmLength = pcmParts.reduce((n, p) => n + p.length, 0);
    // The header may carry extra chunks (LIST etc.) — the fixed '36 + n'
    // RIFF size only holds for a bare 44-byte header and came out SHORT
    // (tested: 1536 vs the correct 1570). RIFF size = filesize - 8.
    header.writeUInt32LE(header.length - 8 + pcmLength, 4);
    const dataIdx = header.indexOf('data', 12, 'ascii');
    if (dataIdx >= 0) header.writeUInt32LE(pcmLength, dataIdx + 4);
    const buffer = Buffer.concat([header, ...pcmParts]);

    // Upload to MinIO with access control mapping (the bridge returns WAV)
    const filename = `chapter-${chapterId}-${Date.now()}.wav`;
    const uploadResult = await mediaStorage.upload('audio', buffer, filename, {
      bookId,
      userId,
      chapterId,
      'x-amz-meta-voice': selectedVoice,
    }, setMediaBookMapping);

    await updateJobStatus(job.id, { status: 'active', progress: 90, message: 'Updating book data...' });

    // Record on the chapter through the data service (the Redis book:{id}
    // store is empty under PostgreSQL-only mode; audioFiles were never
    // written to Postgres at all).
    try {
      const book = await BookDataService.findById(bookId);
      if (book) {
        // AudiobookTab reads data.audioFiles[chapterId] — writing only
        // chapter.audio meant the generated audio never appeared in the UI.
        const audioFiles = { ...(book.audioFiles || {}), [chapterId]: uploadResult };
        const chapters = book.chapters || [];
        const chapter = chapters.find(c => c.id === chapterId);
        if (chapter) chapter.audio = uploadResult;
        await BookDataService.update(bookId, userId, { audio_files: audioFiles, chapters }, book.version);
      }
    } catch (err) {
      console.error('Audio generated but book update failed:', err.message);
    }

    await updateJobStatus(job.id, {
      status: 'completed',
      progress: 100,
      message: 'Audio generated successfully',
      result: uploadResult,
    });

    return uploadResult;
  } catch (error) {
    console.error('Audio generation job failed:', error);
    await updateJobStatus(job.id, {
      status: 'failed',
      error: error.message,
      message: `Failed: ${error.message}`,
    });
    throw error;
  }
}
