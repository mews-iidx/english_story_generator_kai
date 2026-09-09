import { VocabLookupResult } from './vocab';
import { CefrLevel } from './settings';

export type ContentType = 'story' | 'podcast' | 'dialogue';

export interface Story {
  id: string;
  title: string;
  titleJa: string;
  summary: string;
  storyContent: string;
  japaneseTranslation: string;
  targetVocabList: string[];
  vocabList?: VocabLookupResult[];
  userPrompt?: string;
  cefrLevel: CefrLevel;
  contentType?: ContentType; // story: ショートストーリー, podcast: 1人語りエッセイ, dialogue: 会話劇
  genres?: string[]; // ジャンルタグ
  targetWordCount?: number;
  actualWordCount?: number; // 実際の単語数
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
}