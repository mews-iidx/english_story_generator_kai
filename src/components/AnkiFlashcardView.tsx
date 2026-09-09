import React, { useState, useEffect, useMemo } from 'react';
import { VocabItem } from '../types/vocab';
import { Volume2, Sparkles, CheckCircle2, RotateCcw, ArrowRight, Star } from 'lucide-react';
import confetti from 'canvas-confetti';
import { speakText } from '../utils/speech';
import { getTodayDateString } from '../utils/srs';

interface AnkiFlashcardViewProps {
  vocabs: VocabItem[];
  onRateCard: (vocabId: string, rating: 'again' | 'hard' | 'good' | 'easy') => void;
}

export const AnkiFlashcardView: React.FC<AnkiFlashcardViewProps> = ({
  vocabs,
  onRateCard,
}) => {
  const today = getTodayDateString();

  // 今日の復習対象語彙（未定着・期日到来のもの）
  const dueQueue = useMemo(() => {
    const due = vocabs.filter(v => v.nextReviewDate <= today);
    if (due.length > 0) {
      return due.sort((a, b) => (b.importance ?? 3) - (a.importance ?? 3) || b.lapseCount - a.lapseCount);
    }
    // 期日到来がない場合は未定着のものを出題
    return vocabs.filter(v => v.repetitionCount < 4).sort((a, b) => (b.importance ?? 3) - (a.importance ?? 3));
  }, [vocabs, today]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [sessionReviewedCount, setSessionReviewedCount] = useState(0);

  const currentCard = dueQueue[currentIndex];

  useEffect(() => {
    setIsFlipped(false);
    if (currentCard) {
      speakText(currentCard.phrase, 0.95);
    }
  }, [currentIndex, currentCard?.id]);

  const handleRating = (rating: 'again' | 'hard' | 'good' | 'easy') => {
    if (!currentCard) return;

    onRateCard(currentCard.id, rating);
    setSessionReviewedCount(prev => prev + 1);

    if (currentIndex + 1 >= dueQueue.length) {
      confetti({
        particleCount: 100,
        spread: 80,
        origin: { y: 0.6 },
        colors: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6']
      });
    }

    setIsFlipped(false);
    setCurrentIndex(prev => prev + 1);
  };

  const handleRestart = () => {
    setCurrentIndex(0);
    setIsFlipped(false);
    setSessionReviewedCount(0);
  };

  if (!currentCard || currentIndex >= dueQueue.length) {
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
            {sessionReviewedCount > 0 ? `${sessionReviewedCount} 枚のフラッシュカードを復習しました。` : '現在復習が必要な語彙はありません！'}
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

  return (
    <div className="max-w-xl mx-auto space-y-4">
      {/* Progress Counter */}
      <div className="flex items-center justify-between text-xs px-2 text-slate-400">
        <span className="flex items-center gap-1.5 font-semibold text-blue-400">
          <Sparkles className="w-3.5 h-3.5 text-yellow-400" />
          Anki 一問一答（忘却曲線SRS）
        </span>
        <span>
          残り: <strong>{dueQueue.length - currentIndex}</strong> / {dueQueue.length} 枚
        </span>
      </div>

      {/* Main Flashcard */}
      <div
        onClick={() => setIsFlipped(!isFlipped)}
        className={`bg-slate-900/90 border rounded-3xl p-6 sm:p-9 shadow-2xl min-h-[300px] flex flex-col justify-between cursor-pointer select-none transition-all duration-300 hover:border-blue-500/50 ${
          isFlipped
            ? 'border-blue-500/60 bg-gradient-to-br from-slate-900 via-blue-950/40 to-slate-900'
            : 'border-slate-800 hover:shadow-blue-500/10'
        }`}
      >
        {/* Card Header: Meta badges */}
        <div className="flex items-center justify-between">
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
            className="p-2 text-slate-400 hover:text-blue-400 hover:bg-slate-800 rounded-xl transition-colors border border-slate-800"
            title="発音を再生"
          >
            <Volume2 className="w-4 h-4" />
          </button>
        </div>

        {/* Card Front & Back Content */}
        <div className="text-center py-6 space-y-4">
          {/* Front: Phrase */}
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            {currentCard.phrase}
          </h2>

          {/* Back: Meaning & Details */}
          {isFlipped ? (
            <div className="space-y-4 animate-fadeIn">
              <p className="text-lg sm:text-xl font-bold text-sky-400">
                {currentCard.meaning}
              </p>

              {currentCard.exampleSentence && (
                <div className="bg-slate-950/70 border border-slate-800 p-3 rounded-2xl text-xs text-slate-300 text-left space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-blue-400 font-bold">
                    <span>📖 例文:</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        speakText(currentCard.exampleSentence);
                      }}
                      className="p-1 text-slate-400 hover:text-blue-300"
                    >
                      <Volume2 className="w-3 h-3" />
                    </button>
                  </div>
                  <p className="font-serif leading-relaxed">
                    "{currentCard.exampleSentence}"
                  </p>
                </div>
              )}

              {currentCard.contextNote && (
                <p className="text-[11px] text-slate-400 bg-slate-950/40 p-2 rounded-xl text-left">
                  💡 {currentCard.contextNote}
                </p>
              )}
            </div>
          ) : (
            <div className="pt-8 text-xs text-slate-500 flex items-center justify-center gap-1.5 animate-pulse">
              <span>👆 カードをタップして答えを表示</span>
            </div>
          )}
        </div>

        {/* Card Footer info */}
        <div className="text-center text-[10px] text-slate-500">
          定着回数: {currentCard.repetitionCount}回 (間隔: {currentCard.intervalDays}日)
        </div>
      </div>

      {/* 4-step Rating Action Buttons (裏面表示時) */}
      {isFlipped ? (
        <div className="grid grid-cols-4 gap-2 pt-1 animate-slideUp">
          <button
            type="button"
            onClick={() => handleRating('again')}
            className="flex flex-col items-center justify-center p-2.5 bg-red-950/60 hover:bg-red-900/80 text-red-400 border border-red-500/40 rounded-2xl text-xs font-bold transition-all shadow-md shadow-red-950/30"
          >
            <span className="text-sm sm:text-base">🔴</span>
            <span>Again</span>
            <span className="text-[9px] text-red-400/80 font-normal mt-0.5">1分後</span>
          </button>

          <button
            type="button"
            onClick={() => handleRating('hard')}
            className="flex flex-col items-center justify-center p-2.5 bg-amber-950/60 hover:bg-amber-900/80 text-amber-400 border border-amber-500/40 rounded-2xl text-xs font-bold transition-all shadow-md shadow-amber-950/30"
          >
            <span className="text-sm sm:text-base">🟠</span>
            <span>Hard</span>
            <span className="text-[9px] text-amber-400/80 font-normal mt-0.5">1日後</span>
          </button>

          <button
            type="button"
            onClick={() => handleRating('good')}
            className="flex flex-col items-center justify-center p-2.5 bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-400 border border-emerald-500/40 rounded-2xl text-xs font-bold transition-all shadow-md shadow-emerald-950/30"
          >
            <span className="text-sm sm:text-base">🟢</span>
            <span>Good</span>
            <span className="text-[9px] text-emerald-400/80 font-normal mt-0.5">3〜4日後</span>
          </button>

          <button
            type="button"
            onClick={() => handleRating('easy')}
            className="flex flex-col items-center justify-center p-2.5 bg-blue-950/60 hover:bg-blue-900/80 text-blue-300 border border-blue-500/40 rounded-2xl text-xs font-bold transition-all shadow-md shadow-blue-950/30"
          >
            <span className="text-sm sm:text-base">🔵</span>
            <span>Easy</span>
            <span className="text-[9px] text-blue-400/80 font-normal mt-0.5">7日後</span>
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsFlipped(true)}
          className="w-full py-3 bg-slate-900 hover:bg-slate-850 text-slate-200 border border-slate-800 rounded-2xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-2"
        >
          <span>答えを見る</span>
          <ArrowRight className="w-4 h-4 text-blue-400" />
        </button>
      )}
    </div>
  );
};