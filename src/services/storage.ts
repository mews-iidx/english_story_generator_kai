import { PatternMasterItem, VocabMasterItem, UserMasteryState, LevelProgressSummary, DailySnapshot, MyGoal, MasteryStatus, ItemProgress, ReadingSessionLog } from '../types/mastery';
import { getPatternsByLevel } from '../data/cefrPatternsMaster';
import { CEFR_VOCAB_MASTER, getVocabMasterByLevel, getVocabByPhrase } from '../data/cefrVocabMaster';
import { getTodayDateString } from '../utils/srs';
import { ExpressionErrorItem } from '../types/expressionError';
import { VocabItem, VocabLookupResult, ExtractedCorePattern } from '../types/vocab';
import { DifficultSentenceItem, DifficultyReasonCategory } from '../types/sentence';
import { Story } from '../types/story';
import { AppSettings, DEFAULT_SETTINGS, TokenStats } from '../types/settings';
import { ChatMessage } from '../types/chat';
import { Persona, CallSession } from '../types/persona';
import { calculateLapseSRS, calculateSuccessSRS, calculateAnkiSRS, addDaysToDate } from '../utils/srs';

const STORAGE_KEYS = {
  SETTINGS: 'storykai_settings_v1',
  STORIES: 'storykai_stories_v1',
  VOCABS: 'storykai_vocabs_v1',
  DIFFICULT_SENTENCES: 'storykai_difficult_sentences_v1',
  CHAT_MESSAGES: 'storykai_chat_messages_v1',
  PERSONAS: 'storykai_personas_v1',
  CALL_SESSIONS: 'storykai_call_sessions_v1',
  EXPRESSION_ERRORS: 'storykai_expression_errors_v1',
  MASTERY_STATE: 'storykai_mastery_state_v1',
  DAILY_SNAPSHOTS: 'storykai_daily_snapshots_v1',
  MY_GOAL: 'storykai_my_goal_v1',
  READING_LOGS: 'storykai_reading_logs_v1',
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

    // AIの出題意図があった構文・単語の進捗をこっそり反映 (Passive Exposure & Mastery)
    try {
      const mastery = loadMasteryState();
      const now = new Date().toISOString();
      let masteryChanged = false;

      // 1. Target Embeddings (構文 & 単語)
      if (story.targetEmbeddings && story.targetEmbeddings.length > 0) {
        story.targetEmbeddings.forEach(emb => {
          if (emb.type === 'pattern' && emb.targetId) {
            const prev = mastery.patterns[emb.targetId] || {
              status: 'unseen',
              encounterCount: 0,
              firstSeenAt: now,
            };
            if (prev.status !== 'lapsed' && prev.status !== 'mastered') {
              const nextCount = (prev.encounterCount || 0) + 1;
              mastery.patterns[emb.targetId] = {
                ...prev,
                status: nextCount >= 3 ? 'mastered' : 'exposed',
                lastSeenAt: now,
                encounterCount: nextCount,
                masteredAt: nextCount >= 3 ? now : prev.masteredAt,
              };
              masteryChanged = true;
            }
          } else if (emb.type === 'vocab') {
            const key = (emb.targetName || '').trim().toLowerCase();
            if (key) {
              const prev = mastery.vocabs[key] || {
                status: 'unseen',
                encounterCount: 0,
                firstSeenAt: now,
              };
              if (prev.status !== 'lapsed' && prev.status !== 'mastered') {
                const nextCount = (prev.encounterCount || 0) + 1;
                mastery.vocabs[key] = {
                  ...prev,
                  status: nextCount >= 3 ? 'mastered' : 'exposed',
                  lastSeenAt: now,
                  encounterCount: nextCount,
                  masteredAt: nextCount >= 3 ? now : prev.masteredAt,
                };
                masteryChanged = true;
              }
            }
          }
        });
      }

      // 2. Target Vocab List
      if (story.targetVocabList && story.targetVocabList.length > 0) {
        story.targetVocabList.forEach(rawWord => {
          const key = rawWord.trim().toLowerCase();
          if (key) {
            const prev = mastery.vocabs[key] || {
              status: 'unseen',
              encounterCount: 0,
              firstSeenAt: now,
            };
            if (prev.status !== 'lapsed' && prev.status !== 'mastered') {
              const nextCount = (prev.encounterCount || 0) + 1;
              mastery.vocabs[key] = {
                ...prev,
                status: nextCount >= 3 ? 'mastered' : 'exposed',
                lastSeenAt: now,
                encounterCount: nextCount,
                masteredAt: nextCount >= 3 ? now : prev.masteredAt,
              };
              masteryChanged = true;
            }
          }
        });
      }

      if (masteryChanged) {
        saveMasteryState(mastery);
      }

      // 単語数とWPMを日次スナップショットに記録
      const words = updatedStory.actualWordCount || updatedStory.targetWordCount || 700;
      recordDailyReadingActivity(words, wpm, updatedStory.title, updatedStory.id);
    } catch (err) {
      console.error('Failed to update passive mastery on story read', err);
    }

    return updatedStory;
  }
  return null;
}

