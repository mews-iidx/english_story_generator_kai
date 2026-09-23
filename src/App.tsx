import { ExtractedCorePattern } from './types/vocab';
import { ExpressionErrorItem } from './types/expressionError';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Header, NavTab } from './components/Header';
import { HistoryView } from './components/HistoryView';
import { StoryCreateView } from './components/StoryCreateView';
import { MasteryDashboardView } from './components/MasteryDashboardView';
import { ReaderView } from './components/ReaderView';
import { QuizView } from './components/QuizView';
import { DrillView } from './components/DrillView';
// import { ListeningLabView } from './components/ListeningLabView';
import { StoryQueueModal } from './components/StoryQueueModal';
import { StoryQueueTask } from './types/storyQueue';
import { AiMentorChatView } from './components/AiMentorChatView';
import { SettingsView } from './components/SettingsView';
import { CallView } from './components/CallView';
import { TranslationBottomSheet } from './components/TranslationBottomSheet';
import { ImportStoryModal } from './components/ImportStoryModal';

import { Story, ContentType, TargetEmbedding } from './types/story';
import { VocabItem } from './types/vocab';
import { DifficultSentenceItem, DifficultyReasonCategory } from './types/sentence';
import { ChatMessage, ChatSuggestedVocab } from './types/chat';
import { Persona, CallSession } from './types/persona';
import { AppSettings, DEFAULT_SETTINGS, CefrLevel } from './types/settings';

import {
  loadSettings,
  saveSettings,
  loadMasteryState,
  loadStories,
  saveStory,
  deleteStory as removeStoryFromStorage,
  recordStoryRead,
  loadVocabs,
  recordVocabLapse,
  saveSentenceCardWithSiblings,
  SaveSentenceCardParams,
  recordVocabMastered,
  deleteVocab as removeVocabFromStorage,
  saveVocabsBatch,
  isInvalidVocabMeaning,
  recordAnkiRating,
  saveSingleVocab,
  loadDifficultSentences,
  saveDifficultSentence,
  updateDifficultSentenceReason,
  deleteDifficultSentence as removeSentenceFromStorage,
  loadChatMessages,
  saveChatMessage,
  clearChatMessages,
  loadPersonas,
  savePersona,
  deletePersona as removePersonaFromStorage,
  resetPersonas,
  updatePersonaMemory,
  loadCallSessions,
  saveCallSession,
  updateCallSession,
  deleteCallSession,
  loadExpressionErrors,
  saveExpressionError,
  deleteExpressionError,
  addTokenUsage,
  resetAllData,
  loadStoryQueue,
  enqueueStoryTask,
  cancelStoryTask,
  removeStoryTask,
  updateStoryTask,
  clearStoryQueueHistory,
  sanitizeStuckStoryQueue,
  getUnmasteredTargetPatterns,
  getUnmasteredTargetVocabs,
} from './services/storage';

import { AppLogger } from './services/liveLogger';
import { generateStorySeriesWithGemini, fetchContextualWordMeaning,
  extractSentenceCorePatternsWithGemini } from './services/gemini';
import { translateWithGoogleFree } from './services/translate';
import { pickTargetVocabsForStory, pickTargetErrorPatternsForStory, extractRecentSummaries, getTodayDateString } from './utils/srs';
import { requestGoogleAccessToken, getOrCreateSpreadsheet, syncAllToGoogleSheets } from './services/googleSheets';

