import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { VocabItem } from '../types/vocab';
import { Volume2, CheckCircle2, Zap, Filter, Undo2, BookOpen, PenTool, Sliders, X, Check } from 'lucide-react';
import confetti from 'canvas-confetti';
import { speakText } from '../utils/speech';
import { getTodayDateString, getNextReviewIntervals, calculateAnkiSRS } from '../utils/srs';
import { cleanTranslationText, loadSettings, saveSettings } from '../services/storage';

export type AnkiCardFilter = 'all' | 'word' | 'pattern' | 'en_to_ja' | 'ja_to_en';

interface FilterOption {
  id: AnkiCardFilter;
  label: string;
  badgeLabel: string;
  description: string;
  filterFn: (item: VocabItem) => boolean;
}

const FILTER_OPTIONS: FilterOption[] = [
  {
    id: 'all',
    label: 'すべて (全カード)',
    badgeLabel: 'すべて 📚',
    description: '登録された全1文カード・構文カードをまとめて復習',
    filterFn: () => true,
  },
  {
    id: 'word',
    label: '🔤 単語重視',
    badgeLabel: '🔤 単語',
    description: '単語・イディオムにフォーカスしたカード',
    filterFn: (v) => v.focusType === 'word' || Boolean(v.focusWord) || (Boolean(v.phrase) && v.phrase.trim().split(/\s+/).length <= 2 && v.focusType !== 'pattern' && (!v.corePatterns || v.corePatterns.length === 0)),
  },
  {
    id: 'pattern',
    label: '💡 構文・文法重視',
    badgeLabel: '💡 構文',
    description: '文法構造・S+V骨格にフォーカスしたカード',
    filterFn: (v) => v.focusType === 'pattern' || (Boolean(v.corePatterns) && v.corePatterns!.length > 0) || v.cardType === 'pattern',
  },
  {
    id: 'en_to_ja',
    label: '📖 読解 (EN ➔ JA)',
    badgeLabel: '📖 読解',
    description: '英語を見て瞬時に意味を脳内展開する訓練',
    filterFn: (v) => v.cardDirection !== 'ja_to_en',
  },
  {
    id: 'ja_to_en',
    label: '✍️ 作文 (JA ➔ EN)',
    badgeLabel: '✍️ 作文',
    description: '日本語の意味から瞬時に英語センテンスを組み立てる訓練',
    filterFn: (v) => v.cardDirection === 'ja_to_en',
  },
];

interface HistorySnapshot {
  ratedCard: VocabItem;               // 評価直前のカードデータ（ストレージ復元用）
  previousReviewQueue: VocabItem[];   // 評価前の復習キュー
  previousLearningPool: VocabItem[];  // 評価前の学習プール
  previousGraduatedIds: Set<string>;  // 評価前の卒業ID
  previousReviewedCount: number;      // 評価前の解答数
  activeCardBefore: VocabItem;        // 画面に表示されていたカード
}

interface AnkiFlashcardViewProps {
  vocabs: VocabItem[];
  onRateCard: (vocabId: string, rating: 'again' | 'hard' | 'good' | 'easy') => void;
  onRevertCard?: (previousCard: VocabItem) => void;
}

// Fisher-Yates シャッフル関数
function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 出題カードの決定ヘルパー
function pickNextCard(learning: VocabItem[], reviews: VocabItem[]): VocabItem | null {
  const now = Date.now();
  // 1. 期日(1分/10分)が到来している学習中カードがあれば最優先
  const dueLearning = learning
    .filter(c => !c.dueTimestamp || c.dueTimestamp <= now)
    .sort((a, b) => (a.dueTimestamp || 0) - (b.dueTimestamp || 0));

  if (dueLearning.length > 0) {
    return dueLearning[0];
  }

  // 2. 通常の復習キュー（青・緑）から出題
  if (reviews.length > 0) {
    return reviews[0];
  }

  // 3. 復習キューが空の場合は、残りの学習中カードを最短期日順に出題（待たせない）
  if (learning.length > 0) {
    return [...learning].sort((a, b) => (a.dueTimestamp || 0) - (b.dueTimestamp || 0))[0];
  }

  return null;
}