// ===================== VOCABULARIES =====================
export function loadVocabs(): VocabItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.VOCABS);
    if (!raw) return [];
    let vocabs: VocabItem[] = JSON.parse(raw);
    let modified = false;

    // 1. 最新マスタ辞書と自動同期（過去の誤データやヘリウム等のクレンジング）
    vocabs = vocabs.map(v => {
      const masterItem = getVocabByPhrase(v.phrase);
      if (masterItem && (
        !v.meaning || 
        v.meaning.includes('化学記号') || 
        v.meaning.includes('helium') || 
        v.meaning === '要復習' || 
        v.meaning === '要確認' ||
        v.meaning.startsWith('=')
      )) {
        modified = true;
        return {
          ...v,
          meaning: masterItem.meaning,
          partOfSpeech: masterItem.partOfSpeech || v.partOfSpeech,
          level: masterItem.cefr || v.level,
        };
      }
      return v;
    });

    // 2. センテンスが段落単位になっている古いカードを1文単位にトリム & 【例文】プレフィックスの除去
    vocabs = vocabs.map(v => {
      let item = { ...v };
      let itemMod = false;

      if (item.meaning && (item.meaning.startsWith('【例文】') || item.meaning.startsWith('(例文)') || item.meaning.startsWith('例文:'))) {
        item.meaning = cleanTranslationText(item.meaning);
        itemMod = true;
      }
      if (item.translation && (item.translation.startsWith('【例文】') || item.translation.startsWith('(例文)') || item.translation.startsWith('例文:'))) {
        item.translation = cleanTranslationText(item.translation);
        itemMod = true;
      }

      // 単語カードで meaning が sentence と完全一致、または英語長文になっている場合の自動修復
      const isWord = item.focusType === 'word' || (item.focusWord && item.focusWord.length > 0) || (item.phrase && item.phrase.trim().split(/\s+/).length <= 2 && item.focusType !== 'pattern');
      if (isWord && item.meaning && item.sentence && (item.meaning.trim() === item.sentence.trim() || (!/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(item.meaning) && item.meaning.length > 30))) {
        const targetPhrase = item.focusWord || item.phrase;
        const masterItem = getVocabByPhrase(targetPhrase);
        if (masterItem && masterItem.meaning) {
          item.meaning = masterItem.meaning;
          if (item.focusMeaning) item.focusMeaning = masterItem.meaning;
          itemMod = true;
        }
      }

      if (item.sentence && (item.sentence.includes('\n') || item.sentence.includes('. ') || item.sentence.includes('! ') || item.sentence.includes('? '))) {
        const clean = extractSingleSentence(item.sentence, item.focusWord || item.phrase);
        if (clean && clean !== item.sentence && clean.length < item.sentence.length) {
          item.sentence = clean;
          item.exampleSentence = clean;
          itemMod = true;
        }
      }

      // 初回登録時の埋没フラグをクリアして即時出題可能に
      if (item.buriedUntilDate) {
        item.buriedUntilDate = undefined;
        itemMod = true;
      }

      if (itemMod) {
        modified = true;
      }
      return item;
    });

    if (modified) {
      saveVocabsBatch(vocabs);
    }

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

/**
 * フレーズのあいまい一致・正規化ヘルパー
 * 例: "too tired to" と "too ... to", "look forward to" などを柔軟に同一視
 */
