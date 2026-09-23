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