// 単語のハイライト表示ヘルパー
function highlightWordInSentence(sentence: string, targetWord?: string) {
  if (!sentence) return null;
  if (!targetWord || !targetWord.trim()) return <span>{sentence}</span>;
  const escaped = targetWord.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = sentence.split(new RegExp(`(${escaped})`, 'gi'));
  return (
    <>
      {parts.map((part, idx) => {
        if (part.toLowerCase() === targetWord.toLowerCase().trim()) {
          return (
            <span key={idx} className="text-sky-300 font-bold bg-sky-950/80 px-1 py-0.5 rounded border border-sky-500/40">
              {part}
            </span>
          );
        }
        return <span key={idx}>{part}</span>;
      })}
    </>
  );
}

export const AnkiFlashcardView: React.FC<AnkiFlashcardViewProps> = ({
  vocabs,
  onRateCard,
  onRevertCard,
}) => {
  const today = getTodayDateString();

  // カードフィルター設定 (localStorageで永続化、初期値はすべて)
  const [cardFilter, setCardFilter] = useState<AnkiCardFilter>(() => {
    const saved = localStorage.getItem('anki_card_filter') as AnkiCardFilter;
    return saved && FILTER_OPTIONS.some(o => o.id === saved) ? saved : 'all';
  });

  const activeFilterDef = useMemo(() => {
    return FILTER_OPTIONS.find(f => f.id === cardFilter) || FILTER_OPTIONS[0];
  }, [cardFilter]);

  // 出題制限設定モーダル
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [appSettings, setAppSettings] = useState(() => loadSettings());
  const [newCardsLimit, setNewCardsLimit] = useState(appSettings.ankiNewCardsPerDay ?? 20);
  const [maxReviewsLimit, setMaxReviewsLimit] = useState(appSettings.ankiMaxReviewsPerDay ?? 200);
  const [graduationDays, setGraduationDays] = useState(appSettings.ankiGraduationIntervalDays ?? 21);

  // 各フィルター別の件数統計（全体件数 & 今日の復習対象件数）
  const filterStats = useMemo(() => {
    const stats: Record<AnkiCardFilter, { total: number; due: number }> = {
      all: { total: 0, due: 0 },
      word: { total: 0, due: 0 },
      pattern: { total: 0, due: 0 },
      en_to_ja: { total: 0, due: 0 },
      ja_to_en: { total: 0, due: 0 },
    };

    FILTER_OPTIONS.forEach(opt => {
      const matched = vocabs.filter(opt.filterFn);
      const dueCount = matched.filter(v => {
        if (v.buriedUntilDate && v.buriedUntilDate > today) return false;
        return (
          v.cardState === 'learning' ||
          v.cardState === 'relearning' ||
          ((!v.cardState || v.cardState === 'new' || v.cardState === 'review') && v.nextReviewDate <= today)
        );
      }).length;

      stats[opt.id] = {
        total: matched.length,
        due: dueCount,
      };
    });

    return stats;
  }, [vocabs, today]);

  // 現在のフィルターに合致する語彙
  const filteredVocabs = useMemo(() => {
    return vocabs.filter(activeFilterDef.filterFn);
  }, [vocabs, activeFilterDef]);

  const [reviewQueue, setReviewQueue] = useState<VocabItem[]>([]);
  const [learningPool, setLearningPool] = useState<VocabItem[]>([]);
  const [activeCard, setActiveCard] = useState<VocabItem | null>(null);

  const [isFlipped, setIsFlipped] = useState(false);
  const [sessionReviewedCount, setSessionReviewedCount] = useState(0);
  const [graduatedIds, setGraduatedIds] = useState<Set<string>>(new Set());
  const [backlogCount, setBacklogCount] = useState(0);

  // 操作取り消し（Undo）履歴スタック
  const [historyStack, setHistoryStack] = useState<HistorySnapshot[]>([]);

  // セッション初期化ヘルパー (上限設定を適用)
  const initSession = useCallback((targetVocabs: VocabItem[], allowExtraStudy: boolean = false) => {
    const activeCards = targetVocabs.filter(v => !v.buriedUntilDate || v.buriedUntilDate <= today);
    const learningCards = activeCards.filter(v => v.cardState === 'learning' || v.cardState === 'relearning');
    
    // 復習対象（既存カードで今日が期日のもの）
    const dueReviewCards = activeCards.filter(v => 
      (v.cardState === 'review' || (v.repetitionCount && v.repetitionCount > 0)) && 
      v.cardState !== 'learning' && 
      v.cardState !== 'relearning' && 
      v.nextReviewDate <= today
    );

    // 新規カード（未学習）
    const newCards = activeCards.filter(v => 
      (!v.cardState || v.cardState === 'new' || !v.repetitionCount || v.repetitionCount === 0) &&
      v.cardState !== 'learning' && 
      v.cardState !== 'relearning' &&
      v.nextReviewDate <= today
    );

    let initialReviews: VocabItem[] = [];
    let initialLearning: VocabItem[] = [];
    let remainingBacklog = 0;

    if (allowExtraStudy) {
      // 上限枠なしの全件出題
      const unmastered = targetVocabs.filter(v => (v.repetitionCount ?? 0) < 4);
      initialReviews = unmastered.length > 0 ? shuffleArray(unmastered) : shuffleArray(targetVocabs);
      initialLearning = [];
      remainingBacklog = 0;
    } else if (dueReviewCards.length > 0 || newCards.length > 0 || learningCards.length > 0) {
      // 1日の上限を適用
      const maxReviews = appSettings.ankiMaxReviewsPerDay ?? 200;
      const maxNew = appSettings.ankiNewCardsPerDay ?? 20;

      // 優先度・期日順にソート
      const sortedReviews = [...dueReviewCards].sort((a, b) => (a.nextReviewDate || '').localeCompare(b.nextReviewDate || ''));
      const sortedNew = [...newCards].sort((a, b) => (b.importance || 3) - (a.importance || 3));

      const selectedReviews = sortedReviews.slice(0, maxReviews);
      const selectedNew = sortedNew.slice(0, maxNew);

      remainingBacklog = (dueReviewCards.length - selectedReviews.length) + (newCards.length - selectedNew.length);

      // 本日の復習期日・新規カードをシャッフルして出題
      initialReviews = shuffleArray([...selectedReviews, ...selectedNew]);
      initialLearning = learningCards;
    } else {
      initialReviews = [];
      initialLearning = [];
      remainingBacklog = 0;
    }

    const firstCard = pickNextCard(initialLearning, initialReviews);

    setReviewQueue(initialReviews);
    setLearningPool(initialLearning);
    setActiveCard(firstCard);
    setIsFlipped(false);
    setSessionReviewedCount(0);
    setGraduatedIds(new Set());
    setHistoryStack([]);
    setBacklogCount(remainingBacklog);
  }, [today, appSettings]);

  // 初回マウント時、またはフィルター/設定変更時にセッション初期化
  useEffect(() => {
    initSession(filteredVocabs, false);
  }, [cardFilter, appSettings]);

  const handleFilterChange = (newFilter: AnkiCardFilter) => {
    if (newFilter === cardFilter) return;
    setCardFilter(newFilter);
    localStorage.setItem('anki_card_filter', newFilter);
  };

  const handleSaveSettings = () => {
    const updated = {
      ...appSettings,
      ankiNewCardsPerDay: newCardsLimit,
      ankiMaxReviewsPerDay: maxReviewsLimit,
      ankiGraduationIntervalDays: graduationDays,
    };
    saveSettings(updated);
    setAppSettings(updated);
    setIsSettingsOpen(false);
  };

  // 次回復習間隔（Again / Hard / Good / Easy）の動的プレビュー計算
  const intervals = useMemo(() => {
    if (!activeCard) return { again: '1分', hard: '6分', good: '10分', easy: '4日' };
    return getNextReviewIntervals(activeCard);
  }, [activeCard]);

  // キーボードショートカット (Space: フリップ, 1: Again, 2: Hard, 3: Good, 4: Easy, z: Undo)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      if (e.key === 'z' || (e.ctrlKey && e.key === 'z') || (e.metaKey && e.key === 'z')) {
        e.preventDefault();
        handleUndo();
        return;
      }

      if (!activeCard) return;

      if (!isFlipped) {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          handleFlip();
        }
      } else {
        if (e.key === '1') {
          e.preventDefault();
          handleRate('again');
        } else if (e.key === '2') {
          e.preventDefault();
          handleRate('hard');
        } else if (e.key === '3') {
          e.preventDefault();
          handleRate('good');
        } else if (e.key === '4') {
          e.preventDefault();
          handleRate('easy');
        } else if (e.key === ' ') {
          e.preventDefault();
          handleRate('good');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFlipped, activeCard, reviewQueue, learningPool, historyStack]);

  const handleFlip = () => {
    setIsFlipped(true);
    if (activeCard) {
      const textToSpeak = activeCard.sentence || activeCard.exampleSentence || activeCard.phrase;
      if (textToSpeak) {
        speakText(textToSpeak);
      }
    }
  };

  // 直前の回答を取り消す (Undo)
  const handleUndo = () => {
    if (historyStack.length === 0) return;
    const lastSnapshot = historyStack[historyStack.length - 1];
    setHistoryStack(prev => prev.slice(0, -1));

    if (onRevertCard) {
      onRevertCard(lastSnapshot.ratedCard);
    }

    setReviewQueue(lastSnapshot.previousReviewQueue);
    setLearningPool(lastSnapshot.previousLearningPool);
    setGraduatedIds(lastSnapshot.previousGraduatedIds);
    setSessionReviewedCount(lastSnapshot.previousReviewedCount);
    setActiveCard(lastSnapshot.activeCardBefore);
    setIsFlipped(false);
  };

  // Anki 4段階評価ハンドラー
  const handleRate = (rating: 'again' | 'hard' | 'good' | 'easy') => {
    if (!activeCard) return;

    const currentCard = activeCard;

    const snapshot: HistorySnapshot = {
      ratedCard: { ...currentCard },
      previousReviewQueue: [...reviewQueue],
      previousLearningPool: [...learningPool],
      previousGraduatedIds: new Set(graduatedIds),
      previousReviewedCount: sessionReviewedCount,
      activeCardBefore: currentCard,
    };
    setHistoryStack(prev => [...prev.slice(-10), snapshot]);

    const srsResult = calculateAnkiSRS(currentCard, rating);
    onRateCard(currentCard.id, rating);

    const updatedCard: VocabItem = {
      ...currentCard,
      ...srsResult,
    };

    let nextReviewQ = reviewQueue.filter(c => c.id !== currentCard.id);
    let nextLearningP = learningPool.filter(c => c.id !== currentCard.id);
    const nextGraduated = new Set(graduatedIds);

    if (srsResult.cardState === 'learning' || srsResult.cardState === 'relearning') {
      nextLearningP.push(updatedCard);
    } else {
      nextGraduated.add(currentCard.id);
    }

    const nextPick = pickNextCard(nextLearningP, nextReviewQ);

    setReviewQueue(nextReviewQ);
    setLearningPool(nextLearningP);
    setGraduatedIds(nextGraduated);
    setSessionReviewedCount(prev => prev + 1);
    setActiveCard(nextPick);
    setIsFlipped(false);

    if (!nextPick) {
      confetti({
        particleCount: 100,
        spread: 80,
        origin: { y: 0.6 },
        colors: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899']
      });
    }
  };

  // 全問完了時の表示
  if (!activeCard) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Filter Bar */}
        <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-800">
          <div className="flex items-center space-x-2 text-xs text-slate-400">
            <Filter className="w-4 h-4 text-blue-400" />
            <span className="font-semibold">カード絞り込み:</span>
          </div>
          <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
            {FILTER_OPTIONS.map(opt => {
              const stat = filterStats[opt.id];
              const isSelected = cardFilter === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => handleFilterChange(opt.id)}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${
                    isSelected
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                      : 'bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800'
                  }`}
                >
                  <span>{opt.badgeLabel}</span>
                  {stat.due > 0 && (
                    <span className="ml-1.5 px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px]">
                      {stat.due}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Completion Card */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-8 sm:p-10 shadow-2xl text-center space-y-6 animate-fadeIn">
          <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center mx-auto shadow-xl shadow-emerald-500/25">
            <CheckCircle2 className="w-9 h-9 text-white" />
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              今日の復習が完了しました！ 🎉
            </h2>
            <p className="text-sm text-slate-400 max-w-md mx-auto leading-relaxed">
              選択中のカテゴリー【{activeFilterDef.label}】における本日の学習目標はすべて達成しました。素晴らしい継続力です！
            </p>
            {backlogCount > 0 && (
              <p className="text-xs text-amber-300 bg-amber-950/40 border border-amber-500/30 px-3 py-1.5 rounded-xl max-w-sm mx-auto">
                📦 1日の出題制限により、残り <strong>{backlogCount} 枚</strong> が明日に温存されています。
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 max-w-sm mx-auto text-left">
            <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-2xl">
              <span className="text-[11px] font-semibold text-slate-400 block">本日の回答数</span>
              <strong className="text-xl font-bold text-white">{sessionReviewedCount} 回</strong>
            </div>
            <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-2xl">
              <span className="text-[11px] font-semibold text-slate-400 block">定着・卒業カード</span>
              <strong className="text-xl font-bold text-emerald-400">{graduatedIds.size} 語</strong>
            </div>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={() => initSession(filteredVocabs, true)}
              className="w-full sm:w-auto flex items-center justify-center space-x-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl text-sm font-bold shadow-lg shadow-blue-600/25 transition-all"
            >
              <Zap className="w-4 h-4 text-amber-300" />
              <span>{backlogCount > 0 ? `待機中カードを追加学習 (${backlogCount}枚)` : '追加で練習する（未定着カード）'}</span>
            </button>
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="w-full sm:w-auto flex items-center justify-center space-x-2 px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-2xl text-sm font-bold transition-all"
            >
              <Sliders className="w-4 h-4 text-slate-400" />
              <span>出題上限を変更</span>
            </button>
          </div>
        </div>

        {/* Settings Modal */}
        {isSettingsOpen && (
          <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-5 animate-scaleUp">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center space-x-2">
                  <Sliders className="w-5 h-5 text-blue-400" />
                  <h3 className="text-base font-bold text-white">Anki出題制限・卒業設定</h3>
                </div>
                <button
                  onClick={() => setIsSettingsOpen(false)}
                  className="p-1 text-slate-400 hover:text-white rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4 text-xs text-slate-300">
                <div className="space-y-1.5">
                  <label className="font-bold text-white block">1日の新規カード出題数 (New Cards/Day)</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={newCardsLimit}
                    onChange={(e) => setNewCardsLimit(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white font-bold"
                  />
                  <p className="text-slate-500 text-[11px]">初めて学習するカードの1日あたりの上限です（推奨: 15〜30枚）</p>
                </div>

                <div className="space-y-1.5">
                  <label className="font-bold text-white block">1日の最大復習カード数 (Max Reviews/Day)</label>
                  <input
                    type="number"
                    min="10"
                    max="500"
                    value={maxReviewsLimit}
                    onChange={(e) => setMaxReviewsLimit(Math.max(10, parseInt(e.target.value, 10) || 10))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white font-bold"
                  />
                  <p className="text-slate-500 text-[11px]">復習期日が到来したカードの1日あたりの上限です（推奨: 100〜250枚）</p>
                </div>

                <div className="space-y-1.5">
                  <label className="font-bold text-white block">自動卒業・マスター同期の間隔日数 (Mature Days)</label>
                  <input
                    type="number"
                    min="7"
                    max="90"
                    value={graduationDays}
                    onChange={(e) => setGraduationDays(Math.max(7, parseInt(e.target.value, 10) || 7))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white font-bold"
                  />
                  <p className="text-slate-500 text-[11px]">復習間隔がこの日数を超えたら、CEFRマスターDBで自動的に「既知（Mastered）」として同期されます（本家Anki基準: 21日）</p>
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
                <button
                  onClick={() => setIsSettingsOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleSaveSettings}
                  className="flex items-center space-x-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-600/30"
                >
                  <Check className="w-4 h-4" />
                  <span>設定を保存</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // カード種類の判定 & 表示テキスト整理
  const isWordCard = activeCard.focusType === 'word' ||
    Boolean(activeCard.focusWord) ||
    (Boolean(activeCard.phrase) && activeCard.phrase.trim().split(/\s+/).length <= 2 && activeCard.focusType !== 'pattern' && (!activeCard.corePatterns || activeCard.corePatterns.length === 0));

  const displayWord = (activeCard.focusWord || activeCard.phrase || '').trim();
  const displaySentence = (activeCard.sentence || activeCard.exampleSentence || activeCard.phrase || '').trim();
  const displayWordMeaning = cleanTranslationText(activeCard.focusMeaning || activeCard.meaning || activeCard.translation || '');
  const displaySentenceTranslation = cleanTranslationText(activeCard.translation || (isWordCard ? '' : activeCard.meaning) || '');

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
      {/* 1. Header: Filter & Progress */}
      <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-800">
        <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
          {FILTER_OPTIONS.map(opt => {
            const stat = filterStats[opt.id];
            const isSelected = cardFilter === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => handleFilterChange(opt.id)}
                className={`px-2.5 py-1 rounded-xl text-xs font-bold transition-all ${
                  isSelected
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                    : 'bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800'
                }`}
              >
                <span>{opt.badgeLabel}</span>
                {stat.due > 0 && (
                  <span className="ml-1 px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px]">
                    {stat.due}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center space-x-2">
          {/* Settings Button */}
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center space-x-1 px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl text-xs font-semibold border border-slate-800 transition-colors"
            title="出題上限設定"
          >
            <Sliders className="w-3.5 h-3.5 text-blue-400" />
            <span className="hidden sm:inline">設定</span>
          </button>

          {/* Undo Button */}
          {historyStack.length > 0 && (
            <button
              onClick={handleUndo}
              className="flex items-center space-x-1 px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold border border-slate-800 transition-colors"
              title="直前の評価を取り消す"
            >
              <Undo2 className="w-3.5 h-3.5 text-amber-400" />
              <span>取り消し</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Anki Three-Counter Display: [🔴 学習中] [🔵 新規] [🟢 復習] */}
      <div className="flex items-center justify-between bg-slate-900/90 border border-slate-800 rounded-2xl p-3 shadow-lg text-xs">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-1.5" title="学習中・再学習ステップ中（1分/10分待機）">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
            <span className="font-extrabold text-rose-400">{learningPool.length}</span>
            <span className="text-slate-400 text-[11px]">学習中</span>
          </div>

          <div className="flex items-center space-x-1.5" title="本日出題キューにあるカード">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
            <span className="font-extrabold text-blue-400">{reviewQueue.length}</span>
            <span className="text-slate-400 text-[11px]">出題待ち</span>
          </div>

          <div className="flex items-center space-x-1.5" title="本日正解・卒業したカード">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span className="font-extrabold text-emerald-400">{graduatedIds.size}</span>
            <span className="text-slate-400 text-[11px]">定着</span>
          </div>
        </div>

        <div className="flex items-center space-x-2 text-[11px] text-slate-400">
          <span>今日: <strong className="text-white">{sessionReviewedCount}</strong> 回</span>
          {backlogCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30 text-[10px]">
              待機 {backlogCount}
            </span>
          )}
        </div>
      </div>

      {/* 3. Main Flashcard Area */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 relative overflow-hidden">
        {/* Top Badges */}
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-bold">
              {activeCard.cardDirection === 'ja_to_en' ? '✍️ 和英 (作文)' : '📖 英和 (読解)'}
            </span>
            {isWordCard ? (
              <span className="px-2.5 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20 font-bold">
                🔤 単語
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 font-bold">
                💡 構文・文法
              </span>
            )}
            {activeCard.intervalDays && activeCard.intervalDays >= (appSettings.ankiGraduationIntervalDays ?? 21) && (
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold">
                🟢 既知 (Mature)
              </span>
            )}
          </div>

          <div className="text-slate-500 text-[11px] font-mono">
            {activeCard.cardState === 'learning' ? 'ステップ 1m/10m' : `間隔: ${activeCard.intervalDays || 0}日`}
          </div>
        </div>

        {/* Card Content */}
        <div className="min-h-[160px] flex flex-col justify-center text-center space-y-4">
          {activeCard.cardDirection === 'ja_to_en' ? (
            /* =================================================================
               和 ➔ 英 (瞬間英作文モード: 日本語全文 ➔ 英語全文)
               ================================================================= */
            <div className="space-y-4">
              <div className="inline-flex items-center space-x-1.5 px-3 py-1 bg-indigo-500/20 border border-indigo-500/30 rounded-full text-indigo-300 text-xs font-bold">
                <PenTool className="w-3.5 h-3.5" />
                <span>瞬間英作文 (和 ➔ 英)</span>
              </div>

              <div className="py-2">
                <p className="text-lg sm:text-2xl font-bold text-white leading-relaxed px-2">
                  {displaySentenceTranslation || displayWordMeaning}
                </p>
                {isWordCard && displayWordMeaning && displaySentenceTranslation && displayWordMeaning !== displaySentenceTranslation && (
                  <p className="text-xs text-sky-400 mt-1">
                    （キー表現: <span className="font-semibold text-sky-300">{displayWordMeaning}</span>）
                  </p>
                )}
              </div>

              {isFlipped ? (
                <div className="space-y-3 pt-3 border-t border-slate-800 animate-fadeIn text-left">
                  <div className="p-4 bg-slate-950/80 border border-indigo-500/30 rounded-2xl space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-indigo-400">英語の正解 (模範例文):</span>
                      <button
                        onClick={() => speakText(displaySentence)}
                        className="p-1.5 text-sky-400 hover:text-sky-300 hover:bg-sky-950/70 rounded-xl transition-colors"
                        title="発音を再生"
                      >
                        <Volume2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="text-base sm:text-lg font-bold text-white font-serif leading-relaxed">
                      {isWordCard ? highlightWordInSentence(displaySentence, displayWord) : displaySentence}
                    </div>
                  </div>

                  {activeCard.contextNote && (
                    <div className="p-2.5 bg-slate-950/50 border border-slate-800 rounded-xl text-xs text-slate-300">
                      💡 {activeCard.contextNote}
                    </div>
                  )}

                  {/* 構文骨格バッジ */}
                  {activeCard.corePatterns && activeCard.corePatterns.length > 0 && (
                    <div className="p-3 bg-purple-950/40 border border-purple-500/30 rounded-2xl space-y-1.5 text-xs">
                      <span className="text-[11px] font-bold text-purple-300">💡 構文骨格:</span>
                      {activeCard.corePatterns.map((cp, idx) => (
                        <div key={idx} className="p-2 bg-slate-950/70 border border-purple-500/20 rounded-xl">
                          <div className="font-bold text-purple-200">{cp.patternName}: <code className="text-[11px] text-amber-300 font-mono">{cp.formula}</code></div>
                          <div className="text-[10px] text-slate-300">{cp.meaningTemplate}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-4">
                  <span className="text-xs text-slate-500">頭の中で英語全文を組み立ててからタップ</span>
                </div>
              )}
            </div>
          ) : (
            /* =================================================================
               英 ➔ 和 (読解・コンパイルモード: 英語全文 ➔ 日本語全文)
               ================================================================= */
            <div className="space-y-4">
              <div className="inline-flex items-center space-x-1.5 px-3 py-1 bg-cyan-500/20 border border-cyan-500/30 rounded-full text-cyan-300 text-xs font-bold">
                <BookOpen className="w-3.5 h-3.5" />
                <span>読解コンパイル (英 ➔ 和)</span>
              </div>

              <div className="flex items-center justify-center space-x-2 py-1">
                <p className="text-lg sm:text-2xl font-bold text-white font-serif leading-relaxed px-2">
                  {isWordCard ? highlightWordInSentence(displaySentence, displayWord) : displaySentence}
                </p>
                <button
                  onClick={() => speakText(displaySentence)}
                  className="p-2 text-sky-400 hover:text-sky-300 hover:bg-sky-950/70 rounded-xl transition-colors border border-sky-500/30 shrink-0"
                  title="発音を再生"
                >
                  <Volume2 className="w-4 h-4" />
                </button>
              </div>

              {isFlipped ? (
                <div className="space-y-3 pt-3 border-t border-slate-800 animate-fadeIn text-left">
                  <div className="p-4 bg-slate-950/80 border border-emerald-500/30 rounded-2xl space-y-1">
                    <span className="text-[11px] font-bold text-emerald-400 block">日本語訳:</span>
                    <div className="text-base sm:text-lg font-bold text-white leading-relaxed">
                      {displaySentenceTranslation || displayWordMeaning}
                    </div>
                  </div>

                  {isWordCard && displayWordMeaning && displaySentenceTranslation && displayWordMeaning !== displaySentenceTranslation && (
                    <div className="text-xs text-slate-400 px-1">
                      フォーカス単語の意味: <strong className="text-sky-300">{displayWord}</strong> = {displayWordMeaning}
                    </div>
                  )}

                  {activeCard.contextNote && (
                    <div className="p-2.5 bg-slate-950/50 border border-slate-800 rounded-xl text-xs text-slate-300">
                      💡 {activeCard.contextNote}
                    </div>
                  )}

                  {/* 構文骨格バッジ */}
                  {activeCard.corePatterns && activeCard.corePatterns.length > 0 && (
                    <div className="p-3 bg-purple-950/40 border border-purple-500/30 rounded-2xl space-y-1.5 text-xs">
                      <span className="text-[11px] font-bold text-purple-300">💡 構文骨格 (急所):</span>
                      {activeCard.corePatterns.map((cp, idx) => (
                        <div key={idx} className="p-2 bg-slate-950/70 border border-purple-500/20 rounded-xl">
                          <div className="font-bold text-purple-200">{cp.patternName}: <code className="text-[11px] text-amber-300 font-mono">{cp.formula}</code></div>
                          <div className="text-[10px] text-slate-300">{cp.meaningTemplate}</div>
                          {cp.briefNote && <div className="text-[9px] text-purple-300/80 pt-0.5 border-t border-purple-500/10">💡 {cp.briefNote}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-4">
                  <span className="text-xs text-slate-500">英語の語順のまま理解してタップ</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 4. Action Buttons (Flip vs Rate) */}
        <div className="pt-3 border-t border-slate-800">
          {!isFlipped ? (
            <button
              onClick={handleFlip}
              className="w-full py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 active:scale-[0.99] text-white rounded-2xl text-sm font-bold shadow-xl shadow-blue-600/30 transition-all"
            >
              答えを表示 (Space / タップ)
            </button>
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:gap-3 animate-fadeIn">
              {/* 1. Again (もう一度) */}
              <button
                onClick={() => handleRate('again')}
                className="flex flex-col items-center justify-center p-3 bg-rose-950/60 hover:bg-rose-900/70 active:scale-[0.98] border border-rose-500/40 text-rose-300 rounded-2xl transition-all group"
              >
                <span className="text-[10px] text-rose-400/80 font-bold">{intervals.again}</span>
                <span className="text-xs sm:text-sm font-extrabold text-rose-200 mt-0.5">もう一度</span>
              </button>

              {/* 2. Hard (難しい) */}
              <button
                onClick={() => handleRate('hard')}
                className="flex flex-col items-center justify-center p-3 bg-amber-950/60 hover:bg-amber-900/70 active:scale-[0.98] border border-amber-500/40 text-amber-300 rounded-2xl transition-all group"
              >
                <span className="text-[10px] text-amber-400/80 font-bold">{intervals.hard}</span>
                <span className="text-xs sm:text-sm font-extrabold text-amber-200 mt-0.5">難しい</span>
              </button>

              {/* 3. Good (正解) */}
              <button
                onClick={() => handleRate('good')}
                className="flex flex-col items-center justify-center p-3 bg-emerald-950/60 hover:bg-emerald-900/70 active:scale-[0.98] border border-emerald-500/40 text-emerald-300 rounded-2xl transition-all group shadow-md shadow-emerald-500/10"
              >
                <span className="text-[10px] text-emerald-400/80 font-bold">{intervals.good}</span>
                <span className="text-xs sm:text-sm font-extrabold text-emerald-200 mt-0.5">正解</span>
              </button>

              {/* 4. Easy (簡単) */}
              <button
                onClick={() => handleRate('easy')}
                className="flex flex-col items-center justify-center p-3 bg-sky-950/60 hover:bg-sky-900/70 active:scale-[0.98] border border-sky-500/40 text-sky-300 rounded-2xl transition-all group shadow-md shadow-sky-500/10"
              >
                <span className="text-[10px] text-sky-400/80 font-bold">{intervals.easy}</span>
                <span className="text-xs sm:text-sm font-extrabold text-sky-200 mt-0.5">簡単</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-5 animate-scaleUp">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <Sliders className="w-5 h-5 text-blue-400" />
                <h3 className="text-base font-bold text-white">Anki出題制限・卒業設定</h3>
              </div>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs text-slate-300">
              <div className="space-y-1.5">
                <label className="font-bold text-white block">1日の新規カード出題数 (New Cards/Day)</label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={newCardsLimit}
                  onChange={(e) => setNewCardsLimit(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white font-bold"
                />
                <p className="text-slate-500 text-[11px]">初めて学習するカードの1日あたりの上限です（デフォルト: 20枚）</p>
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-white block">1日の最大復習カード数 (Max Reviews/Day)</label>
                <input
                  type="number"
                  min="10"
                  max="500"
                  value={maxReviewsLimit}
                  onChange={(e) => setMaxReviewsLimit(Math.max(10, parseInt(e.target.value, 10) || 10))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white font-bold"
                />
                <p className="text-slate-500 text-[11px]">復習期日が到来したカードの1日あたりの上限です（デフォルト: 200枚）</p>
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-white block">自動卒業・マスター同期の間隔日数 (Mature Days)</label>
                <input
                  type="number"
                  min="7"
                  max="90"
                  value={graduationDays}
                  onChange={(e) => setGraduationDays(Math.max(7, parseInt(e.target.value, 10) || 7))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white font-bold"
                />
                <p className="text-slate-500 text-[11px]">復習間隔がこの日数を超えたら、CEFRマスターDBで自動的に「既知（Mastered）」として同期されます（本家Anki基準: 21日）</p>
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold"
              >
                キャンセル
              </button>
              <button
                onClick={handleSaveSettings}
                className="flex items-center space-x-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-600/30"
              >
                <Check className="w-4 h-4" />
                <span>設定を保存</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