export function normalizePhraseKey(phrase: string): string {
  return phrase
    .toLowerCase()
    .replace(/[~～….]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function findMatchingVocabIndex(vocabs: VocabItem[], phrase: string): number {
  const targetNorm = normalizePhraseKey(phrase);
  
  // 1. 完全一致 (大文字小文字無視)
  let idx = vocabs.findIndex(v => v.phrase.trim().toLowerCase() === phrase.trim().toLowerCase());
  if (idx >= 0) return idx;

  // 2. 正規化一致 (記号・余分な空白の無視)
  idx = vocabs.findIndex(v => normalizePhraseKey(v.phrase) === targetNorm);
  if (idx >= 0) return idx;

  // 3. イディオムパターン一致 (例: "too ... to" に対して "too tired to" がマッチ)
  idx = vocabs.findIndex(v => {
    const vNorm = normalizePhraseKey(v.phrase);
    if (vNorm.includes('too') && vNorm.includes('to') && targetNorm.startsWith('too ') && targetNorm.includes(' to')) {
      return true;
    }
    return false;
  });

  return idx;
}

export function recordVocabLapse(
  lookup: VocabLookupResult,
  sourceStoryId?: string
): VocabItem {
  const vocabs = loadVocabs();
  const existingIndex = findMatchingVocabIndex(vocabs, lookup.phrase);
  const cefrItem = getVocabByPhrase(lookup.phrase);
  const determinedLevel = cefrItem?.cefr || 'C1';

  let updatedItem: VocabItem;

  if (existingIndex >= 0) {
    const existing = vocabs[existingIndex];
    const srs = calculateLapseSRS(existing);
    // 有効な訳のみ更新。'要復習'などのステータス文字列で既存の日本語訳を上書きしない
    let finalMeaning = existing.meaning;
    if (!isInvalidVocabMeaning(lookup.meaning)) {
      finalMeaning = lookup.meaning.trim();
    } else if (cefrItem?.meaning) {
      finalMeaning = cefrItem.meaning;
    }

    updatedItem = {
      ...existing,
      meaning: finalMeaning,
      level: existing.level || determinedLevel,
      partOfSpeech: lookup.part_of_speech || (cefrItem?.partOfSpeech ?? existing.partOfSpeech),
      contextNote: lookup.explanation || existing.contextNote,
      exampleSentence: lookup.context_sentence || existing.exampleSentence,
      ...srs,
      sourceStoryId: sourceStoryId || existing.sourceStoryId,
    };
    vocabs[existingIndex] = updatedItem;
  } else {
    const srs = calculateLapseSRS();
    let meaning = !isInvalidVocabMeaning(lookup.meaning) ? lookup.meaning.trim() : '';
    if (!meaning && cefrItem?.meaning) {
      meaning = cefrItem.meaning;
    }
    updatedItem = {
      id: 'voc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      phrase: lookup.phrase.trim(),
      meaning,
      level: determinedLevel,
      partOfSpeech: lookup.part_of_speech || (cefrItem?.partOfSpeech ?? 'word/phrase'),
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
  // 習熟度マスターDBステートにも要復習として同期
  recordVocabMasteryStatus(lookup.phrase, 'lapsed');
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

// Anki 4段階評価 (again, hard, good, easy) - 本家Anki SM-2 SRSアルゴリズム
export function saveSingleVocab(item: VocabItem): void {
  const vocabs = loadVocabs();
  const index = vocabs.findIndex(v => v.id === item.id);
  if (index >= 0) {
    vocabs[index] = item;
  } else {
    vocabs.unshift(item);
  }
  saveVocabsBatch(vocabs);
}

export function recordAnkiRating(
  vocabId: string,
  rating: 'again' | 'hard' | 'good' | 'easy'
): VocabItem | null {
  const vocabs = loadVocabs();
  const index = vocabs.findIndex(v => v.id === vocabId);
  if (index < 0) return null;

  const item = vocabs[index];
  const srs = calculateAnkiSRS(item, rating);

  const updated: VocabItem = {
    ...item,
    ...srs,
  };

  vocabs[index] = updated;

  // Sibling Burying (兄弟カード延期): 今日中に解いた兄弟カードがあれば明日に延期
  if (item.siblingId) {
    const siblingIndex = vocabs.findIndex(v => v.id === item.siblingId);
    if (siblingIndex >= 0) {
      const today = getTodayDateString();
      const tomorrow = addDaysToDate(1);
      const sibling = vocabs[siblingIndex];
      vocabs[siblingIndex] = {
        ...sibling,
        buriedUntilDate: tomorrow,
        nextReviewDate: sibling.nextReviewDate <= today ? tomorrow : sibling.nextReviewDate,
      };
    }
  }

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
    localStorage.removeItem(STORAGE_KEYS.PERSONAS);
    localStorage.removeItem(STORAGE_KEYS.CALL_SESSIONS);
    localStorage.removeItem(STORAGE_KEYS.EXPRESSION_ERRORS);
    localStorage.removeItem(STORAGE_KEYS.MASTERY_STATE);
    localStorage.removeItem(STORAGE_KEYS.DAILY_SNAPSHOTS);
    localStorage.removeItem(STORAGE_KEYS.MY_GOAL);
    localStorage.removeItem('reader_show_targets');
    localStorage.removeItem('anki_importance_filter');

    // 明示的に空のクリーンデータを書き込み
    localStorage.setItem(STORAGE_KEYS.MASTERY_STATE, JSON.stringify({
      patterns: {},
      vocabs: {},
      lastUpdatedAt: new Date().toISOString()
    }));
    localStorage.setItem(STORAGE_KEYS.DAILY_SNAPSHOTS, JSON.stringify([]));

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
  personas?: Persona[];
  callSessions?: CallSession[];
  expressionErrors?: ExpressionErrorItem[];
  masteryState?: UserMasteryState;
  dailySnapshots?: DailySnapshot[];
  myGoal?: MyGoal | null;
  settings?: Partial<AppSettings>;
}

export function exportAllData(): string {
  const data: ExportData = {
    version: '2.0.0',
    exportedAt: new Date().toISOString(),
    stories: loadStories(),
    vocabs: loadVocabs(),
    difficultSentences: loadDifficultSentences(),
    chatMessages: loadChatMessages(),
    personas: loadPersonas(),
    callSessions: loadCallSessions(),
    expressionErrors: loadExpressionErrors(),
    masteryState: loadMasteryState(),
    dailySnapshots: loadDailySnapshots(),
    myGoal: loadMyGoal(),
    settings: loadSettings(),
  };
  return JSON.stringify(data, null, 2);
}

export function importAllData(jsonStr: string): { 
  success: boolean; 
  storyCount: number; 
  vocabCount: number; 
  sentenceCount: number;
  hasMastery: boolean;
  hasSnapshots: boolean;
} {
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
    if (data.personas && Array.isArray(data.personas)) {
      localStorage.setItem(STORAGE_KEYS.PERSONAS, JSON.stringify(data.personas));
    }
    if (data.callSessions && Array.isArray(data.callSessions)) {
      localStorage.setItem(STORAGE_KEYS.CALL_SESSIONS, JSON.stringify(data.callSessions));
    }
    if (data.expressionErrors && Array.isArray(data.expressionErrors)) {
      localStorage.setItem(STORAGE_KEYS.EXPRESSION_ERRORS, JSON.stringify(data.expressionErrors));
    }
    if (data.masteryState && typeof data.masteryState === 'object') {
      localStorage.setItem(STORAGE_KEYS.MASTERY_STATE, JSON.stringify(data.masteryState));
    }
    if (data.dailySnapshots && Array.isArray(data.dailySnapshots)) {
      localStorage.setItem(STORAGE_KEYS.DAILY_SNAPSHOTS, JSON.stringify(data.dailySnapshots));
    }
    if (data.myGoal) {
      localStorage.setItem(STORAGE_KEYS.MY_GOAL, JSON.stringify(data.myGoal));
    }
    if (data.settings && typeof data.settings === 'object') {
      const current = loadSettings();
      saveSettings({ ...current, ...data.settings });
    }

    return {
      success: true,
      storyCount: data.stories?.length || 0,
      vocabCount: data.vocabs?.length || 0,
      sentenceCount: data.difficultSentences?.length || 0,
      hasMastery: !!data.masteryState,
      hasSnapshots: !!(data.dailySnapshots && data.dailySnapshots.length > 0),
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
// ===================== EXPRESSION ERRORS (偽英語・発話カルテDB) =====================
export function loadExpressionErrors(): ExpressionErrorItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.EXPRESSION_ERRORS);
    if (!raw) return [];
    const items: ExpressionErrorItem[] = JSON.parse(raw);
    return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch (e) {
    console.error('Failed to load expression errors', e);
    return [];
  }
}

export function saveExpressionError(
  item: Omit<ExpressionErrorItem, 'id' | 'createdAt' | 'storyReinforcedCount'>
): ExpressionErrorItem {
  const list = loadExpressionErrors();
  
  // 既存の同一パターンがあれば更新
  const existingIndex = list.findIndex(
    e => e.corePattern.trim().toLowerCase() === item.corePattern.trim().toLowerCase() ||
         e.userUtterance.trim().toLowerCase() === item.userUtterance.trim().toLowerCase()
  );

  let result: ExpressionErrorItem;
  if (existingIndex >= 0) {
    result = {
      ...list[existingIndex],
      naturalExpression: item.naturalExpression,
      explanation: item.explanation,
      causeCategory: item.causeCategory,
      userNote: item.userNote || list[existingIndex].userNote,
    };
    list[existingIndex] = result;
  } else {
    result = {
      ...item,
      id: 'err_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      storyReinforcedCount: 0,
      createdAt: new Date().toISOString(),
    };
    list.unshift(result);
  }

  localStorage.setItem(STORAGE_KEYS.EXPRESSION_ERRORS, JSON.stringify(list));
  return result;
}

export function deleteExpressionError(id: string): void {
  const list = loadExpressionErrors().filter(e => e.id !== id);
  localStorage.setItem(STORAGE_KEYS.EXPRESSION_ERRORS, JSON.stringify(list));
}

export function incrementExpressionReinforced(corePattern: string): void {
  const list = loadExpressionErrors();
  let changed = false;
  const updated = list.map(item => {
    if (item.corePattern.includes(corePattern) || corePattern.includes(item.corePattern)) {
      changed = true;
      return {
        ...item,
        storyReinforcedCount: item.storyReinforcedCount + 1,
        lastReinforcedAt: new Date().toISOString(),
      };
    }
    return item;
  });

  if (changed) {
    localStorage.setItem(STORAGE_KEYS.EXPRESSION_ERRORS, JSON.stringify(updated));
  }
}

// ===================== MASTERY & TELEMETRY (スキルツリー・アナリティクス) =====================

export function loadMasteryState(): UserMasteryState {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.MASTERY_STATE);
    let state: UserMasteryState;
    if (raw) {
      state = JSON.parse(raw);
    } else {
      state = {
        patterns: {},
        vocabs: {},
        lastUpdatedAt: new Date().toISOString(),
      };
    }

    // 既存の単語帳データ (vocabs) と自動同期
    const existingVocabs = loadVocabs();
    let changed = false;
    existingVocabs.forEach(v => {
      const phraseKey = v.phrase.trim().toLowerCase();
      // Master DB に一致する単語を探す
      const matchedMaster = CEFR_VOCAB_MASTER.find(m => m.phrase.toLowerCase() === phraseKey);
      const targetKey = matchedMaster ? matchedMaster.id : phraseKey;

      if (!state.vocabs[targetKey]) {
        const isMastered = (v.repetitionCount ?? 0) >= 3 || (v.intervalDays ?? 0) >= 4;
        state.vocabs[targetKey] = {
          status: isMastered ? 'mastered' : 'lapsed',
          firstSeenAt: v.createdAt || new Date().toISOString(),
          lastSeenAt: v.lastReviewedAt || v.createdAt || new Date().toISOString(),
          encounterCount: (v.repetitionCount || 1),
          masteredAt: isMastered ? new Date().toISOString() : undefined,
        };
        changed = true;
      }
    });

    if (changed) {
      saveMasteryState(state);
    }

    return state;
  } catch (e) {
    console.error('Failed to load mastery state', e);
    return { patterns: {}, vocabs: {}, lastUpdatedAt: new Date().toISOString() };
  }
}

export function saveMasteryState(state: UserMasteryState): void {
  try {
    state.lastUpdatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEYS.MASTERY_STATE, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save mastery state', e);
  }
}

export function computeLevelProgress(level: 'A1' | 'A2' | 'B1' | 'B2', state?: UserMasteryState): LevelProgressSummary {
  const currentState = state || loadMasteryState();
  const patternsInLevel = getPatternsByLevel(level);
  const vocabsInLevel = getVocabMasterByLevel(level);

  let patternMastered = 0;
  let patternLapsed = 0;
  let patternExposed = 0;

  patternsInLevel.forEach(p => {
    const prog = currentState.patterns[p.id];
    if (prog) {
      if (prog.status === 'mastered') patternMastered++;
      else if (prog.status === 'lapsed') patternLapsed++;
      else if (prog.status === 'exposed') patternExposed++;
    }
  });

  const patternTotal = patternsInLevel.length || 1;
  const patternUnseen = Math.max(0, patternTotal - (patternMastered + patternLapsed + patternExposed));
  const patternPct = Math.round((patternMastered / patternTotal) * 100);

  let vocabMastered = 0;
  let vocabLapsed = 0;
  let vocabExposed = 0;

  vocabsInLevel.forEach(v => {
    const prog = currentState.vocabs[v.id] || currentState.vocabs[v.phrase.toLowerCase()];
    if (prog) {
      if (prog.status === 'mastered') vocabMastered++;
      else if (prog.status === 'lapsed') vocabLapsed++;
      else if (prog.status === 'exposed') vocabExposed++;
    }
  });

  const vocabTotal = vocabsInLevel.length || 1;
  const vocabUnseen = Math.max(0, vocabTotal - (vocabMastered + vocabLapsed + vocabExposed));
  const vocabPct = Math.round((vocabMastered / vocabTotal) * 100);

  const overallPct = Math.round((patternPct * 0.5) + (vocabPct * 0.5));

  return {
    vocabTotal,
    vocabMastered,
    vocabLapsed,
    vocabExposed,
    vocabUnseen,
    vocabPct,
    patternTotal,
    patternMastered,
    patternLapsed,
    patternExposed,
    patternUnseen,
    patternPct,
    overallPct,
  };
}

export function computeAllLevelProgress(state?: UserMasteryState): Record<'A1' | 'A2' | 'B1' | 'B2', LevelProgressSummary> {
  const currentState = state || loadMasteryState();
  return {
    A1: computeLevelProgress('A1', currentState),
    A2: computeLevelProgress('A2', currentState),
    B1: computeLevelProgress('B1', currentState),
    B2: computeLevelProgress('B2', currentState),
  };
}

export function recordPatternStatus(patternId: string, status: MasteryStatus): void {
  const state = loadMasteryState();
  const now = new Date().toISOString();
  const prev = state.patterns[patternId] || {
    status: 'unseen',
    encounterCount: 0,
    firstSeenAt: now,
  };

  if (status === 'unseen') {
    delete state.patterns[patternId];
  } else {
    const updated: ItemProgress = {
      ...prev,
      status,
      lastSeenAt: now,
      encounterCount: Math.max(1, prev.encounterCount + 1),
      masteredAt: status === 'mastered' ? (prev.masteredAt || now) : undefined,
    };
    state.patterns[patternId] = updated;
  }
  saveMasteryState(state);
}

export function recordVocabMasteryBatch(updates: { phrase: string; status: MasteryStatus }[]): void {
  if (!updates || updates.length === 0) return;
  const state = loadMasteryState();
  const now = new Date().toISOString();

  updates.forEach(({ phrase, status }) => {
    const key = phrase.trim().toLowerCase();
    const prev = state.vocabs[key] || {
      status: 'unseen',
      encounterCount: 0,
      firstSeenAt: now,
    };

    if (status === 'unseen') {
      delete state.vocabs[key];
    } else {
      state.vocabs[key] = {
        ...prev,
        status,
        lastSeenAt: now,
        encounterCount: Math.max(1, prev.encounterCount + 1),
        masteredAt: status === 'mastered' ? (prev.masteredAt || now) : undefined,
      };
    }
  });

  saveMasteryState(state);
}

export function recordPatternMasteryBatch(updates: { patternId: string; status: MasteryStatus }[]): void {
  if (!updates || updates.length === 0) return;
  const state = loadMasteryState();
  const now = new Date().toISOString();

  updates.forEach(({ patternId, status }) => {
    const prev = state.patterns[patternId] || {
      status: 'unseen',
      encounterCount: 0,
      firstSeenAt: now,
    };

    if (status === 'unseen') {
      delete state.patterns[patternId];
    } else {
      state.patterns[patternId] = {
        ...prev,
        status,
        lastSeenAt: now,
        encounterCount: Math.max(1, prev.encounterCount + 1),
        masteredAt: status === 'mastered' ? (prev.masteredAt || now) : undefined,
      };
    }
  });

  saveMasteryState(state);
}

export function recordVocabMasteryStatus(phraseOrId: string, status: MasteryStatus): void {
  const state = loadMasteryState();
  const now = new Date().toISOString();
  const key = phraseOrId.trim().toLowerCase();
  const prev = state.vocabs[key] || {
    status: 'unseen',
    encounterCount: 0,
    firstSeenAt: now,
  };

  if (status === 'unseen') {
    delete state.vocabs[key];
  } else {
    const updated: ItemProgress = {
      ...prev,
      status,
      lastSeenAt: now,
      encounterCount: Math.max(1, prev.encounterCount + 1),
      masteredAt: status === 'mastered' ? (prev.masteredAt || now) : undefined,
    };
    state.vocabs[key] = updated;
  }
  saveMasteryState(state);
}

// --------------------- DAILY SNAPSHOTS (成長推移・Diff) ---------------------

export function loadDailySnapshots(): DailySnapshot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DAILY_SNAPSHOTS);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to load daily snapshots', e);
    return [];
  }
}

