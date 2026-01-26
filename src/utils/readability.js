import { syllable } from 'syllable';

/**
 * Calculate readability metrics for text
 */
export function calculateReadability(text) {
  if (!text || text.trim().length === 0) {
    return {
      fleschScore: 0,
      fleschKincaidGrade: 0,
      readingLevel: 'N/A',
      readingTime: 0,
      sentences: 0,
      words: 0,
      syllables: 0,
      avgWordsPerSentence: 0,
      avgSyllablesPerWord: 0,
    };
  }

  // Split into sentences (simplified - handles most cases)
  const sentences = text
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  const sentenceCount = Math.max(sentences.length, 1);

  // Split into words
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0);

  const wordCount = Math.max(words.length, 1);

  // Count syllables
  const totalSyllables = words.reduce((sum, word) => {
    return sum + syllable(word);
  }, 0);

  // Calculate metrics
  const avgWordsPerSentence = wordCount / sentenceCount;
  const avgSyllablesPerWord = totalSyllables / wordCount;

  // Flesch Reading Ease Score (0-100, higher is easier)
  // 206.835 - 1.015 * (words/sentences) - 84.6 * (syllables/words)
  const fleschScore = Math.max(
    0,
    Math.min(
      100,
      206.835 - 1.015 * avgWordsPerSentence - 84.6 * avgSyllablesPerWord
    )
  );

  // Flesch-Kincaid Grade Level
  // 0.39 * (words/sentences) + 11.8 * (syllables/words) - 15.59
  const fleschKincaidGrade = Math.max(
    0,
    0.39 * avgWordsPerSentence + 11.8 * avgSyllablesPerWord - 15.59
  );

  // Reading level description
  let readingLevel = 'Unknown';
  if (fleschScore >= 90) {
    readingLevel = 'Very Easy (5th grade)';
  } else if (fleschScore >= 80) {
    readingLevel = 'Easy (6th grade)';
  } else if (fleschScore >= 70) {
    readingLevel = 'Fairly Easy (7th grade)';
  } else if (fleschScore >= 60) {
    readingLevel = 'Standard (8th-9th grade)';
  } else if (fleschScore >= 50) {
    readingLevel = 'Fairly Difficult (10th-12th grade)';
  } else if (fleschScore >= 30) {
    readingLevel = 'Difficult (College)';
  } else {
    readingLevel = 'Very Difficult (College Graduate)';
  }

  // Estimated reading time (assuming 200 words per minute)
  const readingTime = Math.ceil(wordCount / 200);

  return {
    fleschScore: Math.round(fleschScore * 10) / 10,
    fleschKincaidGrade: Math.round(fleschKincaidGrade * 10) / 10,
    readingLevel,
    readingTime,
    sentences: sentenceCount,
    words: wordCount,
    syllables: totalSyllables,
    avgWordsPerSentence: Math.round(avgWordsPerSentence * 10) / 10,
    avgSyllablesPerWord: Math.round(avgSyllablesPerWord * 10) / 10,
  };
}

/**
 * Get a color class based on Flesch score
 */
export function getReadabilityColor(fleschScore) {
  if (fleschScore >= 70) {
    return 'text-green-600';
  } else if (fleschScore >= 50) {
    return 'text-yellow-600';
  } else if (fleschScore >= 30) {
    return 'text-orange-600';
  } else {
    return 'text-red-600';
  }
}

/**
 * Get sentence complexity indicator
 */
export function getSentenceComplexity(avgWordsPerSentence) {
  if (avgWordsPerSentence < 15) {
    return { level: 'Simple', color: 'text-green-600' };
  } else if (avgWordsPerSentence < 20) {
    return { level: 'Medium', color: 'text-yellow-600' };
  } else if (avgWordsPerSentence < 25) {
    return { level: 'Complex', color: 'text-orange-600' };
  } else {
    return { level: 'Very Complex', color: 'text-red-600' };
  }
}
