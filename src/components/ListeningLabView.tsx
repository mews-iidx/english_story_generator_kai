import React, { useState, useEffect, useCallback } from 'react';
import {
  Headphones,
  Play,
  Sparkles,
  CheckCircle2,
  BarChart3,
  Minus,
  Plus,
  Zap,
  Volume2,
  BookmarkPlus,
  RefreshCw,
  Eye,
  X
} from 'lucide-react';
import { CefrLevel } from '../types/settings';
import { LabQuestion, LabAnalyticsSummary } from '../types/listeningLab';
import {
  generateLabBatch,
  saveLabQuestionRecord,
  calculateLabAnalytics,
} from '../services/listeningLabService';
import { saveListeningCard } from '../services/storage';
import { speakText, stopSpeech } from '../utils/speech';
import confetti from 'canvas-confetti';

interface ListeningLabViewProps {
  apiKey: string;
  selectedModel?: string;
  userLevel?: CefrLevel;
  onListeningCardSaved?: () => void;
}

const WORD_COUNT_PRESETS = [4, 6, 8, 10, 12, 14, 16, 20] as const;
const CEFR_LEVELS: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1'];
const SPEED_RATES = [
  { label: '0.8x', value: 0.8 },
  { label: '0.9x', value: 0.9 },
  { label: '1.0x', value: 1.0 },
  { label: '1.1x', value: 1.1 },
  { label: '1.2x', value: 1.2 },
];