export function saveDailySnapshotsBatch(snapshots: DailySnapshot[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.DAILY_SNAPSHOTS, JSON.stringify(snapshots));
  } catch (e) {
    console.error('Failed to save daily snapshots', e);
  }
}

export function ensureTodaySnapshot(): DailySnapshot {
  const today = getTodayDateString();
  const snapshots = loadDailySnapshots();
  const existingIdx = snapshots.findIndex(s => s.date === today);

  const allLevels = computeAllLevelProgress();
  const snapshot: DailySnapshot = {
    date: today,
    a1Progress: allLevels.A1,
    a2Progress: allLevels.A2,
    b1Progress: allLevels.B1,
    b2Progress: allLevels.B2,
    wordsRead: existingIdx >= 0 ? snapshots[existingIdx].wordsRead : 0,
    averageWpm: existingIdx >= 0 ? snapshots[existingIdx].averageWpm : 0,
    newMasteredPatternsCount: existingIdx >= 0 ? snapshots[existingIdx].newMasteredPatternsCount : 0,
    newMasteredVocabsCount: existingIdx >= 0 ? snapshots[existingIdx].newMasteredVocabsCount : 0,
  };

  if (existingIdx >= 0) {
    snapshots[existingIdx] = snapshot;
  } else {
    snapshots.push(snapshot);
  }

  // 直近60日分のみ保持
  const trimmed = snapshots.slice(-60);
  saveDailySnapshotsBatch(trimmed);
  return snapshot;
}

