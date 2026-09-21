import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Play,
  RotateCcw,
  CheckCircle2,
  Brain,
  Headphones,
  Minus,
  Plus,
  SkipForward,
  BookOpen,
  ArrowLeft,
  Pause,
  Zap,
  Eye,
  EyeOff,
  FileText,
  Layers,
  Sparkles
} from 'lucide-react';
import { Story, StoryListeningMetrics } from '../types/story';
import { LabChunk } from '../types/listeningLab';
import { splitIntoSmartChunks } from '../services/listeningLabService';
import { stopSpeech } from '../utils/speech';

interface StoryListeningStepViewProps {
  story: Story;
  onCompleteListening: (metrics: StoryListeningMetrics) => void;
  onSkipToReader: () => void;
  onBackToBookshelf: () => void;
}

interface StorySentenceItem {
  id: string;
  sentenceIdx: number;
  text: string;
  translationJa: string;
  chunks: LabChunk[];
}

export type ListeningStreamMode = 'sentence' | 'chunk';
type StepStatus = 'idle' | 'playing' | 'paused_at_boundary' | 'all_completed';

export const StoryListeningStepView: React.FC<StoryListeningStepViewProps> = ({
  story,
  onCompleteListening,
  onSkipToReader,
  onBackToBookshelf,
}) => {
  // Playback stream mode: 'sentence' (1文流し) vs 'chunk' (Thought Group流し)
  const [streamMode, setStreamMode] = useState<ListeningStreamMode>('sentence');

  // Speed setting (WPM) - 単語ごとのインターバル時間を直接制御
  const [speedWpm, setSpeedWpm] = useState<number>(100);

  // Japanese translation toggle (hidden by default per user request)
  const [showTranslation, setShowTranslation] = useState<boolean>(false);

  // Story breakdown into sentences, translations, and Thought Groups
  const sentenceList: StorySentenceItem[] = useMemo(() => {
    if (!story.storyContent) return [];

    // Split English sentences
    const rawSentences = story.storyContent
      .replace(/\r\n/g, '\n')
      .split(/(?<=[.!?])\s+|\n+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    // Split Japanese translations (matching 1:1 by punctuation / line breaks)
    const rawJaSentences = (story.japaneseTranslation || '')
      .replace(/\r\n/g, '\n')
      .split(/(?<=[。！？\n])\s*/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    return rawSentences.map((sentText, idx) => {
      const translationJa = rawJaSentences[idx] || (idx === 0 ? story.japaneseTranslation : '');
      const chunks = splitIntoSmartChunks(sentText, translationJa);
      return {
        id: `sent_${idx}`,
        sentenceIdx: idx,
        text: sentText,
        translationJa,
        chunks,
      };
    });
  }, [story.storyContent, story.japaneseTranslation]);

  // Current progress state
  const [currentSentenceIdx, setCurrentSentenceIdx] = useState<number>(0);
  const [currentChunkIdx, setCurrentChunkIdx] = useState<number>(0);
  const [stepWordIdx, setStepWordIdx] = useState<number>(-1);
  const [stepStatus, setStepStatus] = useState<StepStatus>('idle');

  // Latency tracking metrics & playback timer
  const pauseStartRef = useRef<number>(0);
  const latenciesRef = useRef<number[]>([]);
  const storyStartTimeRef = useRef<number>(Date.now());
  const playbackTimerRef = useRef<any>(null);

  const currentSentence = sentenceList[currentSentenceIdx] || null;
  const currentChunks = currentSentence ? currentSentence.chunks : [];
  const currentChunk = currentChunks[currentChunkIdx] || null;

  // Stop playback safely
  const stopPlayback = useCallback(() => {
    if (playbackTimerRef.current) {
      clearInterval(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
    stopSpeech();
    setStepWordIdx(-1);
  }, []);

  useEffect(() => {
    return () => {
      stopPlayback();
    };
  }, [stopPlayback]);

  // Mode change handler
  const handleSwitchMode = (newMode: ListeningStreamMode) => {
    if (newMode === streamMode) return;
    stopPlayback();
    setStreamMode(newMode);
    setShowTranslation(false);
    setStepWordIdx(-1);
    setStepStatus('idle');
  };

  // Play single item (1 sentence or 1 chunk) with word-by-word reading
  const playCurrentTarget = useCallback((sIdx: number, cIdx: number, mode: ListeningStreamMode) => {
    const targetSentence = sentenceList[sIdx];
    if (!targetSentence) {
      stopPlayback();
      setStepStatus('all_completed');
      return;
    }

    stopPlayback();
    setShowTranslation(false);
    setCurrentSentenceIdx(sIdx);
    setCurrentChunkIdx(cIdx);
    setStepStatus('playing');

    // 対象の単語リストを抽出
    const targetText = mode === 'sentence'
      ? targetSentence.text
      : (targetSentence.chunks[cIdx]?.text || '');

    const words = targetText.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      setStepStatus('paused_at_boundary');
      return;
    }

    let currentWord = 0;
    setStepWordIdx(0);

    const speakSingleWord = (word: string) => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const cleanWord = word.replace(/[^a-zA-Z0-9'-]/g, '');
        if (cleanWord) {
          const utterance = new SpeechSynthesisUtterance(cleanWord);
          utterance.lang = 'en-US';
          const rateMultiplier = Math.max(0.7, Math.min(1.8, speedWpm / 100));
          utterance.rate = rateMultiplier;
          window.speechSynthesis.speak(utterance);
        }
      }
    };

    const speakAndStepWord = () => {
      if (currentWord >= words.length) {
        if (playbackTimerRef.current) {
          clearInterval(playbackTimerRef.current);
          playbackTimerRef.current = null;
        }
        stopPlayback();
        setStepWordIdx(-1);
        setStepStatus('paused_at_boundary');
        pauseStartRef.current = Date.now();
        return;
      }

      const word = words[currentWord];
      setStepWordIdx(currentWord);
      speakSingleWord(word);
      currentWord++;
    };

    // 1単語目を即座に発話
    speakAndStepWord();

    // WPMに基づく等間隔タイマーで単語を1つずつ進める
    const intervalMs = Math.round((60 / speedWpm) * 1000);
    playbackTimerRef.current = setInterval(() => {
      if (currentWord < words.length) {
        speakAndStepWord();
      } else {
        if (playbackTimerRef.current) {
          clearInterval(playbackTimerRef.current);
          playbackTimerRef.current = null;
        }
        stopPlayback();
        setStepWordIdx(-1);
        setStepStatus('paused_at_boundary');
        pauseStartRef.current = Date.now();
      }
    }, intervalMs);
  }, [sentenceList, speedWpm, stopPlayback]);

  // Advance to next step
  const handleAdvance = useCallback(() => {
    // Record latency for comprehension/processing checkpoint
    if (pauseStartRef.current > 0) {
      const elapsed = Date.now() - pauseStartRef.current;
      latenciesRef.current.push(elapsed);
      pauseStartRef.current = 0;
    }

    setShowTranslation(false);

    if (streamMode === 'sentence') {
      // 1文流し: 次の文へ
      if (currentSentenceIdx + 1 < sentenceList.length) {
        const nextSIdx = currentSentenceIdx + 1;
        playCurrentTarget(nextSIdx, 0, 'sentence');
      } else {
        stopPlayback();
        setStepStatus('all_completed');
      }
    } else {
      // Thought Group流し: 次のチャンクまたは次の文へ
      if (!currentSentence) return;
      if (currentChunkIdx + 1 < currentChunks.length) {
        const nextCIdx = currentChunkIdx + 1;
        playCurrentTarget(currentSentenceIdx, nextCIdx, 'chunk');
      } else {
        if (currentSentenceIdx + 1 < sentenceList.length) {
          const nextSIdx = currentSentenceIdx + 1;
          playCurrentTarget(nextSIdx, 0, 'chunk');
        } else {
          stopPlayback();
          setStepStatus('all_completed');
        }
      }
    }
  }, [streamMode, currentSentenceIdx, currentChunkIdx, currentChunks.length, sentenceList.length, playCurrentTarget, currentSentence, stopPlayback]);

  // Space / Enter keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }

      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        if (stepStatus === 'idle') {
          playCurrentTarget(0, 0, streamMode);
        } else if (stepStatus === 'paused_at_boundary') {
          handleAdvance();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [stepStatus, playCurrentTarget, handleAdvance, streamMode]);

  // Complete story metrics calculation & emit
  const handleFinishAndOpenReader = () => {
    const totalLatency = latenciesRef.current.reduce((a, b) => a + b, 0);
    const count = latenciesRef.current.length || 1;
    const avgLatency = Math.round(totalLatency / count);
    const totalDuration = Date.now() - storyStartTimeRef.current;

    const metrics: StoryListeningMetrics = {
      totalChunks: streamMode === 'sentence' ? sentenceList.length : latenciesRef.current.length,
      avgChunkLatencyMs: avgLatency,
      totalSentenceLatencyMs: totalDuration,
      completedAt: new Date().toISOString(),
    };

    onCompleteListening(metrics);
  };

  const totalChunksInStory = useMemo(() => {
    return sentenceList.reduce((acc, s) => acc + s.chunks.length, 0);
  }, [sentenceList]);

  const completedChunksCount = useMemo(() => {
    let count = 0;
    for (let i = 0; i < currentSentenceIdx; i++) {
      count += sentenceList[i]?.chunks.length || 0;
    }
    count += currentChunkIdx;
    return count;
  }, [currentSentenceIdx, currentChunkIdx, sentenceList]);

  // Active sentence words list
  const currentSentenceWords = useMemo(() => {
    if (!currentSentence) return [];
    return currentSentence.text.trim().split(/\s+/).filter(Boolean);
  }, [currentSentence]);

  // Active chunk words list
  const currentChunkWords = useMemo(() => {
    if (!currentChunk) return [];
    return currentChunk.text.trim().split(/\s+/).filter(Boolean);
  }, [currentChunk]);

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20 animate-fadeIn">
      {/* 1. Header Navigation & Stage Indicator */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-6 shadow-2xl backdrop-blur-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <button
              onClick={onBackToBookshelf}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-all"
              title="本棚に戻る"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <div className="flex items-center space-x-2">
                <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 text-[11px] font-bold font-mono">
                  第1段階: 初見リスニング
                </span>
                <span className="text-xs text-slate-400 font-medium">
                  {story.cefrLevel}
                </span>
              </div>
              <h1 className="text-lg sm:text-xl font-bold text-white mt-1 line-clamp-1">
                {story.title}
              </h1>
            </div>
          </div>

          <button
            onClick={onSkipToReader}
            className="flex items-center space-x-1.5 px-3.5 py-2 bg-slate-850 hover:bg-slate-800 text-slate-300 hover:text-white rounded-xl text-xs font-semibold border border-slate-700 transition-all"
          >
            <BookOpen className="w-3.5 h-3.5 text-cyan-400" />
            <span>リーダーへ進む (スキップ)</span>
          </button>
        </div>

        {/* Stage Flow Bar */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-xs">
          <div className="flex items-center space-x-2 text-indigo-300 font-bold">
            <div className="w-5 h-5 rounded-full bg-indigo-500 text-white flex items-center justify-center text-[10px]">
              1
            </div>
            <span>初見リスニング（{streamMode === 'sentence' ? '1文流し' : 'Thought Group'}・単語同期）</span>
          </div>

          <div className="text-slate-600 font-mono">────▶</div>

          <div className="flex items-center space-x-2 text-slate-400 font-medium opacity-60">
            <div className="w-5 h-5 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center text-[10px]">
              2
            </div>
            <span>精読 ＆ Anki送り</span>
          </div>
        </div>
      </div>

      {/* 2. Main Listening Stage */}
      {stepStatus === 'all_completed' ? (
        /* Completion Summary Screen */
        <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-8 sm:p-12 text-center space-y-6 shadow-2xl animate-fadeIn">
          <div className="w-20 h-20 bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 rounded-3xl flex items-center justify-center mx-auto shadow-xl shadow-emerald-500/10 animate-bounce">
            <CheckCircle2 className="w-10 h-10" />
          </div>

          <div className="space-y-2 max-w-lg mx-auto">
            <h2 className="text-2xl sm:text-3xl font-black text-white">
              🎉 初見リスニング完走！
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              全 {sentenceList.length} 文（{totalChunksInStory} チャンク）の音声を
              <strong className="text-cyan-300 ml-1">
                {streamMode === 'sentence' ? '【1文流しモード】' : '【Thought Group流しモード】'}
              </strong>
              で駆け抜けました！残った情景と分からない単語（変数 $X$）を抱えてリーダーへ進みましょう。
            </p>
          </div>

          {/* Performance KPI Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-lg mx-auto pt-2">
            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-1">
              <span className="text-[11px] text-slate-400 font-bold">
                {streamMode === 'sentence' ? '総文数' : '総チャンク数'}
              </span>
              <div className="text-xl sm:text-2xl font-black text-white font-mono">
                {streamMode === 'sentence' ? sentenceList.length : totalChunksInStory}{' '}
                <span className="text-xs font-normal text-slate-400">
                  {streamMode === 'sentence' ? '文' : '塊'}
                </span>
              </div>
            </div>

            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-1">
              <span className="text-[11px] text-slate-400 font-bold">平均処理速度</span>
              <div className="text-xl sm:text-2xl font-black text-cyan-300 font-mono">
                {(latenciesRef.current.reduce((a, b) => a + b, 0) / (latenciesRef.current.length || 1) / 1000).toFixed(2)}
                <span className="text-xs font-normal text-slate-400 ml-1">
                  秒/{streamMode === 'sentence' ? '文' : '塊'}
                </span>
              </div>
            </div>

            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-1 col-span-2 sm:col-span-1">
              <span className="text-[11px] text-slate-400 font-bold">設定再生速度</span>
              <div className="text-xl sm:text-2xl font-black text-indigo-400 font-mono">
                {speedWpm} <span className="text-xs font-normal text-slate-400">WPM</span>
              </div>
            </div>
          </div>

          {/* Transition CTA */}
          <div className="pt-4">
            <button
              onClick={handleFinishAndOpenReader}
              className="flex items-center space-x-2.5 px-8 py-4 bg-gradient-to-r from-indigo-600 via-purple-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white rounded-2xl text-base sm:text-lg font-black shadow-xl shadow-indigo-600/30 transition-all mx-auto active:scale-95 cursor-pointer"
            >
              <BookOpen className="w-5 h-5" />
              <span>📖 リーダーを開いて精読 ＆ Anki送りへ進む ▶</span>
            </button>
          </div>
        </div>
      ) : (
        /* Active Listening Stepper Screen */
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
          {/* Top Bar: Mode Selector & Speed Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
            {/* Mode Switcher Segmented Control */}
            <div className="flex items-center p-1 bg-slate-950 rounded-2xl border border-slate-800">
              <button
                type="button"
                onClick={() => handleSwitchMode('sentence')}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  streamMode === 'sentence'
                    ? 'bg-gradient-to-r from-indigo-600 to-cyan-600 text-white shadow-md shadow-indigo-500/20'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>📝 1文流しモード</span>
              </button>

              <button
                type="button"
                onClick={() => handleSwitchMode('chunk')}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  streamMode === 'chunk'
                    ? 'bg-gradient-to-r from-indigo-600 to-cyan-600 text-white shadow-md shadow-indigo-500/20'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>🧩 Thought Group流し</span>
              </button>
            </div>

            {/* Progress status badge */}
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-1 bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 rounded-xl text-xs font-mono font-bold">
                文 {currentSentenceIdx + 1} / {sentenceList.length}
              </span>
              {streamMode === 'chunk' && (
                <span className="text-xs text-slate-400 font-medium">
                  進捗: {completedChunksCount} / {totalChunksInStory} チャンク
                </span>
              )}
            </div>

            {/* Speed spinner (WPM) */}
            <div className="flex items-center space-x-1.5 bg-slate-950 px-2.5 py-1 rounded-xl border border-slate-800 text-xs">
              <span className="text-slate-400 font-semibold flex items-center gap-1 mr-1">
                <Zap className="w-3.5 h-3.5 text-cyan-400" />
                <span>速度:</span>
              </span>
              <button
                type="button"
                onClick={() => setSpeedWpm(prev => Math.max(50, prev - 10))}
                className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
                title="遅く"
              >
                <Minus className="w-3 h-3" />
              </button>
              <span className="font-mono font-bold text-cyan-300 min-w-[50px] text-center">
                {speedWpm} WPM
              </span>
              <button
                type="button"
                onClick={() => setSpeedWpm(prev => Math.min(250, prev + 10))}
                className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
                title="速く"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Flash & Pause Stage */}
          <div className="bg-slate-950/90 border border-slate-850 rounded-3xl p-6 sm:p-10 text-center space-y-6 shadow-inner min-h-[300px] flex flex-col justify-center items-center">
            {stepStatus === 'idle' ? (
              /* Idle Start Prompt */
              <div className="space-y-4 max-w-md mx-auto">
                <div className="w-14 h-14 bg-indigo-500/20 text-indigo-400 rounded-2xl flex items-center justify-center mx-auto border border-indigo-500/30">
                  <Headphones className="w-7 h-7" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-lg font-bold text-white">
                    {streamMode === 'sentence' ? '1文流しリスニングを開始' : 'Thought Groupリスニングを開始'}
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {streamMode === 'sentence'
                      ? '単語ごとに音声が再生され、1文の終わりで一時停止します。和訳はボタンを押すと確認できます。'
                      : '意味・認知のまとまり（Thought Group）ごとに単語が再生され、切れ目で一時停止します。'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => playCurrentTarget(0, 0, streamMode)}
                  className="flex items-center space-x-2 px-8 py-3.5 bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white rounded-2xl text-sm font-black shadow-lg shadow-indigo-600/30 transition-all active:scale-95 mx-auto cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-white" />
                  <span>▶️ リスニング開始（Spaceキー）</span>
                </button>
              </div>
            ) : stepStatus === 'playing' ? (
              /* Playing: Streaming words with exact interval word-by-word reading */
              <div className="space-y-4 w-full max-w-2xl mx-auto animate-in fade-in zoom-in-95 duration-100">
                <div className="flex items-center justify-center gap-2">
                  <span className="px-3 py-1 rounded-full bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 font-mono text-xs font-bold flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                    <span>
                      {streamMode === 'sentence'
                        ? `文 ${currentSentenceIdx + 1} / ${sentenceList.length} 再生中... (${(stepWordIdx + 1)} / ${currentSentenceWords.length}語)`
                        : `Chunk ${currentChunkIdx + 1} / ${currentChunks.length} 再生中... (${(stepWordIdx + 1)} / ${currentChunkWords.length}語)`}
                    </span>
                  </span>
                </div>

                {/* Active big flashing word */}
                <div className="text-4xl sm:text-6xl font-black text-white font-mono tracking-wide py-2 min-h-[72px] flex items-center justify-center">
                  {streamMode === 'sentence' ? (
                    stepWordIdx >= 0 && currentSentenceWords[stepWordIdx] ? (
                      currentSentenceWords[stepWordIdx]
                    ) : (
                      <span className="opacity-40 text-2xl sm:text-3xl font-normal">Listening...</span>
                    )
                  ) : (
                    stepWordIdx >= 0 && currentChunkWords[stepWordIdx] ? (
                      currentChunkWords[stepWordIdx]
                    ) : (
                      currentChunk?.text
                    )
                  )}
                </div>

                {/* Sentence context highlight preview */}
                {streamMode === 'sentence' && currentSentence && (
                  <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-2xl text-xs sm:text-sm text-slate-400 leading-relaxed font-serif text-left max-h-24 overflow-y-auto">
                    {currentSentenceWords.map((w, idx) => (
                      <span
                        key={idx}
                        className={`inline-block mr-1 transition-colors ${
                          idx === stepWordIdx
                            ? 'text-cyan-300 font-bold bg-cyan-500/20 px-1 rounded scale-105'
                            : idx < stepWordIdx
                            ? 'text-slate-300'
                            : 'text-slate-500'
                        }`}
                      >
                        {w}
                      </span>
                    ))}
                  </div>
                )}

                <p className="text-xs text-slate-500 font-medium">
                  {speedWpm} WPM の速度で1語ずつ発話・表示中
                </p>
              </div>
            ) : stepStatus === 'paused_at_boundary' ? (
              /* Paused at boundary: Compression time + Hidden Translation with Click-to-Reveal */
              <div className="space-y-5 animate-in fade-in zoom-in-95 duration-150 w-full max-w-xl mx-auto">
                <div className="flex items-center justify-center gap-2">
                  <span className="px-3 py-1 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 font-bold text-xs flex items-center gap-1.5 shadow">
                    <Pause className="w-3.5 h-3.5" />
                    <span>
                      {streamMode === 'sentence'
                        ? `文 ${currentSentenceIdx + 1} / ${sentenceList.length} 再生完了`
                        : `Thought Group ${currentChunkIdx + 1} / ${currentChunks.length} 完了（切れ目: ／）`}
                    </span>
                  </span>
                </div>

                {/* Display spoken text */}
                <div className="p-4 sm:p-5 bg-slate-900/90 border border-slate-800 rounded-2xl text-center space-y-2 shadow-lg">
                  <div className="text-base sm:text-lg font-bold text-white leading-relaxed font-serif">
                    {streamMode === 'sentence'
                      ? currentSentence?.text
                      : currentChunk?.text}
                  </div>
                  {streamMode === 'chunk' && currentChunk?.boundaryReason && (
                    <div className="text-[11px] text-slate-500 font-mono">
                      区分: {currentChunk.boundaryReason}
                    </div>
                  )}
                </div>

                {/* Japanese Translation: Hidden by default, click to reveal */}
                <div className="space-y-2">
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={() => setShowTranslation(prev => !prev)}
                      className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-slate-850 hover:bg-slate-800 text-xs font-bold text-sky-300 hover:text-sky-200 border border-sky-500/30 transition-all active:scale-95 shadow cursor-pointer"
                    >
                      {showTranslation ? (
                        <>
                          <EyeOff className="w-3.5 h-3.5 text-sky-400" />
                          <span>和訳を隠す</span>
                        </>
                      ) : (
                        <>
                          <Eye className="w-3.5 h-3.5 text-sky-400" />
                          <span>💡 和訳を表示（クリックで確認）</span>
                        </>
                      )}
                    </button>
                  </div>

                  {showTranslation && (
                    <div className="p-4 bg-sky-950/40 border border-sky-500/30 rounded-2xl text-xs sm:text-sm text-sky-200 leading-relaxed text-left animate-fadeIn shadow-inner">
                      <span className="text-[11px] font-bold text-sky-400 block mb-1">
                        【日本語訳】
                      </span>
                      {streamMode === 'sentence'
                        ? currentSentence?.translationJa || '（和訳が見つかりませんでした）'
                        : currentChunk?.translationJa || currentSentence?.translationJa || '（和訳が見つかりませんでした）'}
                    </div>
                  )}
                </div>

                {/* Brain Compression Cue */}
                <div className="p-3.5 bg-slate-900/70 border border-amber-500/20 rounded-2xl space-y-1 text-center">
                  <div className="text-xs font-bold text-amber-300 flex items-center justify-center gap-1">
                    <Brain className="w-3.5 h-3.5 text-amber-400" />
                    <span>🧠【脳内圧縮タイム】</span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    頭の中に情景をイメージし、音はメモリから消去！分からない単語は<strong>「変数 $X$」</strong>としてキープして前へ進みましょう。
                  </p>
                </div>

                {/* Action Controls */}
                <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={handleAdvance}
                    className="flex items-center space-x-2 px-6 py-3 bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white rounded-2xl text-xs sm:text-sm font-black shadow-lg shadow-indigo-600/30 transition-all active:scale-95 cursor-pointer"
                  >
                    <SkipForward className="w-4 h-4" />
                    <span>
                      {streamMode === 'sentence'
                        ? currentSentenceIdx + 1 < sentenceList.length
                          ? `次の文（文 ${currentSentenceIdx + 2}/${sentenceList.length}）へ ▶ (Space)`
                          : '🎉 全文完了！サマリーへ 🚀'
                        : currentChunkIdx + 1 < currentChunks.length
                        ? `次のThought Group（${currentChunkIdx + 2}/${currentChunks.length}）へ ▶ (Space)`
                        : currentSentenceIdx + 1 < sentenceList.length
                        ? `次の文（文 ${currentSentenceIdx + 2}/${sentenceList.length}）へ ▶ (Space)`
                        : '🎉 全文完了！サマリーへ 🚀'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => playCurrentTarget(currentSentenceIdx, currentChunkIdx, streamMode)}
                    className="flex items-center space-x-1.5 px-4 py-3 bg-slate-800 hover:bg-slate-750 text-slate-300 rounded-2xl text-xs font-bold border border-slate-700 transition-all cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                    <span>再聴</span>
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};
