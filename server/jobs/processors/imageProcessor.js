import { saiImage } from '../../saiClient.js';
import { mediaStorage } from '../../services/mediaStorage.js';
import { updateJobStatus } from '../queue.js';
import { v4 as uuidv4 } from 'uuid';
import { setMediaBookMapping, recordMediaOwner } from '../../utils/mediaMapping.js';
import { BookDataService } from '../../db/dataService.js';

// Redis client for book data
export async function processImageGeneration(job) {
  const { userId, bookId, imageType, itemId, prompt, context } = job.data;

  try {
    await updateJobStatus(job, { status: 'active', progress: 10 });

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

    await updateJobStatus(job, { status: 'active', progress: 30, message: 'Generating image with AI...' });

    // Generate image via the SAI media bridge
    const { buffer: imageBuffer } = await saiImage({
      prompt: enhancedPrompt,
      model: 'flux2-klein-9b',
      size: '1024x1024',
    });

    await updateJobStatus(job, { status: 'active', progress: 70, message: 'Uploading image...' });

    // Upload to MinIO with access control mapping
    // unguessable, and never overwrites an earlier image of the same item
    const filename = `${imageType}-${uuidv4()}.png`;
    const imageUrl = `/api/media/images/${filename}`;

    const uploadResult = await mediaStorage.upload('images', imageBuffer, filename, {
      bookId,
      userId,
      imageType,
      itemId,
    }, setMediaBookMapping);
    await recordMediaOwner('images', filename, { ownerId: userId, bookId });

    await updateJobStatus(job, { status: 'active', progress: 90, message: 'Updating book data...' });

    // Persist through the data service. The old code wrote book:{id} in Redis —
    // a store that has been EMPTY since DUAL_WRITE=false, so every generated
    // image's book update was silently discarded.
    try {
      // Applied to a fresh read of the book (see applyServerWrite).
      await BookDataService.applyServerWrite(bookId, userId, (book) => {
        const updates = {};
        if (imageType === 'cover') {
          // the book's own cover (this branch was lost in an earlier rewrite —
          // covers were generated, uploaded, then never attached)
          updates.metadata = { ...(book.metadata || {}), coverImage: imageUrl };
        } else if (imageType === 'character' && itemId) {
          const character = (book.characters || []).find(c => c.id === itemId);
          if (character) {
            character.imageUrl = imageUrl;
            updates.characters = book.characters;
          }
        } else if (imageType === 'location' && itemId) {
          const location = (book.locations || []).find(l => l.id === itemId);
          if (location) {
            location.imageUrl = imageUrl;
            updates.locations = book.locations;
          }
        } else if (imageType === 'chapter' && itemId) {
          const chapters = book.chapters || [];
          const chapter = chapters.find(c => c.id === itemId);
          if (chapter) {
            chapter.coverImage = imageUrl;
            updates.chapters = chapters;
          }
        }
        return updates;
      });
    } catch (err) {
      // The image itself is safe in MinIO; the book-reference update failing
      // must not fail the job — but it must be LOUD.
      console.error('Image generated but book update failed:', err.message);
      await updateJobStatus(job, {
        status: 'active', progress: 95,
        message: 'Image generated; book update failed — attach it manually',
      });
    }

    await updateJobStatus(job, {
      status: 'completed',
      progress: 100,
      message: 'Image generated successfully',
      result: uploadResult,
    });

    return uploadResult;
  } catch (error) {
    console.error('Image generation job failed:', error);
    await updateJobStatus(job, {
      status: 'failed',
      error: error.message,
      message: `Failed: ${error.message}`,
    });
    throw error;
  }
}
