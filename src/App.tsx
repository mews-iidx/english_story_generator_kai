import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Header, NavTab } from './components/Header';
import { HistoryView } from './components/HistoryView';
import { StoryCreateView } from './components/StoryCreateView';
import { ReaderView } from './components/ReaderView';
import { QuizView } from './components/QuizView';
import { VocabBankView } from './components/VocabBankView';
import { SettingsView } from './components/SettingsView';
import { TranslationBottomSheet } from './components/TranslationBottomSheet';
import { ImportStoryModal } from './components/ImportStoryModal';

import { Story } from './types/story';
import { VocabItem } from './types/vocab';
import { DifficultSentenceItem } from './types/sentence';
import { AppSettings, DEFAULT_SETTINGS, CefrLevel } from './types/settings';

import {
  loadSettings,
  saveSettings,
  loadStories,
  saveStory,
  deleteStory as removeStoryFromStorage,
  loadVocabs,
  recordVocabLapse,
  recordVocabMastered,
  deleteVocab as removeVocabFromStorage,
  updateVocabImportance,
  batchUpdateVocabImportance,
  loadDifficultSentences,
  saveDifficultSentence,
  deleteDifficultSentence as removeSentenceFromStorage,
  addTokenUsage,
  resetAllData,
} from './services/storage';

import { generateStoryWithGemini, getDetailedNuanceWithGemini, rankVocabImportanceWithGemini } from './services/gemini';
import { translateWithGoogleFree } from './services/translate';
import { pickTargetVocabsForStory, extractRecentSummaries, getTodayDateString } from './utils/srs';
import { requestGoogleAccessToken, getOrCreateSpreadsheet, syncAllToGoogleSheets } from './services/googleSheets';

