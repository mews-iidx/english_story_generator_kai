export interface ChatSuggestedVocab {
  phrase: string;
  meaning: string;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  suggestedVocabs?: ChatSuggestedVocab[]; // AIが回答から抽出した登録推奨語彙
  createdAt: string;
}