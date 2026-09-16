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
  targetTokens: string[];
}

export interface PatternMasterItem {
  id: string;
  cefr: CefrLevel;
  category: PatternCategory;
  categoryLabel: string;
  name: string;
  meaning: string;
  focus: string;
  variations: [PatternVariation, PatternVariation, PatternVariation];
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
  status?: MasteryStatus;
  comprehensionStatus?: MasteryStatus;
  comprehensionMasteredAt?: string;
  assemblyStatus?: MasteryStatus;
  assemblyMasteredAt?: string;

  encounterCount?: number;
  mistakeCount?: number;
  comprehensionMistakeCount?: number;
  assemblyMistakeCount?: number;
  consecutiveCorrectCount?: number;

  drillComprehensionAttempts?: number;
  drillComprehensionSuccesses?: number;
  drillAssemblyAttempts?: number;
  drillAssemblySuccesses?: number;

  firstSeenAt?: string;
  lastSeenAt?: string;
  masteredAt?: string;
  lastMistakeAt?: string;
  lastErrorReason?: string;
  currentVariationIndex?: number;
}

export interface UserMasteryState {
  patterns: Record<string, ItemProgress>;
  vocabs: Record<string, ItemProgress>;
  lastUpdatedAt: string;
}

export interface LevelProgressSummary {
  vocabTotal: number;
  vocabMastered: number;
  vocabAssemblyMastered?: number;
  vocabLapsed: number;
  vocabExposed: number;
  vocabUnseen: number;
  vocabPct: number;
  vocabAssemblyPct?: number;

  patternTotal: number;
  patternMastered: number;
  patternAssemblyMastered?: number;
  patternLapsed: number;
  patternExposed: number;
  patternUnseen: number;
  patternPct: number;
  patternAssemblyPct?: number;

  overallPct: number;
  overallAssemblyPct?: number;
}

export interface DailySnapshot {
  date: string;
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
  completedAt: string;
  dateString: string;
  wordsCount: number;
  wpm: number;
}

export interface DrillAttemptLog {
  id: string;
  timestamp: string;
  dateString: string;
  itemId: string;
  itemType: 'pattern' | 'vocab';
  drillType: 'comprehension' | 'assembly';
  cefr: CefrLevel;
  result: 'correct' | 'alternative_hint' | 'wrong';
  userResponse: string;
  feedback?: string;
  correctedSentence?: string;
  errorReason?: string;
}

export interface CategoryWeaknessSummary {
  category: PatternCategory;
  categoryLabel: string;
  totalCount: number;
  comprehensionMasteredCount: number;
  assemblyMasteredCount: number;
  mistakeCount: number;
  accuracyRate: number;
}

export interface WeakPatternItem {
  pattern: PatternMasterItem;
  progress: ItemProgress;
  mistakeCount: number;
  lastErrorReason?: string;
}