// --------------------- READING LOGS (読了セッション履歴) ---------------------

export function loadReadingSessionLogs(): ReadingSessionLog[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.READING_LOGS);
    if (!raw) return [];
    const logs: ReadingSessionLog[] = JSON.parse(raw);
    return logs.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
  } catch (e) {
    console.error('Failed to load reading session logs', e);
    return [];
  }
}

export function saveReadingSessionLogs(logs: ReadingSessionLog[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.READING_LOGS, JSON.stringify(logs));
  } catch (e) {
    console.error('Failed to save reading session logs', e);
  }
}

export function deleteReadingSessionLog(logId: string): { logs: ReadingSessionLog[]; snapshots: DailySnapshot[] } {
  const logs = loadReadingSessionLogs();
  const target = logs.find(l => l.id === logId);
  const updatedLogs = logs.filter(l => l.id !== logId);
  saveReadingSessionLogs(updatedLogs);

  // 日次スナップショットの自動再計算（削除したログのノイズを除去）
  const snapshots = loadDailySnapshots();
  if (target) {
    const dateLogs = updatedLogs.filter(l => l.dateString === target.dateString);
    const snapIdx = snapshots.findIndex(s => s.date === target.dateString);
    if (snapIdx >= 0) {
      if (dateLogs.length === 0) {
        snapshots[snapIdx].wordsRead = 0;
        snapshots[snapIdx].averageWpm = 0;
      } else {
        const totalWords = dateLogs.reduce((acc, l) => acc + (l.wordsCount || 0), 0);
        const validWpms = dateLogs.map(l => l.wpm).filter(w => w > 0);
        const avgWpm = validWpms.length > 0 ? Math.round(validWpms.reduce((a, b) => a + b, 0) / validWpms.length) : 0;
        snapshots[snapIdx].wordsRead = totalWords;
        snapshots[snapIdx].averageWpm = avgWpm;
      }
      saveDailySnapshotsBatch(snapshots);
    }
  }

  return { logs: updatedLogs, snapshots };
}

