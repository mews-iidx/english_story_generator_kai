import { VocabItem, VocabLookupResult } from '../types/vocab';
import { DifficultSentenceItem, DifficultyReasonCategory } from '../types/sentence';
import { Story } from '../types/story';
import { AppSettings, DEFAULT_SETTINGS, TokenStats } from '../types/settings';
import { ChatMessage } from '../types/chat';
import { Persona, CallSession } from '../types/persona';
import { calculateLapseSRS, calculateSuccessSRS, addDaysToDate } from '../utils/srs';

const STORAGE_KEYS = {
  SETTINGS: 'storykai_settings_v1',
  STORIES: 'storykai_stories_v1',
  VOCABS: 'storykai_vocabs_v1',
  DIFFICULT_SENTENCES: 'storykai_difficult_sentences_v1',
  CHAT_MESSAGES: 'storykai_chat_messages_v1',
  PERSONAS: 'storykai_personas_v1',
  CALL_SESSIONS: 'storykai_call_sessions_v1',
};

// ===================== SETTINGS =====================
export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed: AppSettings = { 
      ...DEFAULT_SETTINGS, 
      ...JSON.parse(raw),
      tokenStats: {
        ...DEFAULT_SETTINGS.tokenStats,
        ...(JSON.parse(raw).tokenStats || {})
      }
    };
    if (!parsed.geminiModel || parsed.geminiModel.startsWith('gemini-2.') || parsed.geminiModel.startsWith('gemini-1.')) {
      parsed.geminiModel = 'gemini-3.7-flash';
      saveSettings(parsed);
    }
    return parsed;
  } catch (e) {
    console.error('Failed to load settings from localStorage', e);
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save settings to localStorage', e);
  }
}

export function addTokenUsage(promptTokens: number, candidatesTokens: number): TokenStats {
  const current = loadSettings();
  const updatedStats: TokenStats = {
    totalPromptTokens: current.tokenStats.totalPromptTokens + (promptTokens || 0),
    totalCandidatesTokens: current.tokenStats.totalCandidatesTokens + (candidatesTokens || 0),
    totalTokens: current.tokenStats.totalTokens + (promptTokens || 0) + (candidatesTokens || 0),
    totalGenerations: current.tokenStats.totalGenerations + 1,
  };
  const updatedSettings: AppSettings = {
    ...current,
    tokenStats: updatedStats,
  };
  saveSettings(updatedSettings);
  return updatedStats;
}

// ===================== STORIES =====================
export function loadStories(): Story[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.STORIES);
    if (!raw) return [];
    const stories: Story[] = JSON.parse(raw);
    return stories.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch (e) {
    console.error('Failed to load stories', e);
    return [];
  }
}

export function saveStory(story: Story): void {
  try {
    const existing = loadStories();
    const filtered = existing.filter(s => s.id !== story.id);
    const updated = [story, ...filtered];
    localStorage.setItem(STORAGE_KEYS.STORIES, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to save story', e);
  }
}

export function deleteStory(storyId: string): void {
  try {
    const existing = loadStories();
    const updated = existing.filter(s => s.id !== storyId);
    localStorage.setItem(STORAGE_KEYS.STORIES, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to delete story', e);
  }
}

export function recordStoryRead(storyId: string, wpm?: number): Story | null {
  const stories = loadStories();
  const index = stories.findIndex(s => s.id === storyId);
  if (index >= 0) {
    const story = stories[index];
    const updatedStory: Story = {
      ...story,
      isRead: true,
      readAt: new Date().toISOString(),
      readCount: (story.readCount || 0) + 1,
      wpm: wpm || story.wpm,
    };
    stories[index] = updatedStory;
    localStorage.setItem(STORAGE_KEYS.STORIES, JSON.stringify(stories));
    return updatedStory;
  }
  return null;
}

// ===================== VOCABULARIES =====================
export function loadVocabs(): VocabItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.VOCABS);
    if (!raw) return [];
    const vocabs: VocabItem[] = JSON.parse(raw);
    return vocabs.sort((a, b) => new Date(b.lastReviewedAt).getTime() - new Date(a.lastReviewedAt).getTime());
  } catch (e) {
    console.error('Failed to load vocabs', e);
    return [];
  }
}

