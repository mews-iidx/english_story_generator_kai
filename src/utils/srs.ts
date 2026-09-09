import { VocabItem } from '../types/vocab';
import { Story } from '../types/story';
import { ExpressionErrorItem } from '../types/expressionError';

export const DEFAULT_EASE_FACTOR = 2.5; // 初期 Ease Factor (250%)
export const MIN_EASE_FACTOR = 1.3;     // 最小 Ease Factor (130%)
export const EASY_BONUS = 1.3;          // Easy選択時のボーナス倍率
export const HARD_FACTOR = 1.2;         // Hard選択時の間隔倍率

export function getTodayDateString(): string {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

export function addDaysToDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * 間隔日数を人間が読みやすいラベルに変換 (Ankiスタイルの表示)
 * 例: 1 -> "1日", 6 -> "6日", 45 -> "1.5ヶ月", 400 -> "1.1年"
 */
export function formatIntervalDays(days: number): string {
  if (days <= 0) return '今日';
  if (days === 1) return '1日';
  if (days < 30) return `${days}日`;
  if (days < 365) {
    const months = (days / 30).toFixed(1).replace(/\.0$/, '');
    return `${months}ヶ月`;
  }
  const years = (days / 365).toFixed(1).replace(/\.0$/, '');
  return `${years}年`;
}

export interface AnkiSRSResult {
  easeFactor: number;
  intervalDays: number;
  repetitionCount: number;
  lapseCount: number;
  nextReviewDate: string;
  lastReviewedAt: string;
}

/**
 * 本家Anki (SuperMemo SM-2) アルゴリズムによるSRS間隔計算
 */
export function calculateAnkiSRS(
  item: Partial<VocabItem> | undefined,
  rating: 'again' | 'hard' | 'good' | 'easy'
): AnkiSRSResult {
  const now = new Date().toISOString();
  const currentEF = item?.easeFactor ?? DEFAULT_EASE_FACTOR;
  const currentInterval = item?.intervalDays ?? 0;
  const currentReps = item?.repetitionCount ?? 0;
  const currentLapses = item?.lapseCount ?? 0;

  let newEF = currentEF;
  let newInterval = 1;
  let newReps = currentReps;
  let newLapses = currentLapses;

  switch (rating) {
    case 'again': {
      newEF = Math.max(MIN_EASE_FACTOR, Math.round((currentEF - 0.20) * 100) / 100);
      newInterval = 1;
      newReps = 0;
      newLapses = currentLapses + 1;
      break;
    }
    case 'hard': {
      newEF = Math.max(MIN_EASE_FACTOR, Math.round((currentEF - 0.15) * 100) / 100);
      newReps = currentReps + 1;
      if (currentReps === 0 || currentInterval <= 1) {
        newInterval = 1;
      } else {
        newInterval = Math.max(currentInterval + 1, Math.round(currentInterval * HARD_FACTOR));
      }
      break;
    }
    case 'good': {
      newEF = currentEF;
      newReps = currentReps + 1;
      if (currentReps === 0) {
        newInterval = 1;
      } else if (currentReps === 1) {
        newInterval = 6;
      } else {
        newInterval = Math.max(currentInterval + 1, Math.round(currentInterval * currentEF));
      }
      break;
    }
    case 'easy': {
      newEF = Math.round((currentEF + 0.15) * 100) / 100;
      newReps = currentReps + 1;
      if (currentReps === 0) {
        newInterval = 4;
      } else if (currentReps === 1) {
        newInterval = Math.round(6 * newEF * EASY_BONUS);
      } else {
        newInterval = Math.max(currentInterval + 2, Math.round(currentInterval * newEF * EASY_BONUS));
      }
      break;
    }
  }

  return {
    easeFactor: newEF,
    intervalDays: newInterval,
    repetitionCount: newReps,
    lapseCount: newLapses,
    nextReviewDate: addDaysToDate(newInterval),
    lastReviewedAt: now,
  };
}

/**
 * ボタン表示用に各レーティングを選んだ時の次回期日ラベルを取得
 */
export function getNextReviewIntervals(item: Partial<VocabItem> | undefined): {
  again: string;
  hard: string;
  good: string;
  easy: string;
} {
  const isNewOrLapse = (item?.repetitionCount ?? 0) === 0;
  
  return {
    again: '< 1分',
    hard: isNewOrLapse ? '< 10分' : formatIntervalDays(calculateAnkiSRS(item, 'hard').intervalDays),
    good: formatIntervalDays(calculateAnkiSRS(item, 'good').intervalDays),
    easy: formatIntervalDays(calculateAnkiSRS(item, 'easy').intervalDays),
  };
}

/**
 * 互換性のための既存関数（calculateLapseSRS / calculateSuccessSRS）
 */
export function calculateLapseSRS(existing?: VocabItem) {
  const res = calculateAnkiSRS(existing, 'again');
  return {
    lapseCount: res.lapseCount,
    repetitionCount: res.repetitionCount,
    intervalDays: res.intervalDays,
    nextReviewDate: res.nextReviewDate,
    lastReviewedAt: res.lastReviewedAt,
    easeFactor: res.easeFactor,
  };
}

export function calculateSuccessSRS(item: VocabItem) {
  const res = calculateAnkiSRS(item, 'good');
  return {
    repetitionCount: res.repetitionCount,
    intervalDays: res.intervalDays,
    nextReviewDate: res.nextReviewDate,
    lastReviewedAt: res.lastReviewedAt,
    easeFactor: res.easeFactor,
  };
}

/**
 * 今回のストーリーに注入すべき復習対象語彙（3〜5個）を選定
 * 【改善点：連続生成時の単語重複クールダウン＆多様性確保】
 */
export function pickTargetVocabsForStory(
  vocabList: VocabItem[],
  count: number = 4,
  recentStories: Story[] = []
): string[] {
  if (!vocabList || vocabList.length === 0) return [];

  const today = getTodayDateString();

  // 直近2〜3話で使われた単語のセット（クールダウン用）
  const recentlyUsedPhrases = new Set<string>();
  recentStories.slice(0, 3).forEach(s => {
    (s.targetVocabList || []).forEach(v => {
      const clean = v.replace(/\s*\([^)]*\)/g, '').trim().toLowerCase();
      recentlyUsedPhrases.add(clean);
    });
  });

  // クールダウン対象外（新鮮な単語）と対象（直近使用済み単語）に分割
  const freshItems = vocabList.filter(v => !recentlyUsedPhrases.has(v.phrase.trim().toLowerCase()));
  const candidatePool = freshItems.length >= count ? freshItems : vocabList;

  const dueItems = candidatePool.filter(v => v.nextReviewDate <= today);
  
  // 重要度(降順) ➔ lapseCount(降順) ➔ 最終復習日時(昇順)
  dueItems.sort((a, b) => {
    const impA = a.importance ?? 3;
    const impB = b.importance ?? 3;
    if (impB !== impA) return impB - impA;
    if (b.lapseCount !== a.lapseCount) return b.lapseCount - a.lapseCount;
    return new Date(a.lastReviewedAt).getTime() - new Date(b.lastReviewedAt).getTime();
  });

  const selectedItems: VocabItem[] = [];

  for (const item of dueItems) {
    if (selectedItems.length >= count) break;
    selectedItems.push(item);
  }

  if (selectedItems.length < count) {
    const remaining = candidatePool.filter(v => !selectedItems.some(s => s.id === v.id));
    remaining.sort((a, b) => {
      const impA = a.importance ?? 3;
      const impB = b.importance ?? 3;
      if (impB !== impA) return impB - impA;
      if (b.lapseCount !== a.lapseCount) return b.lapseCount - a.lapseCount;
      return a.repetitionCount - b.repetitionCount;
    });

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

/**
 * 偽英語・発話カルテDBから、今回のストーリーに自然に応用すべき文法・語法パターンを選定
 */
export function pickTargetErrorPatternsForStory(
  errorList: ExpressionErrorItem[],
  count: number = 2
): { corePattern: string; naturalExpression: string; explanation: string }[] {
  if (!errorList || errorList.length === 0) return [];

  // ストーリー強化回数が少ないもの ➔ 作成日が新しい順
  const sorted = [...errorList].sort((a, b) => {
    if (a.storyReinforcedCount !== b.storyReinforcedCount) {
      return a.storyReinforcedCount - b.storyReinforcedCount;
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return sorted.slice(0, count).map(e => ({
    corePattern: e.corePattern,
    naturalExpression: e.naturalExpression,
    explanation: e.explanation,
  }));
}

export function extractRecentSummaries(stories: Story[], limit: number = 4): string[] {
  return stories
    .slice(0, limit)
    .map(s => `• 「${s.title}」: ${s.summary}`)
    .filter(Boolean);
}