export const App: React.FC = () => {
  // メイン画面は本棚 (bookshelf)
  const [activeTab, setActiveTab] = useState<NavTab>('bookshelf');
  const [readingStory, setReadingStory] = useState<Story | null>(null);

  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [stories, setStories] = useState<Story[]>([]);
  const [vocabs, setVocabs] = useState<VocabItem[]>([]);
  const [difficultSentences, setDifficultSentences] = useState<DifficultSentenceItem[]>([]);

  // バックグラウンド生成状態
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingTheme, setGeneratingTheme] = useState('');
  const [notificationToast, setNotificationToast] = useState<string | null>(null);

  // AI重要度ランク付け状態
  const [isRankingImportance, setIsRankingImportance] = useState(false);

  const [isSyncing, setIsSyncing] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  // 単語・複数単語タップ選択＆ボトムシート翻訳状態
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [contextSentence, setContextSentence] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);

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

  // 初期ロード
  useEffect(() => {
    const s = loadSettings();
    const st = loadStories();
    const v = loadVocabs();
    const ds = loadDifficultSentences();

    setSettings(s);
    setStories(st);
    setVocabs(v);
    setDifficultSentences(ds);
  }, []);

  // 今日の復習期日語彙（重要度順に選出）
  const dueVocabs = useMemo(() => {
    return pickTargetVocabsForStory(vocabs, 4);
  }, [vocabs]);

  const dueCount = useMemo(() => {
    const today = getTodayDateString();
    return vocabs.filter(v => v.nextReviewDate <= today).length;
  }, [vocabs]);

  const isSavedAsVocab = useMemo(() => {
    if (!selectedText) return false;
    const norm = selectedText.trim().toLowerCase();
    return vocabs.some(v => v.phrase.toLowerCase() === norm);
  }, [selectedText, vocabs]);

  const isSavedAsSentence = useMemo(() => {
    if (!selectedText) return false;
    const norm = selectedText.trim().toLowerCase();
    return difficultSentences.some(s => s.sentence.toLowerCase().includes(norm) || norm.includes(s.sentence.toLowerCase()));
  }, [selectedText, difficultSentences]);

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

  // バックグラウンド非同期ストーリー生成ハンドラー
  const handleGenerateStoryInBackground = async (userPrompt?: string, wordCount = 700) => {
    if (!settings.geminiApiKey) {
      alert('Gemini APIキーが設定されていません。右上の「設定」からAPIキーを入力してください。');
      setActiveTab('settings');
      return;
    }

    setIsGenerating(true);
    setGeneratingTheme(userPrompt || '');
    // 生成開始後、ユーザーは即座に本棚に戻れる
    setActiveTab('bookshelf');

    try {
      const currentStoryList = loadStories();
      const recentSummaries = extractRecentSummaries(currentStoryList, 5);

      const res = await generateStoryWithGemini({
        apiKey: settings.geminiApiKey,
        model: settings.geminiModel,
        cefrLevel: settings.cefrLevel,
        userPrompt,
        targetVocabs: dueVocabs,
        recentSummaries,
        targetWordCount: wordCount,
      });

      const newStory = res.story;

      if (res.tokenUsage) {
        handleRecordTokenUsage(res.tokenUsage.promptTokens, res.tokenUsage.candidatesTokens);
      }

      saveStory(newStory);
      const updatedStories = [newStory, ...loadStories().filter(s => s.id !== newStory.id)];
      setStories(updatedStories);

      // 読書中であれば邪魔せずトーストで優しく通知
      setNotificationToast(`🎉 新しい物語『${newStory.title}』が本棚に追加されました！`);

      triggerAutoSync(vocabs, updatedStories);
    } catch (err: any) {
      console.error('Generation error', err);
      alert(`ストーリー生成に失敗しました:\n${err.message}`);
    } finally {
      setIsGenerating(false);
      setGeneratingTheme('');
    }
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

  // 単語・複数単語タップ時の即時翻訳（4-tier fallback）
  const handleWordOrPhraseTap = async (text: string, sentence: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    setSelectedText(trimmed);
    setContextSentence(sentence);
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
    setIsSheetOpen(false);
  };

  // 単語・構文を弱点リストに追加 / Lapse記録
  const handleAddToVocab = (phrase: string, meaning: string, sentence?: string, note?: string) => {
    const lookup = {
      phrase,
      meaning,
      part_of_speech: 'word/phrase',
      explanation: note || '',
      context_sentence: sentence || '',
    };
    recordVocabLapse(lookup, readingStory?.id);
    const updatedVocabs = loadVocabs();
    setVocabs(updatedVocabs);
    triggerAutoSync(updatedVocabs, stories);
  };

  const handleLapseVocab = (phrase: string, meaning = '要復習') => {
    handleAddToVocab(phrase, meaning, readingStory?.storyContent);
  };

  // 訳せなかった文を独立して保存（自己分析用）
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

  const handleDeleteDifficultSentence = (id: string) => {
    removeSentenceFromStorage(id);
    setDifficultSentences(loadDifficultSentences());
  };

  // 語彙の重要度（1〜5）手動更新
  const handleUpdateVocabImportance = (vocabId: string, importance: number) => {
    updateVocabImportance(vocabId, importance);
    setVocabs(loadVocabs());
  };

  // AIによる登録語彙の一括重要度ランク付け
  const handleRankVocabImportance = async () => {
    if (!settings.geminiApiKey) {
      alert('Gemini APIキーを設定してください');
      setActiveTab('settings');
      return;
    }

    const currentVocabs = loadVocabs();
    if (currentVocabs.length === 0) {
      alert('登録された語彙がありません');
      return;
    }

    setIsRankingImportance(true);
    try {
      const itemsToRank = currentVocabs.map(v => ({
        id: v.id,
        phrase: v.phrase,
        meaning: v.meaning,
      }));

      const res = await rankVocabImportanceWithGemini(
        itemsToRank,
        settings.geminiApiKey,
        settings.geminiModel
      );

      if (res.tokenUsage) {
        handleRecordTokenUsage(res.tokenUsage.promptTokens, res.tokenUsage.candidatesTokens);
      }

      if (res.rankings && res.rankings.length > 0) {
        batchUpdateVocabImportance(res.rankings);
        const updated = loadVocabs();
        setVocabs(updated);
        triggerAutoSync(updated, stories);
        alert(`✨ ${res.rankings.length}件の語彙の重要度ランク付けが完了しました！`);
      } else {
        alert('重要度スコアの取得に失敗しました。');
      }
    } catch (e: any) {
      console.error('Rank importance error', e);
      alert(`重要度判定エラー: ${e.message}`);
    } finally {
      setIsRankingImportance(false);
    }
  };

  // AIによる詳細ニュアンス取得
  const handleFetchDetailedNuance = async (): Promise<string> => {
    if (!settings.geminiApiKey) {
      alert('Gemini APIキーを設定してください');
      return '';
    }
    const res = await getDetailedNuanceWithGemini(
      selectedText,
      contextSentence,
      settings.geminiApiKey,
      settings.geminiModel
    );

    if (res.tokenUsage) {
      handleRecordTokenUsage(res.tokenUsage.promptTokens, res.tokenUsage.candidatesTokens);
    }

    return res.explanation;
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
    if (confirm('この語彙を削除しますか？')) {
      removeVocabFromStorage(vocabId);
      const updated = loadVocabs();
      setVocabs(updated);
      triggerAutoSync(updated, stories);
    }
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
    setStories(loadStories());
    setVocabs(loadVocabs());
    setDifficultSentences(loadDifficultSentences());
    setSettings(loadSettings());
  };

  const handleResetAllData = () => {
    resetAllData();
    setStories([]);
    setVocabs([]);
    setDifficultSentences([]);
    setReadingStory(null);
    setSelectedText('');
    setIsSheetOpen(false);
    setSettings(loadSettings());
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-blue-600 selection:text-white">
      <Header
        activeTab={activeTab}
        setActiveTab={(tab) => {
          setActiveTab(tab);
          setReadingStory(null); // タブ切り替え時は本棚や各画面へ
        }}
        dueCount={dueCount}
        isSyncing={isSyncing}
        hasGoogleSync={Boolean(settings.googleSpreadsheetId)}
        onSyncClick={handleGoogleManualSync}
        canInstallPWA={Boolean(deferredPrompt)}
        onInstallPWA={handleInstallPWA}
        isGenerating={isGenerating}
        generatingTheme={generatingTheme}
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
        {/* 読書モード (Reader View): 本棚で本を開いたときに表示 */}
        {readingStory ? (
          <ReaderView
            currentStory={readingStory}
            vocabs={vocabs}
            onWordOrPhraseTap={handleWordOrPhraseTap}
            selectedPhrase={selectedText}
            onClearSelection={handleClearSelection}
            onMasterVocab={handleMasterVocab}
            onLapseVocab={handleLapseVocab}
            onBackToBookshelf={() => setReadingStory(null)}
          />
        ) : (
          <>
            {/* 1. Main Home: Bookshelf Tab */}
            {activeTab === 'bookshelf' && (
              <HistoryView
                stories={stories}
                onSelectStory={(story) => {
                  setReadingStory(story);
                  setSelectedText('');
                  setIsSheetOpen(false);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                onDeleteStory={handleDeleteStory}
                onNavigateToCreate={() => setActiveTab('create')}
                isGenerating={isGenerating}
                generatingTheme={generatingTheme}
              />
            )}

            {/* 2. Story Creation Studio Tab */}
            {activeTab === 'create' && (
              <StoryCreateView
                currentLevel={settings.cefrLevel}
                onLevelChange={handleLevelChange}
                isGenerating={isGenerating}
                generatingTheme={generatingTheme}
                dueVocabs={dueVocabs}
                onGenerateStory={handleGenerateStoryInBackground}
                onOpenImportModal={() => setIsImportModalOpen(true)}
                onNavigateToBookshelf={() => setActiveTab('bookshelf')}
              />
            )}

            {/* 3. Quiz Tab */}
            {activeTab === 'quiz' && (
              <QuizView
                apiKey={settings.geminiApiKey}
                model={settings.geminiModel}
                cefrLevel={settings.cefrLevel}
                onLevelChange={handleLevelChange}
                dueVocabs={dueVocabs}
                vocabs={vocabs}
                onAddToVocab={handleAddToVocab}
                onRecordTokenUsage={handleRecordTokenUsage}
              />
            )}

            {/* 4. Vocab Bank Tab */}
            {activeTab === 'vocab' && (
              <VocabBankView
                vocabs={vocabs}
                difficultSentences={difficultSentences}
                onMasterVocab={handleMasterVocab}
                onDeleteVocab={handleDeleteVocab}
                onDeleteSentence={handleDeleteDifficultSentence}
                onUpdateImportance={handleUpdateVocabImportance}
                onRankVocabImportance={handleRankVocabImportance}
                isRankingImportance={isRankingImportance}
              />
            )}

            {/* 5. Settings Tab */}
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

      {/* 外部AIプロンプト / JSONインポートモーダル */}
      <ImportStoryModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        cefrLevel={settings.cefrLevel}
        dueVocabs={dueVocabs}
        onImportStory={handleImportStory}
      />

      {/* スマホChrome風ボトムシート翻訳 */}
      <TranslationBottomSheet
        isOpen={isSheetOpen}
        onClose={() => {
          setIsSheetOpen(false);
          setSelectedText('');
        }}
        originalText={selectedText}
        translatedText={translatedText}
        contextSentence={contextSentence}
        isLoading={isTranslating}
        isSavedAsVocab={isSavedAsVocab}
        isSavedAsSentence={isSavedAsSentence}
        onAddToVocab={handleAddToVocab}
        onSaveDifficultSentence={handleSaveDifficultSentence}
        onFetchDetailedNuance={handleFetchDetailedNuance}
      />
    </div>
  );
};

export default App;