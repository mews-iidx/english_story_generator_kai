import { VocabLookupResult } from './vocab';
import { CefrLevel } from './settings';

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
  createdAt: string;
}

export interface StoryGenerationResponse {
  title: string;
  title_ja: string;
  summary: string;
  story: string;
  japanese_translation: string;
  target_vocab_used: string[];
  vocabulary_list?: VocabLookupResult[];
}