export function saveVocabsBatch(vocabs: VocabItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.VOCABS, JSON.stringify(vocabs));
  } catch (e) {
    console.error('Failed to save vocabs batch', e);
  }
}

export const isInvalidVocabMeaning = (m?: string): boolean => {
  if (!m) return true;
  const trimmed = m.trim();
  return (
    trimmed === '' ||
    trimmed === '要復習' ||
    trimmed === '要確認' ||
    trimmed === '（意味未設定）' ||
    trimmed === '（翻訳取得失敗）'
  );
};

export function recordVocabLapse(
  lookup: VocabLookupResult,
  sourceStoryId?: string
): VocabItem {
  const vocabs = loadVocabs();
  const normalizedPhrase = lookup.phrase.trim().toLowerCase();
  const existingIndex = vocabs.findIndex(v => v.phrase.toLowerCase() === normalizedPhrase);

  let updatedItem: VocabItem;

  if (existingIndex >= 0) {
    const existing = vocabs[existingIndex];
    const srs = calculateLapseSRS(existing);
    // 有効な訳のみ更新。'要復習'などのステータス文字列で既存の日本語訳を上書きしない
    let finalMeaning = existing.meaning;
    if (!isInvalidVocabMeaning(lookup.meaning)) {
      finalMeaning = lookup.meaning.trim();
    }

    updatedItem = {
      ...existing,
      meaning: finalMeaning,
      partOfSpeech: lookup.part_of_speech || existing.partOfSpeech,
      contextNote: lookup.explanation || existing.contextNote,
      exampleSentence: lookup.context_sentence || existing.exampleSentence,
      ...srs,
      sourceStoryId: sourceStoryId || existing.sourceStoryId,
    };
    vocabs[existingIndex] = updatedItem;
  } else {
    const srs = calculateLapseSRS();
    const meaning = !isInvalidVocabMeaning(lookup.meaning) ? lookup.meaning.trim() : '';
    updatedItem = {
      id: 'voc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      phrase: lookup.phrase.trim(),
      meaning,
      partOfSpeech: lookup.part_of_speech || 'word/phrase',
      contextNote: lookup.explanation || '',
      exampleSentence: lookup.context_sentence || '',
      ...srs,
      importance: undefined,
      createdAt: new Date().toISOString(),
      sourceStoryId,
    };
    vocabs.unshift(updatedItem);
  }

  saveVocabsBatch(vocabs);
  return updatedItem;
}

export function updateVocabMeaning(vocabId: string, meaning: string): void {
  const vocabs = loadVocabs();
  const index = vocabs.findIndex(v => v.id === vocabId);
  if (index >= 0) {
    vocabs[index] = {
      ...vocabs[index],
      meaning: meaning.trim(),
    };
    saveVocabsBatch(vocabs);
  }
}

export function recordVocabMastered(vocabId: string): void {
  const vocabs = loadVocabs();
  const index = vocabs.findIndex(v => v.id === vocabId);
  if (index >= 0) {
    const item = vocabs[index];
    const srs = calculateSuccessSRS(item);
    vocabs[index] = {
      ...item,
      ...srs,
    };
    saveVocabsBatch(vocabs);
  }
}

export function deleteVocab(vocabId: string): void {
  const vocabs = loadVocabs();
  const updated = vocabs.filter(v => v.id !== vocabId);
  saveVocabsBatch(updated);
}

export function updateVocabImportance(vocabId: string, importance: number): void {
  const vocabs = loadVocabs();
  const index = vocabs.findIndex(v => v.id === vocabId);
  if (index >= 0) {
    vocabs[index] = {
      ...vocabs[index],
      importance: Math.max(1, Math.min(5, importance)),
    };
    saveVocabsBatch(vocabs);
  }
}

