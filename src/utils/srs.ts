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

  // 1. 直近の話（最大5話分）で使われた単語を、使用された新しさ順（0 = 最も直近）に記録
  const recencyMap = new Map<string, number>();
  recentStories.slice(0, 5).forEach((s, storyIdx) => {
    (s.targetVocabList || []).forEach(v => {
      const clean = v
        .replace(/\s*\([^)]*\)/g, '')
        .replace(/[:：].*$/, '')
        .trim()
        .toLowerCase();
      if (!recencyMap.has(clean)) {
        recencyMap.set(clean, storyIdx);
      }
    });
  });

  // 2. 単語のスコアリング（未定着・復習期日・高重要度・高Lapseを優先）
  const getVocabScore = (item: VocabItem): number => {
    let score = 0;
    const isDue = item.nextReviewDate <= today;
    if (isDue) score += 100; // 今日の復習期日
    if ((item.repetitionCount ?? 0) < 3) score += 50; // 未定着
    score += (item.importance ?? 3) * 20; // 重要度 (1..5 -> 20..100)
    score += (item.lapseCount ?? 0) * 15; // 忘れやすい単語
    return score;
  };

  // 全語彙をスコア降順にソート
  const sortedVocabs = [...vocabList].sort((a, b) => {
    const scoreA = getVocabScore(a);
    const scoreB = getVocabScore(b);
    if (scoreB !== scoreA) return scoreB - scoreA;
    return new Date(a.lastReviewedAt || 0).getTime() - new Date(b.lastReviewedAt || 0).getTime();
  });

  // 3. クールダウン（直近使用済み）単語と新鮮（未使用）単語に分類
  const freshItems: VocabItem[] = [];
  const usedItems: { item: VocabItem; recency: number }[] = [];

  sortedVocabs.forEach(v => {
    const key = v.phrase.trim().toLowerCase();
    if (recencyMap.has(key)) {
      usedItems.push({ item: v, recency: recencyMap.get(key)! });
    } else {
      freshItems.push(v);
    }
  });

  // 使用済みアイテムは「最も昔に使われた順（recency大）」➔「優先度スコア高い順」でソート
  usedItems.sort((a, b) => {
    if (b.recency !== a.recency) return b.recency - a.recency;
    return getVocabScore(b.item) - getVocabScore(a.item);
  });

  // 4. 候補の選定（1日2〜3話生成してもプールの上位から順に重複なく4単語ずつ消化）
  const selected: VocabItem[] = [];

  // まず新鮮な高優先度単語から順に枠を埋める (例: 1回目=上位1..4, 2回目=5..8, 3回目=9..12)
  for (const item of freshItems) {
    if (selected.length >= count) break;
    selected.push(item);
  }

  // 新鮮な単語だけでは count に満たない場合、最も昔に使われた単語から補充
  if (selected.length < count) {
    for (const { item } of usedItems) {
      if (selected.length >= count) break;
      if (!selected.some(s => s.id === item.id)) {
        selected.push(item);
      }
    }
  }

  // 5. Geminiプロンプト用フォーマットに整形して返却
  return selected.map(item => {
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
