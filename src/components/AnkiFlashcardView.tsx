import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { VocabItem } from '../types/vocab';
import { Volume2, Sparkles, CheckCircle2, RotateCcw, Star, ChevronDown, ChevronUp, BookOpen, Shuffle, Clock, Zap } from 'lucide-react';
import confetti from 'canvas-confetti';
import { speakText } from '../utils/speech';
import { getTodayDateString, getNextReviewIntervals, calculateAnkiSRS } from '../utils/srs';

interface AnkiFlashcardViewProps {
  vocabs: VocabItem[];
  onRateCard: (vocabId: string, rating: 'again' | 'hard' | 'good' | 'easy') => void;
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

export const AnkiFlashcardView: React.FC<AnkiFlashcardViewProps> = ({
  vocabs,
  onRateCard,
}) => {
  const today = getTodayDateString();

  // 今日の対象カード（未着手 + 再学習中）の選出
  const initialCards = useMemo(() => {
    // 1. 本日再学習中のカード
    const learning = vocabs.filter(v => v.cardState === 'learning' || v.cardState === 'relearning');
    // 2. 本日復習期日のカード (新規または復習)
    const due = vocabs.filter(v => (!v.cardState || v.cardState === 'new' || v.cardState === 'review') && v.nextReviewDate <= today);

    const pool = due.length > 0 || learning.length > 0
      ? [...learning, ...shuffleArray(due)]
      : shuffleArray(vocabs.filter(v => v.repetitionCount < 4));

    return pool;
  }, [vocabs, today]);

  // 動的実行キュー（未合格のカード一覧）
  const [queue, setQueue] = useState<VocabItem[]>([]);
  const [sessionInitialCards, setSessionInitialCards] = useState<VocabItem[]>([]);
  const [isFlipped, setIsFlipped] = useState(false);
  const [showExample, setShowExample] = useState(false);
  
  // 統計・カウンター状態
  const [sessionReviewedCount, setSessionReviewedCount] = useState(0);
  const [graduatedIds, setGraduatedIds] = useState<Set<string>>(new Set());

  // タイマー更新用のステート（毎秒更新）
  const [nowTime, setNowTime] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => {
      setNowTime(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // 初回マウント時のみセッション初期化
  const isInitializedRef = useRef(false);
  useEffect(() => {
    if (!isInitializedRef.current && initialCards.length > 0) {
      setSessionInitialCards(initialCards);
      setQueue(initialCards);
      isInitializedRef.current = true;
    }
  }, [initialCards]);

  const currentCard = queue[0]; // 常にキューの先頭カードを出題

  // 次回間隔プレビュー（Anki本家同様に各ボタンに表示）
  const nextIntervals = useMemo(() => {
    return getNextReviewIntervals(currentCard);
  }, [currentCard]);

  // 新しいカードになった時の読み上げ
  useEffect(() => {
    setIsFlipped(false);
    setShowExample(false);
    if (currentCard) {
      speakText(currentCard.phrase, 0.95);
    }
  }, [currentCard?.id]);

  // レーティング評価処理（Anki SM-2 & Learning Steps 1m/10m 完全準拠）
  const handleRating = useCallback((rating: 'again' | 'hard' | 'good' | 'easy') => {
    if (!currentCard) return;

    const cardId = currentCard.id;

    // 1. 永続ストレージへの記録（LocalStorageに状態が即座に保存されるため中断しても消えない）
    onRateCard(cardId, rating);
    setSessionReviewedCount(prev => prev + 1);

    // 2. 次状態の算出
    const nextSRS = calculateAnkiSRS(currentCard, rating);
    const updatedCard: VocabItem = {
      ...currentCard,
      ...nextSRS,
    };

    const isStillLearning = nextSRS.cardState === 'learning' || nextSRS.cardState === 'relearning';

    if (isStillLearning) {
      // 再学習中：卒業せず、キューの指定間隔（Againは1〜3枚後、Hard/Goodは6〜10枚後）に再挿入
      setQueue(prevQueue => {
        const rest = prevQueue.slice(1);
        if (rest.length === 0) {
          return [updatedCard];
        }

        let insertIndex = 0;
        if (rating === 'again') {
          // 🔴 Again (< 1分): すぐ（1〜3枚後）に出題
          const minOffset = Math.min(rest.length, 1);
          const maxOffset = Math.min(rest.length, 3);
          insertIndex = minOffset + Math.floor(Math.random() * (maxOffset - minOffset + 1));
        } else if (rating === 'hard' && updatedCard.learningStep === 0) {
          // 🟠 Hard (< 6分): 中間（3〜5枚後）に出題
          const minOffset = Math.min(rest.length, 3);
          const maxOffset = Math.min(rest.length, 5);
          insertIndex = minOffset + Math.floor(Math.random() * (maxOffset - minOffset + 1));
        } else {
          // 🟢 Good (< 10分 step) または 🟠 Hard (10分 step): 奥（6〜10枚後またはキューの75%位置）に出題
          if (rest.length <= 3) {
            insertIndex = rest.length;
          } else {
            const minOffset = Math.min(rest.length, Math.max(4, Math.floor(rest.length * 0.6)));
            const maxOffset = Math.min(rest.length, Math.max(minOffset, Math.floor(rest.length * 0.85) + 1));
            insertIndex = minOffset + Math.floor(Math.random() * (maxOffset - minOffset + 1));
          }
        }

        const nextQ = [...rest];
        nextQ.splice(insertIndex, 0, updatedCard);
        return nextQ;
      });
    } else {
      // 🟢 卒業（合格）：キューから除外、卒業セットに追加
      setGraduatedIds(prev => new Set(prev).add(cardId));

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
  }, [currentCard, onRateCard]);

  // 残りキューのシャッフル
  const handleShuffleRemaining = useCallback(() => {
    setQueue(prev => {
      if (prev.length <= 1) return prev;
      return [prev[0], ...shuffleArray(prev.slice(1))];
    });
  }, []);

  // キーボードショートカット (Space, 1, 2, 3, 4)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        if (!isFlipped) {
          setIsFlipped(true);
        } else {
          handleRating('good');
        }
      } else if (isFlipped) {
        if (e.key === '1') {
          e.preventDefault();
          handleRating('again');
        } else if (e.key === '2') {
          e.preventDefault();
          handleRating('hard');
        } else if (e.key === '3') {
          e.preventDefault();
          handleRating('good');
        } else if (e.key === '4') {
          e.preventDefault();
          handleRating('easy');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFlipped, handleRating]);

  // もう一度復習する（セッション再初期化）
  const handleRestart = useCallback(() => {
    const learning = vocabs.filter(v => v.cardState === 'learning' || v.cardState === 'relearning');
    const due = vocabs.filter(v => (!v.cardState || v.cardState === 'new' || v.cardState === 'review') && v.nextReviewDate <= today);

    const pool = due.length > 0 || learning.length > 0
      ? [...learning, ...shuffleArray(due)]
      : shuffleArray(vocabs.filter(v => v.repetitionCount < 4));

    setSessionInitialCards(pool);
    setQueue(pool);
    setIsFlipped(false);
    setShowExample(false);
    setSessionReviewedCount(0);
    setGraduatedIds(new Set());
  }, [vocabs, today]);

  // 全カード完了画面
  if (!currentCard || queue.length === 0) {
    const totalDoneCount = sessionInitialCards.length || initialCards.length;

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
                合計 <strong className="text-cyan-300">{sessionReviewedCount}回</strong> の解答で、本日の全 <strong className="text-white">{totalDoneCount}語</strong> を完全にクリアしました！
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
            <span>もう一度復習する（シャッフル）</span>
          </button>
        </div>
      </div>
    );
  }

  const importance = currentCard.importance ?? 3;
  const easePercent = Math.round((currentCard.easeFactor ?? 2.5) * 100);
  
  // カウンタ計算（Anki本家標準の3色）
  const inRelearnCount = vocabs.filter(v => (v.cardState === 'learning' || v.cardState === 'relearning') && !graduatedIds.has(v.id)).length;
  const graduatedCount = graduatedIds.size;
  const freshDueCount = vocabs.filter(v => (!v.cardState || v.cardState === 'new' || v.cardState === 'review') && v.nextReviewDate <= today && !graduatedIds.has(v.id)).length;

  // ラーニング待機時間計算
  const isTimerWaiting = currentCard.dueTimestamp && currentCard.dueTimestamp > nowTime;
  const waitSecondsRemaining = isTimerWaiting ? Math.ceil((currentCard.dueTimestamp! - nowTime) / 1000) : 0;
  const waitMinutes = Math.floor(waitSecondsRemaining / 60);
  const waitSeconds = waitSecondsRemaining % 60;

  return (
    <div className="max-w-xl mx-auto space-y-3">
      {/* Progress Header: Ankiステータスカウンタ ＆ シャッフル */}
      <div className="flex items-center justify-between text-xs px-2 text-slate-400 flex-wrap gap-2">
        <div className="flex items-center gap-1.5 font-semibold text-cyan-400">
          <Sparkles className="w-3.5 h-3.5 text-yellow-400" />
          <span>Anki 一問一答（忘却曲線SRS）</span>
        </div>

        {/* 右側カウンタ：Anki標準の3色バッジ (青:未着手 / 赤:再学習 / 緑:卒業) + シャッフル */}
        <div className="flex items-center gap-2 text-[11px] font-medium flex-wrap">
          {queue.length > 1 && (
            <button
              onClick={handleShuffleRemaining}
              className="flex items-center space-x-1 px-2.5 py-0.5 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-cyan-300 border border-slate-800 rounded-lg transition-colors shadow-sm"
              title="残りの出題順をランダムシャッフル"
            >
              <Shuffle className="w-3 h-3 text-cyan-400" />
              <span>シャッフル</span>
            </button>
          )}

          <div className="flex items-center bg-slate-950 px-2.5 py-0.5 rounded-lg border border-slate-800 space-x-2.5 shadow-sm">
            <span className="text-blue-400 font-bold" title="今日の未着手カード">
              🔵 {freshDueCount}
            </span>
            <span className="text-red-400 font-bold" title="再学習（1分/10分ステップ待機中）のカード">
              🔴 {inRelearnCount}
            </span>
            <span className="text-emerald-400 font-bold" title="本日卒業（習得完了）のカード">
              🟢 {graduatedCount}
            </span>
          </div>
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
              <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
              重要度 {importance}
            </span>

            {/* ラーニング状態バッジ */}
            {currentCard.cardState === 'learning' && (
              <span className="text-[10px] font-bold text-red-300 bg-red-950/80 px-2 py-0.5 rounded-md border border-red-500/40 flex items-center gap-1">
                <Zap className="w-2.5 h-2.5 text-yellow-400" />
                学習中 (Step {currentCard.learningStep === 1 ? '2: 10分' : '1: 1分'})
              </span>
            )}
            {currentCard.cardState === 'relearning' && (
              <span className="text-[10px] font-bold text-red-300 bg-red-950/80 px-2 py-0.5 rounded-md border border-red-500/40 flex items-center gap-1">
                <RotateCcw className="w-2.5 h-2.5 text-red-400" />
                再学習中 (10分)
              </span>
            )}
          </div>

          <div className="flex items-center space-x-1.5">
            {isTimerWaiting && (
              <span className="text-[10px] text-amber-400 bg-amber-950/60 border border-amber-500/30 px-2 py-0.5 rounded-md flex items-center gap-1 font-mono">
                <Clock className="w-3 h-3" />
                あと {waitMinutes}:{waitSeconds.toString().padStart(2, '0')}
              </span>
            )}

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                speakText(currentCard.phrase, 0.95);
              }}
              className="p-1.5 text-slate-400 hover:text-cyan-400 hover:bg-slate-800 rounded-xl transition-colors border border-slate-800"
              title="発音を再生"
            >
              <Volume2 className="w-4 h-4" />
            </button>
          </div>
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
              <span>👆 カードまたは Spaceキー で答えを表示</span>
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

