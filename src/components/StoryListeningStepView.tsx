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
  Sparkles,
  Volume2,
  AlertTriangle,
  Flame,
  Clock,
  Gauge
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

  // Refs for tracking timestamps
  const unitStartTimeRef = useRef<number>(0);

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
  }, []);

  useEffect(() => {
    return () => {
      stopAudio();
    };
  }, [stopAudio]);

  // Play unit audio with natural linking
  const playUnitAudio = useCallback((unit: ListeningUnit, isRetry: boolean = false) => {
    if (!unit || !unit.text) return;

    stopAudio();
    setIsPlaying(true);

    if (isRetry) {
      setCurrentRetryCount(prev => prev + 1);
    }

    speakText(unit.text, speechRate, 'en-US', () => {
      setIsPlaying(false);
    });
  }, [speechRate, stopAudio]);

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

  // Advance to next unit or finish
  const handleAdvance = useCallback(() => {
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
    };

    const nextLogs = [...unitLogs, log];
    setUnitLogs(nextLogs);

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
    }
  }, [currentUnit, currentIndex, currentRetryCount, revealedEnglish, revealedJapanese, unitLogs, units, blindMode, playUnitAudio, stopAudio]);

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
        if (e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault();
          handleAdvance();
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
  }, [stepStatus, handleAdvance, handleRetry, handlePrevious, blindMode]);

  // Benchmark Metrics Computation
  const metricsData = useMemo(() => {
    const totalUnits = unitLogs.length;
    if (totalUnits === 0) {
      return {
        firstPassRate: 100,
        totalRetries: 0,
        avgLatencySec: 0,
        bottlenecks: [],
      };
    }

    const firstPassCount = unitLogs.filter(
      log => log.retryCount === 0 && !log.revealedEnglish
    ).length;
    const firstPassRate = Math.round((firstPassCount / totalUnits) * 100);

    const totalRetries = unitLogs.reduce((acc, log) => acc + log.retryCount, 0);
    const totalLatencyMs = unitLogs.reduce((acc, log) => acc + log.elapsedMs, 0);
    const avgLatencySec = (totalLatencyMs / totalUnits / 1000).toFixed(1);

    // Bottlenecks: Units that took >= 1 retry OR where English was revealed
    const bottlenecks = unitLogs.filter(
      log => log.retryCount >= 1 || log.revealedEnglish
    );

    return {
      firstPassRate,
      totalRetries,
      avgLatencySec,
      bottlenecks,
    };
  }, [unitLogs]);

  // Finish and open reader
  const handleFinishAndOpenReader = () => {
    const totalUnits = unitLogs.length || 1;
    const totalLatencyMs = unitLogs.reduce((acc, log) => acc + log.elapsedMs, 0);
    const avgLatencyMs = Math.round(totalLatencyMs / totalUnits);

    const metrics: StoryListeningMetrics = {
      totalChunks: units.length,
      avgChunkLatencyMs: avgLatencyMs,
      totalSentenceLatencyMs: totalLatencyMs,
      firstPassRate: metricsData.firstPassRate,
      totalRetries: metricsData.totalRetries,
      bottleneckCount: metricsData.bottlenecks.length,
      unitLogs: unitLogs,
      completedAt: new Date().toISOString(),
    };

    onCompleteListening(metrics);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20 animate-fadeIn">
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
            className="flex items-center space-x-1.5 px-3.5 py-2 bg-slate-850 hover:bg-slate-800 text-slate-300 hover:text-white rounded-xl text-xs font-semibold border border-slate-700 transition-all cursor-pointer"
          >
            <BookOpen className="w-3.5 h-3.5 text-cyan-400" />
            <span>リーダーへ進む (スキップ)</span>
          </button>
        </div>

        {/* Stage Flow Indicator */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-xs">
          <div className="flex items-center space-x-2 text-indigo-300 font-bold">
            <div className="w-5 h-5 rounded-full bg-indigo-500 text-white flex items-center justify-center text-[10px]">
              1
            </div>
            <span>初見ブラインド・リスニング（自然なリンキング・即時リトライ）</span>
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
              分かるまで何度でもリトライし、分かったら次へ進みましょう！
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
              全 {units.length} {streamMode === 'sentence' ? '文' : 'チャンク'} のリスニングを完了しました。
              あなたの聴覚バンド幅の測定結果です。
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
              <span className="text-[10px] text-slate-500">0リトライ・文字非表示</span>
            </div>

            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-1">
              <span className="text-[11px] text-slate-400 font-bold flex items-center justify-center gap-1">
                <Clock className="w-3.5 h-3.5 text-sky-400" />
                平均突破時間
              </span>
              <div className="text-2xl sm:text-3xl font-black text-sky-300 font-mono">
                {metricsData.avgLatencySec}
                <span className="text-xs font-normal text-slate-400 ml-1">秒</span>
              </div>
              <span className="text-[10px] text-slate-500">理解までの秒数</span>
            </div>

            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-1">
              <span className="text-[11px] text-slate-400 font-bold flex items-center justify-center gap-1">
                <RotateCcw className="w-3.5 h-3.5 text-purple-400" />
                総リトライ
              </span>
              <div className="text-2xl sm:text-3xl font-black text-purple-300 font-mono">
                {metricsData.totalRetries}
                <span className="text-xs font-normal text-slate-400 ml-1">回</span>
              </div>
              <span className="text-[10px] text-slate-500">聞き直し合計</span>
            </div>

            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-1">
              <span className="text-[11px] text-slate-400 font-bold flex items-center justify-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                要復習文
              </span>
              <div className="text-2xl sm:text-3xl font-black text-amber-400 font-mono">
                {metricsData.bottlenecks.length}
                <span className="text-xs font-normal text-slate-400 ml-1">件</span>
              </div>
              <span className="text-[10px] text-slate-500">リトライor英文確認</span>
            </div>
          </div>

          {/* Bottleneck Review Section */}
          {metricsData.bottlenecks.length > 0 ? (
            <div className="bg-slate-950/80 border border-slate-800/80 rounded-2xl p-5 text-left max-w-2xl mx-auto space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 text-amber-400 font-bold text-xs sm:text-sm">
                  <AlertTriangle className="w-4 h-4" />
                  <span>聞き取りで詰まったボトルネック（精読でのAnki登録推奨）</span>
                </div>
                <span className="text-xs text-slate-400 font-mono">
                  {metricsData.bottlenecks.length} / {units.length} 件
                </span>
              </div>

              <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                {metricsData.bottlenecks.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-1.5 hover:border-slate-700 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs sm:text-sm font-bold text-white leading-relaxed font-serif">
                        {item.textEn}
                      </p>
                      <button
                        type="button"
                        onClick={() => speakText(item.textEn, speechRate, 'en-US')}
                        className="p-1.5 bg-slate-800 hover:bg-slate-750 text-indigo-300 hover:text-white rounded-lg border border-slate-700 transition-all shrink-0 cursor-pointer"
                        title="音声を再生"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <p className="text-[11px] text-slate-400 leading-snug">
                      {item.translationJa}
                    </p>

                    <div className="flex items-center gap-2 pt-1">
                      {item.retryCount > 0 && (
                        <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-mono">
                          🔄 リトライ {item.retryCount} 回
                        </span>
                      )}
                      {item.revealedEnglish && (
                        <span className="px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30 text-[10px]">
                          👁️ 英文確認
                        </span>
                      )}
                      <span className="text-[10px] text-slate-500 font-mono ml-auto">
                        所要: {(item.elapsedMs / 1000).toFixed(1)}s
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-4 bg-emerald-950/40 border border-emerald-500/30 rounded-2xl max-w-md mx-auto text-emerald-300 text-xs font-bold flex items-center justify-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <span>パーフェクト！すべての文を一発で聞き取れました！</span>
            </div>
          )}

          {/* Transition CTA */}
          <div className="pt-2">
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
        /* 4. Active Listening Stepper Card */
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-8 shadow-2xl space-y-6">
          {/* Top Control Bar: Mode, Blind Toggle, Rate & Progress */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
            {/* Stream Mode Switcher */}
            <div className="flex items-center p-1 bg-slate-950 rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={() => handleSwitchMode('sentence')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  streamMode === 'sentence'
                    ? 'bg-gradient-to-r from-indigo-600 to-cyan-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                1文流し
              </button>
              <button
                type="button"
                onClick={() => handleSwitchMode('chunk')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  streamMode === 'chunk'
                    ? 'bg-gradient-to-r from-indigo-600 to-cyan-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Thought Group
              </button>
            </div>

            {/* Blind Mode & Speed Pill */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleToggleBlindMode}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                  blindMode
                    ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40 hover:bg-indigo-500/30'
                    : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-750'
                }`}
                title="英文表示の切り替え"
              >
                {blindMode ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span>{blindMode ? 'ブラインド中 (音のみ)' : '英文表示中'}</span>
              </button>

              <div className="flex items-center bg-slate-950 px-2 py-1 rounded-xl border border-slate-800 gap-1">
                <Gauge className="w-3 h-3 text-amber-400" />
                <select
                  value={speechRate}
                  onChange={e => setSpeechRate(parseFloat(e.target.value))}
                  className="bg-transparent text-xs font-bold text-slate-300 focus:outline-none cursor-pointer"
                >
                  {SPEECH_RATES.map(rate => (
                    <option key={rate.value} value={rate.value} className="bg-slate-900 text-white">
                      {rate.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Unit Progress Tracker */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center space-x-2">
                <span className="font-bold text-white font-mono">
                  {streamMode === 'sentence' ? `文 ${currentIndex + 1} / ${units.length}` : `Chunk ${currentIndex + 1} / ${units.length}`}
                </span>
                {streamMode === 'chunk' && currentUnit?.boundaryReason && (
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px] font-mono">
                    {currentUnit.boundaryReason}
                  </span>
                )}
              </div>

              <div className="flex items-center space-x-2">
                {currentRetryCount > 0 && (
                  <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[11px] font-mono font-bold animate-pulse">
                    🔄 リトライ {currentRetryCount} 回目
                  </span>
                )}
                <span className="text-slate-400 font-mono">
                  {Math.round(((currentIndex + 1) / units.length) * 100)}%
                </span>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-gradient-to-r from-indigo-500 to-cyan-400 h-full transition-all duration-300"
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
                    <span>聞き取れましたか？（リトライ または 次へ）</span>
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

          {/* Action Control Buttons */}
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            {/* Primary Advance Button */}
            <button
              type="button"
              onClick={handleAdvance}
              className="flex items-center space-x-2 px-7 py-3.5 bg-gradient-to-r from-indigo-600 via-purple-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white rounded-2xl text-xs sm:text-sm font-black shadow-lg shadow-indigo-600/30 transition-all active:scale-95 cursor-pointer"
            >
              <SkipForward className="w-4 h-4" />
              <span>
                {currentIndex + 1 < units.length
                  ? `⏭️ 分かった・次へ ▶ (Space / Enter)`
                  : '🎉 全文完了！サマリーへ 🚀'}
              </span>
            </button>

            {/* Retry Button */}
            <button
              type="button"
              onClick={handleRetry}
              className="flex items-center space-x-1.5 px-4 py-3.5 bg-slate-800 hover:bg-slate-750 text-slate-200 hover:text-white rounded-2xl text-xs font-bold border border-slate-700 transition-all cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
              <span>もう一度聴く (R)</span>
            </button>

            {/* Peek English Button */}
            <button
              type="button"
              onClick={() => setRevealedEnglish(prev => !prev)}
              className="flex items-center space-x-1.5 px-3.5 py-3.5 bg-slate-850 hover:bg-slate-800 text-slate-300 hover:text-white rounded-2xl text-xs font-bold border border-slate-700 transition-all cursor-pointer"
            >
              {revealedEnglish ? (
                <>
                  <EyeOff className="w-3.5 h-3.5 text-slate-400" />
                  <span>英文を隠す</span>
                </>
              ) : (
                <>
                  <Eye className="w-3.5 h-3.5 text-sky-400" />
                  <span>英文を見る (V)</span>
                </>
              )}
            </button>

            {/* Back Button */}
            {currentIndex > 0 && (
              <button
                type="button"
                onClick={handlePrevious}
                className="flex items-center space-x-1 px-3 py-3.5 bg-slate-900 hover:bg-slate-850 text-slate-400 hover:text-slate-200 rounded-2xl text-xs font-medium border border-slate-800 transition-all cursor-pointer"
                title="1つ戻る (←キー)"
              >
                <span>⏮️ 戻る</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