export function recordDailyReadingActivity(wordsCount: number, wpm?: number, storyTitle?: string, storyId?: string): void {
  const today = getTodayDateString();
  const now = new Date().toISOString();

  // 1. 読了セッション個別ログに追加
  const logs = loadReadingSessionLogs();
  const newLog: ReadingSessionLog = {
    id: 'read_log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    storyId,
    storyTitle: storyTitle || '英語ストーリー',
    completedAt: now,
    dateString: today,
    wordsCount,
    wpm: wpm || 0,
  };
  logs.unshift(newLog);
  saveReadingSessionLogs(logs.slice(0, 100)); // 直近100件まで保持

  // 2. 日次スナップショットをログに基づいて正確に集約
  const snapshots = loadDailySnapshots();
  let existing = snapshots.find(s => s.date === today);
  if (!existing) {
    existing = ensureTodaySnapshot();
  }

  const todayLogs = logs.filter(l => l.dateString === today);
  const totalWords = todayLogs.reduce((acc, l) => acc + (l.wordsCount || 0), 0);
  const validWpms = todayLogs.map(l => l.wpm).filter(w => w > 0);
  const avgWpm = validWpms.length > 0 ? Math.round(validWpms.reduce((a, b) => a + b, 0) / validWpms.length) : (wpm || 0);

  existing.wordsRead = totalWords;
  existing.averageWpm = avgWpm;

  const allLevels = computeAllLevelProgress();
  existing.a1Progress = allLevels.A1;
  existing.a2Progress = allLevels.A2;
  existing.b1Progress = allLevels.B1;
  existing.b2Progress = allLevels.B2;

  const idx = snapshots.findIndex(s => s.date === today);
  if (idx >= 0) {
    snapshots[idx] = existing;
  } else {
    snapshots.push(existing);
  }
  saveDailySnapshotsBatch(snapshots);
}

