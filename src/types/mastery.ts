import { CefrLevel } from './settings';

export type PatternCategory =
  | 'basic_syntax'
  | 'infinitives_gerunds'
  | 'tenses_aspects'
  | 'modals'
  | 'questions_negatives'
  | 'coordination'
  | 'correlative'
  | 'relative_clauses'
  | 'participles'
  | 'comparatives'
  | 'conditionals'
  | 'inversion_emphasis'
  | 'causative_passive'
  | 'adjectives_adverbs'
  | 'nouns_pronouns'
  | 'prepositions'
  | 'determiners'
  | 'reported_speech';

export interface PatternVariation {
  sentence: string;
  translation: string;
  targetTokens: string[]; // 穴埋め・強調箇所のトークン (例: ["too", "to"])
}

export interface PatternMasterItem {
  id: string;
  cefr: CefrLevel;
  category: PatternCategory;
  categoryLabel: string;
  name: string;
  meaning: string;
  focus: string;
  variations: [PatternVariation, PatternVariation, PatternVariation]; // 厳選された3文
}

export interface VocabMasterItem {
  id: string;
  phrase: string;
  meaning: string;
  cefr: CefrLevel;
  partOfSpeech: string;
}

export type MasteryStatus = 'unseen' | 'exposed' | 'lapsed' | 'mastered';

export interface ItemProgress {
  status: MasteryStatus;
  firstSeenAt?: string;
  lastSeenAt?: string;
  encounterCount: number;
  masteredAt?: string;
  currentVariationIndex?: number; // Anki出題時の3文ローテーション用 (0, 1, 2)
}

export interface UserMasteryState {
  patterns: Record<string, ItemProgress>;
  vocabs: Record<string, ItemProgress>;
  lastUpdatedAt: string;
}

export interface LevelProgressSummary {
  vocabTotal: number;
  vocabMastered: number;
  vocabLapsed: number;
  vocabExposed: number;
  vocabUnseen: number;
  vocabPct: number;

  patternTotal: number;
  patternMastered: number;
  patternLapsed: number;
  patternExposed: number;
  patternUnseen: number;
  patternPct: number;

  overallPct: number;
}

export interface DailySnapshot {
  date: string; // YYYY-MM-DD
  a1Progress: LevelProgressSummary;
  a2Progress: LevelProgressSummary;
  b1Progress: LevelProgressSummary;
  b2Progress: LevelProgressSummary;
  wordsRead: number;
  averageWpm: number;
  newMasteredPatternsCount: number;
  newMasteredVocabsCount: number;
}

export interface MyGoal {
  targetCefr: CefrLevel;
  targetDays: number;
  startDate: string;
  targetDate: string;
  isActive: boolean;
}

export interface ReadingSessionLog {
  id: string;
  storyId?: string;
  storyTitle: string;
  completedAt: string; // ISO string
  dateString: string;  // YYYY-MM-DD
  wordsCount: number;
  wpm: number;
}
