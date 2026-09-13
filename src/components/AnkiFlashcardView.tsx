import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { VocabItem } from '../types/vocab';
import { Volume2, Sparkles, CheckCircle2, Star, Zap, Filter, Undo2, Lightbulb, Repeat } from 'lucide-react';
import confetti from 'canvas-confetti';
import { speakText } from '../utils/speech';
import { getTodayDateString, getNextReviewIntervals, calculateAnkiSRS } from '../utils/srs';

export type AnkiImportanceFilter = 'ge4' | 'ge3' | 'all' | 'syntax' | 'only5' | 'only4' | 'only3' | 'low';

interface FilterOption {
  id: AnkiImportanceFilter;
  label: string;
  badgeLabel: string;
  description: string;
  filterFn: (item: VocabItem) => boolean;
}

const FILTER_OPTIONS: FilterOption[] = [
  {
    id: 'ge4',
    label: '★4以上 (最頻出・必須)',
    badgeLabel: '★4以上 👑',
    description: '日常英会話の基盤となる最頻出・必須語彙に集中',
    filterFn: (v) => (v.importance ?? 3) >= 4,
  },
  {
    id: 'syntax',
    label: '💡 構文カード (3文ローテーション)',
    badgeLabel: '💡 構文マスター',
    description: '文脈依存を防ぐ3パターン回転出題の構文カード',
    filterFn: (v) => v.cardType === 'pattern',
  },
  {
    id: 'ge3',
    label: '★3以上 (標準〜重要)',
    badgeLabel: '★3以上 ⭐',
    description: '標準から最頻出までバランス良くマスター',
    filterFn: (v) => (v.importance ?? 3) >= 3,
  },
  {
    id: 'all',
    label: 'すべて (全語彙・構文)',
    badgeLabel: 'すべて 📚',
    description: '登録された全語彙と構文カードをまとめて復習',
    filterFn: () => true,
  },
  {
    id: 'only5',
    label: '★5 (超重要・日常必須)',
    badgeLabel: '★5 日常必須',
    description: '最優先で身につけるべき基礎語彙',
    filterFn: (v) => (v.importance ?? 3) === 5 && v.cardType !== 'pattern',
  },
  {
    id: 'only4',
    label: '★4 (重要・頻出)',
    badgeLabel: '★4 頻出',
    description: '表現力と理解度を高める頻出語彙',
    filterFn: (v) => (v.importance ?? 3) === 4,
  },
  {
    id: 'only3',
    label: '★3 (標準)',
    badgeLabel: '★3 標準',
    description: '一般的な日常・ストーリー語彙',
    filterFn: (v) => (v.importance ?? 3) === 3,
  },
  {
    id: 'low',
    label: '★1〜2 (発展・難単語)',
    badgeLabel: '★1〜2 発展 🎯',
    description: '専門的・低頻度な語彙をまとめて集中演習',
    filterFn: (v) => (v.importance ?? 3) <= 2,
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

// 出題カードの決定ヘルパー（ユーザーがボタンを押した時のみ呼び出す）
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
    const sorted = [...learning].sort((a, b) => (a.dueTimestamp || 0) - (b.dueTimestamp || 0));
    return sorted[0];
  }

  return null;
}

