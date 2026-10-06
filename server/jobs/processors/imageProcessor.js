import { saiImage } from '../../saiClient.js';
import { mediaStorage } from '../../services/mediaStorage.js';
import { updateJobStatus } from '../queue.js';
import { setMediaBookMapping } from '../../utils/mediaMapping.js';
import { BookDataService } from '../../db/dataService.js';

// Redis client for book data
export async function processImageGeneration(job) {
  const { userId, bookId, imageType, itemId, prompt, context } = job.data;

  try {
    await updateJobStatus(job.id, { status: 'active', progress: 10 });

    // Build enhanced prompt based on image type
    let enhancedPrompt = prompt;

    if (context) {
      const contextParts = [];
      if (context.genre) contextParts.push(`Genre: ${context.genre}`);
      if (context.tone) contextParts.push(`Tone: ${context.tone}`);
      if (context.setting) contextParts.push(`Setting: ${context.setting}`);

      if (contextParts.length > 0) {
        enhancedPrompt = `${contextParts.join(', ')}\n\n${prompt}`;
      }
    }

    await updateJobStatus(job.id, { status: 'active', progress: 30, message: 'Generating image with AI...' });

    // Generate image via the SAI media bridge
    const { buffer: imageBuffer } = await saiImage({
      prompt: enhancedPrompt,
      model: 'flux2-klein-9b',
      size: '1024x1024',
    });

    await updateJobStatus(job.id, { status: 'active', progress: 70, message: 'Uploading image...' });

    // Upload to MinIO with access control mapping
    const filename = `${imageType}-${itemId || Date.now()}.png`;

    const uploadResult = await mediaStorage.upload('images', imageBuffer, filename, {
      bookId,
      userId,
      imageType,
      itemId,
    }, setMediaBookMapping);

    await updateJobStatus(job.id, { status: 'active', progress: 90, message: 'Updating book data...' });

    // Persist through the data service. The old code wrote book:{id} in Redis —
    // a store that has been EMPTY since DUAL_WRITE=false, so every generated
    // image's book update was silently discarded.
    try {
      const book = await BookDataService.findById(bookId);
      if (book) {
        const updates = {};
        if (imageType === 'cover') {
          // the book's own cover (this branch was lost in an earlier rewrite —
          // covers were generated, uploaded, then never attached)
          updates.metadata = { ...(book.metadata || {}), coverImage: uploadResult };
        } else if (imageType === 'character' && itemId) {
          const character = (book.characters || []).find(c => c.id === itemId);
          if (character) {
            character.visual = uploadResult;
            updates.characters = book.characters;
          }
        } else if (imageType === 'location' && itemId) {
          const location = (book.locations || []).find(l => l.id === itemId);
          if (location) {
            location.visual = uploadResult;
            updates.locations = book.locations;
          }
        } else if (imageType === 'chapter' && itemId) {
          const chapters = book.chapters || [];
          const chapter = chapters.find(c => c.id === itemId);
          if (chapter) {
            chapter.coverImage = uploadResult;
            updates.chapters = chapters;
          }
        }
        if (Object.keys(updates).length) {
          await BookDataService.update(bookId, userId, updates, book.version);
        }
      }
    } catch (err) {
      // The image itself is safe in MinIO; the book-reference update failing
      // must not fail the job — but it must be LOUD.
      console.error('Image generated but book update failed:', err.message);
      await updateJobStatus(job.id, {
        status: 'active', progress: 95,
        message: 'Image generated; book update failed — attach it manually',
      });
    }

    await updateJobStatus(job.id, {
      status: 'completed',
      progress: 100,
      message: 'Image generated successfully',
      result: uploadResult,
    });

    return uploadResult;
  } catch (error) {
    console.error('Image generation job failed:', error);
    await updateJobStatus(job.id, {
      status: 'failed',
      error: error.message,
      message: `Failed: ${error.message}`,
    });
    throw error;
  }
}
