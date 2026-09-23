import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Play,
  RotateCcw,
  CheckCircle2,
  Brain,
  Headphones,
  SkipForward,
  BookOpen,
  ArrowLeft,
  Eye,
  EyeOff,
  Layers,
  Volume2,
  AlertTriangle,
  Flame,
  Gauge,
  Zap,
} from 'lucide-react';
import { Story, StoryListeningMetrics, StoryListeningUnitLog } from '../types/story';
import { splitIntoSmartChunks } from '../services/listeningLabService';
import { speakText, stopSpeech } from '../utils/speech';

interface StoryListeningStepViewProps {
  story: Story;
  onCompleteListening: (metrics: StoryListeningMetrics) => void;
  onSkipToReader: () => void;
  onBackToBookshelf: () => void;
}

export type ListeningStreamMode = 'sentence' | 'chunk';

interface ListeningUnit {
  id: string;
  type: 'sentence' | 'chunk';
  unitIdx: number;
  sentenceIdx: number;
  chunkIdx?: number;
  totalChunksInSentence?: number;
  text: string;
  translationJa: string;
  boundaryReason?: string;
}

// 1-second base64 silent WAV to keep OS MediaSession alive on mobile/PWA
const SILENT_AUDIO_URI = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

const SPEECH_RATES = [
  { label: '0.75x', value: 0.75 },
  { label: '0.85x', value: 0.85 },
  { label: '1.0x', value: 1.0 },
  { label: '1.15x', value: 1.15 },
  { label: '1.25x', value: 1.25 },
];