// --------------------- MY GOAL (任意目標) ---------------------

export function loadMyGoal(): MyGoal | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.MY_GOAL);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to load my goal', e);
    return null;
  }
}

export function saveMyGoal(goal: MyGoal): void {
  try {
    localStorage.setItem(STORAGE_KEYS.MY_GOAL, JSON.stringify(goal));
  } catch (e) {
    console.error('Failed to save my goal', e);
  }
}

export function clearMyGoal(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.MY_GOAL);
  } catch (e) {
    console.error('Failed to clear my goal', e);
  }
}

// --------------------- TARGET SELECTION HELPERS (ストーリー生成用の未習得選定) ---------------------

export function getUnmasteredTargetPatterns(level: 'A1' | 'A2' | 'B1' | 'B2', count: number = 2): PatternMasterItem[] {
  const state = loadMasteryState();
  const patterns = getPatternsByLevel(level);

  // 1. 要復習 (lapsed) を最優先
  const lapsed = patterns.filter(p => state.patterns[p.id]?.status === 'lapsed');
  // 2. 未遭遇 (unseen) を次に優先
  const unseen = patterns.filter(p => !state.patterns[p.id] || state.patterns[p.id].status === 'unseen');
  // 3. 遭遇済み (exposed)
  const exposed = patterns.filter(p => state.patterns[p.id]?.status === 'exposed');

  const pool = [...lapsed, ...unseen, ...exposed];
  if (pool.length === 0) return patterns.slice(0, count);

  return pool.slice(0, count);
}

export function getUnmasteredTargetVocabs(level: 'A1' | 'A2' | 'B1' | 'B2', count: number = 3): VocabMasterItem[] {
  const state = loadMasteryState();
  const vocabs = getVocabMasterByLevel(level);

  const lapsed = vocabs.filter(v => state.vocabs[v.id]?.status === 'lapsed' || state.vocabs[v.phrase.toLowerCase()]?.status === 'lapsed');
  const unseen = vocabs.filter(v => (!state.vocabs[v.id] && !state.vocabs[v.phrase.toLowerCase()]) || state.vocabs[v.id]?.status === 'unseen');
  const exposed = vocabs.filter(v => state.vocabs[v.id]?.status === 'exposed' || state.vocabs[v.phrase.toLowerCase()]?.status === 'exposed');

  const pool = [...lapsed, ...unseen, ...exposed];
  if (pool.length === 0) return vocabs.slice(0, count);

  return pool.slice(0, count);
}

/**
 * 語彙アイテムとマスターDBの構文パターンカード（要復習・遭遇済み）を統合したAnkiデッキを生成
 */
export function loadAnkiUnifiedDeck(): VocabItem[] {
  return loadVocabs();
}

export interface SaveSentenceCardParams {
  sentence: string;
  translation: string;
  focusType: 'word' | 'pattern' | 'sentence';
  focusWord?: string;
  focusMeaning?: string;
  corePatterns?: ExtractedCorePattern[];
  sourceStoryId?: string;
  importance?: number;
}

/**
 * 1文単位で英和・和英の2枚の兄弟カードを自動生成して保存
 */
/**
 * 複数文を含む段落テキストから、対象の単語・フレーズが含まれる「1文（ピリオド・疑問符・感嘆符・改行で区切られた単位）」を正確に抽出する
 */
/**
 * 翻訳テキストや日本語訳から【例文】や(例文)などの不要な接頭辞を除去しサニタイズ
 */
export function cleanTranslationText(text?: string): string {
  if (!text) return '';
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^【例文】\s*/g, '');
  cleaned = cleaned.replace(/^\(例文\)\s*/g, '');
  cleaned = cleaned.replace(/^\[例文\]\s*/g, '');
  cleaned = cleaned.replace(/^例文[:：]\s*/g, '');
  return cleaned.trim();
}

