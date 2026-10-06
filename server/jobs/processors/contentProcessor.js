import { AIBookOrchestrator } from '../../ai-agent-orchestrator.js';
import { updateJobStatus } from '../queue.js';
import { BookDataService } from '../../db/dataService.js';

export async function processContentGeneration(job) {
  const { userId, bookId, contentType, itemId, config } = job.data;

  try {
    await updateJobStatus(job, { status: 'active', progress: 10 });

    // Load through the data service — the Redis book:{id} store is EMPTY under
    // PostgreSQL-only mode, so the old load threw 'Book not found' for every job.
    const book = await BookDataService.findById(bookId);
    if (!book) {
      throw new Error('Book not found');
    }
    const orchestrator = new AIBookOrchestrator(book);

    let result;

    // Progress callback
    const onProgress = async (progress, message) => {
      await updateJobStatus(job, {
        status: 'active',
        progress: Math.min(90, 10 + progress * 0.8),
        message,
      });
    };

    await updateJobStatus(job, { status: 'active', progress: 20, message: `Generating ${contentType}...` });

    // Generate content based on type
    switch (contentType) {
      // The orchestrator's REAL method names (the old ones don't exist — every
      // content job crashed at dispatch).
      case 'chapter': {
        const outline = (itemId && (book.chapterOutlines || []).find(o => o.id === itemId))
          || { title: config?.title || 'Chapter', summary: config?.summary || '', scenes: config?.scenes || [], characters: config?.characters || [] };
        result = await orchestrator.generateChapterContent(outline, book, itemId || (book.chapters?.length || 0) + 1);
        break;
      }

      case 'character':
        result = await orchestrator.generateCharacters(book, config?.count || 1);
        break;

      case 'location':
        result = await orchestrator.generateLocations(book, book.characters || [], config?.count || 1);
        break;

      case 'plotline':
        result = await orchestrator.generatePlotlines(book, book, config?.count || 1);
        break;

      case 'worldbuilding':
        result = await orchestrator.generateTimeline(book);
        break;

      default:
        throw new Error(`Unknown content type: ${contentType}`);
    }

    await updateJobStatus(job, { status: 'active', progress: 95, message: 'Saving to book...' });

    // Persist the generated content onto the book (the old code re-read the
    // dead Redis store and saved NOTHING).
    try {
      // Applied to a FRESH read of the book: the copy loaded at the start of
      // the job is stale, and writing it back reverted the user's edits.
      await BookDataService.applyServerWrite(bookId, job.data.userId, (fresh) => {
        if (contentType === 'chapter' && result) {
          const generated = typeof result === 'object' ? result : { content: String(result) };
          const chapters = (fresh.chapters || []).map(c => ({ ...c }));
          const existing = itemId ? chapters.find(c => c.id === itemId) : null;
          if (existing) {
            Object.assign(existing, generated);
          } else {
            // no target chapter: add it as the next one (this used to report
            // success and save nothing)
            const next = chapters.reduce((m, c) => Math.max(m, Number(c.number || c.chapterNumber || c.chapter_number || 0)), 0) + 1;
            chapters.push({ ...generated, number: next });
          }
          return { chapters };
        }
        if (Array.isArray(result)) {
          if (contentType === 'character') return { characters: [...(fresh.characters || []), ...result] };
          if (contentType === 'location') return { locations: [...(fresh.locations || []), ...result] };
          if (contentType === 'plotline') return { plotlines: [...(fresh.plotlines || []), ...result] };
        }
        return null;
      });
    } catch (err) {
      console.error('Content generated but book update failed:', err.message);
      throw err; // don't report success for content that was never saved
    }

    await updateJobStatus(job, {
      status: 'completed',
      progress: 100,
      message: `${contentType} generated successfully`,
      result,
    });

    return result;
  } catch (error) {
    console.error('Content generation job failed:', error);
    await updateJobStatus(job, {
      status: 'failed',
      error: error.message,
      message: `Failed: ${error.message}`,
    });
    throw error;
  }
}
