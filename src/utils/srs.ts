import { VocabItem } from '../types/vocab';
import { Story } from '../types/story';

export function getTodayDateString(): string {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

export function addDaysToDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

export function calculateLapseSRS(existing?: VocabItem): {
  lapseCount: number;
  repetitionCount: number;
  intervalDays: number;
  nextReviewDate: string;
  lastReviewedAt: string;
} {
  const now = new Date().toISOString();
  return {
    lapseCount: (existing?.lapseCount || 0) + 1,
    repetitionCount: 0,
    intervalDays: 1,
    nextReviewDate: addDaysToDate(1),
    lastReviewedAt: now,
  };
}

export function calculateSuccessSRS(item: VocabItem): {
  repetitionCount: number;
  intervalDays: number;
  nextReviewDate: string;
  lastReviewedAt: string;
} {
  const intervals = [1, 3, 7, 14, 30, 60, 120];
  const nextRep = item.repetitionCount + 1;
  const nextInterval = intervals[Math.min(nextRep, intervals.length - 1)];
  
  return {
    repetitionCount: nextRep,
    intervalDays: nextInterval,
    nextReviewDate: addDaysToDate(nextInterval),
    lastReviewedAt: new Date().toISOString(),
  };
}

/**
 * 今回のストーリーに注入すべき復習対象語彙（3〜5個）を選定
 * 単なる単語文字列だけでなく、文脈・構文メモ（contextNote）があればそれも付与してGeminiに渡す
 */
export function pickTargetVocabsForStory(vocabList: VocabItem[], count: number = 4): string[] {
  if (!vocabList || vocabList.length === 0) return [];

  const today = getTodayDateString();

  const dueItems = vocabList.filter(v => v.nextReviewDate <= today);
  
  dueItems.sort((a, b) => {
    if (b.lapseCount !== a.lapseCount) return b.lapseCount - a.lapseCount;
    return new Date(a.lastReviewedAt).getTime() - new Date(b.lastReviewedAt).getTime();
  });

  const selectedItems: VocabItem[] = [];

  for (const item of dueItems) {
    if (selectedItems.length >= count) break;
    selectedItems.push(item);
  }

  if (selectedItems.length < count) {
    const remaining = vocabList.filter(v => !selectedItems.some(s => s.id === v.id));
    remaining.sort((a, b) => b.lapseCount - a.lapseCount || a.repetitionCount - b.repetitionCount);

    for (const item of remaining) {
      if (selectedItems.length >= count) break;
      selectedItems.push(item);
    }
  }

  return selectedItems.map(item => {
    if (item.contextNote && item.contextNote.length > 0) {
      return `${item.phrase} (意味/構文: ${item.meaning} - ${item.contextNote.slice(0, 40)})`;
    }
    return `${item.phrase} (意味: ${item.meaning})`;
  });
}

export function extractRecentSummaries(stories: Story[], limit: number = 4): string[] {
  return stories
    .slice(0, limit)
    .map(s => `• 「${s.title}」: ${s.summary}`)
    .filter(Boolean);
}