export function batchUpdateVocabImportance(updates: { id: string; importance: number }[]): void {
  const vocabs = loadVocabs();
  const map = new Map(updates.map(u => [u.id, u.importance]));
  let changed = false;

  const updated = vocabs.map(v => {
    if (map.has(v.id)) {
      changed = true;
      return {
        ...v,
        importance: Math.max(1, Math.min(5, map.get(v.id)!)),
      };
    }
    return v;
  });

  if (changed) {
    saveVocabsBatch(updated);
  }
}

// Anki 4段階評価 (again, hard, good, easy)
export function recordAnkiRating(
  vocabId: string,
  rating: 'again' | 'hard' | 'good' | 'easy'
): VocabItem | null {
  const vocabs = loadVocabs();
  const index = vocabs.findIndex(v => v.id === vocabId);
  if (index < 0) return null;

  const item = vocabs[index];
  const now = new Date().toISOString();
  let updated: VocabItem;

  if (rating === 'again') {
    updated = {
      ...item,
      lapseCount: item.lapseCount + 1,
      repetitionCount: 0,
      intervalDays: 1,
      nextReviewDate: addDaysToDate(1),
      lastReviewedAt: now,
    };
  } else if (rating === 'hard') {
    const nextInterval = Math.max(1, Math.round(item.intervalDays * 1.2));
    updated = {
      ...item,
      repetitionCount: Math.max(1, item.repetitionCount),
      intervalDays: nextInterval,
      nextReviewDate: addDaysToDate(nextInterval),
      lastReviewedAt: now,
    };
  } else if (rating === 'good') {
    const intervals = [1, 3, 7, 14, 30, 60, 120];
    const nextRep = item.repetitionCount + 1;
    const nextInterval = intervals[Math.min(nextRep, intervals.length - 1)];
    updated = {
      ...item,
      repetitionCount: nextRep,
      intervalDays: nextInterval,
      nextReviewDate: addDaysToDate(nextInterval),
      lastReviewedAt: now,
    };
  } else {
    // easy
    const intervals = [3, 7, 14, 30, 60, 120, 240];
    const nextRep = item.repetitionCount + 2;
    const nextInterval = intervals[Math.min(nextRep, intervals.length - 1)];
    updated = {
      ...item,
      repetitionCount: nextRep,
      intervalDays: nextInterval,
      nextReviewDate: addDaysToDate(nextInterval),
      lastReviewedAt: now,
    };
  }

  vocabs[index] = updated;
  saveVocabsBatch(vocabs);
  return updated;
}

// ===================== DIFFICULT SENTENCES (訳せなかった文章リスト) =====================
export function loadDifficultSentences(): DifficultSentenceItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DIFFICULT_SENTENCES);
    if (!raw) return [];
    const sentences: DifficultSentenceItem[] = JSON.parse(raw);
    return sentences.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch (e) {
    console.error('Failed to load difficult sentences', e);
    return [];
  }
}

export function saveDifficultSentence(
  item: Omit<DifficultSentenceItem, 'id' | 'createdAt'>
): DifficultSentenceItem {
  const list = loadDifficultSentences();
  const newItem: DifficultSentenceItem = {
    ...item,
    id: 'sen_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    createdAt: new Date().toISOString(),
  };

  const filtered = list.filter(s => s.sentence.trim() !== item.sentence.trim());
  const updated = [newItem, ...filtered];

  try {
    localStorage.setItem(STORAGE_KEYS.DIFFICULT_SENTENCES, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to save difficult sentence', e);
  }

  return newItem;
}

export function updateDifficultSentenceReason(
  id: string,
  reasonCategory: DifficultyReasonCategory,
  reasonNote: string
): void {
  const list = loadDifficultSentences();
  const index = list.findIndex(s => s.id === id);
  if (index >= 0) {
    list[index] = {
      ...list[index],
      reasonCategory,
      reasonNote,
    };
    try {
      localStorage.setItem(STORAGE_KEYS.DIFFICULT_SENTENCES, JSON.stringify(list));
    } catch (e) {
      console.error('Failed to update difficult sentence reason', e);
    }
  }
}

export function deleteDifficultSentence(id: string): void {
  const list = loadDifficultSentences();
  const updated = list.filter(s => s.id !== id);
  try {
    localStorage.setItem(STORAGE_KEYS.DIFFICULT_SENTENCES, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to delete difficult sentence', e);
  }
}

// ===================== CHAT MESSAGES (AIメンターチャット) =====================
export function loadChatMessages(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CHAT_MESSAGES);
    if (!raw) {
      return [
        {
          id: 'welcome_msg',
          sender: 'assistant',
          text: 'こんにちは！AI英語メンターのCompileEngです。⚡\n「〜は英語で何と言う？」「このニュアンスの違いは？」「この文法の意味は？」など、疑問に思ったことを何でも質問してください。回答からワンタップで語彙帳やAnkiに登録できます！',
          createdAt: new Date().toISOString(),
        }
      ];
    }
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to load chat messages', e);
    return [];
  }
}

