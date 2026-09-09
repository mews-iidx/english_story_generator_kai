export interface VocabLookupResult {
  phrase: string;
  meaning: string;
  part_of_speech: string;
  explanation: string;
  context_sentence?: string;
}

export type CardState = 'new' | 'learning' | 'review' | 'relearning';

export interface VocabItem {
  id: string;
  phrase: string;
  meaning: string;
  partOfSpeech: string;
  contextNote: string;
  exampleSentence: string;
  lapseCount: number;         // 忘れてタップした回数
  repetitionCount: number;    // 正解・定着カウント
  intervalDays: number;       // 次回復習までの間隔日数
  nextReviewDate: string;     // YYYY-MM-DD
  lastReviewedAt: string;     // ISO timestamp
  createdAt: string;          // ISO timestamp
  sourceStoryId?: string;     // どのストーリー由来か
  importance?: number;        // 重要度スコア: 1〜5 (5が最重要・日常英会話必須)
  easeFactor?: number;        // Anki Ease Factor (初期値 2.5, 最小 1.3)
  
  // 本家Anki Learning/Relearning ステップ永続化フィールド
  cardState?: CardState;      // 'new' | 'learning' | 'review' | 'relearning'
  learningStep?: number;      // 0 (Step 1: 1分), 1 (Step 2: 10分)
  dueTimestamp?: number | null; // 当日内再出題のミリ秒タイムスタンプ
}

export type VocabFilterStatus = 'all' | 'due' | 'learning' | 'mastered';
