import { VocabItem } from '../types/vocab';
import { Story } from '../types/story';

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
 *
 * 1. Again (もう一度 / 忘れた):
 *    - Ease Factor: -0.20 (下限 1.3)
 *    - 間隔: 1日 (Lapseリセット)
 *    - repetitionCount: 0, lapseCount: +1
 *
 * 2. Hard (難しい / 苦戦):
 *    - Ease Factor: -0.15 (下限 1.3)
 *    - 間隔: 前回間隔 * 1.2 (最低+1日) / 新規時は1日
 *    - repetitionCount: +1
 *
 * 3. Good (普通 / 正解):
 *    - Ease Factor: 変動なし
 *    - 間隔:
 *        repetitionCount 0 -> 1日
 *        repetitionCount 1 -> 6日 (Anki標準のGraduating step)
 *        repetitionCount >= 2 -> 前回間隔 * EaseFactor
 *    - repetitionCount: +1
 *
 * 4. Easy (簡単 / 余裕):
 *    - Ease Factor: +0.15
 *    - 間隔:
 *        repetitionCount 0 -> 4日 (Anki標準のEasy interval初期値)
 *        repetitionCount 1 -> round(6 * EaseFactor * 1.3) (約20日)
 *        repetitionCount >= 2 -> round(前回間隔 * EaseFactor * 1.3)
 *    - repetitionCount: +1
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
  return {
    again: formatIntervalDays(calculateAnkiSRS(item, 'again').intervalDays),
    hard: formatIntervalDays(calculateAnkiSRS(item, 'hard').intervalDays),
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
 * 【重要度優先ルール】:
 * 1. 日常会話における重要度 (importance 5 -> 1) が高いものを最優先
 * 2. 忘却タップ回数 (lapseCount) が多いもの
 * 3. 復習期日 (due) または未定着のもの
 */
export function pickTargetVocabsForStory(vocabList: VocabItem[], count: number = 4): string[] {
  if (!vocabList || vocabList.length === 0) return [];

  const today = getTodayDateString();

  const dueItems = vocabList.filter(v => v.nextReviewDate <= today);
  
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
    const remaining = vocabList.filter(v => !selectedItems.some(s => s.id === v.id));
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

export function extractRecentSummaries(stories: Story[], limit: number = 4): string[] {
  return stories
    .slice(0, limit)
    .map(s => `• 「${s.title}」: ${s.summary}`)
    .filter(Boolean);
}
