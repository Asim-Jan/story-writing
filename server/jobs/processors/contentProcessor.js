import { AIBookOrchestrator } from '../../ai-agent-orchestrator.js';
import { updateJobStatus } from '../queue.js';
import { BookDataService } from '../../db/dataService.js';

export async function processContentGeneration(job) {
  const { userId, bookId, contentType, itemId, config } = job.data;

  try {
    await updateJobStatus(job.id, { status: 'active', progress: 10 });

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
      await updateJobStatus(job.id, {
        status: 'active',
        progress: Math.min(90, 10 + progress * 0.8),
        message,
      });
    };

    await updateJobStatus(job.id, { status: 'active', progress: 20, message: `Generating ${contentType}...` });

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

    await updateJobStatus(job.id, { status: 'active', progress: 95, message: 'Saving to book...' });

    // Persist the generated content onto the book (the old code re-read the
    // dead Redis store and saved NOTHING).
    try {
      const updates = {};
      if (contentType === 'chapter' && result) {
        const chapters = book.chapters || [];
        const ch = chapters.find(c => c.id === itemId) || {};
        Object.assign(ch, typeof result === 'object' ? result : { content: String(result) });
        updates.chapters = chapters;
      } else if (Array.isArray(result)) {
        if (contentType === 'character') updates.characters = [...(book.characters || []), ...result];
        else if (contentType === 'location') updates.locations = [...(book.locations || []), ...result];
        else if (contentType === 'plotline') updates.plotlines = [...(book.plotlines || []), ...result];
      }
      if (Object.keys(updates).length) {
        await BookDataService.update(bookId, job.data.userId, updates, book.version);
      }
    } catch (err) {
      console.error('Content generated but book update failed:', err.message);
      throw err; // don't report success for content that was never saved
    }

    await updateJobStatus(job.id, {
      status: 'completed',
      progress: 100,
      message: `${contentType} generated successfully`,
      result,
    });

    return result;
  } catch (error) {
    console.error('Content generation job failed:', error);
    await updateJobStatus(job.id, {
      status: 'failed',
      error: error.message,
      message: `Failed: ${error.message}`,
    });
    throw error;
  }
}