export const App: React.FC = () => {
  // メイン画面は本棚 (bookshelf)
  const [activeTab, setActiveTab] = useState<NavTab>('bookshelf');
  const [readingStory, setReadingStory] = useState<Story | null>(null);

  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [stories, setStories] = useState<Story[]>([]);
  const [vocabs, setVocabs] = useState<VocabItem[]>([]);
  const [difficultSentences, setDifficultSentences] = useState<DifficultSentenceItem[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [callSessions, setCallSessions] = useState<CallSession[]>([]);
  const [expressionErrors, setExpressionErrors] = useState<ExpressionErrorItem[]>([]);
  const [initialChatInput, setInitialChatInput] = useState('');
  const [dataVersion, setDataVersion] = useState(0);

  // リーダー画面上でのオーバーレイチャット状態
  const [isReaderChatOverlayOpen, setIsReaderChatOverlayOpen] = useState(false);
  const savedReaderScrollYRef = React.useRef<number>(0);



  // バックグラウンド生成状態
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingTheme, setGeneratingTheme] = useState('');
  const [generatingProgress, setGeneratingProgress] = useState<{ current: number; total: number; message: string } | undefined>(undefined);
  const [notificationToast, setNotificationToast] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  // 物語バックグラウンド順次生成キュー
  const [queueTasks, setQueueTasks] = useState<StoryQueueTask[]>(() => sanitizeStuckStoryQueue());
  const [isQueueModalOpen, setIsQueueModalOpen] = useState(false);
  const [isCallActive, setIsCallActive] = useState(false);
  const isProcessingQueueRef = React.useRef(false);

  // 単語・複数単語タップ選択＆ボトムシート翻訳状態
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [contextSentence, setContextSentence] = useState('');
  const [activeTargetEmbedding, setActiveTargetEmbedding] = useState<TargetEmbedding | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);

  // ブラウザバック / システム戻るジェスチャー対応
  useEffect(() => {
    const handlePopState = () => {
      if (isReaderChatOverlayOpen) {
        setIsReaderChatOverlayOpen(false);
        return;
      }
      if (isSheetOpen) {
        setIsSheetOpen(false);
        setSelectedText('');
        setActiveTargetEmbedding(null);
        return;
      }
      if (readingStory) {
        setReadingStory(null);
        return;
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isReaderChatOverlayOpen, isSheetOpen, readingStory]);

  // PWA インストールプロンプト
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallPWA = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  // 初期ロード＆壊れた意味データ（'要復習'など）の自動修復マイグレーション
  useEffect(() => {
    const s = loadSettings();
    const st = loadStories();
    const v = loadVocabs();
    const ds = loadDifficultSentences();
    const cm = loadChatMessages();
    const p = loadPersonas();
    const cs = loadCallSessions();

    setSettings(s);
    setStories(st);
    setVocabs(v);
    setDifficultSentences(ds);
    setChatMessages(cm);
    setPersonas(p);
    setCallSessions(cs);

    // 意味が「要復習」や空欄になっている語彙の自動翻訳修復
    const repairCorruptedVocabs = async () => {
      const corrupted = v.filter(item => isInvalidVocabMeaning(item.meaning));
      if (corrupted.length === 0) return;

      console.log(`[CompileEng] Auto-repairing ${corrupted.length} vocabularies with corrupted/missing meanings...`);
      let hasUpdates = false;
      const updatedVocabs = [...v];

      for (const item of corrupted) {
        try {
          const res = await translateWithGoogleFree(item.phrase, s.geminiApiKey);
          if (res?.translatedText && res.translatedText.trim() && res.translatedText.trim() !== item.phrase) {
            const idx = updatedVocabs.findIndex(x => x.id === item.id);
            if (idx >= 0) {
              updatedVocabs[idx] = {
                ...updatedVocabs[idx],
                meaning: res.translatedText.trim(),
              };
              hasUpdates = true;
            }
          }
        } catch (e) {
          console.warn(`[CompileEng] Auto-repair failed for "${item.phrase}":`, e);
        }
      }

      if (hasUpdates) {
        saveVocabsBatch(updatedVocabs);
        setVocabs(updatedVocabs);
        console.log(`[CompileEng] Successfully repaired ${corrupted.length} vocabulary meanings!`);
      }
    };

    repairCorruptedVocabs();
  }, []);

  // 今日の復習期日語彙（重要度順に選出）
  const dueVocabs = useMemo(() => {
    return pickTargetVocabsForStory(vocabs, 4);
  }, [vocabs]);

  const dueCount = useMemo(() => {
    const today = getTodayDateString();
    return vocabs.filter(v => v.nextReviewDate <= today || v.cardState === 'learning' || v.cardState === 'relearning').length;
  }, [vocabs]);

  const savedVocabPhrases = useMemo(() => {
    // 単語帳に「要復習（習得中）」として登録中の単語
    const mastery = loadMasteryState();
    return new Set(
      vocabs
        .filter(v => {
          const st = mastery.vocabs[v.phrase.toLowerCase()]?.status;
          if (st === 'mastered') return false;
          return (v.repetitionCount || 0) < 4;
        })
        .map(v => v.phrase.toLowerCase())
    );
  }, [vocabs]);

  const isSavedAsVocab = useMemo(() => {
    if (!selectedText) return false;
    return savedVocabPhrases.has(selectedText.trim().toLowerCase());
  }, [selectedText, savedVocabPhrases]);



  // トースト表示タイマー
  useEffect(() => {
    if (notificationToast) {
      const timer = setTimeout(() => setNotificationToast(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [notificationToast]);

  // Google Sheets 自動同期
  const triggerAutoSync = useCallback(async (currentVocabs: VocabItem[], currentStories: Story[]) => {
    if (!settings.googleAccessToken || !settings.googleSpreadsheetId) return;
    try {
      setIsSyncing(true);
      await syncAllToGoogleSheets(
        settings.googleSpreadsheetId,
        settings.googleAccessToken,
        currentVocabs,
        currentStories
      );
      const updatedSettings = { ...settings, lastSyncedAt: new Date().toISOString() };
      setSettings(updatedSettings);
      saveSettings(updatedSettings);
    } catch (e) {
      console.warn('Auto sync failed:', e);
    } finally {
      setIsSyncing(false);
    }
  }, [settings]);

  const handleRecordTokenUsage = (promptTokens: number, candidatesTokens: number) => {
    addTokenUsage(promptTokens, candidatesTokens);
    setSettings(loadSettings());
  };

  // バックグラウンド非同期ストーリー/スクリプト生成ハンドラー

  // ===================== STORY QUEUE WORKER =====================
  const processNextQueueTask = useCallback(async () => {
    if (isProcessingQueueRef.current) return;
    const currentQueue = loadStoryQueue();
    const nextTask = currentQueue.find(t => t.status === 'pending');
    
    // 待機中タスクがない場合は生成状態を確実に解除
    if (!nextTask) {
      isProcessingQueueRef.current = false;
      setIsGenerating(false);
      setGeneratingTheme('');
      setGeneratingProgress(undefined);
      setQueueTasks(currentQueue);
      return;
    }

    if (!settings.geminiApiKey) {
      updateStoryTask(nextTask.id, t => ({ ...t, status: 'failed', error: 'APIキーが設定されていません' }));
      setQueueTasks(loadStoryQueue());
      setIsGenerating(false);
      return;
    }

    isProcessingQueueRef.current = true;
    setIsGenerating(true);
    setGeneratingTheme(nextTask.title || '物語');

    updateStoryTask(nextTask.id, t => ({ ...t, status: 'generating', startedAt: new Date().toISOString() }));
    setQueueTasks(loadStoryQueue());

    try {
      const currentStoryList = loadStories();
      const recentSummaries = extractRecentSummaries(currentStoryList, 5);
      const currentVocabs = loadVocabs();
      const errorList = loadExpressionErrors();

      const selectedDueVocabs = pickTargetVocabsForStory(currentVocabs, 4, currentStoryList);
      const targetErrorPatterns = pickTargetErrorPatternsForStory(errorList, 2);
      const levelKey = (settings.cefrLevel === 'C1' ? 'B2' : settings.cefrLevel) as 'A1' | 'A2' | 'B1' | 'B2';
      const targetPatterns = getUnmasteredTargetPatterns(levelKey, 3);
      const targetVocabMaster = getUnmasteredTargetVocabs(levelKey, 4);

      const res = await generateStorySeriesWithGemini(
        {
          apiKey: settings.geminiApiKey,
          model: settings.geminiModel,
          cefrLevel: nextTask.params?.cefrLevel || settings.cefrLevel,
          contentType: nextTask.params?.contentType || 'story',
          storyCount: nextTask.storyCount || 1,
          isContinuous: nextTask.seriesType === 'continuous',
          userPrompt: nextTask.params?.userPrompt || nextTask.title,
          targetVocabs: selectedDueVocabs,
          targetPatterns,
          targetVocabMaster,
          targetErrorPatterns,
          recentSummaries,
          targetWordCount: nextTask.params?.targetWordCount || 700,
        },
        (current, total, message) => {
          updateStoryTask(nextTask.id, t => ({
            ...t,
            currentEpisodeIndex: current,
            totalEpisodes: total,
            progressMessage: message,
          }));
          setQueueTasks(loadStoryQueue());
          setGeneratingProgress({ current, total, message });
        }
      );

      // ストーリー保存 & 連載番号付け (1/2, 2/2...)
      const currentList = loadStories();
      const seriesId = nextTask.seriesId;

      if (seriesId) {
        const existingSeriesStories = currentList.filter(s => s.seriesId === seriesId);
        const newEpIndex = existingSeriesStories.length + 1;
        const newTotalEp = newEpIndex;

        // 生成されたストーリーに episodeIndex と totalEpisodes を設定
        res.stories.forEach((story, idx) => {
          story.seriesId = seriesId;
          story.episodeIndex = newEpIndex + idx;
          story.totalEpisodes = newTotalEp;
          story.seriesType = 'continuous';
          saveStory(story);
        });

        // 既存のエピソードの totalEpisodes を更新
        existingSeriesStories.forEach(s => {
          s.totalEpisodes = newTotalEp;
          s.seriesType = 'continuous';
          saveStory(s);
        });
      } else {
        res.stories.forEach(story => {
          story.episodeIndex = 1;
          story.totalEpisodes = 1;
          saveStory(story);
        });
      }

      if (res.totalPromptTokens || res.totalCandidatesTokens) {
        handleRecordTokenUsage(res.totalPromptTokens, res.totalCandidatesTokens);
      }

      updateStoryTask(nextTask.id, t => ({
        ...t,
        status: 'completed',
        completedAt: new Date().toISOString(),
        generatedStoryIds: res.stories.map(s => s.id),
      }));

      const updatedStories = loadStories();
      setStories(updatedStories);
      setQueueTasks(loadStoryQueue());
      setNotificationToast(`🎉 『${nextTask.title}』の生成が完了しました！`);
      triggerAutoSync(vocabs, updatedStories);
    } catch (err: any) {
      console.error('Queue task execution failed', err);
      AppLogger.error('story', 'STORY_QUEUE_TASK_FAILED', `キュータスク『${nextTask.title}』の実行に失敗しました: ${err?.message || err}`, {
        taskId: nextTask.id,
        taskTitle: nextTask.title,
        error: err?.message || String(err),
        stack: err?.stack,
        params: nextTask.params,
      });
      updateStoryTask(nextTask.id, t => ({
        ...t,
        status: 'failed',
        error: err?.message || '生成エラーが発生しました',
      }));
      setQueueTasks(loadStoryQueue());
      setNotificationToast(`⚠️ 『${nextTask.title}』の生成中にエラーが発生しました`);
    } finally {
      isProcessingQueueRef.current = false;
      const remainingQueue = loadStoryQueue();
      const hasMore = remainingQueue.some(t => t.status === 'pending');
      setIsGenerating(hasMore);
      setQueueTasks(remainingQueue);
      if (!hasMore) {
        setGeneratingTheme('');
        setGeneratingProgress(undefined);
      } else {
        // 次のタスクへ連続実行
        setTimeout(() => {
          processNextQueueTask();
        }, 300);
      }
    }
  }, [settings, vocabs, handleRecordTokenUsage, triggerAutoSync]);

  // キュー変更監視
  useEffect(() => {
    const hasPending = queueTasks.some(t => t.status === 'pending');
    if (hasPending && !isProcessingQueueRef.current) {
      processNextQueueTask();
    } else if (!hasPending && !queueTasks.some(t => t.status === 'generating')) {
      if (isGenerating) {
        setIsGenerating(false);
        setGeneratingTheme('');
        setGeneratingProgress(undefined);
      }
    }
  }, [queueTasks, processNextQueueTask, isGenerating]);

  // 次話（続き）のキュー追加
  const handleQueueNextEpisode = (story: Story) => {
    const title = story.titleJa || story.title;
    let seriesId = story.seriesId;
    if (!seriesId) {
      seriesId = 'series_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      story.seriesId = seriesId;
      story.episodeIndex = 1;
      story.totalEpisodes = 1;
      story.seriesType = 'continuous';
      saveStory(story);
      setStories(loadStories());
    }

    const currentEpIndex = story.episodeIndex || 1;
    const nextEpIndex = currentEpIndex + 1;
    const taskTitle = `『${title}』の続き (第${nextEpIndex}話)`;
    const promptText = `前話「${title}」のあらすじ: ${story.summary || '主人公たちの物語'}。この物語の自然な続きとなる第${nextEpIndex}話を執筆してください。`;

    enqueueStoryTask({
      title: taskTitle,
      topic: story.summary,
      seriesId,
      seriesType: 'continuous',
      storyCount: 1,
      totalEpisodes: nextEpIndex,
      params: {
        apiKey: settings.geminiApiKey,
        model: settings.geminiModel,
        cefrLevel: story.cefrLevel || settings.cefrLevel,
        contentType: story.contentType || 'story',
        userPrompt: promptText,
        targetVocabs: [],
        recentSummaries: [],
        targetWordCount: story.actualWordCount || 700,
      },
    });

    setQueueTasks(loadStoryQueue());
    setNotificationToast(`⏳ ${taskTitle} を生成キューに追加しました！`);
  };

  const handleCancelQueueTask = (taskId: string) => {
    const updated = cancelStoryTask(taskId);
    setQueueTasks(updated);
    const hasPendingOrGenerating = updated.some(t => t.status === 'pending' || t.status === 'generating');
    if (!hasPendingOrGenerating) {
      isProcessingQueueRef.current = false;
      setIsGenerating(false);
      setGeneratingTheme('');
      setGeneratingProgress(undefined);
    }
  };

  const handleRemoveQueueTask = (taskId: string) => {
    const updated = removeStoryTask(taskId);
    setQueueTasks(updated);
  };

  const handleRetryQueueTask = (task: StoryQueueTask) => {
    updateStoryTask(task.id, t => ({ ...t, status: 'pending', error: undefined }));
    setQueueTasks(loadStoryQueue());
  };

  const handleClearQueueHistory = () => {
    const updated = clearStoryQueueHistory();
    setQueueTasks(updated);
  };

  const handleGenerateStoryInBackground = (
    userPrompt?: string,
    wordCount = 700,
    contentType: ContentType = 'podcast'
  ) => {
    if (!settings.geminiApiKey) {
      alert('Gemini APIキーが設定されていません。右上の「設定」からAPIキーを入力してください。');
      setActiveTab('settings');
      return;
    }

    const title = userPrompt ? `『${userPrompt.slice(0, 20)}』` : '新しいストーリー';

    enqueueStoryTask({
      title,
      topic: userPrompt,
      seriesType: 'single',
      storyCount: 1,
      totalEpisodes: 1,
      params: {
        apiKey: settings.geminiApiKey,
        model: settings.geminiModel,
        cefrLevel: settings.cefrLevel,
        contentType,
        userPrompt,
        targetVocabs: [],
        recentSummaries: [],
        targetWordCount: wordCount,
      },
    });

    setQueueTasks(loadStoryQueue());
    setNotificationToast(`⏳ ${title} を生成キューに追加しました！`);
  };

  // 外部JSONインポートハンドラー
  const handleImportStory = (story: Story) => {
    saveStory(story);
    const updatedStories = [story, ...stories.filter(s => s.id !== story.id)];
    setStories(updatedStories);
    setActiveTab('bookshelf');
    setReadingStory(story);
    triggerAutoSync(vocabs, updatedStories);
  };

  // 単語・複数単語タップ時の即時翻訳（4-tier fallback & 構文バインディング）
  const handleWordOrPhraseTap = async (text: string, sentence: string, targetEmbedding?: TargetEmbedding) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    setSelectedText(trimmed);
    setContextSentence(sentence);
    setActiveTargetEmbedding(targetEmbedding || null);
    setIsSheetOpen(true);
    setIsTranslating(true);
    setTranslatedText('翻訳中...');

    try {
      const res = await translateWithGoogleFree(trimmed, settings.geminiApiKey);
      setTranslatedText(res.translatedText);
    } catch (e) {
      setTranslatedText('（翻訳取得失敗）');
    } finally {
      setIsTranslating(false);
    }
  };

  const handleClearSelection = () => {
    setSelectedText('');
    setActiveTargetEmbedding(null);
    setIsSheetOpen(false);
  };

  // 単語・構文を弱点リストに追加 / Lapse記録
  // 1文カード（英和・和英の兄弟カード）を自動生成して保存
  const handleSaveSentenceCard = async (params: SaveSentenceCardParams) => {
    let finalParams = { ...params };

    // 単語カードで文の翻訳がまだ単語の訳のままになっている場合、1文丸ごとを文単位で翻訳
    if (params.focusType === 'word' && params.sentence && params.focusWord) {
      if (!params.translation || params.translation === params.focusMeaning || params.translation.length <= 10) {
        try {
          const res = await translateWithGoogleFree(params.sentence, settings.geminiApiKey);
          if (res.translatedText && !res.translatedText.includes('（翻訳取得失敗）')) {
            finalParams.translation = res.translatedText;
          }
        } catch (e) {
          console.warn('Failed to translate full sentence for Anki card:', e);
        }
      }
    }

    saveSentenceCardWithSiblings({
      ...finalParams,
      sourceStoryId: readingStory?.id,
    });
    const updatedVocabs = loadVocabs();
    setVocabs(updatedVocabs);
    triggerAutoSync(updatedVocabs, stories);
  };

  // 選択文から2〜3個の構造化構文骨格仮説を抽出
  const handleExtractCorePatterns = async (): Promise<ExtractedCorePattern[]> => {
    if (!settings.geminiApiKey) {
      alert('Gemini APIキーを設定してください');
      return [];
    }
    const res = await extractSentenceCorePatternsWithGemini(
      selectedText,
      translatedText,
      settings.geminiApiKey,
      settings.geminiModel
    );
    if (res.tokenUsage) {
      handleRecordTokenUsage(res.tokenUsage.promptTokens, res.tokenUsage.candidatesTokens);
    }
    return res.patterns;
  };

  const handleAddToVocab = (phrase: string, meaning: string, sentence?: string, note?: string) => {
    const lookup = {
      phrase,
      meaning: !isInvalidVocabMeaning(meaning) ? meaning.trim() : '',
      part_of_speech: 'word/phrase',
      explanation: note || '',
      context_sentence: sentence || '',
    };
    recordVocabLapse(lookup, readingStory?.id);
    const updatedVocabs = loadVocabs();
    setVocabs(updatedVocabs);
    triggerAutoSync(updatedVocabs, stories);
  };

  // 訳せなかった文を保存
  const handleSaveDifficultSentence = (sentence: string, translation: string, phrase: string) => {
    saveDifficultSentence({
      sentence: sentence.trim(),
      translation: translation.trim(),
      highlightedPhrase: phrase.trim(),
      sourceStoryId: readingStory?.id,
      sourceStoryTitle: readingStory?.title,
    });
    setDifficultSentences(loadDifficultSentences());
  };

  const handleUpdateSentenceReason = (sentenceId: string, category: DifficultyReasonCategory, note: string) => {
    updateDifficultSentenceReason(sentenceId, category, note);
    setDifficultSentences(loadDifficultSentences());
  };

  const handleDeleteDifficultSentence = (id: string) => {
    removeSentenceFromStorage(id);
    setDifficultSentences(loadDifficultSentences());
  };

  const handleSaveExpressionError = (item: any) => {
    const saved = saveExpressionError(item);
    setExpressionErrors(loadExpressionErrors());
    return saved;
  };

  const handleDeleteExpressionError = (errorId: string) => {
    deleteExpressionError(errorId);
    setExpressionErrors(loadExpressionErrors());
  };

  // Anki 4段階評価
  const handleRateAnkiCard = (vocabId: string, rating: 'again' | 'hard' | 'good' | 'easy') => {
    recordAnkiRating(vocabId, rating);
    const updated = loadVocabs();
    setVocabs(updated);
    triggerAutoSync(updated, stories);
  };

  // Anki レーティングの取り消し (Undo)
  const handleRevertAnkiCard = (previousCard: VocabItem) => {
    saveSingleVocab(previousCard);
    const updated = loadVocabs();
    setVocabs(updated);
    triggerAutoSync(updated, stories);
  };

  // 読了記録
  const handleRecordStoryRead = (storyId: string, wpm?: number) => {
    recordStoryRead(storyId, wpm);
    setStories(loadStories());
  };

  // AIメンターチャット メッセージ送信ハンドラー
  const handleSendChatMessage = (userText: string, assistantReply: string, suggestedVocabs: ChatSuggestedVocab[]) => {
    const userMsg: ChatMessage = {
      id: 'msg_u_' + Date.now(),
      sender: 'user',
      text: userText,
      createdAt: new Date().toISOString(),
    };
    const botMsg: ChatMessage = {
      id: 'msg_b_' + (Date.now() + 1),
      sender: 'assistant',
      text: assistantReply,
      suggestedVocabs,
      createdAt: new Date().toISOString(),
    };

    saveChatMessage(userMsg);
    saveChatMessage(botMsg);
    setChatMessages(loadChatMessages());
  };

  const handleClearChat = () => {
    clearChatMessages();
    setChatMessages(loadChatMessages());
  };

  // Language Exchange ペルソナ操作ハンドラー
  const handleSavePersona = (persona: Persona) => {
    savePersona(persona);
    setPersonas(loadPersonas());
  };

  const handleDeletePersona = (personaId: string) => {
    removePersonaFromStorage(personaId);
    setPersonas(loadPersonas());
  };

  const handleResetPersonas = () => {
    const p = resetPersonas();
    setPersonas(p);
  };

  const handleUpdatePersonaMemory = (
    personaId: string,
    memoryUpdates: {
      newLikes?: string[];
      newDislikes?: string[];
      newTopic?: { topic: string; summary: string };
      newUserNotes?: string[];
      newPromises?: string[];
    },
    lastSpokenAt?: string
  ) => {
    updatePersonaMemory(personaId, memoryUpdates, lastSpokenAt);
    setPersonas(loadPersonas());
  };

  const handleSaveCallSession = (session: CallSession) => {
    saveCallSession(session);
    setCallSessions(loadCallSessions());
  };

  const handleUpdateCallSession = (sessionId: string, updater: (s: CallSession) => CallSession) => {
    const updated = updateCallSession(sessionId, updater);
    setCallSessions(loadCallSessions());
    return updated;
  };

  const handleDeleteCallSession = (sessionId: string) => {
    deleteCallSession(sessionId);
    setCallSessions(loadCallSessions());
  };

  // ボトムシート「AIに質問」を押した時
  const handleOpenChatWithSelection = (customText?: string) => {
    const targetText = customText || selectedText;
    if (targetText && targetText.trim()) {
      setInitialChatInput(`「${targetText.trim()}」`);
    } else {
      setInitialChatInput('');
    }

    if (readingStory) {
      // 現在の読書スクロール位置を確実に記憶
      savedReaderScrollYRef.current = window.scrollY || document.documentElement.scrollTop || 0;
      // リーダー画面では画面遷移せずオーバーレイドロワーを開く
      setIsSheetOpen(false);
      setIsReaderChatOverlayOpen(true);
    } else {
      setActiveTab('chat');
    }
  };

  const handleCloseReaderChatOverlay = () => {
    setIsReaderChatOverlayOpen(false);
    const targetScrollY = savedReaderScrollYRef.current;
    // スクロール位置を即座に復元
    requestAnimationFrame(() => {
      window.scrollTo({ top: targetScrollY, behavior: 'instant' });
      setTimeout(() => {
        window.scrollTo({ top: targetScrollY, behavior: 'instant' });
      }, 50);
    });
  };

  // AIによる文脈に即した単語の意味取得
  const handleFetchContextualMeaning = async (): Promise<{ meaning: string; partOfSpeech?: string }> => {
    if (!settings.geminiApiKey) {
      alert('Gemini APIキーを設定してください');
      return { meaning: '' };
    }
    const res = await fetchContextualWordMeaning(
      selectedText,
      contextSentence,
      settings.geminiApiKey,
      settings.geminiModel
    );

    if (res.tokenUsage) {
      handleRecordTokenUsage(res.tokenUsage.promptTokens, res.tokenUsage.candidatesTokens);
    }

    return { meaning: res.meaning, partOfSpeech: res.partOfSpeech };
  };



  // レベル変更（A1, A2, B1, B2, C1）
  const handleLevelChange = (lvl: CefrLevel) => {
    const updated: AppSettings = { ...settings, cefrLevel: lvl };
    setSettings(updated);
    saveSettings(updated);
  };

  const handleMasterVocab = (vocabId: string) => {
    recordVocabMastered(vocabId);
    const updated = loadVocabs();
    setVocabs(updated);
    triggerAutoSync(updated, stories);
  };

  const handleDeleteVocab = (vocabId: string) => {
    removeVocabFromStorage(vocabId);
    const updated = loadVocabs();
    setVocabs(updated);
    triggerAutoSync(updated, stories);
  };

  const handleUpdateVocab = (updatedCard: VocabItem) => {
    saveSingleVocab(updatedCard);
    const updated = loadVocabs();
    setVocabs(updated);
    triggerAutoSync(updated, stories);
  };

  const handleDeleteStory = (storyId: string) => {
    if (confirm('このストーリーを本棚から削除しますか？')) {
      removeStoryFromStorage(storyId);
      const updated = loadStories();
      setStories(updated);
      if (readingStory?.id === storyId) {
        setReadingStory(null);
      }
      triggerAutoSync(vocabs, updated);
    }
  };

  const handleSaveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
  };

  const handleGoogleConnect = async () => {
    try {
      setIsSyncing(true);
      const token = await requestGoogleAccessToken(settings.googleClientId);
      const spreadsheetId = await getOrCreateSpreadsheet(token, settings.googleSpreadsheetId);
      
      const updatedSettings: AppSettings = {
        ...settings,
        googleAccessToken: token,
        googleSpreadsheetId: spreadsheetId,
        lastSyncedAt: new Date().toISOString(),
      };
      setSettings(updatedSettings);
      saveSettings(updatedSettings);

      await syncAllToGoogleSheets(spreadsheetId, token, vocabs, stories);
      alert('Google Drive連携が完了しました！専用スプレッドシートにデータが同期されました。');
    } catch (err: any) {
      console.error('Google connect error', err);
      alert(`Google連携に失敗しました: ${err.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleGoogleManualSync = async () => {
    if (!settings.googleSpreadsheetId || !settings.googleClientId) {
      alert('Google Client IDとスプレッドシート連携を先に完了してください。');
      return;
    }
    try {
      setIsSyncing(true);
      const token = settings.googleAccessToken || await requestGoogleAccessToken(settings.googleClientId);
      await syncAllToGoogleSheets(settings.googleSpreadsheetId, token, vocabs, stories);
      
      const updatedSettings = {
        ...settings,
        googleAccessToken: token,
        lastSyncedAt: new Date().toISOString(),
      };
      setSettings(updatedSettings);
      saveSettings(updatedSettings);
      alert('Googleスプレッドシートとの同期が完了しました！');
    } catch (err: any) {
      alert(`同期エラー: ${err.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDataImported = () => {
    setDataVersion(v => v + 1);
    setStories(loadStories());
    setVocabs(loadVocabs());
    setDifficultSentences(loadDifficultSentences());
    setChatMessages(loadChatMessages());
    setPersonas(loadPersonas());
    setCallSessions(loadCallSessions());
    setExpressionErrors(loadExpressionErrors());
    setSettings(loadSettings());
  };

  const handleResetAllData = () => {
    resetAllData();
    setDataVersion(v => v + 1);
    setStories([]);
    setVocabs([]);
    setDifficultSentences([]);
    setChatMessages([]);
    setPersonas(resetPersonas());
    setCallSessions([]);
    setReadingStory(null);
    setSelectedText('');
    setIsSheetOpen(false);
    setSettings(loadSettings());
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-blue-600 selection:text-white">
      <Header
        isReading={Boolean(readingStory)}
        activeTab={activeTab}
        setActiveTab={(tab) => {
          setActiveTab(tab);
          setReadingStory(null);
          setIsReaderChatOverlayOpen(false);
        }}
        dueCount={dueCount}
        isSyncing={isSyncing}
        hasGoogleSync={Boolean(settings.googleSpreadsheetId)}
        onSyncClick={handleGoogleManualSync}
        canInstallPWA={Boolean(deferredPrompt)}
        onInstallPWA={handleInstallPWA}
        isGenerating={isGenerating}
        generatingTheme={generatingTheme}
        isCallActive={isCallActive}
      />

      {/* Non-intrusive notification toast for completed background generation */}
      {notificationToast && (
        <div className="fixed top-16 right-4 z-50 max-w-sm bg-blue-600/95 border border-blue-400 text-white px-4 py-3 rounded-2xl shadow-2xl backdrop-blur-md animate-slideDown flex items-center justify-between gap-3">
          <span className="text-xs sm:text-sm font-semibold">{notificationToast}</span>
          <button
            onClick={() => setNotificationToast(null)}
            className="text-white/80 hover:text-white text-xs font-bold px-1.5 py-0.5 rounded-lg hover:bg-blue-700/50"
          >
            ✕
          </button>
        </div>
      )}

      <main className="flex-1 pb-24 md:pb-12">
        {/* 読書・リスニングモード (Reader View): 本棚で本を開いたときに表示 */}
        {readingStory ? (
          <ReaderView
            currentStory={readingStory}
            onUpdateStory={(updated) => {
              setReadingStory(updated);
              setStories(prev => prev.map(s => s.id === updated.id ? updated : s));
            }}
            allStories={stories}
            vocabs={vocabs}
            difficultSentences={difficultSentences}
            onWordOrPhraseTap={handleWordOrPhraseTap}
            selectedPhrase={selectedText}
            onClearSelection={handleClearSelection}
            onSaveDifficultSentence={handleSaveDifficultSentence}
            onUpdateSentenceReason={handleUpdateSentenceReason}
            onRecordStoryRead={handleRecordStoryRead}
            onQueueNextEpisode={handleQueueNextEpisode}
            onSelectStory={(story) => {
              window.history.pushState({ view: 'reading', storyId: story.id }, '', '');
              setReadingStory(story);
              setSelectedText('');
              setIsSheetOpen(false);
              setIsReaderChatOverlayOpen(false);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            onBackToBookshelf={() => {
              setReadingStory(null);
              setIsReaderChatOverlayOpen(false);
              if (window.history.state?.view === 'reading') {
                window.history.back();
              }
            }}
          />
        ) : (
          <>
            {/* 1. Main Home: Bookshelf Tab */}
            {activeTab === 'bookshelf' && (
              <HistoryView
                stories={stories}
                onSelectStory={(story) => {
                  window.history.pushState({ view: 'reading', storyId: story.id }, '', '');
                  setReadingStory(story);
                  setSelectedText('');
                  setIsSheetOpen(false);
                  setIsReaderChatOverlayOpen(false);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                onDeleteStory={handleDeleteStory}
                onNavigateToCreate={() => setActiveTab('create')}
                isGenerating={isGenerating}
                generatingTheme={generatingTheme}
                queueTasks={queueTasks}
                onOpenQueueModal={() => setIsQueueModalOpen(true)}
                onQueueNextEpisode={handleQueueNextEpisode}
              />
            )}

            {/* 1.5 Drill Tab (瞬間ドリル・仕分け機) */}
            {activeTab === 'drill' && (
              <DrillView
                apiKey={settings.geminiApiKey}
                selectedModel={settings.geminiModel}
                userLevel={settings.cefrLevel}
                onNavigateToAnki={() => setActiveTab('quiz')}
              />
            )}

            {/* 1.8 Listening Bandwidth Lab Tab (一時コメントアウト・後で復活可能) */}
            {/* {activeTab === 'listening_lab' && (
              <ListeningLabView
                apiKey={settings.geminiApiKey}
                selectedModel={settings.geminiModel}
                userLevel={settings.cefrLevel}
              />
            )} */}

            {/* 2. Story / Script Creation Studio Tab */}
            {activeTab === 'create' && (
              <StoryCreateView
                currentLevel={settings.cefrLevel}
                onLevelChange={handleLevelChange}
                isGenerating={isGenerating}
                generatingTheme={generatingTheme}
                generatingProgress={generatingProgress}
                queueTasks={queueTasks}
                onOpenQueueModal={() => setIsQueueModalOpen(true)}
                onGenerateStory={handleGenerateStoryInBackground}
                onOpenImportModal={() => setIsImportModalOpen(true)}
                onNavigateToBookshelf={() => setActiveTab('bookshelf')}
              />
            )}

            {/* Mastery & Integrated Vocab Bank Tab */}
            {activeTab === 'mastery' && (
              <MasteryDashboardView
                key={dataVersion}
                onNavigateToCreate={() => setActiveTab('create')}
                savedVocabs={vocabs}
                difficultSentences={difficultSentences}
                expressionErrors={expressionErrors}
                stories={stories}
                onMasterVocab={handleMasterVocab}
                onDeleteVocab={handleDeleteVocab}
                onDeleteSentence={handleDeleteDifficultSentence}
                onDeleteExpressionError={handleDeleteExpressionError}
              />
            )}

            {/* 3. Live AI English Call Tab */}
            {activeTab === 'call' && (
              <CallView
                apiKey={settings.geminiApiKey}
                model={settings.geminiModel}
                personas={personas}
                callSessions={callSessions}
                onSavePersona={handleSavePersona}
                onDeletePersona={handleDeletePersona}
                onResetPersonas={handleResetPersonas}
                onUpdatePersonaMemory={handleUpdatePersonaMemory}
                onSaveCallSession={handleSaveCallSession}
                onUpdateCallSession={handleUpdateCallSession}
                onDeleteCallSession={handleDeleteCallSession}
                onAddToVocab={handleAddToVocab}
                onSaveSentenceCard={handleSaveSentenceCard}
                onSaveExpressionError={handleSaveExpressionError}
                onRecordTokenUsage={handleRecordTokenUsage}
                savedVocabPhrases={savedVocabPhrases}
                onCallStateChange={(active: boolean) => setIsCallActive(active)}
              />
            )}

            {/* 4. AI Mentor Chat Tab */}
            {activeTab === 'chat' && (
              <AiMentorChatView
                apiKey={settings.geminiApiKey}
                model={settings.geminiModel}
                messages={chatMessages}
                onSendMessage={handleSendChatMessage}
                onAddToVocab={handleAddToVocab}
                onClearChat={handleClearChat}
                onRecordTokenUsage={handleRecordTokenUsage}
                savedVocabPhrases={savedVocabPhrases}
                initialInput={initialChatInput}
              />
            )}

            {/* 5. Anki & Interactive Quiz Tab */}
            {activeTab === 'quiz' && (
              <QuizView
                apiKey={settings.geminiApiKey}
                model={settings.geminiModel}
                cefrLevel={settings.cefrLevel}
                onLevelChange={handleLevelChange}
                vocabs={vocabs}
                dueVocabs={dueVocabs}
                onAddToVocab={handleAddToVocab}
                onUpdateVocab={handleUpdateVocab}
                onDeleteVocab={handleDeleteVocab}
                onRecordTokenUsage={handleRecordTokenUsage}
                onRateAnkiCard={handleRateAnkiCard}
                onRevertAnkiCard={handleRevertAnkiCard}
              />
            )}

            {/* 6. Settings Tab */}
            {activeTab === 'settings' && (
              <SettingsView
                settings={settings}
                onSaveSettings={handleSaveSettings}
                onGoogleConnect={handleGoogleConnect}
                onGoogleSync={handleGoogleManualSync}
                isSyncing={isSyncing}
                onDataImported={handleDataImported}
                onResetAllData={handleResetAllData}
                canInstallPWA={Boolean(deferredPrompt)}
                onInstallPWA={handleInstallPWA}
              />
            )}
          </>
        )}
      </main>

            {/* 物語バックグラウンド順次生成キュー モーダル */}
      <StoryQueueModal
        isOpen={isQueueModalOpen}
        onClose={() => setIsQueueModalOpen(false)}
        tasks={queueTasks}
        onCancelTask={handleCancelQueueTask}
        onRemoveTask={handleRemoveQueueTask}
        onRetryTask={handleRetryQueueTask}
        onClearHistory={handleClearQueueHistory}
        isProcessing={isGenerating}
      />

      {/* リーダー画面上のオーバーレイAIチャットドロワー */}
      {readingStory && isReaderChatOverlayOpen && (
        <div 
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-end animate-fadeIn"
          onClick={handleCloseReaderChatOverlay}
        >
          <div 
            className="w-full max-w-lg h-full bg-slate-950 border-l border-slate-800 shadow-2xl animate-slideLeft flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <AiMentorChatView
              apiKey={settings.geminiApiKey}
              model={settings.geminiModel}
              messages={chatMessages}
              onSendMessage={handleSendChatMessage}
              onAddToVocab={handleAddToVocab}
              onClearChat={handleClearChat}
              onRecordTokenUsage={handleRecordTokenUsage}
              savedVocabPhrases={savedVocabPhrases}
              initialInput={initialChatInput}
              isOverlayMode={true}
              onClose={handleCloseReaderChatOverlay}
            />
          </div>
        </div>
      )}

      {/* 外部AIプロンプト / JSONインポートモーダル */}
      <ImportStoryModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        cefrLevel={settings.cefrLevel}
        dueVocabs={dueVocabs}
        onImportStory={handleImportStory}
      />

      {/* スマホChrome風ボトムシート翻訳 (1文カード & 構文抽出対応) */}
      <TranslationBottomSheet
        isOpen={isSheetOpen}
        onClose={() => {
          setIsSheetOpen(false);
          setSelectedText('');
          setActiveTargetEmbedding(null);
        }}
        originalText={selectedText}
        translatedText={translatedText}
        contextSentence={contextSentence}
        targetEmbedding={activeTargetEmbedding}
        isLoading={isTranslating}
        isSavedAsVocab={isSavedAsVocab}
        onAddToVocab={handleAddToVocab}
        onSaveSentenceCard={handleSaveSentenceCard}
        onFetchContextualMeaning={handleFetchContextualMeaning}
        onExtractCorePatterns={handleExtractCorePatterns}
        onOpenChatMentor={(text) => handleOpenChatWithSelection(text)}
      />
    </div>
  );
};

export default App;