export const AnkiFlashcardView: React.FC<AnkiFlashcardViewProps> = ({
  vocabs,
  onRateCard,
  onRevertCard,
}) => {
  const today = getTodayDateString();

  // 重要度フィルター設定 (localStorageで永続化、初期値は★4以上推奨)
  const [importanceFilter, setImportanceFilter] = useState<AnkiImportanceFilter>(() => {
    const saved = localStorage.getItem('anki_importance_filter') as AnkiImportanceFilter;
    return saved && FILTER_OPTIONS.some(o => o.id === saved) ? saved : 'ge4';
  });

  const activeFilterDef = useMemo(() => {
    return FILTER_OPTIONS.find(f => f.id === importanceFilter) || FILTER_OPTIONS[0];
  }, [importanceFilter]);

  // 各フィルター別の件数統計（全体件数 & 今日の復習対象件数）
  const filterStats = useMemo(() => {
    const stats: Record<AnkiImportanceFilter, { total: number; due: number }> = {
      ge4: { total: 0, due: 0 },
      syntax: { total: 0, due: 0 },
      ge3: { total: 0, due: 0 },
      all: { total: 0, due: 0 },
      only5: { total: 0, due: 0 },
      only4: { total: 0, due: 0 },
      only3: { total: 0, due: 0 },
      low: { total: 0, due: 0 },
    };

    FILTER_OPTIONS.forEach(opt => {
      const matched = vocabs.filter(opt.filterFn);
      const dueCount = matched.filter(v =>
        v.cardState === 'learning' ||
        v.cardState === 'relearning' ||
        ((!v.cardState || v.cardState === 'new' || v.cardState === 'review') && v.nextReviewDate <= today)
      ).length;

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

  // -------------------------------------------------------------
  // 本家Anki完全準拠の2層キュー管理:
  // 1. reviewQueue (青: 新規 / 緑: 本日の復習期日カード)
  // 2. learningPool (赤: 1分/10分ステップ待機中の学習・再学習カード)
  // -------------------------------------------------------------
  const [reviewQueue, setReviewQueue] = useState<VocabItem[]>([]);
  const [learningPool, setLearningPool] = useState<VocabItem[]>([]);
  const [activeCard, setActiveCard] = useState<VocabItem | null>(null);

  const [isFlipped, setIsFlipped] = useState(false);
  const [sessionReviewedCount, setSessionReviewedCount] = useState(0);
  const [graduatedIds, setGraduatedIds] = useState<Set<string>>(new Set());

  // 操作取り消し（Undo）履歴スタック
  const [historyStack, setHistoryStack] = useState<HistorySnapshot[]>([]);

  // セッション初期化ヘルパー
  const initSession = useCallback((targetVocabs: VocabItem[], allowExtraStudy: boolean = false) => {
    const learningCards = targetVocabs.filter(v => v.cardState === 'learning' || v.cardState === 'relearning');
    const dueReviewCards = targetVocabs.filter(v => (!v.cardState || v.cardState === 'new' || v.cardState === 'review') && v.nextReviewDate <= today);

    let initialReviews: VocabItem[] = [];
    let initialLearning: VocabItem[] = [];

    if (dueReviewCards.length > 0 || learningCards.length > 0) {
      // 今日の復習期日・学習中カードのみを出題
      initialReviews = shuffleArray(dueReviewCards);
      initialLearning = learningCards;
      } else if (allowExtraStudy) {
      // 追加練習
      const unmastered = targetVocabs.filter(v => (v.repetitionCount ?? 0) < 4);
      initialReviews = unmastered.length > 0 ? shuffleArray(unmastered) : shuffleArray(targetVocabs);
      initialLearning = [];
      } else {
      initialReviews = [];
      initialLearning = [];
      }

    const firstCard = pickNextCard(initialLearning, initialReviews);

    setReviewQueue(initialReviews);
    setLearningPool(initialLearning);
    setActiveCard(firstCard);
    setIsFlipped(false);
    setSessionReviewedCount(0);
    setGraduatedIds(new Set());
    setHistoryStack([]);
  }, [today]);

  useEffect(() => {
    initSession(filteredVocabs, false);
  }, [importanceFilter, initSession]);

  const handleFilterChange = (newFilter: AnkiImportanceFilter) => {
    if (newFilter === importanceFilter) return;
    setImportanceFilter(newFilter);
    localStorage.setItem('anki_importance_filter', newFilter);
  };

  // 次回復習間隔のプレビュー
  const intervals = useMemo(() => {
    if (!activeCard) return { again: '1分', hard: '6分', good: '10分', easy: '4日' };
    return getNextReviewIntervals(activeCard);
  }, [activeCard]);

  // 構文カード用のローテーション文取得
  const patternVariationData = useMemo(() => {
    if (!activeCard || !activeCard.variations || activeCard.variations.length === 0) return null;
    const rotIdx = (activeCard.repetitionCount || 0) % activeCard.variations.length;
    const currentVar = activeCard.variations[rotIdx];
    return {
      rotIdx,
      currentVar,
      allVariations: activeCard.variations,
    };
  }, [activeCard]);

  // フリップ（回答表示）
  const handleFlip = () => {
    setIsFlipped(true);
    if (activeCard) {
      const textToSpeak = activeCard.cardType === 'pattern' && patternVariationData
        ? patternVariationData.currentVar.sentence
        : activeCard.phrase;
      speakText(textToSpeak);
    }
  };

  // Undo (直前の評価を取り消す)
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

  // 解答評価ハンドラー (Again / Hard / Good / Easy)
  const handleRate = (rating: 'again' | 'hard' | 'good' | 'easy') => {
    if (!activeCard) return;

    const currentCard = activeCard;

    // Undoスナップショットの保存
    const snapshot: HistorySnapshot = {
      ratedCard: { ...currentCard },
      previousReviewQueue: [...reviewQueue],
      previousLearningPool: [...learningPool],
      previousGraduatedIds: new Set(graduatedIds),
      previousReviewedCount: sessionReviewedCount,
      activeCardBefore: currentCard,
    };
    setHistoryStack(prev => [...prev.slice(-10), snapshot]);

    // SM-2 SRS 計算
    const srsResult = calculateAnkiSRS(currentCard, rating, true);

    const updatedCard: VocabItem = {
      ...currentCard,
      easeFactor: srsResult.easeFactor,
      intervalDays: srsResult.intervalDays,
      repetitionCount: srsResult.repetitionCount,
      lapseCount: srsResult.lapseCount,
      nextReviewDate: srsResult.nextReviewDate,
      lastReviewedAt: srsResult.lastReviewedAt,
      cardState: srsResult.cardState,
      learningStep: srsResult.learningStep,
      dueTimestamp: srsResult.dueTimestamp,
    };

    onRateCard(currentCard.id, rating);

    // キュー更新
    const nextReviewQ = reviewQueue.filter(c => c.id !== currentCard.id);
    const nextLearningP = learningPool.filter(c => c.id !== currentCard.id);
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
            <span className="font-semibold">重要度フィルター:</span>
          </div>
          <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
            {FILTER_OPTIONS.map(opt => {
              const stat = filterStats[opt.id];
              const isSelected = importanceFilter === opt.id;
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
              選択中のフィルター【{activeFilterDef.label}】における本日の復習期日カードはすべて完了しました。素晴らしい継続力です！
            </p>
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
              <span>追加で練習する（未定着カード）</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Cloze マスキング表示ヘルパー
  const renderCloze = (sentence: string, tokens: string[]) => {
    if (!tokens || tokens.length === 0) return sentence;
    let parts = [sentence];
    tokens.forEach(tok => {
      const nextParts: string[] = [];
      const regex = new RegExp(`(${tok})`, 'gi');
      parts.forEach(p => {
        const split = p.split(regex);
        nextParts.push(...split);
      });
      parts = nextParts;
    });

    return parts.map((part, idx) => {
      const isTarget = tokens.some(t => t.toLowerCase() === part.toLowerCase());
      if (isTarget) {
        return (
          <span key={idx} className="px-2 py-0.5 mx-1 bg-amber-500/20 border border-amber-500/50 text-amber-300 font-bold rounded-md">
            [ ___ ]
          </span>
        );
      }
      return <span key={idx}>{part}</span>;
    });
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
      {/* 1. Header: Filter & Anki 3-Counter Progress Bar */}
      <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-800">
        {/* Importance Filter Pills */}
        <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
          {FILTER_OPTIONS.map(opt => {
            const stat = filterStats[opt.id];
            const isSelected = importanceFilter === opt.id;
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

      {/* 2. Anki Three-Counter Display: [🔴 学習中] [🔵 新規] [🟢 復習] */}
      <div className="flex items-center justify-between bg-slate-900/90 border border-slate-800 rounded-2xl p-3 shadow-lg text-xs">
        <div className="flex items-center space-x-4">
          {/* 赤: 学習中・再学習プール */}
          <div className="flex items-center space-x-1.5" title="学習中・再学習ステップ中（1分/10分待機）">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
            <span className="font-extrabold text-rose-400">{learningPool.length}</span>
            <span className="text-slate-400 text-[11px]">学習中</span>
          </div>

          {/* 青: 新規・初回 */}
          <div className="flex items-center space-x-1.5" title="未学習・新規カード">
            <span className="w-2.5 h-2.5 rounded-full bg-sky-500" />
            <span className="font-extrabold text-sky-400">
              {reviewQueue.filter(c => !c.cardState || c.cardState === 'new' || (c.repetitionCount ?? 0) === 0).length}
            </span>
            <span className="text-slate-400 text-[11px]">新規</span>
          </div>

          {/* 緑: 本日の復習期日 */}
          <div className="flex items-center space-x-1.5" title="期日到来の復習カード">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span className="font-extrabold text-emerald-400">
              {reviewQueue.filter(c => c.cardState === 'review' || (c.repetitionCount ?? 0) > 0).length}
            </span>
            <span className="text-slate-400 text-[11px]">復習</span>
          </div>
        </div>

        <div className="text-[11px] text-slate-400">
          本日回答: <strong className="text-white">{sessionReviewedCount}</strong> 件
        </div>
      </div>

      {/* 3. Main Flashcard */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 min-h-[320px] flex flex-col justify-between transition-all">
        {/* Card Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2">
            {activeCard.cardType === 'pattern' ? (
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
                CEFR {activeCard.level || 'B1'} 構文マスター
              </span>
            ) : (
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-md bg-blue-500/20 text-blue-300 border border-blue-500/30">
                {activeCard.partOfSpeech || '語彙・表現'}
              </span>
            )}

            {patternVariationData && (
              <span className="text-[11px] font-semibold text-amber-300/80 flex items-center gap-1 bg-slate-950 px-2 py-0.5 rounded-md border border-slate-800">
                <Repeat className="w-3 h-3" />
                文脈ローテーション #{patternVariationData.rotIdx + 1}/3
              </span>
            )}
          </div>

          <div className="flex items-center space-x-1.5 text-amber-400">
            {Array.from({ length: activeCard.importance ?? 3 }).map((_, i) => (
              <Star key={i} className="w-3.5 h-3.5 fill-amber-400" />
            ))}
          </div>
        </div>

        {/* Card Body: Front vs Back */}
        <div className="space-y-4 text-center my-auto py-2">
          {activeCard.cardType === 'pattern' && patternVariationData ? (
            /* Syntax Pattern Card UI */
            <div className="space-y-4">
              <div className="space-y-1.5">
                <span className="text-xs font-bold text-slate-400">【この日本語の意味・構文は？】</span>
                <div className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
                  「{patternVariationData.currentVar.translation}」
                </div>
              </div>

              {/* Context Cloze Sentence on Front */}
              <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl text-base sm:text-lg text-slate-200 leading-relaxed font-serif">
                {isFlipped ? (
                  <span className="text-white font-bold">
                    {patternVariationData.currentVar.sentence}
                  </span>
                ) : (
                  renderCloze(patternVariationData.currentVar.sentence, patternVariationData.currentVar.targetTokens)
                )}
              </div>

              {/* Flipped: Reveal Target Structure & Focus Point */}
              {isFlipped && (
                <div className="p-4 bg-amber-950/30 border border-amber-500/30 rounded-2xl text-left space-y-3 animate-fadeIn">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-400 flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5" />
                      正解の構文パターン:
                    </span>
                    <button
                      onClick={() => speakText(patternVariationData.currentVar.sentence)}
                      className="p-1 text-sky-400 hover:text-sky-300"
                      title="音声を再生"
                    >
                      <Volume2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="text-lg font-bold text-white">
                    {activeCard.phrase}
                  </div>
                  {activeCard.contextNote && (
                    <div className="text-xs text-amber-200/90 leading-relaxed">
                      💡 {activeCard.contextNote}
                    </div>
                  )}

                  {/* 3 Variations List */}
                  <div className="pt-2 border-t border-amber-500/20 space-y-1.5">
                    <span className="text-[11px] font-bold text-slate-400">3つの文脈バリエーション:</span>
                    {patternVariationData.allVariations.map((v, i) => (
                      <div
                        key={i}
                        className={`text-xs p-2 rounded-xl transition-all ${
                          i === patternVariationData.rotIdx
                            ? 'bg-amber-500/20 border border-amber-500/40 text-amber-200 font-medium'
                            : 'bg-slate-950/50 text-slate-400'
                        }`}
                      >
                        <div className="font-semibold text-white">{i + 1}. {v.sentence}</div>
                        <div className="text-[11px] text-slate-400">{v.translation}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Standard Vocab Card UI */
            <div className="space-y-3">
              <div className="flex items-center justify-center space-x-2">
                <h3 className="text-2xl sm:text-3xl font-extrabold text-sky-400 tracking-tight">
                  {activeCard.phrase}
                </h3>
                <button
                  onClick={() => speakText(activeCard.phrase)}
                  className="p-2 text-sky-400 hover:text-sky-300 hover:bg-sky-950/70 rounded-xl transition-colors border border-sky-500/30"
                  title="発音を再生"
                >
                  <Volume2 className="w-4 h-4" />
                </button>
              </div>

              {isFlipped ? (
                <div className="space-y-3 animate-fadeIn">
                  <div className="text-xl sm:text-2xl font-bold text-white">
                    {activeCard.meaning}
                  </div>
                  {activeCard.contextNote && (
                    <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                      {activeCard.contextNote}
                    </p>
                  )}
                  {activeCard.exampleSentence && (
                    <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl text-xs text-slate-300 text-left font-serif leading-relaxed">
                      <span className="font-bold text-sky-400 block mb-0.5">例文:</span>
                      "{activeCard.exampleSentence}"
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-8">
                  <span className="text-xs text-slate-500">タップして日本語訳を表示</span>
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
    </div>
  );
};
