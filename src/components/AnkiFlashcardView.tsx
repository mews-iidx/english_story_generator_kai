import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { VocabItem } from '../types/vocab';
import { Volume2, Sparkles, CheckCircle2, RotateCcw, ArrowRight, Star, ChevronDown, ChevronUp, BookOpen } from 'lucide-react';
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

  // 今日の復習対象ユニーク単語リスト
  const initialDueItems = useMemo(() => {
    const due = vocabs.filter(v => v.nextReviewDate <= today);
    if (due.length > 0) {
      return due.sort((a, b) => (b.importance ?? 3) - (a.importance ?? 3) || b.lapseCount - a.lapseCount);
    }
    return vocabs.filter(v => v.repetitionCount < 4).sort((a, b) => (b.importance ?? 3) - (a.importance ?? 3));
  }, [vocabs, today]);

  // 動的キュー（セッション内で未完了のカードを保持する配列）
  const [queue, setQueue] = useState<VocabItem[]>([]);
  const [isFlipped, setIsFlipped] = useState(false);
  const [showExample, setShowExample] = useState(false);
  
  // 統計・カウンター状態
  const [sessionReviewedCount, setSessionReviewedCount] = useState(0);
  const [graduatedIds, setGraduatedIds] = useState<Set<string>>(new Set());
  const [relearningIds, setRelearningIds] = useState<Set<string>>(new Set());

  // 初期化
  useEffect(() => {
    setQueue(initialDueItems);
    setIsFlipped(false);
    setShowExample(false);
    setSessionReviewedCount(0);
    setGraduatedIds(new Set());
    setRelearningIds(new Set());
  }, [initialDueItems]);

  const currentCard = queue[0]; // 常にキューの先頭カードを出題

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
  }, [currentCard?.id]);

  const handleRating = (rating: 'again' | 'hard' | 'good' | 'easy') => {
    if (!currentCard) return;

    const cardId = currentCard.id;

    // 1. 永続ストレージへの記録
    onRateCard(cardId, rating);
    setSessionReviewedCount(prev => prev + 1);

    // 2. 本家Ankiのラーニング判定
    const isNewOrLapse = (currentCard.repetitionCount ?? 0) === 0;
    const shouldRelearn = rating === 'again' || (rating === 'hard' && isNewOrLapse);

    if (shouldRelearn) {
      // 再学習（リトライ）：卒業せず、キューの少し後ろ（3〜4枚後または末尾）に再挿入
      setRelearningIds(prev => new Set(prev).add(cardId));
      
      setQueue(prevQueue => {
        const rest = prevQueue.slice(1);
        const insertOffset = rest.length >= 3 ? 3 : rest.length;
        const nextQ = [...rest];
        nextQ.splice(insertOffset, 0, currentCard);
        return nextQ;
      });
    } else {
      // 卒業（合格）：キューから除外、卒業セットに追加
      setGraduatedIds(prev => new Set(prev).add(cardId));
      setRelearningIds(prev => {
        const updated = new Set(prev);
        updated.delete(cardId);
        return updated;
      });

      setQueue(prevQueue => {
        const nextQ = prevQueue.slice(1);
        if (nextQ.length === 0) {
          confetti({
            particleCount: 100,
            spread: 80,
            origin: { y: 0.6 },
            colors: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6']
          });
        }
        return nextQ;
      });
    }

    setIsFlipped(false);
    setShowExample(false);
  };

  const handleRestart = useCallback(() => {
    setQueue(initialDueItems);
    setIsFlipped(false);
    setShowExample(false);
    setSessionReviewedCount(0);
    setGraduatedIds(new Set());
    setRelearningIds(new Set());
  }, [initialDueItems]);

  // 全カード完了画面
  if (!currentCard || queue.length === 0) {
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
                合計 <strong className="text-cyan-300">{sessionReviewedCount}回</strong> の解答で、本日の全 <strong className="text-white">{initialDueItems.length}語</strong> を完全にクリアしました！
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
  
  // 正確な残り枚数（未卒業のユニーク単語数）
  const totalCards = initialDueItems.length;
  const remainingCards = Math.max(0, totalCards - graduatedIds.size);
  const inRelearnCount = relearningIds.size;

  return (
    <div className="max-w-xl mx-auto space-y-3">
      {/* Progress Header: チラつきのない安定したAnkiカウンタ */}
      <div className="flex items-center justify-between text-xs px-2 text-slate-400">
        <span className="flex items-center gap-1.5 font-semibold text-cyan-400">
          <Sparkles className="w-3.5 h-3.5 text-yellow-400" />
          Anki 一問一答（忘却曲線SRS）
        </span>

        {/* 右側カウンタ：固定レイアウトでチラつきゼロ */}
        <div className="flex items-center gap-2 text-[11px] font-medium">
          {inRelearnCount > 0 && (
            <span className="text-red-400 bg-red-950/60 border border-red-500/30 px-2 py-0.5 rounded-md font-semibold">
              🔴 再学習: {inRelearnCount}語
            </span>
          )}
          <span className="bg-slate-950 px-2.5 py-0.5 rounded-md border border-slate-800">
            残り: <strong className="text-white font-bold">{remainingCards}</strong> / {totalCards} 語
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
