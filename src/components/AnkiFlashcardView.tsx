import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { VocabItem } from '../types/vocab';
import { Volume2, Sparkles, CheckCircle2, RotateCcw, ArrowRight, Star, ChevronDown, ChevronUp, BookOpen, RefreshCw } from 'lucide-react';
import confetti from 'canvas-confetti';
import { speakText } from '../utils/speech';
import { getTodayDateString, getNextReviewIntervals } from '../utils/srs';

interface AnkiFlashcardViewProps {
  vocabs: VocabItem[];
  onRateCard: (vocabId: string, rating: 'again' | 'hard' | 'good' | 'easy') => void;
}

export const AnkiFlashcardView: React.FC<AnkiFlashcardViewProps> = ({
  vocabs,
  onRateCard,
}) => {
  const today = getTodayDateString();

  // 今日の復習対象語彙の抽出
  const initialDueItems = useMemo(() => {
    const due = vocabs.filter(v => v.nextReviewDate <= today);
    if (due.length > 0) {
      return due.sort((a, b) => (b.importance ?? 3) - (a.importance ?? 3) || b.lapseCount - a.lapseCount);
    }
    return vocabs.filter(v => v.repetitionCount < 4).sort((a, b) => (b.importance ?? 3) - (a.importance ?? 3));
  }, [vocabs, today]);

  // セッション内学習キュー（AgainやHardで再挿入される動的キュー）
  const [queue, setQueue] = useState<VocabItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [showExample, setShowExample] = useState(false);
  const [sessionReviewedCount, setSessionReviewedCount] = useState(0);
  const [relearningCount, setRelearningCount] = useState(0); // セッション内でAgainを押された回数

  // 初期化
  useEffect(() => {
    setQueue(initialDueItems);
    setCurrentIndex(0);
    setSessionReviewedCount(0);
    setRelearningCount(0);
  }, [initialDueItems]);

  const currentCard = queue[currentIndex];

  // 次回間隔プレビュー（Anki本家同様に各ボタンに表示）
  const nextIntervals = useMemo(() => {
    return getNextReviewIntervals(currentCard);
  }, [currentCard]);

  useEffect(() => {
    setIsFlipped(false);
    setShowExample(false);
    if (currentCard) {
      speakText(currentCard.phrase, 0.95);
    }
  }, [currentIndex, currentCard?.id]);

  const handleRating = (rating: 'again' | 'hard' | 'good' | 'easy') => {
    if (!currentCard) return;

    // 1. 永続ストレージへの記録
    onRateCard(currentCard.id, rating);
    setSessionReviewedCount(prev => prev + 1);

    // 2. 本家Ankiのラーニングステップ（当日セッション内リトライキューの処理）
    const isNewOrLapse = (currentCard.repetitionCount ?? 0) === 0;
    const shouldRelearn = rating === 'again' || (rating === 'hard' && isNewOrLapse);

    if (shouldRelearn) {
      setRelearningCount(prev => prev + 1);
      // セッションのキュー末尾（残り枚数が4枚以上あれば3枚後ろ、少なければ末尾）に再挿入
      setQueue(prevQueue => {
        const remainingCount = prevQueue.length - (currentIndex + 1);
        const insertOffset = remainingCount >= 3 ? 3 : remainingCount;
        const insertIndex = currentIndex + 1 + insertOffset;
        
        const nextQ = [...prevQueue];
        nextQ.splice(insertIndex, 0, currentCard);
        return nextQ;
      });
    }

    // 3. 終了チェック（すべてのカードがGood/Easyで卒業した時）
    const isLastCard = !shouldRelearn && currentIndex + 1 >= queue.length;
    if (isLastCard) {
      confetti({
        particleCount: 100,
        spread: 80,
        origin: { y: 0.6 },
        colors: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6']
      });
    }

    setIsFlipped(false);
    setShowExample(false);
    setCurrentIndex(prev => prev + 1);
  };

  const handleRestart = useCallback(() => {
    setQueue(initialDueItems);
    setCurrentIndex(0);
    setIsFlipped(false);
    setShowExample(false);
    setSessionReviewedCount(0);
    setRelearningCount(0);
  }, [initialDueItems]);

  if (!currentCard || currentIndex >= queue.length) {
    return (
      <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-8 sm:p-12 text-center space-y-5 max-w-xl mx-auto shadow-2xl animate-fadeIn">
        <div className="w-16 h-16 mx-auto rounded-3xl bg-emerald-950/80 border border-emerald-500/40 flex items-center justify-center">
          <CheckCircle2 className="w-8 h-8 text-emerald-400" />
        </div>

        <div className="space-y-1.5">
          <h3 className="text-xl sm:text-2xl font-bold text-white">
            今日のAnki復習セッション完了！🎉
          </h3>
          <p className="text-xs sm:text-sm text-slate-300">
            {sessionReviewedCount > 0 ? (
              <>
                合計 <strong className="text-cyan-300">{sessionReviewedCount}回</strong> の解答で全カードを完全定着させました！
                {relearningCount > 0 && (
                  <span className="block text-slate-400 text-xs mt-1">
                    （うち {relearningCount}回のセッション内リトライを克服）
                  </span>
                )}
              </>
            ) : (
              '現在復習が必要な語彙はありません！'
            )}
          </p>
        </div>

        <div className="pt-2 flex justify-center gap-3">
          <button
            onClick={handleRestart}
            className="flex items-center space-x-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-blue-600/30 transition-all"
          >
            <RotateCcw className="w-4 h-4" />
            <span>もう一度復習する</span>
          </button>
        </div>
      </div>
    );
  }

  const importance = currentCard.importance ?? 3;
  const easePercent = Math.round((currentCard.easeFactor ?? 2.5) * 100);
  const remainingCount = queue.length - currentIndex;

  return (
    <div className="max-w-xl mx-auto space-y-3">
      {/* Progress Header: Anki Style Counter */}
      <div className="flex items-center justify-between text-xs px-2 text-slate-400">
        <span className="flex items-center gap-1.5 font-semibold text-cyan-400">
          <Sparkles className="w-3.5 h-3.5 text-yellow-400" />
          Anki 一問一答（忘却曲線SRS）
        </span>

        <div className="flex items-center gap-2">
          {relearningCount > 0 && (
            <span className="flex items-center gap-1 px-2 py-0.5 bg-red-950/60 border border-red-500/30 text-red-400 rounded-md text-[11px] font-bold">
              <RefreshCw className="w-3 h-3 animate-spin-slow" />
              リトライ克服中
            </span>
          )}
          <span className="font-medium">
            残り: <strong className="text-white font-bold">{remainingCount}</strong> 枚
          </span>
        </div>
      </div>

      {/* Main Flashcard: Fixed height footprint so buttons NEVER jump */}
      <div
        onClick={() => setIsFlipped(!isFlipped)}
        className={`bg-slate-900/95 border rounded-3xl p-5 sm:p-7 shadow-2xl h-[270px] sm:h-[290px] flex flex-col justify-between cursor-pointer select-none transition-all duration-200 hover:border-cyan-500/50 relative overflow-hidden ${
          isFlipped
            ? 'border-cyan-500/60 bg-gradient-to-br from-slate-900 via-blue-950/40 to-slate-900'
            : 'border-slate-800 hover:shadow-cyan-500/10'
        }`}
      >
        {/* Card Header: Meta badges */}
        <div className="flex items-center justify-between flex-shrink-0">
          <div className="flex items-center space-x-2">
            <span className="text-[10px] uppercase font-bold text-slate-400 bg-slate-950 px-2 py-0.5 rounded-md border border-slate-800">
              {currentCard.partOfSpeech || '語彙'}
            </span>
            <span className="text-[10px] font-bold text-amber-300 bg-amber-950/60 px-2 py-0.5 rounded-md border border-amber-500/30 flex items-center gap-0.5">
              <Star className="w-3 h-3 fill-current" />★{importance}
            </span>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              speakText(currentCard.phrase);
            }}
            className="p-1.5 text-slate-400 hover:text-cyan-400 hover:bg-slate-800 rounded-xl transition-colors border border-slate-800"
            title="発音を再生"
          >
            <Volume2 className="w-4 h-4" />
          </button>
        </div>

        {/* Card Center Content */}
        <div className="flex-1 flex flex-col items-center justify-center text-center px-2 min-h-0 overflow-y-auto">
          {/* Phrase */}
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            {currentCard.phrase}
          </h2>

          {/* Back: Meaning & Collapsible Example */}
          {isFlipped ? (
            <div className="mt-3 space-y-2 animate-fadeIn w-full">
              <p className="text-lg sm:text-xl font-bold text-cyan-300">
                {currentCard.meaning}
              </p>

              {/* Collapsible Example Accordion (デフォルト折りたたみ) */}
              {(currentCard.exampleSentence || currentCard.contextNote) && (
                <div className="pt-1">
                  {!showExample ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowExample(true);
                      }}
                      className="inline-flex items-center space-x-1 px-3 py-1 bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-cyan-300 border border-slate-800 rounded-full text-[11px] font-semibold transition-all"
                    >
                      <BookOpen className="w-3 h-3" />
                      <span>例文・解説を表示</span>
                      <ChevronDown className="w-3 h-3 ml-0.5" />
                    </button>
                  ) : (
                    <div 
                      onClick={(e) => e.stopPropagation()} 
                      className="bg-slate-950/90 border border-slate-800 p-2.5 rounded-xl text-xs text-slate-300 text-left space-y-1.5 animate-fadeIn max-h-[90px] overflow-y-auto"
                    >
                      <div className="flex items-center justify-between text-[10px] text-cyan-400 font-bold">
                        <span>📖 例文:</span>
                        <div className="flex items-center space-x-1">
                          <button
                            type="button"
                            onClick={() => speakText(currentCard.exampleSentence || '')}
                            className="p-0.5 text-slate-400 hover:text-cyan-300"
                            title="例文を再生"
                          >
                            <Volume2 className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowExample(false)}
                            className="p-0.5 text-slate-400 hover:text-white"
                            title="閉じる"
                          >
                            <ChevronUp className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      {currentCard.exampleSentence && (
                        <p className="font-serif leading-tight text-[11px]">
                          "{currentCard.exampleSentence}"
                        </p>
                      )}
                      {currentCard.contextNote && (
                        <p className="text-[10px] text-slate-400">
                          💡 {currentCard.contextNote}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="mt-4 text-xs text-slate-500 flex items-center justify-center gap-1.5 animate-pulse">
              <span>👆 カードをタップして答えを表示</span>
            </div>
          )}
        </div>

        {/* Card Footer info: Repetition, Interval, and Ease Factor */}
        <div className="text-center text-[10px] text-slate-500 flex-shrink-0 flex items-center justify-center gap-2">
          <span>定着回数: <strong className="text-slate-400">{currentCard.repetitionCount}回</strong></span>
          <span>•</span>
          <span>現在間隔: <strong className="text-slate-400">{currentCard.intervalDays}日</strong></span>
          <span>•</span>
          <span>Ease: <strong className="text-slate-400">{easePercent}%</strong></span>
        </div>
      </div>

      {/* Fixed-Height Action Buttons Area (高さ64pxで完全固定。各ボタンに次回期日を動的バッジ表示) */}
      <div className="h-[64px] flex items-center">
        {isFlipped ? (
          <div className="grid grid-cols-4 gap-2 w-full animate-fadeIn">
            {/* 1. Again (もう一度: セッション内で再出題) */}
            <button
              type="button"
              onClick={() => handleRating('again')}
              className="flex flex-col items-center justify-center h-[58px] bg-red-950/60 hover:bg-red-900/80 active:scale-95 text-red-400 border border-red-500/40 rounded-2xl text-xs font-bold transition-all shadow-md shadow-red-950/30"
            >
              <span className="text-sm">🔴</span>
              <span>Again</span>
              <span className="text-[9px] text-red-300 font-semibold bg-red-900/40 px-1.5 py-0.2 rounded mt-0.5">
                {nextIntervals.again}
              </span>
            </button>

            {/* 2. Hard (難しい) */}
            <button
              type="button"
              onClick={() => handleRating('hard')}
              className="flex flex-col items-center justify-center h-[58px] bg-amber-950/60 hover:bg-amber-900/80 active:scale-95 text-amber-400 border border-amber-500/40 rounded-2xl text-xs font-bold transition-all shadow-md shadow-amber-950/30"
            >
              <span className="text-sm">🟠</span>
              <span>Hard</span>
              <span className="text-[9px] text-amber-300 font-semibold bg-amber-900/40 px-1.5 py-0.2 rounded mt-0.5">
                {nextIntervals.hard}
              </span>
            </button>

            {/* 3. Good (普通: 卒業) */}
            <button
              type="button"
              onClick={() => handleRating('good')}
              className="flex flex-col items-center justify-center h-[58px] bg-emerald-950/60 hover:bg-emerald-900/80 active:scale-95 text-emerald-400 border border-emerald-500/40 rounded-2xl text-xs font-bold transition-all shadow-md shadow-emerald-950/30"
            >
              <span className="text-sm">🟢</span>
              <span>Good</span>
              <span className="text-[9px] text-emerald-300 font-semibold bg-emerald-900/40 px-1.5 py-0.2 rounded mt-0.5">
                {nextIntervals.good}
              </span>
            </button>

            {/* 4. Easy (簡単: 卒業＋ボーナス) */}
            <button
              type="button"
              onClick={() => handleRating('easy')}
              className="flex flex-col items-center justify-center h-[58px] bg-blue-950/60 hover:bg-blue-900/80 active:scale-95 text-cyan-300 border border-cyan-500/40 rounded-2xl text-xs font-bold transition-all shadow-md shadow-blue-950/30"
            >
              <span className="text-sm">🔵</span>
              <span>Easy</span>
              <span className="text-[9px] text-cyan-200 font-semibold bg-blue-900/40 px-1.5 py-0.2 rounded mt-0.5">
                {nextIntervals.easy}
              </span>
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setIsFlipped(true)}
            className="w-full h-[58px] bg-slate-900 hover:bg-slate-850 active:scale-[0.99] text-slate-200 border border-slate-800 rounded-2xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-2"
          >
            <span>答えを見る</span>
            <ArrowRight className="w-4 h-4 text-cyan-400" />
          </button>
        )}
      </div>
    </div>
  );
};