export const ListeningLabView: React.FC<ListeningLabViewProps> = ({
  apiKey,
  selectedModel = 'gemini-2.0-flash',
  userLevel = 'A2',
  onListeningCardSaved,
}) => {
  // Configuration State
  const [targetWordCount, setTargetWordCount] = useState<number>(10);
  const [targetSpeedRate, setTargetSpeedRate] = useState<number>(1.0);
  const [targetCefrLevel, setTargetCefrLevel] = useState<CefrLevel>(userLevel);

  // Batch / Session State
  const [questions, setQuestions] = useState<LabQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isSessionCompleted, setIsSessionCompleted] = useState<boolean>(false);

  // Card Progress State
  const [isRevealed, setIsRevealed] = useState<boolean>(false);
  const [markedIndices, setMarkedIndices] = useState<Set<number>>(new Set());
  const [playCount, setPlayCount] = useState<number>(0);
  const [isPlayingAudio, setIsPlayingAudio] = useState<boolean>(false);

  // Session Stats
  const [sessionPerfectCount, setSessionPerfectCount] = useState<number>(0);
  const [sessionSavedCount, setSessionSavedCount] = useState<number>(0);

  // Analytics & Modal State
  const [analytics, setAnalytics] = useState<LabAnalyticsSummary>(() => calculateLabAnalytics());
  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState<boolean>(false);

  const currentQuestion: LabQuestion | undefined = questions[currentIndex];

  // 1. Fetch / Generate batch
  const handleGenerateBatch = useCallback(async (count = 5) => {
    stopSpeech();
    setIsGenerating(true);
    setIsSessionCompleted(false);
    setCurrentIndex(0);
    setIsRevealed(false);
    setMarkedIndices(new Set());
    setPlayCount(0);

    try {
      const newQuestions = await generateLabBatch({
        wordCount: targetWordCount,
        speedRate: targetSpeedRate,
        count,
        cefrLevel: targetCefrLevel,
        apiKey,
        model: selectedModel,
      });

      setQuestions(newQuestions);
      if (newQuestions.length > 0) {
        // Auto play first question
        setTimeout(() => {
          speakText(newQuestions[0].sentenceEn, targetSpeedRate, 'en-US', () => setIsPlayingAudio(false));
          setIsPlayingAudio(true);
          setPlayCount(1);
        }, 400);
      }
    } catch (e) {
      console.error('Failed to generate lab batch', e);
    } finally {
      setIsGenerating(false);
    }
  }, [targetWordCount, targetSpeedRate, targetCefrLevel, apiKey, selectedModel]);

  // Initial load
  useEffect(() => {
    if (questions.length === 0 && !isGenerating) {
      handleGenerateBatch(5);
    }
  }, []);

  // 2. Play Audio
  const handlePlayAudio = useCallback((rate = targetSpeedRate) => {
    if (!currentQuestion) return;
    stopSpeech();
    setIsPlayingAudio(true);
    setPlayCount(prev => prev + 1);
    speakText(currentQuestion.sentenceEn, rate, 'en-US', () => {
      setIsPlayingAudio(false);
    });
  }, [currentQuestion, targetSpeedRate]);

  // 3. Toggle Word Marking
  const handleToggleWordMark = (wordIdx: number) => {
    setMarkedIndices(prev => {
      const next = new Set(prev);
      if (next.has(wordIdx)) {
        next.delete(wordIdx);
      } else {
        next.add(wordIdx);
      }
      return next;
    });
  };

  // 4. Complete Question Action
  const handleCompleteQuestion = useCallback((isPerfect: boolean) => {
    if (!currentQuestion) return;
    stopSpeech();

    const markedTokensList = Array.from(markedIndices)
      .sort((a, b) => a - b)
      .map(idx => currentQuestion.words[idx])
      .filter(Boolean);

    // Save record to persistent storage
    saveLabQuestionRecord({
      id: `rec_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      dateString: new Date().toISOString().split('T')[0],
      sentenceEn: currentQuestion.sentenceEn,
      translationJa: currentQuestion.translationJa,
      wordCount: currentQuestion.words.length,
      speedRate: targetSpeedRate,
      cefrLevel: targetCefrLevel,
      markedTokens: markedTokensList,
      isPerfect,
      savedToAnki: !isPerfect,
    });

    if (isPerfect) {
      setSessionPerfectCount(prev => prev + 1);
    } else {
      // Save directly to Anki (Dedicated Listening Card)
      saveListeningCard({
        sentence: currentQuestion.sentenceEn,
        translation: currentQuestion.translationJa,
        markedTokens: markedTokensList,
        targetSpeedRate: targetSpeedRate,
        englishExplanation: currentQuestion.englishExplanation || (currentQuestion.phoneticPoints ? `音声変化: ${currentQuestion.phoneticPoints}` : undefined),
        cefrLevel: targetCefrLevel,
        wordCount: currentQuestion.words.length,
      });

      setSessionSavedCount(prev => prev + 1);
      if (onListeningCardSaved) {
        onListeningCardSaved();
      }

      confetti({
        particleCount: 20,
        spread: 45,
        origin: { y: 0.8 },
      });
    }

    // Update Analytics
    setAnalytics(calculateLabAnalytics());

    // Advance to next question
    if (currentIndex + 1 < questions.length) {
      const nextIdx = currentIndex + 1;
      setCurrentIndex(nextIdx);
      setIsRevealed(false);
      setMarkedIndices(new Set());
      setPlayCount(0);

      // Auto play next question
      setTimeout(() => {
        if (questions[nextIdx]) {
          speakText(questions[nextIdx].sentenceEn, targetSpeedRate, 'en-US', () => setIsPlayingAudio(false));
          setIsPlayingAudio(true);
          setPlayCount(1);
        }
      }, 300);
    } else {
      setIsSessionCompleted(true);
      confetti({
        particleCount: 60,
        spread: 70,
        origin: { y: 0.6 },
      });
    }
  }, [currentQuestion, markedIndices, targetSpeedRate, targetCefrLevel, currentIndex, questions, onListeningCardSaved]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.code === 'Space' || e.code === 'KeyR') {
        e.preventDefault();
        handlePlayAudio();
      } else if (e.code === 'Enter') {
        e.preventDefault();
        if (!isRevealed) {
          setIsRevealed(true);
        } else {
          // If revealed, Enter triggers complete
          handleCompleteQuestion(markedIndices.size === 0);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isRevealed, markedIndices, handlePlayAudio, handleCompleteQuestion]);

  return (
    <div className="max-w-4xl mx-auto px-3 sm:px-6 py-4 sm:py-8 space-y-6 pb-28 animate-fadeIn">
      {/* 1. Header & Live Word Capacity Metrics */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-cyan-600 via-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Headphones className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-lg sm:text-xl font-black text-white tracking-tight">
                  リスニング集中ラボ
                </h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                  帯域筋トレ
                </span>
              </div>
              <p className="text-xs text-slate-400">
                単語数 × 難易度 × 速度で聴覚ワーキングメモリを拡張する
              </p>
            </div>
          </div>

          {/* Quick Metrics Badge */}
          <div className="flex items-center space-x-2">
            <div className="px-3 py-1.5 rounded-2xl bg-slate-950/80 border border-slate-800 flex items-center space-x-2 text-xs">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-slate-400">処理能力:</span>
              <strong className="text-amber-300 font-mono">
                {analytics.movingAverageWordCapacity > 0 ? `${analytics.movingAverageWordCapacity}語` : '測定中'}
              </strong>
            </div>

            <button
              onClick={() => setIsAnalyticsOpen(true)}
              className="p-2 rounded-2xl bg-slate-950/80 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition-colors"
              title="詳細分析を見る"
            >
              <BarChart3 className="w-4 h-4 text-cyan-400" />
            </button>
          </div>
        </div>

        {/* 2. Control Bar: Word Count Spinner + CEFR + Speed Rate */}
        <div className="pt-3 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          {/* A. Word Count Selector & Stepper */}
          <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-300">文長（目標単語数）:</span>
              <div className="flex items-center space-x-1.5">
                <button
                  onClick={() => setTargetWordCount(prev => Math.max(4, prev - 1))}
                  className="w-6 h-6 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition-colors font-bold"
                  title="1語減らす"
                >
                  <Minus className="w-3 h-3" />
                </button>
                <span className="font-mono font-black text-cyan-300 px-1 text-sm">
                  {targetWordCount} 語
                </span>
                <button
                  onClick={() => setTargetWordCount(prev => Math.min(25, prev + 1))}
                  className="w-6 h-6 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition-colors font-bold"
                  title="1語増やす"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Presets */}
            <div className="flex flex-wrap gap-1">
              {WORD_COUNT_PRESETS.map(count => (
                <button
                  key={count}
                  onClick={() => setTargetWordCount(count)}
                  className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all ${
                    targetWordCount === count
                      ? 'bg-cyan-500 text-slate-950 shadow-sm'
                      : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  {count}語
                </button>
              ))}
            </div>
          </div>

          {/* B. CEFR Level Selector */}
          <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-2">
            <span className="font-bold text-slate-300 block">難易度 (CEFR):</span>
            <div className="grid grid-cols-5 gap-1">
              {CEFR_LEVELS.map(level => (
                <button
                  key={level}
                  onClick={() => setTargetCefrLevel(level)}
                  className={`py-1 rounded-xl text-center text-xs font-bold transition-all ${
                    targetCefrLevel === level
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                      : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          {/* C. Speed Rate Selector */}
          <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-2">
            <span className="font-bold text-slate-300 block">再生速度 (TTS):</span>
            <div className="grid grid-cols-5 gap-1">
              {SPEED_RATES.map(rate => (
                <button
                  key={rate.value}
                  onClick={() => setTargetSpeedRate(rate.value)}
                  className={`py-1 rounded-xl text-center text-xs font-bold transition-all ${
                    targetSpeedRate === rate.value
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                      : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  {rate.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Generate / New Batch Action */}
        <div className="flex items-center justify-between pt-1">
          <div className="text-[11px] text-slate-400">
            {isGenerating ? (
              <span className="flex items-center space-x-1.5 text-cyan-300 animate-pulse">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>AIが{targetWordCount}語（{targetCefrLevel}）の特訓文を生成中...</span>
              </span>
            ) : questions.length > 0 ? (
              <span>
                問題: <strong className="text-white">{currentIndex + 1}</strong> / {questions.length} 問
              </span>
            ) : null}
          </div>

          <button
            onClick={() => handleGenerateBatch(5)}
            disabled={isGenerating}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-md shadow-cyan-600/20 transition-all active:scale-95"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>新規5問を生成</span>
          </button>
        </div>
      </div>

      {/* 3. Main Training Area */}
      {isSessionCompleted ? (
        /* Session Complete Card */
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-8 sm:p-10 shadow-2xl text-center space-y-6 animate-fadeIn">
          <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center mx-auto shadow-xl shadow-emerald-500/25">
            <CheckCircle2 className="w-9 h-9 text-white" />
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              セッション完了！ 🎉
            </h2>
            <p className="text-sm text-slate-300 max-w-md mx-auto leading-relaxed">
              目標 {targetWordCount} 語（{targetCefrLevel}）の特訓を完走しました！
            </p>
          </div>

          {/* Session Summary Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-lg mx-auto text-center">
            <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl">
              <span className="text-[11px] text-slate-400 block font-bold">一発クリア</span>
              <strong className="text-xl sm:text-2xl font-black text-emerald-300 font-mono">
                {sessionPerfectCount} / {questions.length}
              </strong>
            </div>
            <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl">
              <span className="text-[11px] text-slate-400 block font-bold">Anki保存</span>
              <strong className="text-xl sm:text-2xl font-black text-rose-300 font-mono">
                {sessionSavedCount} 語
              </strong>
            </div>
            <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl col-span-2 sm:col-span-1">
              <span className="text-[11px] text-slate-400 block font-bold">現在処理能力</span>
              <strong className="text-xl sm:text-2xl font-black text-amber-300 font-mono">
                {analytics.movingAverageWordCapacity} 語
              </strong>
            </div>
          </div>

          <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={() => handleGenerateBatch(5)}
              className="w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-2xl font-bold shadow-lg shadow-blue-600/30 transition-all active:scale-95"
            >
              🔄 次の5問に挑戦する
            </button>
            <button
              onClick={() => setIsAnalyticsOpen(true)}
              className="w-full sm:w-auto px-6 py-3 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-2xl font-bold transition-all"
            >
              📊 分析データを確認
            </button>
          </div>
        </div>
      ) : currentQuestion ? (
        /* Active Question Card */
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 relative overflow-hidden animate-fadeIn">
          {/* Card Top Info */}
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 font-bold">
                Q {currentIndex + 1} of {questions.length}
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 font-bold">
                {currentQuestion.words.length} 語 ({targetCefrLevel})
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20 font-mono font-bold">
                {targetSpeedRate}x
              </span>
            </div>

            <div className="text-slate-500 text-[11px] font-mono">
              再生回数: <strong className="text-slate-300">{playCount}</strong> 回
            </div>
          </div>

          {/* Blind / Reveal Card Display */}
          {!isRevealed ? (
            /* Phase 1: Blind Audio Loop */
            <div className="py-8 flex flex-col items-center justify-center space-y-6 text-center">
              {/* Big Waveform / Headphone Pulse */}
              <div 
                onClick={() => handlePlayAudio()}
                className={`w-24 h-24 rounded-full flex items-center justify-center cursor-pointer transition-all ${
                  isPlayingAudio
                    ? 'bg-gradient-to-tr from-cyan-500 to-blue-600 shadow-2xl shadow-cyan-500/50 scale-105 animate-pulse ring-4 ring-cyan-400/30'
                    : 'bg-slate-950 hover:bg-slate-800 border-2 border-slate-700 shadow-xl hover:scale-105'
                }`}
                title="音声を再生 (Space / R)"
              >
                {isPlayingAudio ? (
                  <Volume2 className="w-10 h-10 text-white animate-bounce" />
                ) : (
                  <Play className="w-10 h-10 text-cyan-400 ml-1" />
                )}
              </div>

              <div className="space-y-1 max-w-sm">
                <p className="text-sm font-bold text-white">
                  英文は隠された状態です 🎧
                </p>
                <p className="text-xs text-slate-400 leading-relaxed">
                  頭の中で英語と意味が鮮明に浮かぶまで、何度でも再生してください。
                </p>
              </div>

              {/* Quick Playback Rate Options */}
              <div className="flex items-center space-x-2 pt-2">
                <button
                  onClick={() => handlePlayAudio(0.8)}
                  className="px-3 py-1 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-xl text-xs font-bold transition-colors"
                >
                  ▶ 0.8x
                </button>
                <button
                  onClick={() => handlePlayAudio(1.0)}
                  className="px-3 py-1 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-xl text-xs font-bold transition-colors"
                >
                  ▶ 1.0x
                </button>
                <button
                  onClick={() => handlePlayAudio(1.2)}
                  className="px-3 py-1 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-xl text-xs font-bold transition-colors"
                >
                  ▶ 1.2x
                </button>
              </div>

              {/* Reveal Action Button */}
              <div className="w-full pt-4">
                <button
                  onClick={() => setIsRevealed(true)}
                  className="w-full py-4 bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 active:scale-[0.99] text-white rounded-2xl text-sm font-bold shadow-xl shadow-cyan-600/30 transition-all flex items-center justify-center space-x-2"
                >
                  <Eye className="w-4 h-4" />
                  <span>英文を表示して照合 (Enter)</span>
                </button>
              </div>
            </div>
          ) : (
            /* Phase 2: Interactive Word Marking & Review */
            <div className="space-y-6 animate-fadeIn">
              {/* English Sentence Word Tokens */}
              <div className="p-5 bg-slate-950/80 border border-slate-800 rounded-2xl space-y-3 text-left">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-cyan-400">
                    聞き取れなかった単語・リンキングをタップ選択:
                  </span>
                  <div className="flex items-center space-x-1.5">
                    <button
                      onClick={() => handlePlayAudio(0.8)}
                      className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 rounded-lg text-xs font-bold transition-colors"
                      title="0.8x で再生"
                    >
                      ▶ 0.8x
                    </button>
                    <button
                      onClick={() => handlePlayAudio(1.0)}
                      className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 rounded-lg text-xs font-bold transition-colors"
                      title="1.0x で再生"
                    >
                      ▶ 1.0x
                    </button>
                  </div>
                </div>

                {/* Word Chips */}
                <div className="flex flex-wrap gap-2 py-2">
                  {currentQuestion.words.map((word, wIdx) => {
                    const isMarked = markedIndices.has(wIdx);
                    return (
                      <button
                        key={wIdx}
                        onClick={() => handleToggleWordMark(wIdx)}
                        className={`px-3 py-1.5 rounded-xl text-base sm:text-lg font-serif font-bold transition-all ${
                          isMarked
                            ? 'bg-rose-950/90 text-rose-200 border-2 border-rose-500 shadow-lg shadow-rose-500/20 scale-105'
                            : 'bg-slate-900/90 hover:bg-slate-800 text-slate-100 border border-slate-800'
                        }`}
                      >
                        {word}
                      </button>
                    );
                  })}
                </div>

                {markedIndices.size > 0 ? (
                  <p className="text-xs text-rose-400 font-bold animate-pulse">
                    ⚠️ {markedIndices.size} 語の聞き取り弱点をマーク中 ➔ Ankiに登録されます
                  </p>
                ) : (
                  <p className="text-xs text-emerald-400">
                    ✨ すべて聞き取れた場合はマーク不要です（そのまま完璧ボタンへ）
                  </p>
                )}
              </div>

              {/* Japanese Translation Box */}
              <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-1 text-left">
                <span className="text-[11px] font-bold text-slate-400 block">日本語訳:</span>
                <p className="text-sm sm:text-base font-bold text-slate-200 leading-relaxed">
                  {currentQuestion.translationJa}
                </p>
              </div>

              {/* Phonetics / Key Points Guide */}
              {(currentQuestion.phoneticPoints || currentQuestion.englishExplanation) && (
                <div className="p-3 bg-purple-950/30 border border-purple-500/20 rounded-2xl space-y-1 text-xs text-left">
                  {currentQuestion.phoneticPoints && (
                    <div className="text-purple-200">
                      <strong className="text-purple-300">🔊 音声変化: </strong>
                      {currentQuestion.phoneticPoints}
                    </div>
                  )}
                  {currentQuestion.englishExplanation && (
                    <div className="text-slate-300">
                      <strong className="text-slate-400">💡 ニュアンス: </strong>
                      {currentQuestion.englishExplanation}
                    </div>
                  )}
                </div>
              )}

              {/* Bottom Actions */}
              <div className="pt-2">
                {markedIndices.size === 0 ? (
                  <button
                    onClick={() => handleCompleteQuestion(true)}
                    className="w-full py-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-[0.99] text-white rounded-2xl text-sm font-bold shadow-xl shadow-emerald-600/30 transition-all flex items-center justify-center space-x-2"
                  >
                    <CheckCircle2 className="w-5 h-5" />
                    <span>🟢 完璧に聴き取れた！ (Enter)</span>
                  </button>
                ) : (
                  <button
                    onClick={() => handleCompleteQuestion(false)}
                    className="w-full py-4 bg-gradient-to-r from-rose-600 via-pink-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 active:scale-[0.99] text-white rounded-2xl text-sm font-bold shadow-xl shadow-rose-600/30 transition-all flex items-center justify-center space-x-2"
                  >
                    <BookmarkPlus className="w-5 h-5" />
                    <span>🔴 リスニングAnkiに登録して次へ ({markedIndices.size}語マーク)</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* 4. Analytics Modal */}
      {isAnalyticsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 max-w-xl w-full max-h-[90vh] overflow-y-auto space-y-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <BarChart3 className="w-5 h-5 text-cyan-400" />
                <h2 className="text-lg font-bold text-white">リスニング処理能力 分析</h2>
              </div>
              <button
                onClick={() => setIsAnalyticsOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Summary Metrics */}
            <div className="grid grid-cols-3 gap-2.5 text-center">
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-2xl">
                <span className="text-[10px] text-slate-400 block font-bold">総回答数</span>
                <strong className="text-lg font-black text-white font-mono">{analytics.totalQuestions}</strong>
              </div>
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-2xl">
                <span className="text-[10px] text-slate-400 block font-bold">完全突破率</span>
                <strong className="text-lg font-black text-emerald-300 font-mono">{analytics.perfectPassRate}%</strong>
              </div>
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-2xl">
                <span className="text-[10px] text-slate-400 block font-bold">移動平均単語数</span>
                <strong className="text-lg font-black text-amber-300 font-mono">{analytics.movingAverageWordCapacity}語</strong>
              </div>
            </div>

            {/* Word Count Breakdown Table */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-300">文長別の完全突破率:</span>
              <div className="space-y-1.5">
                {Object.entries(analytics.wordCountStats).map(([wc, stat]) => (
                  <div key={wc} className="p-2.5 bg-slate-950 border border-slate-800/80 rounded-xl flex items-center justify-between text-xs">
                    <span className="font-mono font-bold text-cyan-300 w-16">{wc} 語文</span>
                    <div className="flex-1 mx-3 h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-cyan-500 to-emerald-500 rounded-full"
                        style={{ width: `${stat.passRate}%` }}
                      />
                    </div>
                    <span className="font-mono text-slate-300 w-16 text-right">
                      {stat.perfectCount}/{stat.attempts} ({stat.passRate}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Close Action */}
            <button
              onClick={() => setIsAnalyticsOpen(false)}
              className="w-full py-3 bg-slate-800 hover:bg-slate-750 text-white rounded-2xl text-xs font-bold transition-colors"
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