export function extractSingleSentence(text: string, focusToken?: string): string {
  if (!text) return '';
  const trimmed = text.trim();
  
  // 文末（. ! ? または 。 ！ ？ 改行）で1文単位に正確に分割
  const sentences = trimmed
    .replace(/([.!?]["']?)(?:\s+|\n+|$)/g, '$1\n')
    .replace(/([。！？])(?:\s+|\n+|$)/g, '$1\n')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  if (sentences.length <= 1) return trimmed;

  if (focusToken && focusToken.trim()) {
    const target = focusToken.toLowerCase().trim();
    const matched = sentences.find(s => s.toLowerCase().includes(target));
    if (matched) return matched;
  }

  return sentences[0];
}

export function saveSentenceCardWithSiblings(params: SaveSentenceCardParams): { card1: VocabItem; card2: VocabItem } {
  const vocabs = loadVocabs();
  const now = new Date().toISOString();
  const today = getTodayDateString();

  const id1 = 'voc_en_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
  const id2 = 'voc_ja_' + (Date.now() + 1) + '_' + Math.random().toString(36).substring(2, 6);

  const srs1 = calculateLapseSRS();
  const srs2 = calculateLapseSRS();

  const cleanSentence = extractSingleSentence(params.sentence, params.focusWord);
  const isWord = params.focusType === 'word';

  const phraseText = isWord && params.focusWord
    ? params.focusWord.trim()
    : cleanSentence;

  const meaningText = cleanTranslationText(
    isWord && params.focusMeaning
      ? params.focusMeaning.trim()
      : params.translation.trim()
  );

  const primaryNote = params.focusType === 'pattern' && params.corePatterns && params.corePatterns.length > 0
    ? (params.corePatterns[0].briefNote || params.corePatterns[0].meaningTemplate)
    : (params.focusMeaning ? cleanTranslationText(params.focusMeaning) : '');

  // Card 1: 英 ➔ 和 (読解・コンパイル用)
  const card1: VocabItem = {
    id: id1,
    phrase: phraseText,
    meaning: meaningText,
    partOfSpeech: isWord ? '単語・イディオム' : (params.focusType === 'pattern' ? '構文・文法' : '1文・表現'),
    contextNote: primaryNote,
    exampleSentence: cleanSentence,
    sentence: cleanSentence,
    translation: cleanTranslationText(params.translation),
    focusType: params.focusType,
    focusWord: isWord ? params.focusWord?.trim() : undefined,
    focusMeaning: isWord ? meaningText : undefined,
    corePatterns: params.corePatterns || [],
    cardDirection: 'en_to_ja',
    siblingId: id2,
    ...srs1,
    nextReviewDate: today,
    createdAt: now,
    lastReviewedAt: now,
    sourceStoryId: params.sourceStoryId,
    importance: params.importance || (params.focusType === 'pattern' ? 4 : 3),
    cardType: params.focusType === 'pattern' ? 'pattern' : 'vocab',
  };

  // Card 2: 和 ➔ 英 (瞬間英作文・組み立て用)
  // 両方のカードを本日復習対象として即時登録し、Ankiのシャッフルでランダムに出題
  const card2: VocabItem = {
    id: id2,
    phrase: phraseText,
    meaning: meaningText,
    partOfSpeech: isWord ? '単語・イディオム' : (params.focusType === 'pattern' ? '構文・文法' : '1文・表現'),
    contextNote: primaryNote,
    exampleSentence: cleanSentence,
    sentence: cleanSentence,
    translation: cleanTranslationText(params.translation),
    focusType: params.focusType,
    focusWord: isWord ? params.focusWord?.trim() : undefined,
    focusMeaning: isWord ? meaningText : undefined,
    corePatterns: params.corePatterns || [],
    cardDirection: 'ja_to_en',
    siblingId: id1,
    ...srs2,
    nextReviewDate: today, // 本日すぐに復習可能
    createdAt: now,
    lastReviewedAt: now,
    sourceStoryId: params.sourceStoryId,
    importance: params.importance || (params.focusType === 'pattern' ? 4 : 3),
    cardType: params.focusType === 'pattern' ? 'pattern' : 'vocab',
  };

  // 重複チェック:
  // 単語カードの場合は phrase + cardDirection でチェック
  // 文・構文カードの場合は sentence + cardDirection でチェック
  const matchFn1 = isWord
    ? (v: VocabItem) => v.phrase.toLowerCase() === card1.phrase.toLowerCase() && v.cardDirection === 'en_to_ja'
    : (v: VocabItem) => v.sentence === card1.sentence && v.cardDirection === 'en_to_ja';

  const existingIdx1 = vocabs.findIndex(matchFn1);
  if (existingIdx1 >= 0) {
    vocabs[existingIdx1] = { ...vocabs[existingIdx1], ...card1, id: vocabs[existingIdx1].id };
  } else {
    vocabs.unshift(card1);
  }

  const matchFn2 = isWord
    ? (v: VocabItem) => v.phrase.toLowerCase() === card2.phrase.toLowerCase() && v.cardDirection === 'ja_to_en'
    : (v: VocabItem) => v.sentence === card2.sentence && v.cardDirection === 'ja_to_en';

  const existingIdx2 = vocabs.findIndex(matchFn2);
  if (existingIdx2 >= 0) {
    vocabs[existingIdx2] = { ...vocabs[existingIdx2], ...card2, id: vocabs[existingIdx2].id };
  } else {
    vocabs.unshift(card2);
  }

  saveVocabsBatch(vocabs);
  return { card1, card2 };
}