export const StoryListeningStepView: React.FC<StoryListeningStepViewProps> = ({
  story,
  onCompleteListening,
  onSkipToReader,
  onBackToBookshelf,
}) => {
  // 1. Configuration & Mode states
  const [streamMode, setStreamMode] = useState<ListeningStreamMode>('sentence');
  const [blindMode, setBlindMode] = useState<boolean>(true); // Default: Ear-only (text hidden)
  const [speechRate, setSpeechRate] = useState<number>(1.0);

  // 2. Playback state
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [stepStatus, setStepStatus] = useState<'idle' | 'listening' | 'all_completed'>('idle');

  // 3. Current Unit Metrics & Peek states
  const [currentRetryCount, setCurrentRetryCount] = useState<number>(0);
  const [revealedEnglish, setRevealedEnglish] = useState<boolean>(false);
  const [revealedJapanese, setRevealedJapanese] = useState<boolean>(false);
  const [unitLogs, setUnitLogs] = useState<StoryListeningUnitLog[]>([]);
  const [sentenceRatings, setSentenceRatings] = useState<Record<number, { rating: 1 | 2 | 3 | 4; timestamp: string }>>(() => {
    return story.sentenceRatings || {};
  });

  // Refs for tracking timestamps
  const unitStartTimeRef = useRef<number>(0);
  const silentAudioRef = useRef<HTMLAudioElement | null>(null);

  // Story word count
  const storyWordCount = useMemo(() => {
    if (story.actualWordCount && story.actualWordCount > 0) return story.actualWordCount;
    if (story.storyContent) return story.storyContent.split(/\s+/).filter(Boolean).length;
    return story.targetWordCount || 300;
  }, [story.actualWordCount, story.storyContent, story.targetWordCount]);

  // 4. Breakdown story into units (Sentence units or Chunk units)
  const units: ListeningUnit[] = useMemo(() => {
    if (!story.storyContent) return [];

    const rawSentences = story.storyContent
      .replace(/\r\n/g, '\n')
      .split(/(?<=[.!?])\s+|\n+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    const rawJaSentences = (story.japaneseTranslation || '')
      .replace(/\r\n/g, '\n')
      .split(/(?<=[。！？\n])\s*/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    if (streamMode === 'sentence') {
      return rawSentences.map((sentText, sIdx) => ({
        id: `sent_${sIdx}`,
        type: 'sentence',
        unitIdx: sIdx,
        sentenceIdx: sIdx,
        text: sentText,
        translationJa: rawJaSentences[sIdx] || (sIdx === 0 ? story.japaneseTranslation : ''),
      }));
    } else {
      // Chunk (Thought Group) Mode: Flatten all chunks across sentences
      const chunkUnits: ListeningUnit[] = [];
      let globalChunkIdx = 0;

      rawSentences.forEach((sentText, sIdx) => {
        const jaTrans = rawJaSentences[sIdx] || (sIdx === 0 ? story.japaneseTranslation : '');
        const chunks = splitIntoSmartChunks(sentText, jaTrans);

        chunks.forEach((chunk, cIdx) => {
          chunkUnits.push({
            id: `chunk_${sIdx}_${cIdx}`,
            type: 'chunk',
            unitIdx: globalChunkIdx++,
            sentenceIdx: sIdx,
            chunkIdx: cIdx,
            totalChunksInSentence: chunks.length,
            text: chunk.text,
            translationJa: chunk.translationJa || jaTrans,
            boundaryReason: chunk.boundaryReason,
          });
        });
      });

      return chunkUnits;
    }
  }, [story.storyContent, story.japaneseTranslation, streamMode]);

  const currentUnit = units[currentIndex] || null;

  // Safe audio cleanup
  const stopAudio = useCallback(() => {
    stopSpeech();
    setIsPlaying(false);
    try {
      if (silentAudioRef.current) {
        silentAudioRef.current.pause();
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    return () => {
      stopAudio();
    };
  }, [stopAudio]);

  // Play unit audio with natural linking & MediaSession sync
  const playUnitAudio = useCallback((unit: ListeningUnit, isRetry: boolean = false) => {
    if (!unit || !unit.text) return;

    stopAudio();
    setIsPlaying(true);

    if (isRetry) {
      setCurrentRetryCount(prev => prev + 1);
    }

    // Play silent audio loop to unlock Bluetooth / lockscreen MediaSession controls in mobile/PWA
    try {
      if (!silentAudioRef.current) {
        silentAudioRef.current = new Audio(SILENT_AUDIO_URI);
        silentAudioRef.current.loop = true;
      }
      silentAudioRef.current.play().catch(() => {});
    } catch (_) {}

    // MediaSession API: スマホのロック画面・イヤホン操作のメタデータ更新
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: `[文 ${unit.unitIdx + 1}/${units.length}] ${unit.text}`,
          artist: story.title,
          album: `CompileEng - ${story.cefrLevel || 'A2'} 初見リスニング`,
        });
        navigator.mediaSession.playbackState = 'playing';
      } catch (e) {
        console.warn('MediaSession metadata error:', e);
      }
    }

    speakText(unit.text, speechRate, 'en-US', () => {
      setIsPlaying(false);
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused';
      }
    });
  }, [speechRate, stopAudio, units.length, story.title, story.cefrLevel]);

  // Start listening flow from unit 0
  const handleStartListening = () => {
    setStepStatus('listening');
    setCurrentIndex(0);
    setCurrentRetryCount(0);
    setRevealedEnglish(!blindMode);
    setRevealedJapanese(false);
    setUnitLogs([]);
    unitStartTimeRef.current = Date.now();

    if (units.length > 0) {
      playUnitAudio(units[0], false);
    }
  };

  // Re-listen / Retry current unit
  const handleRetry = useCallback(() => {
    if (!currentUnit) return;
    playUnitAudio(currentUnit, true);
  }, [currentUnit, playUnitAudio]);

  // Advance to next unit with a specific 4-level rating
  const handleRateAndAdvance = useCallback((rating: 1 | 2 | 3 | 4) => {
    if (!currentUnit) return;

    // Record elapsed time and metric log for current unit
    const elapsedMs = unitStartTimeRef.current > 0 ? Date.now() - unitStartTimeRef.current : 0;
    const log: StoryListeningUnitLog = {
      unitIdx: currentIndex,
      textEn: currentUnit.text,
      translationJa: currentUnit.translationJa,
      retryCount: currentRetryCount,
      elapsedMs: elapsedMs,
      revealedEnglish: revealedEnglish,
      revealedJapanese: revealedJapanese,
      rating: rating,
    };

    const nextLogs = [...unitLogs, log];
    setUnitLogs(nextLogs);

    // Save sentence rating for ReaderView coloring
    const targetSentenceIdx = currentUnit.sentenceIdx;
    setSentenceRatings(prev => ({
      ...prev,
      [targetSentenceIdx]: {
        rating: rating,
        timestamp: new Date().toISOString(),
      },
    }));

    if (currentIndex + 1 < units.length) {
      const nextIdx = currentIndex + 1;
      setCurrentIndex(nextIdx);
      setCurrentRetryCount(0);
      setRevealedEnglish(!blindMode);
      setRevealedJapanese(false);
      unitStartTimeRef.current = Date.now();
      playUnitAudio(units[nextIdx], false);
    } else {
      // Completed all units
      stopAudio();
      setStepStatus('all_completed');
      // 全文読了時の自動日本語音声アナウンス
      speakText(`全${units.length}文の読み終わりです。お疲れ様でした！`, 1.0, 'ja-JP');
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'none';
      }
    }
  }, [currentUnit, currentIndex, currentRetryCount, revealedEnglish, revealedJapanese, unitLogs, units, blindMode, playUnitAudio, stopAudio]);

  // Default advance (calculate appropriate rating if not explicitly rated)
  const handleAdvanceDefault = useCallback(() => {
    if (!currentUnit) return;
    // 音声コントロール/Spaceでの通常進行時は「3: 理解（中くらいわかった）」をデフォルトとする
    let defaultRating: 1 | 2 | 3 | 4 = 3;
    if (revealedJapanese || currentRetryCount >= 3) {
      defaultRating = 1; // 3回以上リピート / 和訳確認 ➔ 1: 要復習
    } else if (revealedEnglish || currentRetryCount >= 1) {
      defaultRating = 2; // リピート / 英文確認 ➔ 2: 曖昧
    } else {
      defaultRating = 3; // 通常次へ（中くらいわかった） ➔ 3: 理解
    }
    handleRateAndAdvance(defaultRating);
  }, [currentUnit, revealedJapanese, currentRetryCount, revealedEnglish, handleRateAndAdvance]);

  // Go back to previous unit
  const handlePrevious = useCallback(() => {
    if (currentIndex <= 0) return;
    const prevIdx = currentIndex - 1;
    setCurrentIndex(prevIdx);
    setCurrentRetryCount(0);
    setRevealedEnglish(!blindMode);
    setRevealedJapanese(false);
    unitStartTimeRef.current = Date.now();
    playUnitAudio(units[prevIdx], false);
  }, [currentIndex, units, blindMode, playUnitAudio]);

  // Mode change handler (Sentence vs Thought Group)
  const handleSwitchMode = (newMode: ListeningStreamMode) => {
    if (newMode === streamMode) return;
    stopAudio();
    setStreamMode(newMode);
    setCurrentIndex(0);
    setCurrentRetryCount(0);
    setRevealedEnglish(!blindMode);
    setRevealedJapanese(false);
    setUnitLogs([]);
    setStepStatus('idle');
  };

  // Blind mode toggle handler
  const handleToggleBlindMode = () => {
    const nextBlind = !blindMode;
    setBlindMode(nextBlind);
    if (!nextBlind) {
      setRevealedEnglish(true);
    }
  };

  // Keyboard shortcut handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when typing inside input / textarea
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if (stepStatus === 'idle') {
        if (e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault();
          handleStartListening();
        }
        return;
      }

      if (stepStatus === 'listening') {
        if (e.key === '1') {
          e.preventDefault();
          handleRateAndAdvance(1);
        } else if (e.key === '2') {
          e.preventDefault();
          handleRateAndAdvance(2);
        } else if (e.key === '3') {
          e.preventDefault();
          handleRateAndAdvance(3);
        } else if (e.key === '4') {
          e.preventDefault();
          handleRateAndAdvance(4);
        } else if (e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault();
          handleAdvanceDefault();
        } else if (e.code === 'KeyR') {
          e.preventDefault();
          handleRetry();
        } else if (e.code === 'KeyV') {
          e.preventDefault();
          setRevealedEnglish(prev => !prev);
        } else if (e.code === 'KeyJ') {
          e.preventDefault();
          setRevealedJapanese(prev => !prev);
        } else if (e.code === 'ArrowLeft') {
          e.preventDefault();
          handlePrevious();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [stepStatus, handleRateAndAdvance, handleAdvanceDefault, handleRetry, handlePrevious, blindMode]);


  // MediaSession API: イヤホン・ロック画面操作（Play=リピート, Next=次へ, Prev=戻る）
  useEffect(() => {
    if (!('mediaSession' in navigator) || stepStatus !== 'listening') return;

    try {
      navigator.mediaSession.setActionHandler('play', () => {
        handleRetry();
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        stopAudio();
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        handleAdvanceDefault();
      });
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        handlePrevious();
      });
    } catch (e) {
      console.warn('MediaSession action handler error:', e);
    }

    return () => {
      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.setActionHandler('play', null);
          navigator.mediaSession.setActionHandler('pause', null);
          navigator.mediaSession.setActionHandler('nexttrack', null);
          navigator.mediaSession.setActionHandler('previoustrack', null);
        } catch (_) {}
      }
    };
  }, [stepStatus, handleRetry, stopAudio, handleAdvanceDefault, handlePrevious]);

  // Benchmark Metrics Computation
  const metricsData = useMemo(() => {
    const totalUnits = unitLogs.length;
    if (totalUnits === 0) {
      return {
        firstPassRate: 100,
        totalRetries: 0,
        avgLatencySec: '0.0',
        effectiveListeningWpm: 0,
        bottlenecks: [],
      };
    }

    const firstPassCount = unitLogs.filter(
      log => log.retryCount === 0 && !log.revealedEnglish && (log.rating === undefined || log.rating >= 3)
    ).length;
    const firstPassRate = Math.round((firstPassCount / totalUnits) * 100);

    const totalRetries = unitLogs.reduce((acc, log) => acc + log.retryCount, 0);
    const totalLatencyMs = unitLogs.reduce((acc, log) => acc + log.elapsedMs, 0);
    const avgLatencySec = (totalLatencyMs / totalUnits / 1000).toFixed(1);

    const totalSec = Math.max(1, totalLatencyMs / 1000);
    const effectiveListeningWpm = Math.round((storyWordCount / totalSec) * 60);

    // Bottlenecks: Units that took >= 1 retry OR where English was revealed OR rated 1 or 2
    const bottlenecks = unitLogs.filter(
      log => log.retryCount >= 1 || log.revealedEnglish || (log.rating !== undefined && log.rating <= 2)
    );

    return {
      firstPassRate,
      totalRetries,
      avgLatencySec,
      effectiveListeningWpm,
      bottlenecks,
    };
  }, [unitLogs, storyWordCount]);

  // Finish and open reader
  const handleFinishAndOpenReader = () => {
    const totalUnits = unitLogs.length || 1;
    const totalLatencyMs = unitLogs.reduce((acc, log) => acc + log.elapsedMs, 0);
    const avgLatencyMs = Math.round(totalLatencyMs / totalUnits);

    const metrics: StoryListeningMetrics = {
      totalChunks: units.length,
      avgChunkLatencyMs: avgLatencyMs,
      totalSentenceLatencyMs: totalLatencyMs,
      effectiveListeningWpm: metricsData.effectiveListeningWpm,
      firstPassRate: metricsData.firstPassRate,
      totalRetries: metricsData.totalRetries,
      bottleneckCount: metricsData.bottlenecks.length,
      unitLogs: unitLogs,
      sentenceRatings: sentenceRatings,
      completedAt: new Date().toISOString(),
    };

    onCompleteListening(metrics);
  };

  return (
    <div className={`max-w-4xl mx-auto space-y-6 animate-fadeIn ${stepStatus === 'listening' ? 'pb-80 sm:pb-72' : 'pb-20'}`}>
      {/* 1. Header Navigation & Stage Indicator */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-6 shadow-2xl backdrop-blur-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <button
              onClick={onBackToBookshelf}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-all cursor-pointer"
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
            className="flex items-center space-x-1.5 px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white rounded-xl text-xs font-semibold border border-slate-700 transition-all cursor-pointer"
          >
            <BookOpen className="w-3.5 h-3.5 text-cyan-400" />
            <span>リスニングをスキップして精読へ ⏩</span>
          </button>
        </div>

        {/* Stage Flow Indicator */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-xs">
          <div className="flex items-center space-x-2 text-indigo-300 font-bold">
            <div className="w-5 h-5 rounded-full bg-indigo-500 text-white flex items-center justify-center text-[10px]">
              1
            </div>
            <span>初見ブラインド・リスニング（自然なリンキング・4段階理解度メモ）</span>
          </div>

          <div className="text-slate-600 font-mono">────▶</div>

          <div className="flex items-center space-x-2 text-slate-400 font-medium opacity-60">
            <div className="w-5 h-5 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center text-[10px]">
              2
            </div>
            <span>精読（理解度カラー表示） ＆ Anki送り</span>
          </div>
        </div>
      </div>

      {/* 2. Main Body Content */}
      {stepStatus === 'idle' ? (
        /* Ready / Onboarding Card */
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-10 shadow-2xl space-y-8 text-center">
          <div className="w-20 h-20 bg-indigo-500/20 text-indigo-400 border border-indigo-500/40 rounded-3xl flex items-center justify-center mx-auto shadow-xl shadow-indigo-500/10">
            <Headphones className="w-10 h-10 animate-pulse" />
          </div>

          <div className="space-y-3 max-w-lg mx-auto">
            <h2 className="text-2xl sm:text-3xl font-black text-white">
              音だけで意味を掴む「耳トレ」
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              文字を目で追わず、<strong className="text-cyan-300">自然なリンキング音声</strong>だけを聴いて脳内に情景を立ち上げます。
              各文を聴いたら <span className="text-emerald-400 font-bold">4段階の理解度</span>（1〜4キー）でサクサク記録して前へ進みましょう！
            </p>
          </div>

          {/* Mode & Preference Settings */}
          <div className="bg-slate-950/80 p-5 rounded-2xl border border-slate-800/80 max-w-xl mx-auto space-y-4 text-left">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-indigo-400" />
                再生ストリーム単位:
              </span>
              <div className="flex items-center p-1 bg-slate-900 rounded-xl border border-slate-800">
                <button
                  type="button"
                  onClick={() => handleSwitchMode('sentence')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    streamMode === 'sentence'
                      ? 'bg-gradient-to-r from-indigo-600 to-cyan-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  ⚡ 1文流し (推奨)
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchMode('chunk')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    streamMode === 'chunk'
                      ? 'bg-gradient-to-r from-indigo-600 to-cyan-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  🧩 Thought Group流し
                </button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <EyeOff className="w-4 h-4 text-cyan-400" />
                英文表示モード:
              </span>
              <button
                type="button"
                onClick={handleToggleBlindMode}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                  blindMode
                    ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40 hover:bg-indigo-500/30'
                    : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-750'
                }`}
              >
                {blindMode ? '🎧 ブラインド (音のみ・推奨)' : '👁️ 英文を常時表示'}
              </button>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <Gauge className="w-4 h-4 text-amber-400" />
                再生速度:
              </span>
              <div className="flex items-center gap-1.5">
                {SPEECH_RATES.map(rate => (
                  <button
                    key={rate.value}
                    type="button"
                    onClick={() => setSpeechRate(rate.value)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                      speechRate === rate.value
                        ? 'bg-amber-500 text-slate-950 font-black shadow'
                        : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                    }`}
                  >
                    {rate.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Start CTA */}
          <div className="pt-2">
            <button
              onClick={handleStartListening}
              className="flex items-center space-x-3 px-8 py-4 bg-gradient-to-r from-indigo-600 via-purple-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white rounded-2xl text-base sm:text-lg font-black shadow-xl shadow-indigo-600/30 transition-all mx-auto active:scale-95 cursor-pointer"
            >
              <Play className="w-5 h-5 fill-current" />
              <span>初見リスニングを開始する ▶ (Space / Enter)</span>
            </button>
          </div>
        </div>
      ) : stepStatus === 'all_completed' ? (
        /* 3. Completion Summary & Benchmark Screen */
        <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-6 sm:p-10 text-center space-y-8 shadow-2xl animate-fadeIn">
          <div className="w-20 h-20 bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 rounded-3xl flex items-center justify-center mx-auto shadow-xl shadow-emerald-500/10">
            <CheckCircle2 className="w-10 h-10" />
          </div>

          <div className="space-y-2 max-w-lg mx-auto">
            <h2 className="text-2xl sm:text-3xl font-black text-white">
              🎉 初見リスニング完走！
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              全 {units.length} {streamMode === 'sentence' ? '文' : 'チャンク'}（{storyWordCount} 語）のリスニングを完了しました。
              あなたの聴覚実効バンド幅の測定結果です。
            </p>
          </div>

          {/* Benchmark KPI Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-2xl mx-auto">
            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-1">
              <span className="text-[11px] text-slate-400 font-bold flex items-center justify-center gap-1">
                <Flame className="w-3.5 h-3.5 text-amber-400" />
                一発パス率
              </span>
              <div className={`text-2xl sm:text-3xl font-black font-mono ${
                metricsData.firstPassRate >= 80
                  ? 'text-emerald-400'
                  : metricsData.firstPassRate >= 50
                  ? 'text-cyan-400'
                  : 'text-amber-400'
              }`}>
                {metricsData.firstPassRate}%
              </div>
              <span className="text-[10px] text-slate-500">0リトライ・英文未見</span>
            </div>

            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-1">
              <span className="text-[11px] text-slate-400 font-bold flex items-center justify-center gap-1">
                <Zap className="w-3.5 h-3.5 text-cyan-400" />
                聴覚実効WPM
              </span>
              <div className="text-2xl sm:text-3xl font-black text-cyan-300 font-mono">
                {metricsData.effectiveListeningWpm}
              </div>
              <span className="text-[10px] text-slate-500">総処理速度</span>
            </div>

            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-1">
              <span className="text-[11px] text-slate-400 font-bold flex items-center justify-center gap-1">
                <RotateCcw className="w-3.5 h-3.5 text-indigo-400" />
                リトライ回数
              </span>
              <div className="text-2xl sm:text-3xl font-black text-indigo-300 font-mono">
                {metricsData.totalRetries} <span className="text-xs font-normal text-slate-400">回</span>
              </div>
              <span className="text-[10px] text-slate-500">平均 {metricsData.avgLatencySec}s / 塊</span>
            </div>

            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-1">
              <span className="text-[11px] text-slate-400 font-bold flex items-center justify-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                要復習ボトルネック
              </span>
              <div className="text-2xl sm:text-3xl font-black text-rose-400 font-mono">
                {metricsData.bottlenecks.length} <span className="text-xs font-normal text-slate-400">件</span>
              </div>
              <span className="text-[10px] text-slate-500">リトライ・英文確認・低理解度</span>
            </div>
          </div>

          {/* Bottleneck breakdown list */}
          {metricsData.bottlenecks.length > 0 && (
            <div className="bg-slate-950/80 border border-slate-800/80 rounded-2xl p-4 sm:p-5 max-w-2xl mx-auto space-y-3 text-left">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4" />
                  精読で重点チェックすべきボトルネック
                </span>
                <span className="text-[11px] text-slate-500 font-mono">
                  {metricsData.bottlenecks.length} 件
                </span>
              </div>

              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {metricsData.bottlenecks.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-slate-900 border border-slate-855 rounded-xl space-y-1 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-bold text-white font-serif leading-relaxed">
                        {item.textEn}
                      </p>
                      <button
                        type="button"
                        onClick={() => speakText(item.textEn, 1.0, 'en-US')}
                        className="p-1 bg-slate-800 hover:bg-slate-700 text-indigo-300 hover:text-white rounded-lg transition-colors shrink-0 cursor-pointer"
                        title="音声を再生"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {item.translationJa && (
                      <p className="text-[11px] text-slate-400">
                        {item.translationJa}
                      </p>
                    )}
                    <div className="flex items-center gap-2 pt-0.5 text-[10px]">
                      {item.retryCount > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">
                          🔄 {item.retryCount} 回リトライ
                        </span>
                      )}
                      {item.revealedEnglish && (
                        <span className="px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300">
                          👁️ 英文確認
                        </span>
                      )}
                      {item.rating && (
                        <span className={`px-1.5 py-0.5 rounded font-mono ${
                          item.rating === 1 ? 'bg-rose-500/20 text-rose-300' : 'bg-amber-500/20 text-amber-300'
                        }`}>
                          ★ 理解度: {item.rating}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action CTA: Move to Reader */}
          <div className="pt-2">
            <button
              onClick={handleFinishAndOpenReader}
              className="flex items-center space-x-2 px-8 py-4 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white rounded-2xl text-base sm:text-lg font-black shadow-xl shadow-emerald-600/30 transition-all mx-auto active:scale-95 cursor-pointer"
            >
              <BookOpen className="w-5 h-5" />
              <span>第2段階：精読（理解度カラー確認 ＆ Anki送り）へ進む 🚀</span>
            </button>
          </div>
        </div>
      ) : (
        /* 4. Active Listening Stream Player */
        <div className="space-y-6">
          {/* Unit Progress Bar & Speed Switcher */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-2">
            <div className="flex items-center justify-between text-xs flex-wrap gap-2">
              <span className="font-bold text-slate-300 flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 font-mono font-bold">
                  {streamMode === 'sentence' ? '文' : 'チャンク'} {currentIndex + 1} / {units.length}
                </span>
                {currentUnit?.boundaryReason && (
                  <span className="text-[11px] text-slate-400 hidden sm:inline">
                    ({currentUnit.boundaryReason})
                  </span>
                )}
              </span>

              <div className="flex items-center space-x-2">
                {/* Compact Rate Selector */}
                <div className="flex items-center gap-1 bg-slate-950 px-1.5 py-0.5 rounded-lg border border-slate-800">
                  {SPEECH_RATES.map(r => (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => setSpeechRate(r.value)}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition-all cursor-pointer ${
                        speechRate === r.value
                          ? 'bg-amber-500 text-slate-950'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>

                {currentRetryCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-bold font-mono animate-pulse">
                    リトライ {currentRetryCount} 回目
                  </span>
                )}
                <span className="text-[11px] text-slate-400 font-mono">
                  {Math.round(((currentIndex + 1) / units.length) * 100)}%
                </span>
              </div>
            </div>

            <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
              <div
                className="bg-gradient-to-r from-indigo-500 via-purple-500 to-cyan-400 h-full transition-all duration-300"
                style={{ width: `${((currentIndex + 1) / units.length) * 100}%` }}
              />
            </div>
          </div>

          {/* Auditory Listening Centerpiece */}
          <div className="bg-slate-950/90 border border-slate-800/90 rounded-3xl p-6 sm:p-8 space-y-6 text-center shadow-inner relative overflow-hidden">
            {/* Background Glow */}
            <div className="absolute inset-0 bg-gradient-to-b from-indigo-500/5 to-transparent pointer-events-none" />

            {/* Audio Wave / Pulse Visualizer */}
            <div className="flex items-center justify-center gap-1.5 py-4">
              {[0.4, 0.7, 1.0, 0.6, 0.9, 0.5, 0.8, 0.3].map((heightRatio, i) => (
                <div
                  key={i}
                  className={`w-1.5 rounded-full transition-all duration-200 ${
                    isPlaying
                      ? 'bg-gradient-to-t from-indigo-500 to-cyan-400 animate-pulse'
                      : 'bg-slate-800'
                  }`}
                  style={{
                    height: isPlaying ? `${Math.max(16, heightRatio * 48)}px` : '12px',
                    animationDelay: `${i * 100}ms`,
                  }}
                />
              ))}
            </div>

            {/* Status indicator */}
            <div className="flex items-center justify-center gap-2">
              <span className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 transition-all ${
                isPlaying
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 animate-pulse'
                  : 'bg-slate-800 text-slate-300 border border-slate-700'
              }`}>
                {isPlaying ? (
                  <>
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>自然な音声を再生中...</span>
                  </>
                ) : (
                  <>
                    <Headphones className="w-3.5 h-3.5 text-indigo-400" />
                    <span>聞き取れましたか？（上のボタンでリピート / 下の理解度で次へ）</span>
                  </>
                )}
              </span>
            </div>

            {/* English Text Display (Blind vs Revealed) */}
            {revealedEnglish || !blindMode ? (
              <div className="p-4 sm:p-5 bg-slate-900/90 border border-slate-800 rounded-2xl space-y-2 animate-fadeIn shadow-lg">
                <p className="text-base sm:text-xl font-bold text-white leading-relaxed font-serif">
                  {currentUnit?.text}
                </p>
                {blindMode && (
                  <div className="text-[10px] text-amber-400 font-medium">
                    👁️ 英文を表示中（要復習フラグが記録されます）
                  </div>
                )}
              </div>
            ) : (
              <div className="p-6 bg-slate-900/40 border border-dashed border-slate-800 rounded-2xl space-y-2">
                <p className="text-xs sm:text-sm text-slate-400 font-medium leading-relaxed">
                  🎧 英文は非表示です（音だけに集中して情景をイメージ）
                </p>
                <button
                  type="button"
                  onClick={() => setRevealedEnglish(true)}
                  className="text-xs font-bold text-sky-400 hover:text-sky-300 hover:underline transition-all cursor-pointer inline-flex items-center gap-1 pt-1"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>どうしても分からない時は英文を表示 (Vキー)</span>
                </button>
              </div>
            )}

            {/* Japanese Translation Area */}
            {revealedJapanese ? (
              <div className="p-4 bg-sky-950/40 border border-sky-500/30 rounded-2xl text-xs sm:text-sm text-sky-200 leading-relaxed text-left animate-fadeIn shadow-inner">
                <span className="text-[11px] font-bold text-sky-400 block mb-1">
                  【日本語訳】
                </span>
                {currentUnit?.translationJa || '（和訳が見つかりませんでした）'}
              </div>
            ) : (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => setRevealedJapanese(true)}
                  className="text-[11px] font-medium text-slate-500 hover:text-slate-300 hover:underline transition-all cursor-pointer inline-flex items-center gap-1"
                >
                  <span>💡 和訳を確認 (Jキー)</span>
                </button>
              </div>
            )}

            {/* Brain Compression Rule Banner */}
            <div className="p-3 bg-slate-900/60 border border-amber-500/20 rounded-2xl text-center space-y-1">
              <div className="text-[11px] font-bold text-amber-300 flex items-center justify-center gap-1">
                <Brain className="w-3.5 h-3.5 text-amber-400" />
                <span>🧠【脳内圧縮ルール】</span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed max-w-lg mx-auto">
                情景をイメージしたら音そのものは消去！分からない箇所は<strong>「変数 $X$」</strong>のまま前へ進みましょう。
              </p>
            </div>
          </div>

          {/* ========================================================= */}
          {/* Fixed Sticky Bottom Dock: 上段=操作ボタン / 下段=4段階理解度 */}
          {/* ========================================================= */}
          <div className="fixed bottom-0 inset-x-0 z-50 bg-slate-950/95 backdrop-blur-xl border-t border-slate-800 shadow-2xl p-3 sm:p-4 space-y-2.5 max-w-4xl mx-auto" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 16px))' }}>
            
            {/* 上段: リピート・英文・和訳・戻る・次へ等の操作コントロール */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                {/* 戻るボタン */}
                {currentIndex > 0 && (
                  <button
                    type="button"
                    onClick={handlePrevious}
                    className="flex items-center space-x-1 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white rounded-xl text-xs font-bold border border-slate-700 transition-all cursor-pointer shadow-sm active:scale-95"
                    title="1つ前の文へ戻る (←キー)"
                  >
                    <span>⏮️ 戻る</span>
                  </button>
                )}

                {/* リピート (もう一度聴く) ボタン */}
                <button
                  type="button"
                  onClick={handleRetry}
                  className="flex items-center space-x-1.5 px-3.5 py-2 bg-gradient-to-r from-amber-500/20 to-orange-500/20 hover:from-amber-500/30 hover:to-orange-500/30 text-amber-300 hover:text-white rounded-xl text-xs font-bold border border-amber-500/40 hover:border-amber-400 transition-all cursor-pointer shadow-sm active:scale-95 group"
                  title="もう一度再生 (Rキー)"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-amber-400 group-hover:rotate-[-45deg] transition-transform" />
                  <span>もう一度聴く (R)</span>
                </button>

                {/* 英文表示 / 非表示 トグル */}
                <button
                  type="button"
                  onClick={() => setRevealedEnglish(prev => !prev)}
                  className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer shadow-sm active:scale-95 ${
                    revealedEnglish
                      ? 'bg-sky-500/20 text-sky-200 border-sky-500/50'
                      : 'bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border-slate-700'
                  }`}
                  title="英文を見る / 隠す (Vキー)"
                >
                  {revealedEnglish ? (
                    <>
                      <EyeOff className="w-3.5 h-3.5 text-sky-400" />
                      <span>英文を隠す</span>
                    </>
                  ) : (
                    <>
                      <Eye className="w-3.5 h-3.5 text-sky-400" />
                      <span>英文を見る (V)</span>
                    </>
                  )}
                </button>

                {/* 和訳表示 / 非表示 トグル */}
                <button
                  type="button"
                  onClick={() => setRevealedJapanese(prev => !prev)}
                  className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer shadow-sm active:scale-95 ${
                    revealedJapanese
                      ? 'bg-amber-500/20 text-amber-200 border-amber-500/50'
                      : 'bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border-slate-700'
                  }`}
                  title="和訳を確認 / 隠す (Jキー)"
                >
                  <span className="text-[11px] text-amber-400">💡</span>
                  <span>{revealedJapanese ? '和訳を隠す' : '和訳を見る (J)'}</span>
                </button>
              </div>

              {/* 通常次へボタン (Space / Enter) */}
              <button
                type="button"
                onClick={handleAdvanceDefault}
                className="flex items-center space-x-1.5 px-4 sm:px-5 py-2 bg-gradient-to-r from-indigo-600 via-purple-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white rounded-xl text-xs sm:text-sm font-black shadow-lg shadow-indigo-600/30 transition-all active:scale-95 cursor-pointer ml-auto shrink-0"
              >
                <SkipForward className="w-3.5 h-3.5" />
                <span>
                  {currentIndex + 1 < units.length
                    ? '次へ (Space)'
                    : 'サマリーへ 🚀'}
                </span>
              </button>
            </div>

            {/* 下段: 4段階理解度レーティング (1〜4キーで直接評価＆次へ進む) */}
            <div className="grid grid-cols-4 gap-1.5 sm:gap-2 pt-1 border-t border-slate-850/80">
              {/* Rating 1: 🔴 */}
              <button
                type="button"
                onClick={() => handleRateAndAdvance(1)}
                className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 py-2 px-1 sm:px-2 rounded-xl bg-rose-950/80 hover:bg-rose-900 text-rose-300 hover:text-white border border-rose-600/50 hover:border-rose-400 transition-all active:scale-95 cursor-pointer shadow-sm group"
                title="1キー: 全く聞き取れず・要復習"
              >
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-rose-500 inline-block group-hover:animate-ping" />
                  <span className="text-[10px] font-mono px-1 py-0.2 bg-rose-900/90 rounded border border-rose-700 font-bold">1</span>
                </div>
                <span className="text-[10px] sm:text-xs font-black truncate">聞き取れず</span>
              </button>

              {/* Rating 2: 🟡 */}
              <button
                type="button"
                onClick={() => handleRateAndAdvance(2)}
                className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 py-2 px-1 sm:px-2 rounded-xl bg-amber-950/80 hover:bg-amber-900 text-amber-300 hover:text-white border border-amber-600/50 hover:border-amber-400 transition-all active:scale-95 cursor-pointer shadow-sm group"
                title="2キー: 曖昧・要リトライ"
              >
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                  <span className="text-[10px] font-mono px-1 py-0.2 bg-amber-900/90 rounded border border-amber-700 font-bold">2</span>
                </div>
                <span className="text-[10px] sm:text-xs font-black truncate">曖昧</span>
              </button>

              {/* Rating 3: 🔵 */}
              <button
                type="button"
                onClick={() => handleRateAndAdvance(3)}
                className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 py-2 px-1 sm:px-2 rounded-xl bg-sky-950/80 hover:bg-sky-900 text-sky-300 hover:text-white border border-sky-600/50 hover:border-sky-400 transition-all active:scale-95 cursor-pointer shadow-sm group"
                title="3キー: 理解できた"
              >
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-sky-400 inline-block" />
                  <span className="text-[10px] font-mono px-1 py-0.2 bg-sky-900/90 rounded border border-sky-700 font-bold">3</span>
                </div>
                <span className="text-[10px] sm:text-xs font-black truncate">理解できた</span>
              </button>

              {/* Rating 4: 🟢 */}
              <button
                type="button"
                onClick={() => handleRateAndAdvance(4)}
                className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 py-2 px-1 sm:px-2 rounded-xl bg-emerald-950/85 hover:bg-emerald-900 text-emerald-300 hover:text-white border border-emerald-500/60 hover:border-emerald-400 transition-all active:scale-95 cursor-pointer shadow-sm group"
                title="4キー: 即座に情景が浮かんだ"
              >
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                  <span className="text-[10px] font-mono px-1 py-0.2 bg-emerald-900/90 rounded border border-emerald-600 font-bold">4</span>
                </div>
                <span className="text-[10px] sm:text-xs font-black truncate">即座に理解</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
