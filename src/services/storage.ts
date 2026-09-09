import { VocabItem, VocabLookupResult } from '../types/vocab';
import { DifficultSentenceItem, DifficultyReasonCategory } from '../types/sentence';
import { Story } from '../types/story';
import { AppSettings, DEFAULT_SETTINGS, TokenStats } from '../types/settings';
import { ChatMessage } from '../types/chat';
import { calculateLapseSRS, calculateSuccessSRS, addDaysToDate } from '../utils/srs';

const STORAGE_KEYS = {
  SETTINGS: 'storykai_settings_v1',
  STORIES: 'storykai_stories_v1',
  VOCABS: 'storykai_vocabs_v1',
  DIFFICULT_SENTENCES: 'storykai_difficult_sentences_v1',
  CHAT_MESSAGES: 'storykai_chat_messages_v1',
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
    updatedItem = {
      ...existing,
      meaning: lookup.meaning || existing.meaning,
      partOfSpeech: lookup.part_of_speech || existing.partOfSpeech,
      contextNote: lookup.explanation || existing.contextNote,
      exampleSentence: lookup.context_sentence || existing.exampleSentence,
      ...srs,
      sourceStoryId: sourceStoryId || existing.sourceStoryId,
    };
    vocabs[existingIndex] = updatedItem;
  } else {
    const srs = calculateLapseSRS();
    updatedItem = {
      id: 'voc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      phrase: lookup.phrase.trim(),
      meaning: lookup.meaning,
      partOfSpeech: lookup.part_of_speech || 'word/phrase',
      contextNote: lookup.explanation || '',
      exampleSentence: lookup.context_sentence || '',
      ...srs,
      importance: 3,
      createdAt: new Date().toISOString(),
      sourceStoryId,
    };
    vocabs.unshift(updatedItem);
  }

  saveVocabsBatch(vocabs);
  return updatedItem;
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
          text: 'こんにちは！AI英語メンターのStoryKaiです。✨\n「〜は英語で何と言う？」「このニュアンスの違いは？」「この文法の意味は？」など、疑問に思ったことを何でも質問してください。回答からワンタップで語彙帳やAnkiに登録できます！',
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
  const data: ExportData = {
    version: '1.2.0',
    exportedAt: new Date().toISOString(),
    stories: loadStories(),
    vocabs: loadVocabs(),
    difficultSentences: loadDifficultSentences(),
    chatMessages: loadChatMessages(),
    settings: {
      cefrLevel: loadSettings().cefrLevel,
      geminiModel: loadSettings().geminiModel,
    },
  };
  return JSON.stringify(data, null, 2);
}

export function importAllData(jsonStr: string): { success: boolean; storyCount: number; vocabCount: number; sentenceCount: number } {
  try {
    const data: ExportData = JSON.parse(jsonStr);
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