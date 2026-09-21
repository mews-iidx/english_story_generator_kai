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
  Zap
} from 'lucide-react';
import { Story, StoryListeningMetrics } from '../types/story';
import { LabChunk } from '../types/listeningLab';
import { splitIntoSmartChunks } from '../services/listeningLabService';
import { speakNaturalWithWordTracking, stopSpeech } from '../utils/speech';

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
  chunks: LabChunk[];
}

type StepStatus = 'idle' | 'playing_chunk' | 'paused_at_boundary' | 'sentence_done' | 'all_completed';

export const StoryListeningStepView: React.FC<StoryListeningStepViewProps> = ({
  story,
  onCompleteListening,
  onSkipToReader,
  onBackToBookshelf,
}) => {
  // Speed setting
  const [speedWpm, setSpeedWpm] = useState<number>(100);

  // Story breakdown into sentences and chunks
  const sentenceList: StorySentenceItem[] = useMemo(() => {
    if (!story.storyContent) return [];
    
    // Split into sentences (preserving standard sentence terminators)
    const rawSentences = story.storyContent
      .replace(/\r\n/g, '\n')
      .split(/(?<=[.!?])\s+|\n+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    return rawSentences.map((sentText, idx) => {
      const chunks = splitIntoSmartChunks(sentText, '');
      return {
        id: `sent_${idx}`,
        sentenceIdx: idx,
        text: sentText,
        chunks,
      };
    });
  }, [story.storyContent]);

  // Current progress state
  const [currentSentenceIdx, setCurrentSentenceIdx] = useState<number>(0);
  const [currentChunkIdx, setCurrentChunkIdx] = useState<number>(0);
  const [stepWordIdx, setStepWordIdx] = useState<number>(-1);
  const [stepStatus, setStepStatus] = useState<StepStatus>('idle');

  // Latency tracking metrics
  const chunkPauseStartRef = useRef<number>(0);
  const chunkLatenciesRef = useRef<number[]>([]);
  const storyStartTimeRef = useRef<number>(Date.now());
  const cancelSpeechRef = useRef<(() => void) | null>(null);

  const currentSentence = sentenceList[currentSentenceIdx] || null;
  const currentChunks = currentSentence ? currentSentence.chunks : [];
  const currentChunk = currentChunks[currentChunkIdx] || null;

  // Stop playback on unmount or sentence change
  const stopPlayback = useCallback(() => {
    if (cancelSpeechRef.current) {
      cancelSpeechRef.current();
      cancelSpeechRef.current = null;
    }
    stopSpeech();
    setStepWordIdx(-1);
  }, []);

  useEffect(() => {
    return () => {
      stopPlayback();
    };
  }, [stopPlayback]);

  // Play single chunk with natural connected speech + real-time word boundary tracking
  const playChunk = useCallback((sIdx: number, cIdx: number) => {
    const targetSentence = sentenceList[sIdx];
    if (!targetSentence) return;
    const targetChunks = targetSentence.chunks;
    if (cIdx >= targetChunks.length) {
      setStepStatus('sentence_done');
      return;
    }

    stopPlayback();
    setCurrentSentenceIdx(sIdx);
    setCurrentChunkIdx(cIdx);
    setStepStatus('playing_chunk');

    const chunk = targetChunks[cIdx];
    const rateMultiplier = Math.max(0.6, Math.min(1.8, speedWpm / 110));

    // 自然な文章読み上げ（ワナ・ア・リンキング発動）＋ onboundary で単語位置同期
    cancelSpeechRef.current = speakNaturalWithWordTracking(
      chunk.text,
      rateMultiplier,
      (wIdx) => {
        setStepWordIdx(wIdx);
      },
      () => {
        // チャンク音声終了 ➔ 境界で一時停止（脳内圧縮タイム開始）
        setStepWordIdx(-1);
        setStepStatus('paused_at_boundary');
        chunkPauseStartRef.current = Date.now();
      }
    );
  }, [sentenceList, speedWpm, stopPlayback]);

  // Advance to next chunk / sentence
  const handleAdvance = useCallback(() => {
    // Record latency for this chunk
    if (chunkPauseStartRef.current > 0) {
      const elapsed = Date.now() - chunkPauseStartRef.current;
      chunkLatenciesRef.current.push(elapsed);
      chunkPauseStartRef.current = 0;
    }

    if (!currentSentence) return;

    if (currentChunkIdx + 1 < currentChunks.length) {
      // Next chunk in same sentence
      const nextCIdx = currentChunkIdx + 1;
      playChunk(currentSentenceIdx, nextCIdx);
    } else {
      // Sentence finished
      if (currentSentenceIdx + 1 < sentenceList.length) {
        const nextSIdx = currentSentenceIdx + 1;
        setCurrentSentenceIdx(nextSIdx);
        setCurrentChunkIdx(0);
        playChunk(nextSIdx, 0);
      } else {
        // Entire story completed!
        stopPlayback();
        setStepStatus('all_completed');
      }
    }
  }, [currentSentence, currentChunkIdx, currentChunks.length, currentSentenceIdx, sentenceList.length, playChunk, stopPlayback]);

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
          playChunk(0, 0);
        } else if (stepStatus === 'paused_at_boundary') {
          handleAdvance();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [stepStatus, playChunk, handleAdvance]);

  // Complete story metrics calculation & emit
  const handleFinishAndOpenReader = () => {
    const totalLatency = chunkLatenciesRef.current.reduce((a, b) => a + b, 0);
    const count = chunkLatenciesRef.current.length || 1;
    const avgLatency = Math.round(totalLatency / count);
    const totalDuration = Date.now() - storyStartTimeRef.current;

    const metrics: StoryListeningMetrics = {
      totalChunks: count,
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
                  第1段階: 初見チャンクリスニング
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
            <span>初見チャンクリスニング（自然音声・変数 $X$ 処理）</span>
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
              全 {sentenceList.length} 文（{totalChunksInStory} チャンク）の音声を駆け抜けました。頭の中に残った「情景」と「変数 $X$」を抱えてリーダーに進みましょう！
            </p>
          </div>

          {/* Performance KPI Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-lg mx-auto pt-2">
            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-1">
              <span className="text-[11px] text-slate-400 font-bold">総チャンク数</span>
              <div className="text-xl sm:text-2xl font-black text-white font-mono">
                {totalChunksInStory} <span className="text-xs font-normal text-slate-400">塊</span>
              </div>
            </div>

            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-1">
              <span className="text-[11px] text-slate-400 font-bold">平均圧縮速度</span>
              <div className="text-xl sm:text-2xl font-black text-cyan-300 font-mono">
                {(chunkLatenciesRef.current.reduce((a, b) => a + b, 0) / (chunkLatenciesRef.current.length || 1) / 1000).toFixed(2)}
                <span className="text-xs font-normal text-slate-400 ml-1">秒/塊</span>
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
              className="flex items-center space-x-2.5 px-8 py-4 bg-gradient-to-r from-indigo-600 via-purple-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white rounded-2xl text-base sm:text-lg font-black shadow-xl shadow-indigo-600/30 transition-all mx-auto active:scale-95"
            >
              <BookOpen className="w-5 h-5" />
              <span>📖 リーダーを開いて精読 ＆ Anki送りへ進む ▶</span>
            </button>
          </div>
        </div>
      ) : (
        /* Active Listening Stepper Screen */
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
          {/* Progress & Speed Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-1 bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 rounded-xl text-xs font-mono font-bold">
                文 {currentSentenceIdx + 1} / {sentenceList.length}
              </span>
              <span className="text-xs text-slate-400 font-medium">
                進捗: {completedChunksCount} / {totalChunksInStory} チャンク
              </span>
            </div>

            {/* Speed spinner */}
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
          <div className="bg-slate-950/90 border border-slate-850 rounded-3xl p-6 sm:p-12 text-center space-y-6 shadow-inner min-h-[260px] flex flex-col justify-center items-center">
            {stepStatus === 'idle' ? (
              <div className="space-y-4 max-w-md mx-auto">
                <div className="w-14 h-14 bg-indigo-500/20 text-indigo-400 rounded-2xl flex items-center justify-center mx-auto border border-indigo-500/30">
                  <Headphones className="w-7 h-7" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-lg font-bold text-white">
                    初見リスニングを開始
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    自然な発音・音声変化（ワナ・ア・リンキング）でチャンクが流れ、切れ目（/）で一時停止します。分からない単語は「変数 $X$」として流しながら進みましょう。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => playChunk(0, 0)}
                  className="flex items-center space-x-2 px-8 py-3.5 bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white rounded-2xl text-sm font-black shadow-lg shadow-indigo-600/30 transition-all active:scale-95 mx-auto"
                >
                  <Play className="w-4 h-4 fill-white" />
                  <span>▶️ リスニング開始（Spaceキー）</span>
                </button>
              </div>
            ) : stepStatus === 'playing_chunk' ? (
              /* Streaming words in chunk synchronized with natural speech */
              <div className="space-y-3 animate-in fade-in zoom-in-95 duration-100">
                <span className="px-3 py-1 rounded-full bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 font-mono text-xs font-bold">
                  Chunk {currentChunkIdx + 1} / {currentChunks.length} 再生中...
                </span>
                <div className="text-4xl sm:text-6xl font-black text-white font-mono tracking-wide py-2 min-h-[72px] flex items-center justify-center">
                  {stepWordIdx >= 0 ? currentChunk?.text.trim().split(/\s+/)[stepWordIdx] : currentChunk?.text}
                </div>
                <p className="text-xs text-slate-500 font-medium">
                  自然な発音（音声変化）を耳と目でキャッチしてください
                </p>
              </div>
            ) : stepStatus === 'paused_at_boundary' ? (
              /* Paused at chunk boundary for instant compression! */
              <div className="space-y-5 animate-in fade-in zoom-in-95 duration-150 max-w-md mx-auto">
                <div className="flex items-center justify-center gap-2">
                  <span className="px-3 py-1 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 font-bold text-xs flex items-center gap-1.5 shadow">
                    <Pause className="w-3.5 h-3.5" />
                    <span>Chunk {currentChunkIdx + 1} / {currentChunks.length} 完了（切れ目: ／）</span>
                  </span>
                </div>

                {/* Compression cue */}
                <div className="p-4 bg-slate-900 border border-amber-500/30 rounded-2xl space-y-1.5 shadow-lg">
                  <div className="text-xs font-black text-amber-300 flex items-center justify-center gap-1">
                    <Brain className="w-4 h-4 text-amber-400" />
                    <span>🧠【脳内圧縮タイム】</span>
                  </div>
                  <p className="text-xs text-slate-200 leading-relaxed">
                    頭の中に情景をイメージし、音はメモリから消去！分からない単語は<strong>「変数 $X$」</strong>としてキープして前へ進みましょう。
                  </p>
                </div>

                {/* Action Controls */}
                <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={handleAdvance}
                    className="flex items-center space-x-2 px-6 py-3 bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white rounded-2xl text-xs sm:text-sm font-black shadow-lg shadow-indigo-600/30 transition-all active:scale-95"
                  >
                    <SkipForward className="w-4 h-4" />
                    <span>
                      {currentChunkIdx + 1 < currentChunks.length
                        ? `次のチャンク（${currentChunkIdx + 2}/${currentChunks.length}）へ ▶ (Space)`
                        : currentSentenceIdx + 1 < sentenceList.length
                        ? `次の文（文 ${currentSentenceIdx + 2}/${sentenceList.length}）へ ▶ (Space)`
                        : '🎉 全文完了！サマリーへ 🚀'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => playChunk(currentSentenceIdx, currentChunkIdx)}
                    className="flex items-center space-x-1.5 px-4 py-3 bg-slate-800 hover:bg-slate-750 text-slate-300 rounded-2xl text-xs font-bold border border-slate-700 transition-all"
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
