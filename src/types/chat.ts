export interface ChatSuggestedVocab {
  phrase: string;
  meaning: string;
}

export interface SuggestedSentence {
  english: string;
  japanese: string;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  suggestedVocabs?: ChatSuggestedVocab[]; // AIが回答から抽出した登録推奨語彙
  suggestedSentences?: SuggestedSentence[]; // AIが回答から抽出した登録推奨英文・フレーズ
  createdAt: string;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}