export function saveChatMessage(msg: ChatMessage): void {
  try {
    const list = loadChatMessages();
    const updated = [...list, msg];
    localStorage.setItem(STORAGE_KEYS.CHAT_MESSAGES, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to save chat message', e);
  }
}

export function clearChatMessages(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.CHAT_MESSAGES);
  } catch (e) {
    console.error('Failed to clear chat messages', e);
  }
}

// ===================== RESET ALL DATA =====================
export function resetAllData(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.STORIES);
    localStorage.removeItem(STORAGE_KEYS.VOCABS);
    localStorage.removeItem(STORAGE_KEYS.DIFFICULT_SENTENCES);
    localStorage.removeItem(STORAGE_KEYS.CHAT_MESSAGES);
    const s = loadSettings();
    saveSettings({
      ...s,
      tokenStats: {
        totalPromptTokens: 0,
        totalCandidatesTokens: 0,
        totalTokens: 0,
        totalGenerations: 0,
      }
    });
  } catch (e) {
    console.error('Failed to reset data', e);
  }
}

// ===================== EXPORT / IMPORT =====================
export interface ExportData {
  version: string;
  exportedAt: string;
  stories: Story[];
  vocabs: VocabItem[];
  difficultSentences?: DifficultSentenceItem[];
  chatMessages?: ChatMessage[];
  settings: Partial<AppSettings>;
}

export function exportAllData(): string {
  const data: ExportData & { personas?: Persona[]; callSessions?: CallSession[] } = {
    version: '1.3.0',
    exportedAt: new Date().toISOString(),
    stories: loadStories(),
    vocabs: loadVocabs(),
    difficultSentences: loadDifficultSentences(),
    chatMessages: loadChatMessages(),
    personas: loadPersonas(),
    callSessions: loadCallSessions(),
    settings: {
      cefrLevel: loadSettings().cefrLevel,
      geminiModel: loadSettings().geminiModel,
    },
  };
  return JSON.stringify(data, null, 2);
}

export function importAllData(jsonStr: string): { success: boolean; storyCount: number; vocabCount: number; sentenceCount: number } {
  try {
    const data: ExportData & { personas?: Persona[]; callSessions?: CallSession[] } = JSON.parse(jsonStr);
    if (data.stories && Array.isArray(data.stories)) {
      localStorage.setItem(STORAGE_KEYS.STORIES, JSON.stringify(data.stories));
    }
    if (data.vocabs && Array.isArray(data.vocabs)) {
      localStorage.setItem(STORAGE_KEYS.VOCABS, JSON.stringify(data.vocabs));
    }
    if (data.difficultSentences && Array.isArray(data.difficultSentences)) {
      localStorage.setItem(STORAGE_KEYS.DIFFICULT_SENTENCES, JSON.stringify(data.difficultSentences));
    }
    if (data.chatMessages && Array.isArray(data.chatMessages)) {
      localStorage.setItem(STORAGE_KEYS.CHAT_MESSAGES, JSON.stringify(data.chatMessages));
    }
    if (data.personas && Array.isArray(data.personas)) {
      localStorage.setItem(STORAGE_KEYS.PERSONAS, JSON.stringify(data.personas));
    }
    if (data.callSessions && Array.isArray(data.callSessions)) {
      localStorage.setItem(STORAGE_KEYS.CALL_SESSIONS, JSON.stringify(data.callSessions));
    }
    return {
      success: true,
      storyCount: data.stories?.length || 0,
      vocabCount: data.vocabs?.length || 0,
      sentenceCount: data.difficultSentences?.length || 0,
    };
  } catch (e) {
    console.error('Import failed', e);
    throw new Error('Invalid JSON format for data import');
  }
}

