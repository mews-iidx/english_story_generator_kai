export interface PersonaMemory {
  likes: string[];              // 好きなもの・趣味
  dislikes: string[];           // 嫌い・苦手なもの
  recentTopics: {
    date: string;
    topic: string;
    summary: string;
  }[];                          // 過去に話したトピックと要約
  userNotes: string[];          // ユーザーについて覚えていること（例: 「ユーザーは東京在住でプログラマー」）
  promisesOrFutureTasks?: string[]; // 次回までの約束や話題（例: 「次回までに映画を見るかも」）
}

export interface Persona {
  id: string;
  name: string;
  avatarEmoji: string;
  nationality: string;
  nativeLanguage: string;
  age: number;
  occupation: string;
  personality: string;          // 性格・口調（例: 「明るくフレンドリー、スラング多め」）
  interests: string[];          // 興味・関心
  cefrLevel: string;            // 推奨レベル（例: "A2", "B1"）
  voiceName?: string;           // Gemini Live でのボイスタイプ (Puck, Charon, Aoede, Fenrir, Kore)
  systemPromptAddon?: string;   // 特別な背景設定
  memory: PersonaMemory;        // 動的記憶
  lastSpokenAt?: string;        // ISO timestamp
  totalConversations: number;
  isPreset?: boolean;           // プリセットキャラクターか
  createdAt: string;
}

export interface CallMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

export interface ExtractedCallVocab {
  phrase: string;
  meaning: string;
  contextSentence?: string;
  nuanceNote?: string;
}

export interface CallSession {
  id: string;
  personaId?: string;           // undefined の場合はフリー会話
  personaName?: string;
  sessionType?: 'voice' | 'chat'; // 'voice' (音声通話) または 'chat' (テキストチャット)
  startedAt: string;
  endedAt?: string;
  durationSeconds: number;
  messages: CallMessage[];
  extractedVocabs: ExtractedCallVocab[];
  recapSummary?: string;
  newLearnedFacts?: string[];   // ペルソナについて新しく判明した事実
}
