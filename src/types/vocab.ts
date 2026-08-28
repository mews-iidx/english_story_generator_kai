export interface VocabLookupResult {
  phrase: string;
  meaning: string;
  part_of_speech: string;
  explanation: string;
  context_sentence?: string;
}

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
}

export type VocabFilterStatus = 'all' | 'due' | 'learning' | 'mastered';