// ===================== PERSONAS =====================
export const DEFAULT_PRESET_PERSONAS: Persona[] = [
  {
    id: 'persona_sarah',
    name: 'Sarah',
    avatarEmoji: '☕',
    nationality: 'アメリカ (カリフォルニア)',
    nativeLanguage: '英語',
    age: 24,
    occupation: 'カフェ店員 / イラストレーター',
    personality: '明るくフレンドリー、好奇心旺盛。初心者にも優しく短文でゆっくり話してくれる。',
    interests: ['カフェ巡り', 'インディー音楽', '猫', 'コメディドラマ'],
    cefrLevel: 'A2',
    voiceName: 'Aoede',
    memory: {
      likes: ['シティポップ', '猫', 'アールグレイティー', 'フレンズ (ドラマ)'],
      dislikes: ['アメコミ・ヒーロー映画 (Avengers等)', '辛い食べ物'],
      recentTopics: [],
      userNotes: [],
      promisesOrFutureTasks: [],
    },
    totalConversations: 0,
    isPreset: true,
    createdAt: '2026-09-01T00:00:00.000Z',
  },
  {
    id: 'persona_liam',
    name: 'Liam',
    avatarEmoji: '🎸',
    nationality: 'イギリス (ロンドン)',
    nativeLanguage: '英語',
    age: 29,
    occupation: 'グラフィックデザイナー',
    personality: '落ち着いたトーン、少しユーモアや皮肉を交える自然な英国英語。カルチャー好き。',
    interests: ['UKロック', '写真', 'プレミアリーグ(サッカー)', 'クラフトビール'],
    cefrLevel: 'B1',
    voiceName: 'Puck',
    memory: {
      likes: ['オアシス (バンド)', 'アーセナルFC', 'パブ巡り', 'フィルムカメラ'],
      dislikes: ['早起き', '過度な甘い物', '雨の日の満員電車'],
      recentTopics: [],
      userNotes: [],
      promisesOrFutureTasks: [],
    },
    totalConversations: 0,
    isPreset: true,
    createdAt: '2026-09-01T00:00:00.000Z',
  },
  {
    id: 'persona_minho',
    name: 'Minho (ミンホ)',
    avatarEmoji: '🎧',
    nationality: '韓国出身 / ニューヨーク在住',
    nativeLanguage: '韓国語 / 英語 (バイリンガル)',
    age: 26,
    occupation: '大学院生 (コンピュータサイエンス)',
    personality: '親切で温かい。英語学習の苦労を知っている良き理解者。日本語やアニメにも詳しい。',
    interests: ['アニメ', 'プログラミング', '筋トレ', 'ストリートファッション'],
    cefrLevel: 'A2',
    voiceName: 'Fenrir',
    memory: {
      likes: ['呪術廻戦', 'プログラミング (TypeScript/Python)', 'サムギョプサル'],
      dislikes: ['ホラー映画', 'バグのデバッグ'],
      recentTopics: [],
      userNotes: [],
      promisesOrFutureTasks: [],
    },
    totalConversations: 0,
    isPreset: true,
    createdAt: '2026-09-01T00:00:00.000Z',
  },
];

