import { CefrLevel } from './settings';

export type LabBottleneckType =
  | 'memory_overflow'    // ワーキングメモリ（文長）パンク
  | 'backward_parsing'   // 関係詞・前置詞での返り読み癖
  | 'phonetic_linking'   // 音声変化・脱落・連結
  | 'unknown_vocab'      // 未知語・多義語
  | 'perfect';           // 完全理解

export interface LabQuestion {
  id: string;
  sentenceEn: string;
  translationJa: string;
  wordCount: number;
  words: string[];
  cefrLevel: CefrLevel;
  keyPoints?: string;
}

export interface LabDiagnosisResult {
  comprehensionRate: number; // 0 - 100
  understood: string;        // 聞き取れていた部分
  missed: string;            // 脱落・聞き取れなかった部分
  bottleneckType: LabBottleneckType;
  bottleneckLabel: string;
  diagnosis: string;         // AIの詳細解説
  coachingTip: string;       // 次回へのアドバイス
}

export interface LabQuestionRecord {
  id: string;
  timestamp: string;
  dateString: string;
  sentenceEn: string;
  translationJa: string;
  wordCount: number;
  speedWpm: number;
  cefrLevel: CefrLevel;
  userResponse: string;
  diagnosis: LabDiagnosisResult;
}

export interface BandwidthCell {
  attempts: number;
  avgScore: number;
  latestScore: number;
}

// [wordCount: string][speedWpm: string] -> BandwidthCell
export type BandwidthMatrixData = Record<number, Record<number, BandwidthCell>>;

export interface LabAnalyticsSummary {
  totalQuestions: number;
  avgComprehension: number;
  bottleneckCounts: Record<LabBottleneckType, number>;
  matrix: BandwidthMatrixData;
  recentRecords: LabQuestionRecord[];
}
