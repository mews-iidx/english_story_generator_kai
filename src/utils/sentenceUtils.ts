export interface StorySentenceItem {
  id: number;
  text: string;
  pIdx: number;
  charStart: number;
  charEnd: number;
}

export function splitStoryIntoSentences(storyContent: string): StorySentenceItem[] {
  if (!storyContent) return [];
  const paragraphs = storyContent.split('\n\n').filter(p => p.trim().length > 0);
  const result: StorySentenceItem[] = [];
  let counter = 0;

  paragraphs.forEach((p, pIdx) => {
    const regex = /[^.!?\n]+[.!?]+["'」』]?|[^.!?\n]+$/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(p)) !== null) {
      const fullMatch = match[0];
      const trimmed = fullMatch.trim();
      if (trimmed.length > 0) {
        const startOffset = fullMatch.indexOf(trimmed);
        const actualStart = match.index + (startOffset >= 0 ? startOffset : 0);
        const actualEnd = actualStart + trimmed.length;

        result.push({
          id: counter++,
          text: trimmed,
          pIdx,
          charStart: actualStart,
          charEnd: actualEnd,
        });
      }
    }
  });

  return result;
}

export interface StoryComprehensionStats {
  totalSentences: number;
  greenCount: number; // Rating 4: 即座に理解
  blueCount: number;  // Rating 3: 理解
  amberCount: number; // Rating 2: 曖昧
  roseCount: number;  // Rating 1: 要復習
  greenRate: number;  // 0 - 100%
  isAllGreen: boolean; // greenCount === totalSentences && totalSentences > 0
  ratedCount: number;
}

export function computeStoryComprehensionStats(story: {
  storyContent?: string;
  sentenceRatings?: Record<number, { rating: 1 | 2 | 3 | 4 }>;
  listeningMetrics?: { sentenceRatings?: Record<number, { rating: 1 | 2 | 3 | 4 }> };
}): StoryComprehensionStats {
  const sentences = splitStoryIntoSentences(story.storyContent || '');
  const totalSentences = sentences.length;
  const ratings = story.sentenceRatings || story.listeningMetrics?.sentenceRatings || {};

  let greenCount = 0;
  let blueCount = 0;
  let amberCount = 0;
  let roseCount = 0;
  let ratedCount = 0;

  sentences.forEach(s => {
    const r = ratings[s.id]?.rating;
    if (r !== undefined) {
      ratedCount++;
      if (r === 4) greenCount++;
      else if (r === 3) blueCount++;
      else if (r === 2) amberCount++;
      else if (r === 1) roseCount++;
    }
  });

  const greenRate = totalSentences > 0 ? Math.round((greenCount / totalSentences) * 100) : 0;
  const isAllGreen = totalSentences > 0 && greenCount === totalSentences;

  return {
    totalSentences,
    greenCount,
    blueCount,
    amberCount,
    roseCount,
    greenRate,
    isAllGreen,
    ratedCount,
  };
}