export function loadPersonas(): Persona[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PERSONAS);
    if (!raw) {
      savePersonasBatch(DEFAULT_PRESET_PERSONAS);
      return DEFAULT_PRESET_PERSONAS;
    }
    const parsed: Persona[] = JSON.parse(raw);
    if (!parsed || parsed.length === 0) {
      savePersonasBatch(DEFAULT_PRESET_PERSONAS);
      return DEFAULT_PRESET_PERSONAS;
    }
    return parsed;
  } catch (e) {
    console.error('Failed to load personas', e);
    return DEFAULT_PRESET_PERSONAS;
  }
}

export function savePersonasBatch(personas: Persona[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.PERSONAS, JSON.stringify(personas));
  } catch (e) {
    console.error('Failed to save personas batch', e);
  }
}

export function savePersona(persona: Persona): void {
  const current = loadPersonas();
  const index = current.findIndex(p => p.id === persona.id);
  let updated: Persona[];
  if (index >= 0) {
    updated = [...current];
    updated[index] = persona;
  } else {
    updated = [persona, ...current];
  }
  savePersonasBatch(updated);
}

export function deletePersona(personaId: string): void {
  const current = loadPersonas();
  const updated = current.filter(p => p.id !== personaId);
  savePersonasBatch(updated);
}

export function resetPersonas(): Persona[] {
  savePersonasBatch(DEFAULT_PRESET_PERSONAS);
  return DEFAULT_PRESET_PERSONAS;
}

export function updatePersonaMemory(
  personaId: string,
  memoryUpdates: {
    newLikes?: string[];
    newDislikes?: string[];
    newTopic?: { topic: string; summary: string };
    newUserNotes?: string[];
    newPromises?: string[];
  },
  lastSpokenAt: string = new Date().toISOString()
): Persona | null {
  const current = loadPersonas();
  const index = current.findIndex(p => p.id === personaId);
  if (index < 0) return null;

  const target = current[index];
  const oldMemory = target.memory || { likes: [], dislikes: [], recentTopics: [], userNotes: [] };

  const uniqueLikes = Array.from(new Set([...oldMemory.likes, ...(memoryUpdates.newLikes || [])]));
  const uniqueDislikes = Array.from(new Set([...oldMemory.dislikes, ...(memoryUpdates.newDislikes || [])]));
  const uniqueUserNotes = Array.from(new Set([...oldMemory.userNotes, ...(memoryUpdates.newUserNotes || [])]));
  
  let recentTopics = [...(oldMemory.recentTopics || [])];
  if (memoryUpdates.newTopic && memoryUpdates.newTopic.topic) {
    recentTopics.unshift({
      date: new Date().toISOString().split('T')[0],
      topic: memoryUpdates.newTopic.topic,
      summary: memoryUpdates.newTopic.summary,
    });
    recentTopics = recentTopics.slice(0, 10);
  }

  const updatedPersona: Persona = {
    ...target,
    lastSpokenAt,
    totalConversations: (target.totalConversations || 0) + 1,
    memory: {
      likes: uniqueLikes,
      dislikes: uniqueDislikes,
      recentTopics,
      userNotes: uniqueUserNotes,
      promisesOrFutureTasks: memoryUpdates.newPromises || oldMemory.promisesOrFutureTasks || [],
    },
  };

  current[index] = updatedPersona;
  savePersonasBatch(current);
  return updatedPersona;
}

// ===================== CALL SESSIONS =====================
export function loadCallSessions(): CallSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CALL_SESSIONS);
    if (!raw) return [];
    const sessions: CallSession[] = JSON.parse(raw);
    return sessions.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  } catch (e) {
    console.error('Failed to load call sessions', e);
    return [];
  }
}

export function saveCallSession(session: CallSession): void {
  try {
    const sessions = loadCallSessions();
    const filtered = sessions.filter(s => s.id !== session.id);
    const updated = [session, ...filtered].slice(0, 50);
    localStorage.setItem(STORAGE_KEYS.CALL_SESSIONS, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to save call session', e);
  }
}

export function deleteCallSession(sessionId: string): void {
  try {
    const sessions = loadCallSessions();
    const updated = sessions.filter(s => s.id !== sessionId);
    localStorage.setItem(STORAGE_KEYS.CALL_SESSIONS, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to delete call session', e);
  }
}