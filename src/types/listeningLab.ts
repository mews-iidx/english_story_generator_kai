import { CefrLevel } from './settings';

export type LabBottleneckType =
  | 'phonetic_linking'   // 音声変化・脱落・連結
  | 'unknown_vocab'      // 未知語・多義語
  | 'backward_parsing'   // 構文・語順処理
  | 'memory_overflow'    // ワーキングメモリパンク
  | 'perfect';           // 完全理解

export interface LabChunk {
  text: string;
  translationJa: string;
  boundaryReason: string;
}

export interface LabQuestion {
  id: string;
  sentenceEn: string;
  translationJa: string;
  wordCount: number;
  words: string[];
  chunks?: LabChunk[];
  cefrLevel: CefrLevel;
  keyPoints?: string;
  englishExplanation?: string;
  phoneticPoints?: string;
}

export interface LabDiagnosisResult {
  comprehensionRate: number; // 0 - 100
  understood?: string;
  missed?: string;
  bottleneckType: LabBottleneckType;
  bottleneckLabel: string;
  diagnosis?: string;
  coachingTip?: string;
}

export interface LabQuestionRecord {
  id: string;
  sessionId?: string;
  timestamp: string;
  dateString: string;
  sentenceEn: string;
  translationJa: string;
  wordCount: number;
  speedRate: number;        // 0.8, 0.9, 1.0, 1.1, 1.2
  speedWpm?: number;        // legacy compatibility
  cefrLevel: CefrLevel;
  markedTokens: string[];   // 聞き取れずマークした単語
  isPerfect: boolean;       // マーク0で完全突破したか
  savedToAnki?: boolean;
  ankiCardId?: string;
  diagnosis?: LabDiagnosisResult;
}

export interface WordCountStat {
  wordCount: number;
  attempts: number;
  perfectCount: number;
  passRate: number; // 0 - 100
}

export interface LabAnalyticsSummary {
  totalQuestions: number;
  perfectCount: number;
  perfectPassRate: number; // 0 - 100
  movingAverageWordCapacity: number; // 直近の単語処理能力移動平均 (例: 12.4語)
  wordCountStats: Record<number, WordCountStat>;
  recentRecords: LabQuestionRecord[];
}
