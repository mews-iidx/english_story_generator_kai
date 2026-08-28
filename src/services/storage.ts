import { VocabItem, VocabLookupResult } from '../types/vocab';
import { Story } from '../types/story';
import { AppSettings, DEFAULT_SETTINGS } from '../types/settings';
import { calculateLapseSRS, calculateSuccessSRS } from '../utils/srs';

const STORAGE_KEYS = {
  SETTINGS: 'storykai_settings_v1',
  STORIES: 'storykai_stories_v1',
  VOCABS: 'storykai_vocabs_v1',
};

// ===================== SETTINGS =====================
export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed: AppSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    // 古い/非推奨モデル（gemini-2.*, gemini-1.*, gemini-2.5-flashなど）は自動で最新 gemini-3.7-flash にマイグレーション
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

// ===================== EXPORT / IMPORT =====================
export interface ExportData {
  version: string;
  exportedAt: string;
  stories: Story[];
  vocabs: VocabItem[];
  settings: Partial<AppSettings>;
}

export function exportAllData(): string {
  const data: ExportData = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    stories: loadStories(),
    vocabs: loadVocabs(),
    settings: {
      cefrLevel: loadSettings().cefrLevel,
      geminiModel: loadSettings().geminiModel,
    },
  };
  return JSON.stringify(data, null, 2);
}

export function importAllData(jsonStr: string): { success: boolean; storyCount: number; vocabCount: number } {
  try {
    const data: ExportData = JSON.parse(jsonStr);
    if (data.stories && Array.isArray(data.stories)) {
      localStorage.setItem(STORAGE_KEYS.STORIES, JSON.stringify(data.stories));
    }
    if (data.vocabs && Array.isArray(data.vocabs)) {
      localStorage.setItem(STORAGE_KEYS.VOCABS, JSON.stringify(data.vocabs));
    }
    return {
      success: true,
      storyCount: data.stories?.length || 0,
      vocabCount: data.vocabs?.length || 0,
    };
  } catch (e) {
    console.error('Import failed', e);
    throw new Error('Invalid JSON format for data import');
  }
}