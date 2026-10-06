
import { AIImportAnalyzer } from '../../ai-import-analyzer.js';
import { BookDataService } from '../../db/dataService.js';
import { updateJobStatus } from '../queue.js';

export async function processImportAnalysis(job) {
  const { userId, bookId, chapterIndex, chapter } = job.data;

  try {
    await updateJobStatus(job.id, { status: 'active', progress: 10 });

    // Load through the data service (Redis book:{id} is empty in PG-only mode)
    const book = await BookDataService.findById(bookId);
    if (!book) {
      throw new Error('Book not found');
    }
    const analyzer = new AIImportAnalyzer();

    // Build context from previously analyzed chapters
    const context = {
      genre: book.genre,
      existingCharacters: book.characters?.filter(c => !c.fromImport) || [],
      existingLocations: book.locations?.filter(l => !l.fromImport) || [],
      existingPlotlines: book.plotlines?.filter(p => !p.fromImport) || [],
    };

    await updateJobStatus(job.id, {
      status: 'active',
      progress: 30,
      message: `Analyzing chapter ${chapterIndex + 1}...`,
    });

    // Analyze chapter
    const analysis = await analyzer.analyzeChapter(chapter, context);

    await updateJobStatus(job.id, {
      status: 'active',
      progress: 70,
      message: 'Merging with existing data...',
    });

    // Merge analysis into book
    if (!book.importAnalysis) {
      book.importAnalysis = {
        chapters: [],
        allCharacters: [],
        allLocations: [],
        allPlotThreads: [],
        allThemes: [],
      };
    }

    // Store chapter analysis
    book.importAnalysis.chapters[chapterIndex] = analysis;

    // Merge characters (avoiding duplicates)
    if (analysis.characters) {
      const existingChars = book.characters || [];
      const importedChars = book.importAnalysis.allCharacters || [];

      for (const char of analysis.characters) {
        const exists = [...existingChars, ...importedChars].find(
          c => c.name.toLowerCase() === char.name.toLowerCase()
        );

        if (!exists) {
          const newChar = {
            ...char,
            id: `char-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            fromImport: true,
            chapters: [chapterIndex],
          };
          book.importAnalysis.allCharacters.push(newChar);
        } else if (exists.fromImport) {
          // Update existing imported character
          if (!exists.chapters.includes(chapterIndex)) {
            exists.chapters.push(chapterIndex);
          }
        }
      }
    }

    // Merge locations
    if (analysis.locations) {
      const existingLocs = book.locations || [];
      const importedLocs = book.importAnalysis.allLocations || [];

      for (const loc of analysis.locations) {
        const exists = [...existingLocs, ...importedLocs].find(
          l => l.name.toLowerCase() === loc.name.toLowerCase()
        );

        if (!exists) {
          const newLoc = {
            ...loc,
            id: `loc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            fromImport: true,
            chapters: [chapterIndex],
          };
          book.importAnalysis.allLocations.push(newLoc);
        } else if (exists.fromImport) {
          if (!exists.chapters.includes(chapterIndex)) {
            exists.chapters.push(chapterIndex);
          }
        }
      }
    }

    // Merge plot threads
    if (analysis.plotThreads) {
      const existingPlots = book.plotlines || [];
      const importedPlots = book.importAnalysis.allPlotThreads || [];

      for (const plot of analysis.plotThreads) {
        const exists = [...existingPlots, ...importedPlots].find(
          p => p.name && plot.name && p.name.toLowerCase() === plot.name.toLowerCase()
        );

        if (!exists) {
          const newPlot = {
            ...plot,
            id: `plot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            fromImport: true,
            chapters: [chapterIndex],
          };
          book.importAnalysis.allPlotThreads.push(newPlot);
        } else if (exists.fromImport) {
          if (!exists.chapters.includes(chapterIndex)) {
            exists.chapters.push(chapterIndex);
          }
        }
      }
    }

    await updateJobStatus(job.id, { status: 'active', progress: 90, message: 'Saving...' });

    // Save through the data service (the Redis write landed in an empty store)
    await BookDataService.update(bookId, userId, {
      metadata: { ...(book.metadata || {}), importAnalysis: book.importAnalysis },
      characters: book.characters,
      locations: book.locations,
      plotlines: book.plotlines,
    }, book.version);

    await updateJobStatus(job.id, {
      status: 'completed',
      progress: 100,
      message: `Chapter ${chapterIndex + 1} analyzed successfully`,
      result: analysis,
    });

    return analysis;
  } catch (error) {
    console.error('Import analysis job failed:', error);
    await updateJobStatus(job.id, {
      status: 'failed',
      error: error.message,
      message: `Failed: ${error.message}`,
    });
    throw error;
  }
}