      {/* Fixed-Height Action Buttons Area (高さ64pxで完全固定。各ボタンに次回期日を動的バッジ表示 ＆ キーボードショートカットガイド) */}
      <div className="h-[64px] flex items-center">
        {isFlipped ? (
          <div className="grid grid-cols-4 gap-2 w-full animate-fadeIn">
            {/* 1. Again (もう一度: すぐ再出題 <1分) */}
            <button
              type="button"
              onClick={() => handleRating('again')}
              className="flex flex-col items-center justify-center h-[58px] bg-red-950/60 hover:bg-red-900/80 active:scale-95 text-red-400 border border-red-500/40 rounded-2xl text-xs font-bold transition-all shadow-md shadow-red-950/30 group"
            >
              <div className="flex items-center gap-1">
                <span className="text-sm">🔴</span>
                <span>Again</span>
                <kbd className="hidden sm:inline text-[9px] bg-red-950 px-1 rounded text-red-400 border border-red-800">1</kbd>
              </div>
              <span className="text-[9px] text-red-300 font-semibold bg-red-900/40 px-1.5 py-0.2 rounded mt-0.5">
                {nextIntervals.again}
              </span>
            </button>

            {/* 2. Hard (難しい: <6分 または <10分) */}
            <button
              type="button"
              onClick={() => handleRating('hard')}
              className="flex flex-col items-center justify-center h-[58px] bg-amber-950/60 hover:bg-amber-900/80 active:scale-95 text-amber-400 border border-amber-500/40 rounded-2xl text-xs font-bold transition-all shadow-md shadow-amber-950/30 group"
            >
              <div className="flex items-center gap-1">
                <span className="text-sm">🟠</span>
                <span>Hard</span>
                <kbd className="hidden sm:inline text-[9px] bg-amber-950 px-1 rounded text-amber-400 border border-amber-800">2</kbd>
              </div>
              <span className="text-[9px] text-amber-300 font-semibold bg-amber-900/40 px-1.5 py-0.2 rounded mt-0.5">
                {nextIntervals.hard}
              </span>
            </button>

            {/* 3. Good (普通: 次ステップ <10分 または 1日後卒業) */}
            <button
              type="button"
              onClick={() => handleRating('good')}
              className="flex flex-col items-center justify-center h-[58px] bg-emerald-950/60 hover:bg-emerald-900/80 active:scale-95 text-emerald-400 border border-emerald-500/40 rounded-2xl text-xs font-bold transition-all shadow-md shadow-emerald-950/30 group"
            >
              <div className="flex items-center gap-1">
                <span className="text-sm">🟢</span>
                <span>Good</span>
                <kbd className="hidden sm:inline text-[9px] bg-emerald-950 px-1 rounded text-emerald-400 border border-emerald-800">3/Space</kbd>
              </div>
              <span className="text-[9px] text-emerald-300 font-semibold bg-emerald-900/40 px-1.5 py-0.2 rounded mt-0.5">
                {nextIntervals.good}
              </span>
            </button>

            {/* 4. Easy (簡単: 4日後即時卒業) */}
            <button
              type="button"
              onClick={() => handleRating('easy')}
              className="flex flex-col items-center justify-center h-[58px] bg-blue-950/60 hover:bg-blue-900/80 active:scale-95 text-cyan-300 border border-cyan-500/40 rounded-2xl text-xs font-bold transition-all shadow-md shadow-blue-950/30 group"
            >
              <div className="flex items-center gap-1">
                <span className="text-sm">🔵</span>
                <span>Easy</span>
                <kbd className="hidden sm:inline text-[9px] bg-blue-950 px-1 rounded text-cyan-300 border border-cyan-800">4</kbd>
              </div>
              <span className="text-[9px] text-cyan-200 font-semibold bg-blue-900/40 px-1.5 py-0.2 rounded mt-0.5">
                {nextIntervals.easy}
              </span>
            </button>
          </div>
        ) : (
          <div className="w-full text-center text-xs text-slate-500 py-3 flex items-center justify-center gap-2 select-none animate-fadeIn">
            <span>👆 カードをタップして答えを表示</span>
            <kbd className="hidden sm:inline text-[10px] bg-slate-950 text-slate-400 px-2 py-0.5 rounded border border-slate-800">Space</kbd>
          </div>
        )}
      </div>
    </div>
  );
};
