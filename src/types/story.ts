import { VocabLookupResult } from './vocab';
import { CefrLevel } from './settings';

export type ContentType = 'story' | 'podcast' | 'dialogue';
export type SeriesType = 'single' | 'continuous' | 'omnibus' | 'trilogy';

export interface TargetEmbedding {
  targetId: string; // pattern ID (e.g. pat_b1_001) or vocab ID
  type: 'pattern' | 'vocab';
  targetName: string; // e.g. "too [形容詞] to [動詞]" or "reluctant"
  sentenceIndex?: number;
  textSpan?: string; // e.g. "too tired to drive"
  translation?: string; // e.g. "疲れすぎて運転できなかった"
  focusPoint?: string; // e.g. "〜すぎて…できない"
}

export interface StoryListeningUnitLog {
  unitIdx: number;
  textEn: string;
  translationJa: string;
  retryCount: number;
  elapsedMs: number;
  revealedEnglish: boolean;
  revealedJapanese: boolean;
}

export interface StoryListeningMetrics {
  totalChunks: number;
  avgChunkLatencyMs: number;
  totalSentenceLatencyMs: number;
  effectiveListeningWpm?: number; // 実効リスニングWPM (語数 / 所要時間 * 60)
  firstPassRate?: number; // 一発パス率 (0 - 100%)
  totalRetries?: number;
  bottleneckCount?: number;
  unitLogs?: StoryListeningUnitLog[];
  completedAt: string;
}

export interface Story {
  id: string;
  title: string;
  titleJa: string;
  summary: string;
  storyContent: string;
  japaneseTranslation: string;
  targetVocabList: string[];
  vocabList?: VocabLookupResult[];
  targetEmbeddings?: TargetEmbedding[];
  seriesId?: string; // 連載・オムニバスのグループID
  episodeIndex?: number; // 1, 2, 3, 4, 5...
  totalEpisodes?: number; // 1, 2, 3, 4, 5...
  seriesType?: SeriesType;
  isContinuous?: boolean;
  userPrompt?: string;
  cefrLevel: CefrLevel;
  contentType?: ContentType; // story: ショートストーリー, podcast: 1人語りエッセイ, dialogue: 会話劇
  genres?: string[]; // ジャンルタグ
  targetWordCount?: number;
  actualWordCount?: number; // 実際の単語数
  
  // 2-Stage Lifecycle & Listening Metrics
  listeningStatus?: 'unstarted' | 'completed';
  listeningCompletedAt?: string;
  listeningMetrics?: StoryListeningMetrics;
  readingStatus?: 'unstarted' | 'completed';
  firstReadWpm?: number;

  isRead?: boolean; // 読了済みフラグ
  readAt?: string; // 読了日時 (ISO timestamp)
  readCount?: number; // 読了回数
  wpm?: number; // 読書速度 (Words Per Minute)
  createdAt: string;
}

export interface StoryGenerationResponse {
  title: string;
  title_ja: string;
  summary: string;
  story: string;
  japanese_translation: string;
  target_vocab_used: string[];
  genres?: string[];
  vocabulary_list?: VocabLookupResult[];
  target_embeddings?: TargetEmbedding[];
}
