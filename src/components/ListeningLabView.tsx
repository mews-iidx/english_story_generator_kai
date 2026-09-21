import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  FlaskConical,
  Play,
  RotateCcw,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Brain,
  Layers,
  Activity,
  Download,
  Trash2,
  RefreshCw,
  Headphones,
  Zap,
  Check,
  BarChart3,
  Minus,
  Plus,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  Scissors
} from 'lucide-react';
import { CefrLevel } from '../types/settings';
import {
  LabQuestion,
  LabDiagnosisResult,
  LabQuestionRecord,
  LabAnalyticsSummary,
  LabBottleneckType
} from '../types/listeningLab';
import {
  generateLabBatch,
  diagnoseUserResponse,
  saveLabRecord,
  calculateLabAnalytics,
  clearLabRecords,
  exportLabRecordsJson,
  splitIntoSmartChunks
} from '../services/listeningLabService';

interface ListeningLabViewProps {
  apiKey: string;
  selectedModel?: string;
  userLevel?: CefrLevel;
}

const WORD_COUNT_OPTIONS = [4, 6, 8, 12, 16, 20] as const;

type ActiveTab = 'training' | 'analytics';
type DisplayMode = 'audio_only' | 'rsvp_chunk' | 'rsvp_word' | 'text_reveal';

export const ListeningLabView: React.FC<ListeningLabViewProps> = ({
  apiKey,
  selectedModel = 'gemini-2.0-flash',
  userLevel = 'A2',
}) => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('training');

  // Configuration State
  const [targetWordCount, setTargetWordCount] = useState<number>(4);
  const [targetSpeedWpm, setTargetSpeedWpm] = useState<number>(60);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('audio_only');
  const cefrLevel = userLevel;

  // Batch Session State
  const [currentSessionId, setCurrentSessionId] = useState<string>(() => 'sess_' + Date.now());
  const [questions, setQuestions] = useState<LabQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isGeneratingBatch, setIsGeneratingBatch] = useState<boolean>(false);

  // Playback & RSVP Flash State
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [activeWordIndex, setActiveWordIndex] = useState<number>(-1);
  const [activeChunkIndex, setActiveChunkIndex] = useState<number>(-1);
  const playbackTimerRef = useRef<any>(null);

  // User Input & AI Diagnosis State
  const [userResponse, setUserResponse] = useState<string>('');
  const [isDiagnosing, setIsDiagnosing] = useState<boolean>(false);
  const [diagnosisResult, setDiagnosisResult] = useState<LabDiagnosisResult | null>(null);
  const [isSessionCompleted, setIsSessionCompleted] = useState<boolean>(false);

  // Analytics State
  const [analytics, setAnalytics] = useState<LabAnalyticsSummary>(() => calculateLabAnalytics());
  const [copiedExport, setCopiedExport] = useState<boolean>(false);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);

  const currentQuestion = questions[currentIndex] || null;

  // Speed level guide helper
  const speedGuide = useMemo(() => {
    if (targetSpeedWpm <= 60) return { label: '超じっくり（1秒/語・音と文字の確認）', color: 'text-indigo-400 bg-indigo-950/60 border-indigo-500/30' };
    if (targetSpeedWpm <= 90) return { label: 'ゆったり基礎（初心者向け・語順の意識）', color: 'text-sky-400 bg-sky-950/60 border-sky-500/30' };
    if (targetSpeedWpm <= 130) return { label: '普通（標準的な日常会話・ニュース）', color: 'text-emerald-400 bg-emerald-950/60 border-emerald-500/30' };
    if (targetSpeedWpm <= 170) return { label: 'ネイティブ日常速度（ポッドキャスト）', color: 'text-amber-400 bg-amber-950/60 border-amber-500/30' };
    if (targetSpeedWpm <= 200) return { label: 'ネイティブ実速度（映画・フリートーク）', color: 'text-orange-400 bg-orange-950/60 border-orange-500/30' };
    return { label: 'ネイティブ早口（TED Talks・議論）', color: 'text-rose-400 bg-rose-950/60 border-rose-500/30' };
  }, [targetSpeedWpm]);

  // Refresh analytics
  const refreshAnalytics = useCallback(() => {
    setAnalytics(calculateLabAnalytics());
  }, []);

  // Generate a batch of 5 questions
  const handleGenerateBatch = useCallback(async () => {
    if (isGeneratingBatch) return;
    setIsGeneratingBatch(true);
    const newSessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    setCurrentSessionId(newSessionId);
    setCurrentIndex(0);
    setUserResponse('');
    setDiagnosisResult(null);
    setIsSessionCompleted(false);
    setActiveWordIndex(-1);
    setActiveChunkIndex(-1);

    try {
      const batch = await generateLabBatch({
        wordCount: targetWordCount,
        speedWpm: targetSpeedWpm,
        count: 5,
        cefrLevel,
        apiKey,
        model: selectedModel,
      });
      setQuestions(batch);
    } catch (e) {
      console.error('Failed to generate batch', e);
    } finally {
      setIsGeneratingBatch(false);
    }
  }, [targetWordCount, targetSpeedWpm, cefrLevel, apiKey, selectedModel, isGeneratingBatch]);

  // Initial batch load
  useEffect(() => {
    if (questions.length === 0 && !isGeneratingBatch) {
      handleGenerateBatch();
    }
  }, []);

  // Stop playback on unmount or question change
  const stopPlayback = () => {
    if (playbackTimerRef.current) {
      clearTimeout(playbackTimerRef.current);
      clearInterval(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsPlaying(false);
    setActiveWordIndex(-1);
    setActiveChunkIndex(-1);
  };

  useEffect(() => {
    return () => {
      stopPlayback();
    };
  }, []);

  // Step-by-step Audio & RSVP Playback Engine
  const playCurrentQuestion = () => {
    if (!currentQuestion) return;
    stopPlayback();
    setIsPlaying(true);

    const words = currentQuestion.words;
    const chunks = currentQuestion.chunks && currentQuestion.chunks.length > 0
      ? currentQuestion.chunks
      : splitIntoSmartChunks(currentQuestion.sentenceEn, currentQuestion.translationJa);

    // 1. Chunk RSVP Mode: Play chunk-by-chunk with visual synchronization
    if (displayMode === 'rsvp_chunk') {
      let chunkIdx = 0;
      setActiveChunkIndex(0);

      const playNextChunk = () => {
        if (chunkIdx >= chunks.length) {
          stopPlayback();
          return;
        }

        const currentChunk = chunks[chunkIdx];
        setActiveChunkIndex(chunkIdx);

        if ('speechSynthesis' in window) {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(currentChunk.text);
          utterance.lang = 'en-US';
          const rateMultiplier = Math.max(0.6, Math.min(1.8, targetSpeedWpm / 110));
          utterance.rate = rateMultiplier;

          utterance.onend = () => {
            chunkIdx++;
            if (chunkIdx < chunks.length) {
              // Pause slightly between chunks to allow brain packing
              playbackTimerRef.current = setTimeout(playNextChunk, 250);
            } else {
              stopPlayback();
            }
          };

          utterance.onerror = () => {
            stopPlayback();
          };

          window.speechSynthesis.speak(utterance);
        } else {
          // Fallback if no TTS
          chunkIdx++;
          playbackTimerRef.current = setTimeout(playNextChunk, 1000);
        }
      };

      playNextChunk();
      return;
    }

    // 2. Word RSVP Mode or Slow Stepped Speech (<= 80 WPM)
    if (displayMode === 'rsvp_word' || targetSpeedWpm <= 80) {
      let currentWordIdx = 0;
      setActiveWordIndex(0);

      const speakNextWord = () => {
        if (currentWordIdx >= words.length) {
          stopPlayback();
          return;
        }

        const word = words[currentWordIdx];
        setActiveWordIndex(currentWordIdx);

        if ('speechSynthesis' in window) {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(word);
          utterance.lang = 'en-US';
          utterance.rate = 0.85;
          window.speechSynthesis.speak(utterance);
        }

        currentWordIdx++;
      };

      speakNextWord();
      const intervalMs = Math.round((60 / targetSpeedWpm) * 1000);
      playbackTimerRef.current = setInterval(() => {
        if (currentWordIdx < words.length) {
          speakNextWord();
        } else {
          stopPlayback();
        }
      }, intervalMs);
      return;
    }

    // 3. Standard Continuous Flow (Audio Only / Text Reveal)
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(currentQuestion.sentenceEn);
      utterance.lang = 'en-US';
      const rateMultiplier = Math.max(0.6, Math.min(2.0, targetSpeedWpm / 120));
      utterance.rate = rateMultiplier;

      utterance.onend = () => {
        setIsPlaying(false);
      };

      utterance.onerror = () => {
        setIsPlaying(false);
      };

      window.speechSynthesis.speak(utterance);
    } else {
      setTimeout(() => {
        setIsPlaying(false);
      }, (words.length / (targetSpeedWpm / 60)) * 1000);
    }
  };

  // Adjust WPM by delta (+10 / -10)
  const handleAdjustWpm = (delta: number) => {
    setTargetSpeedWpm((prev) => {
      const next = prev + delta;
      return Math.min(250, Math.max(50, next));
    });
  };

  // Handle User Reflection Submission & AI Diagnosis
  const handleDiagnose = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!currentQuestion || isDiagnosing) return;

    setIsDiagnosing(true);
    stopPlayback();

    try {
      const diag = await diagnoseUserResponse({
        question: currentQuestion,
        userResponse: userResponse.trim() || '（無言または聞き取り不能）',
        speedWpm: targetSpeedWpm,
        wordCount: currentQuestion.wordCount,
        apiKey,
        model: selectedModel,
      });

      setDiagnosisResult(diag);

      // Save Record to persistent storage
      const record: LabQuestionRecord = {
        id: 'rec_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        sessionId: currentSessionId,
        timestamp: new Date().toISOString(),
        dateString: new Date().toLocaleDateString('ja-JP'),
        sentenceEn: currentQuestion.sentenceEn,
        translationJa: currentQuestion.translationJa,
        wordCount: currentQuestion.wordCount,
        speedWpm: targetSpeedWpm,
        cefrLevel,
        userResponse,
        chunks: currentQuestion.chunks,
        diagnosis: diag,
      };

      saveLabRecord(record);
      refreshAnalytics();
    } catch (err) {
      console.error('Diagnosis failed', err);
    } finally {
      setIsDiagnosing(false);
    }
  };

  // Move to Next Question in Batch
  const handleNextQuestion = () => {
    stopPlayback();
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      setUserResponse('');
      setDiagnosisResult(null);
      setActiveWordIndex(-1);
      setActiveChunkIndex(-1);
    } else {
      setIsSessionCompleted(true);
    }
  };

  // Quick chip filler
  const addQuickChip = (text: string) => {
    setUserResponse((prev) => {
      if (!prev) return text;
      return prev + ' / ' + text;
    });
  };

  // Copy records to clipboard
  const handleCopyRecords = () => {
    const json = exportLabRecordsJson();
    navigator.clipboard.writeText(json);
    setCopiedExport(true);
    setTimeout(() => setCopiedExport(false), 2000);
  };

  // Clear all data
  const handleClearData = () => {
    if (window.confirm('実験室の全測定データを消去しますか？')) {
      clearLabRecords();
      refreshAnalytics();
    }
  };

  // Bottleneck styling helper
  const getBottleneckBadge = (type: LabBottleneckType) => {
    switch (type) {
      case 'perfect':
        return { label: '完全理解（自動化完了）', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' };
      case 'memory_overflow':
        return { label: 'ワーキングメモリ（文長）パンク', color: 'bg-red-500/20 text-red-300 border-red-500/40' };
      case 'backward_parsing':
        return { label: '関係詞・前置詞の返り読み癖', color: 'bg-amber-500/20 text-amber-300 border-amber-500/40' };
      case 'phonetic_linking':
        return { label: '音声変化・リンキング脱落', color: 'bg-purple-500/20 text-purple-300 border-purple-500/40' };
      case 'unknown_vocab':
        return { label: '未知語・多義語での思考停止', color: 'bg-blue-500/20 text-blue-300 border-blue-500/40' };
      default:
        return { label: '分析中', color: 'bg-slate-700 text-slate-300 border-slate-600' };
    }
  };

  // Bandwidth matrix headers
  const matrixWpmColumns = [60, 80, 100, 120, 150, 180, 200];

  const getCellColor = (cell?: { avgScore: number; attempts: number }) => {
    if (!cell || cell.attempts === 0) return 'bg-slate-900/50 text-slate-600 border-slate-800';
    if (cell.avgScore >= 90) return 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40 font-bold';
    if (cell.avgScore >= 70) return 'bg-amber-950/80 text-amber-300 border-amber-500/40 font-bold';
    return 'bg-red-950/80 text-red-300 border-red-500/40 font-bold';
  };

  const currentChunks = currentQuestion?.chunks && currentQuestion.chunks.length > 0
    ? currentQuestion.chunks
    : (currentQuestion ? splitIntoSmartChunks(currentQuestion.sentenceEn, currentQuestion.translationJa) : []);

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-16 animate-fadeIn">
      {/* 1. Header Banner */}
      <div className="bg-gradient-to-r from-indigo-950/80 via-slate-900/90 to-purple-950/80 border border-indigo-500/30 rounded-3xl p-6 sm:p-7 shadow-2xl backdrop-blur-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-wrap items-center justify-between gap-4 relative z-10">
          <div className="space-y-1">
            <div className="flex items-center space-x-2.5">
              <div className="p-2.5 bg-indigo-500/20 border border-indigo-500/40 rounded-2xl text-indigo-400 shadow-inner">
                <FlaskConical className="w-6 h-6 animate-pulse" />
              </div>
              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white flex items-center gap-2">
                <span>Listening Lab</span>
                <span className="text-[10px] uppercase px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 font-mono">
                  Beta
                </span>
              </h1>
            </div>
            <p className="text-xs sm:text-sm text-slate-300 max-w-2xl">
              単語数 × 速度（WPM）をコントロールし、<strong>「全文キャッシュ癖（最後まで聞いてから訳す癖）」</strong>を脱却して<strong>「チャンク即時パッキング」</strong>を身体化する実験室。
            </p>
          </div>

          {/* Tab Navigation */}
          <div className="flex items-center p-1 bg-slate-950/80 border border-slate-800 rounded-2xl shadow-inner">
            <button
              type="button"
              onClick={() => setActiveTab('training')}
              className={`flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'training'
                  ? 'bg-gradient-to-r from-indigo-600 to-cyan-600 text-white shadow-lg'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>トレーニング</span>
            </button>
            <button
              type="button"
              onClick={() => {
                refreshAnalytics();
                setActiveTab('analytics');
              }}
              className={`flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'analytics'
                  ? 'bg-gradient-to-r from-indigo-600 to-cyan-600 text-white shadow-lg'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>分析 &amp; キャパシティ行列</span>
            </button>
          </div>
        </div>

        {/* Lab Controls Strip (When in Training Tab) */}
        {activeTab === 'training' && (
          <div className="mt-6 pt-5 border-t border-slate-800/80 grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Control 1: Word Count Selection */}
            <div>
              <label className="block text-[11px] font-bold text-slate-400 mb-1.5 flex items-center gap-1">
                <Layers className="w-3.5 h-3.5 text-indigo-400" />
                <span>文の長さ（単語数）</span>
              </label>
              <div className="grid grid-cols-6 gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                {WORD_COUNT_OPTIONS.map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => setTargetWordCount(count)}
                    className={`py-1.5 text-xs font-bold rounded-lg transition-all ${
                      targetWordCount === count
                        ? 'bg-indigo-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {count}語
                  </button>
                ))}
              </div>
            </div>

            {/* Control 2: 10-step WPM Spinner & Benchmark Guide */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-bold text-slate-400 flex items-center gap-1">
                  <Activity className="w-3.5 h-3.5 text-cyan-400" />
                  <span>再生速度（WPM）</span>
                </label>
                <div className="flex items-center space-x-1">
                  <button
                    type="button"
                    onClick={() => handleAdjustWpm(-10)}
                    disabled={targetSpeedWpm <= 50}
                    className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-200 border border-slate-700 transition-all active:scale-95"
                    title="10 WPM 遅延"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="text-xs font-mono font-black text-cyan-300 min-w-[54px] text-center bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                    {targetSpeedWpm} WPM
                  </span>
                  <button
                    type="button"
                    onClick={() => handleAdjustWpm(10)}
                    disabled={targetSpeedWpm >= 250}
                    className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-200 border border-slate-700 transition-all active:scale-95"
                    title="10 WPM 加速"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Slider & Speed Guide Badge */}
              <div className="space-y-1.5">
                <input
                  type="range"
                  min="50"
                  max="250"
                  step="10"
                  value={targetSpeedWpm}
                  onChange={(e) => setTargetSpeedWpm(Number(e.target.value))}
                  className="w-full accent-cyan-400 h-1.5 bg-slate-950 rounded-lg cursor-pointer"
                />
                <div className={`text-[10px] font-semibold px-2 py-0.5 rounded-lg border text-center transition-all ${speedGuide.color}`}>
                  {speedGuide.label}
                </div>
              </div>
            </div>

            {/* Control 3: Display Mode (Audio Only / Chunk RSVP / Word RSVP / Text Reveal) */}
            <div>
              <label className="block text-[11px] font-bold text-slate-400 mb-1.5 flex items-center gap-1">
                <Headphones className="w-3.5 h-3.5 text-emerald-400" />
                <span>表示・トレーニングモード</span>
              </label>
              <select
                value={displayMode}
                onChange={(e) => setDisplayMode(e.target.value as DisplayMode)}
                className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-xs rounded-xl px-3 py-1.5 font-semibold focus:outline-none focus:border-indigo-500"
              >
                <option value="audio_only">🎧 音声のみ（推奨・耳に全集中）</option>
                <option value="rsvp_chunk">⚡ 1チャンクRSVPフラッシュ（意味の塊でフラッシュ）</option>
                <option value="rsvp_word">🔤 1単語RSVPフラッシュ（1語ずつテンポ良く）</option>
                <option value="text_reveal">📖 全文テキスト表示</option>
              </select>
            </div>

            {/* Action Buttons */}
            <div className="col-span-full flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
              <span className="text-xs text-slate-400 font-medium">
                現在の設定: <strong className="text-indigo-300">{targetWordCount}単語</strong> × <strong className="text-cyan-300">{targetSpeedWpm} WPM</strong>
              </span>

              <button
                type="button"
                onClick={handleGenerateBatch}
                disabled={isGeneratingBatch}
                className="flex items-center space-x-1.5 px-4 py-2 bg-indigo-600/90 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-md"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingBatch ? 'animate-spin' : ''}`} />
                <span>{isGeneratingBatch ? '問題セットを生成中...' : 'この設定で新しい5問を生成'}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 2. Main Content: Training Mode */}
      {activeTab === 'training' && (
        <div className="space-y-6">
          {isGeneratingBatch ? (
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-12 text-center space-y-4 shadow-2xl">
              <RefreshCw className="w-8 h-8 animate-spin text-indigo-400 mx-auto" />
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-white">
                  {targetWordCount}単語 × {targetSpeedWpm} WPM の英文を生成中...
                </h3>
                <p className="text-xs text-slate-400">
                  チャンク分割データとともに、重複のない多彩な生活シーンから5問を作成しています
                </p>
              </div>
            </div>
          ) : isSessionCompleted ? (
            /* Session Completed Screen */
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-8 sm:p-10 text-center space-y-6 shadow-2xl animate-fadeIn">
              <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 rounded-3xl flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/10">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-black text-white">5問セッション完了！</h2>
                <p className="text-sm text-slate-300">
                  【{targetWordCount}単語 × {targetSpeedWpm} WPM】でのリスニング結果がセッション履歴に記録されました。
                </p>
              </div>

              <div className="flex flex-wrap justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleGenerateBatch}
                  className="flex items-center space-x-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl text-sm font-bold shadow-lg shadow-indigo-600/30 transition-all"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>もう一度同じ設定で挑戦</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    refreshAnalytics();
                    setActiveTab('analytics');
                  }}
                  className="flex items-center space-x-2 px-6 py-3 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 rounded-2xl text-sm font-bold transition-all"
                >
                  <BarChart3 className="w-4 h-4 text-cyan-400" />
                  <span>セッション履歴・キャパシティを確認</span>
                </button>
              </div>
            </div>
          ) : currentQuestion ? (
            /* Active Question Card */
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
              {/* Question Progress Header */}
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
                <div className="flex items-center space-x-2">
                  <span className="px-2.5 py-1 bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 rounded-xl text-xs font-mono font-bold">
                    Q{currentIndex + 1} / {questions.length}
                  </span>
                  <span className="text-xs font-medium text-slate-400">
                    単語数: <strong className="text-white">{currentQuestion.wordCount}</strong> 語 / 速度: <strong className="text-cyan-300">{targetSpeedWpm}</strong> WPM
                  </span>
                </div>

                {currentQuestion.keyPoints && (
                  <span className="text-[11px] text-slate-500 font-mono hidden sm:inline-block">
                    構文: {currentQuestion.keyPoints}
                  </span>
                )}
              </div>

              {/* Playback & Visualization Stage */}
              <div className="bg-slate-950/80 border border-slate-850 rounded-2xl p-6 sm:p-10 text-center space-y-6 shadow-inner min-h-[220px] flex flex-col justify-center items-center">
                {displayMode === 'rsvp_chunk' && isPlaying && activeChunkIndex >= 0 ? (
                  /* 1-Chunk RSVP Flash Mode */
                  <div className="space-y-3 animate-in fade-in zoom-in-95 duration-150">
                    <div className="flex items-center justify-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 font-mono text-[11px] font-bold">
                        Chunk {activeChunkIndex + 1} / {currentChunks.length}
                      </span>
                      {currentChunks[activeChunkIndex]?.boundaryReason && (
                        <span className="text-[11px] text-slate-400">
                          📍 {currentChunks[activeChunkIndex].boundaryReason}
                        </span>
                      )}
                    </div>
                    <div className="text-2xl sm:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-white to-indigo-300 font-mono tracking-wide py-2">
                      {currentChunks[activeChunkIndex]?.text}
                    </div>
                    {currentChunks[activeChunkIndex]?.translationJa && (
                      <div className="text-xs sm:text-sm text-indigo-300/80 font-sans">
                        （{currentChunks[activeChunkIndex].translationJa}）
                      </div>
                    )}
                  </div>
                ) : displayMode === 'rsvp_word' && isPlaying && activeWordIndex >= 0 ? (
                  /* 1-Word RSVP Flash Mode */
                  <div className="space-y-2 animate-in fade-in zoom-in-95 duration-100">
                    <span className="text-[10px] font-mono text-cyan-400 uppercase tracking-widest block">
                      Word {activeWordIndex + 1} / {currentQuestion.words.length}
                    </span>
                    <div className="text-3xl sm:text-5xl font-black text-white font-mono tracking-wide">
                      {currentQuestion.words[activeWordIndex]}
                    </div>
                  </div>
                ) : displayMode === 'text_reveal' || diagnosisResult ? (
                  /* Text Reveal Mode (or when diagnosed) */
                  <div className="space-y-2 text-left sm:text-center w-full">
                    <span className="text-[11px] font-bold text-slate-500 block uppercase tracking-wider">
                      出題英文
                    </span>
                    <div className="text-xl sm:text-2xl font-bold text-white font-mono leading-relaxed">
                      {currentQuestion.sentenceEn}
                    </div>
                    <div className="text-xs sm:text-sm text-slate-400 font-sans">
                      訳: {currentQuestion.translationJa}
                    </div>
                  </div>
                ) : (
                  /* Pure Audio Mode (Default) */
                  <div className="space-y-3">
                    <div className="flex items-center justify-center gap-1.5">
                      <div className={`w-2 h-6 bg-cyan-400 rounded-full transition-all ${isPlaying ? 'animate-bounce delay-75 h-10' : 'opacity-40'}`} />
                      <div className={`w-2 h-8 bg-indigo-400 rounded-full transition-all ${isPlaying ? 'animate-bounce delay-150 h-12' : 'opacity-40'}`} />
                      <div className={`w-2 h-10 bg-purple-400 rounded-full transition-all ${isPlaying ? 'animate-bounce delay-300 h-14' : 'opacity-40'}`} />
                      <div className={`w-2 h-8 bg-indigo-400 rounded-full transition-all ${isPlaying ? 'animate-bounce delay-150 h-12' : 'opacity-40'}`} />
                      <div className={`w-2 h-6 bg-cyan-400 rounded-full transition-all ${isPlaying ? 'animate-bounce delay-75 h-10' : 'opacity-40'}`} />
                    </div>
                    <p className="text-xs text-slate-400 font-medium">
                      {isPlaying ? '🎧 音声を聴き取ってください...' : '耳に全集中して「再生」を押してください'}
                    </p>
                  </div>
                )}

                {/* Big Play / Replay Buttons */}
                <div className="flex items-center justify-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={playCurrentQuestion}
                    disabled={isPlaying}
                    className="flex items-center space-x-2 px-6 py-3 bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 disabled:opacity-50 text-white rounded-2xl text-sm font-black shadow-lg shadow-indigo-600/25 transition-all active:scale-95"
                  >
                    <Play className="w-4 h-4 fill-white" />
                    <span>{isPlaying ? '再生中...' : '▶️ 再生！'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={playCurrentQuestion}
                    className="flex items-center space-x-1.5 px-4 py-3 bg-slate-800 hover:bg-slate-750 text-slate-300 rounded-2xl text-xs font-bold border border-slate-700 transition-all"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                    <span>もう一度聴く</span>
                  </button>
                </div>
              </div>

              {/* Free-form User Reflection & Diagnosis Area */}
              {!diagnosisResult ? (
                <form onSubmit={handleDiagnose} className="space-y-4">
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-300 flex items-center justify-between">
                      <span>💭 聴き取れたこと・推測・わからなかった原因を自由に入力:</span>
                      <span className="text-[11px] text-slate-500 font-normal">
                        （例: 医者がなんかしてる / 前半はわかったが後半の理由で消えた）
                      </span>
                    </label>
                    <textarea
                      value={userResponse}
                      onChange={(e) => setUserResponse(e.target.value)}
                      placeholder="例: 「誰かがコーヒーを飲んでいる」「前半の主語はわかったけど最後の単語で止まってパンクした」「速すぎて音が繋がって聞こえた」など、率直な感想でOK！"
                      rows={3}
                      className="w-full bg-slate-950 border-2 border-slate-700 focus:border-indigo-500 rounded-2xl p-4 text-white placeholder-slate-600 text-sm font-medium outline-none transition-all resize-none shadow-inner"
                    />
                  </div>

                  {/* Quick Input Chips */}
                  <div className="space-y-1.5">
                    <div className="text-[11px] text-slate-500 font-semibold">クイック入力補助:</div>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        '全体的になんとなく理解できた',
                        '前半だけ理解できた',
                        '単語は知ってるがスピードで消えた',
                        '知らない単語があって思考停止した',
                        '音が繋がって1つの音に聞こえた',
                        '全く聞き取れなかった（真っ白）',
                      ].map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => addQuickChip(chip)}
                          className="px-2.5 py-1 bg-slate-800/80 hover:bg-slate-750 text-slate-300 hover:text-white rounded-lg text-[11px] font-medium border border-slate-700 transition-all"
                        >
                          + {chip}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Submit Button */}
                  <div className="flex justify-end pt-2">
                    <button
                      type="submit"
                      disabled={isDiagnosing}
                      className="flex items-center space-x-2 px-8 py-3.5 bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 disabled:opacity-50 text-white rounded-2xl text-sm sm:text-base font-extrabold shadow-lg shadow-indigo-600/30 transition-all active:scale-95"
                    >
                      {isDiagnosing ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>AI分析中...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4" />
                          <span>これで診断・レビューする</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              ) : (
                /* AI Diagnosis Result & 案3: Chunk Dissection Screen */
                <div className="space-y-6 pt-2 animate-fadeIn">
                  {/* Score & Bottleneck Hero */}
                  <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 sm:p-7 space-y-5 shadow-2xl">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
                      <div className="flex items-center space-x-3">
                        <div
                          className={`w-14 h-14 rounded-2xl flex items-center justify-center font-black text-xl font-mono border ${
                            diagnosisResult.comprehensionRate >= 90
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                              : diagnosisResult.comprehensionRate >= 60
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                              : 'bg-red-500/20 text-red-300 border-red-500/40'
                          }`}
                        >
                          {diagnosisResult.comprehensionRate}%
                        </div>
                        <div>
                          <div className="text-xs text-slate-400 font-bold uppercase tracking-wider">
                            理解度スコア
                          </div>
                          <div className="text-base sm:text-lg font-black text-white">
                            {diagnosisResult.comprehensionRate >= 90 ? '🌟 素晴らしい知覚・処理速度！' : diagnosisResult.comprehensionRate >= 60 ? '👍 大意は掴めています' : '💡 負荷オーバー（調整推奨）'}
                          </div>
                        </div>
                      </div>

                      {/* Bottleneck Badge */}
                      <div className={`px-3 py-1.5 rounded-xl border text-xs font-bold ${getBottleneckBadge(diagnosisResult.bottleneckType).color}`}>
                        {diagnosisResult.bottleneckLabel}
                      </div>
                    </div>

                    {/* Understood vs Missed Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="bg-emerald-950/30 border border-emerald-500/20 p-3.5 rounded-2xl space-y-1">
                        <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1">
                          <Check className="w-3.5 h-3.5" />
                          <span>聞き取れていた点</span>
                        </span>
                        <p className="text-xs text-slate-200 leading-relaxed">
                          {diagnosisResult.understood}
                        </p>
                      </div>
                      <div className="bg-rose-950/30 border border-rose-500/20 p-3.5 rounded-2xl space-y-1">
                        <span className="text-[11px] font-bold text-rose-400 flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5" />
                          <span>脱落・課題点</span>
                        </span>
                        <p className="text-xs text-slate-200 leading-relaxed">
                          {diagnosisResult.missed}
                        </p>
                      </div>
                    </div>

                    {/* AI Diagnosis Details */}
                    <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-2xl space-y-2">
                      <div className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                        <Brain className="w-4 h-4 text-indigo-400" />
                        <span>脳内処理プロセスの分析:</span>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">
                        {diagnosisResult.diagnosis}
                      </p>
                    </div>

                    {/* Coaching Tip */}
                    <div className="bg-gradient-to-r from-cyan-950/50 to-indigo-950/50 border border-cyan-500/30 p-4 rounded-2xl space-y-1">
                      <div className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                        <Sparkles className="w-4 h-4 text-cyan-400" />
                        <span>即効ワンポイント・コーチング:</span>
                      </div>
                      <p className="text-xs text-slate-200 font-medium">
                        {diagnosisResult.coachingTip}
                      </p>
                    </div>
                  </div>

                  {/* 案3: 常に採用される「チャンク解剖 & 切れ目ガイド」 */}
                  <div className="bg-slate-950 border border-indigo-500/30 rounded-3xl p-6 sm:p-7 space-y-5 shadow-2xl">
                    <div className="flex items-center space-x-2.5 text-white font-bold text-base sm:text-lg border-b border-slate-800 pb-3">
                      <div className="p-1.5 bg-indigo-500/20 border border-indigo-500/40 rounded-xl text-indigo-400">
                        <Scissors className="w-4 h-4" />
                      </div>
                      <span>🧠 チャンク解剖 &amp; 脳内パッキング・ガイド</span>
                      <span className="text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 px-2 py-0.5 rounded-full font-mono font-normal">
                        全文キャッシュ癖の脱却
                      </span>
                    </div>

                    {/* Slash Sentence Display */}
                    <div className="space-y-1.5">
                      <span className="text-[11px] font-bold text-slate-400">
                        スラッシュ（/）の位置で情景を確定し、生の音を捨てていくイメージ:
                      </span>
                      <div className="p-4 bg-slate-900/90 rounded-2xl border border-indigo-500/30 flex flex-wrap items-center gap-2 text-base sm:text-lg font-bold font-mono text-white">
                        {currentChunks.map((c, idx) => (
                          <React.Fragment key={idx}>
                            {idx > 0 && <span className="text-indigo-400 font-extrabold text-xl px-1 select-none">/</span>}
                            <span className="px-2.5 py-1 bg-indigo-950/80 border border-indigo-500/40 rounded-xl text-indigo-200 shadow-sm">
                              {c.text}
                            </span>
                          </React.Fragment>
                        ))}
                      </div>
                    </div>

                    {/* Step-by-Step Chunk Processing Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                      {currentChunks.map((chunk, idx) => (
                        <div
                          key={idx}
                          className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl space-y-2 hover:border-indigo-500/50 transition-all flex flex-col justify-between shadow"
                        >
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 font-mono font-bold">
                                Step {idx + 1}
                              </span>
                              <span className="text-[10px] text-slate-400 font-medium">
                                📍 {chunk.boundaryReason}
                              </span>
                            </div>

                            <div className="font-mono font-bold text-white text-sm sm:text-base leading-snug">
                              {chunk.text}
                            </div>

                            <div className="text-xs text-indigo-300/90 font-medium border-t border-slate-800 pt-1.5">
                              訳: {chunk.translationJa}
                            </div>
                          </div>

                          <div className="text-[11px] text-slate-400 bg-slate-950 p-2 rounded-xl border border-slate-850 mt-2">
                            {idx === 0
                              ? '💡 ここで「誰がどうしたか」の映像を脳内に確定させ、音のメモリを破棄！'
                              : idx === currentChunks.length - 1
                              ? '💡 追加情報（時・場所等）を前の情景に付け足して文が完成！'
                              : '💡 前の情景にこの追加情報をアタッチして次の音に備える！'}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Mindset Coach Takeaway */}
                    <div className="bg-slate-900/60 border border-slate-800/80 p-3.5 rounded-2xl text-xs text-slate-300 space-y-1">
                      <strong className="text-amber-300 flex items-center gap-1 font-bold">
                        <span>💡 脳内キャッシュをパンクさせない黄金ルール:</span>
                      </strong>
                      <p className="leading-relaxed text-[11px] text-slate-300">
                        英語は文末を待たずに、<strong>前置詞・to不定詞・接続詞</strong>の手前で情景を確定させて「音」を脳から消去（ガベージコレクション）していくのがネイティブの処理方法です。
                      </p>
                    </div>
                  </div>

                  {/* Next Question Navigation */}
                  <div className="flex justify-end pt-2">
                    <button
                      type="button"
                      onClick={handleNextQuestion}
                      className="flex items-center space-x-2 px-8 py-3.5 bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white rounded-2xl text-sm sm:text-base font-extrabold shadow-lg shadow-indigo-600/30 transition-all active:scale-95"
                    >
                      <span>{currentIndex < questions.length - 1 ? '次の問題へ' : 'セッション結果を見る'}</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* 3. Analytics & Bandwidth Matrix Tab */}
      {activeTab === 'analytics' && (
        <div className="space-y-6 animate-fadeIn">
          {/* Top KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xl space-y-1">
              <span className="text-[11px] font-bold text-slate-400">総測定問数</span>
              <div className="text-2xl sm:text-3xl font-black text-white font-mono">
                {analytics.totalQuestions}
                <span className="text-xs font-normal text-slate-400 ml-1">問</span>
              </div>
            </div>

            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xl space-y-1">
              <span className="text-[11px] font-bold text-slate-400">総セッション数</span>
              <div className="text-2xl sm:text-3xl font-black text-indigo-400 font-mono">
                {analytics.totalSessions}
                <span className="text-xs font-normal text-slate-400 ml-1">回</span>
              </div>
            </div>

            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xl space-y-1">
              <span className="text-[11px] font-bold text-slate-400">平均理解度</span>
              <div className="text-2xl sm:text-3xl font-black text-cyan-300 font-mono">
                {analytics.avgComprehension}%
              </div>
            </div>

            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xl space-y-1">
              <span className="text-[11px] font-bold text-slate-400">完全自動化 (90%+)</span>
              <div className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono">
                {analytics.bottleneckCounts.perfect}
                <span className="text-xs font-normal text-slate-400 ml-1">問</span>
              </div>
            </div>
          </div>

          {/* Bandwidth Capacity Matrix Table */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2.5">
                <BarChart3 className="w-5 h-5 text-indigo-400" />
                <h3 className="font-bold text-white text-base sm:text-lg">
                  リスニング・キャパシティ行列（単語数 × 速度）
                </h3>
              </div>
              <span className="text-xs text-slate-400 font-mono hidden sm:inline-block">
                セル値: 平均理解度 (測定回数)
              </span>
            </div>

            {/* Scrollable Matrix Grid */}
            <div className="overflow-x-auto pb-2">
              <table className="w-full text-center text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="p-2.5 text-left font-bold text-slate-400">単語数 ＼ WPM</th>
                    {matrixWpmColumns.map((wpm) => (
                      <th key={wpm} className="p-2 font-mono font-bold text-slate-300">
                        {wpm} WPM
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {WORD_COUNT_OPTIONS.map((wc) => (
                    <tr key={wc}>
                      <td className="p-2.5 text-left font-bold text-slate-200 whitespace-nowrap">
                        {wc} 単語
                      </td>
                      {matrixWpmColumns.map((wpm) => {
                        const cell = analytics.matrix[wc]?.[wpm];
                        const cellClass = getCellColor(cell);
                        return (
                          <td key={wpm} className="p-1.5">
                            <div className={`p-2.5 rounded-xl border text-center transition-all ${cellClass}`}>
                              {cell && cell.attempts > 0 ? (
                                <>
                                  <div className="text-sm font-extrabold font-mono">{cell.avgScore}%</div>
                                  <div className="text-[10px] opacity-70">({cell.attempts}問)</div>
                                </>
                              ) : (
                                <span className="text-slate-600 font-mono text-[11px]">-</span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Matrix Legend */}
            <div className="flex flex-wrap items-center gap-3 pt-2 text-xs border-t border-slate-800/80 text-slate-400">
              <span className="font-semibold text-slate-300">凡例:</span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-emerald-500/80 inline-block" />
                <span>90-100%: 快適処理ゾーン（自動化完了）</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-amber-500/80 inline-block" />
                <span>70-89%: 成長フロンティア（最適負荷）</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-red-500/80 inline-block" />
                <span>&lt;70%: キャッシュパンク限界（要改善）</span>
              </span>
            </div>
          </div>

          {/* Session History & Accuracy Trend */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-4">
            <div className="flex items-center space-x-2.5 text-white font-bold text-lg border-b border-slate-800 pb-3">
              <TrendingUp className="w-5 h-5 text-emerald-400" />
              <span>セッション別 正答率・成績推移</span>
            </div>

            {analytics.sessionHistory.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">
                セッション履歴はまだありません。「トレーニング」タブで問題を解くとセッション単位で自動記録されます。
              </p>
            ) : (
              <div className="space-y-3">
                {analytics.sessionHistory.map((sess, idx) => {
                  const isExpanded = expandedSessionId === sess.sessionId;
                  return (
                    <div
                      key={sess.sessionId}
                      className="bg-slate-950 border border-slate-850 rounded-2xl p-4 space-y-3 transition-all"
                    >
                      {/* Session Header Bar */}
                      <div
                        onClick={() => setExpandedSessionId(isExpanded ? null : sess.sessionId)}
                        className="flex flex-wrap items-center justify-between gap-3 cursor-pointer select-none"
                      >
                        <div className="flex items-center space-x-2.5">
                          <div
                            className={`p-2 rounded-xl text-xs font-black border ${
                              sess.averageScore >= 90
                                ? 'bg-emerald-950/80 text-emerald-400 border-emerald-500/40'
                                : sess.averageScore >= 70
                                ? 'bg-amber-950/80 text-amber-400 border-amber-500/40'
                                : 'bg-red-950/80 text-red-400 border-red-500/40'
                            }`}
                          >
                            {sess.averageScore}%
                          </div>
                          <div>
                            <div className="text-xs font-bold text-white flex items-center gap-1.5">
                              <span>セッション #{analytics.sessionHistory.length - idx}</span>
                              <span className="text-slate-400 font-normal">({sess.dateString})</span>
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono">
                              【{sess.wordCount}単語 × {sess.speedWpm} WPM】 • {sess.totalQuestions}問中 {sess.perfectCount}問パーフェクト
                            </div>
                          </div>
                        </div>

                        {/* Question Mini-Score Pills */}
                        <div className="flex items-center space-x-1.5">
                          {sess.records.map((r, qIdx) => (
                            <span
                              key={r.id}
                              className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border ${
                                r.diagnosis.comprehensionRate >= 90
                                  ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40'
                                  : r.diagnosis.comprehensionRate >= 70
                                  ? 'bg-amber-950/80 text-amber-300 border-amber-500/40'
                                  : 'bg-red-950/80 text-red-300 border-red-500/40'
                              }`}
                              title={`第${qIdx + 1}問: ${r.diagnosis.comprehensionRate}%`}
                            >
                              Q{qIdx + 1}: {r.diagnosis.comprehensionRate}%
                            </span>
                          ))}
                          <div className="text-slate-500 pl-1">
                            {isExpanded ? <ChevronDown className="w-4 h-4 text-indigo-400" /> : <ChevronRight className="w-4 h-4" />}
                          </div>
                        </div>
                      </div>

                      {/* Expanded Question Details in this Session */}
                      {isExpanded && (
                        <div className="pt-3 border-t border-slate-850 space-y-2 text-xs">
                          {sess.records.map((rec, rIdx) => {
                            const recChunks = rec.chunks && rec.chunks.length > 0
                              ? rec.chunks
                              : splitIntoSmartChunks(rec.sentenceEn, rec.translationJa);
                            return (
                              <div key={rec.id} className="bg-slate-900/70 border border-slate-800 p-3.5 rounded-xl space-y-2">
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="font-bold text-indigo-300">第 {rIdx + 1} 問:</span>
                                  <div className="flex items-center space-x-2">
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getBottleneckBadge(rec.diagnosis.bottleneckType).color}`}>
                                      {rec.diagnosis.bottleneckLabel}
                                    </span>
                                    <span className="font-mono font-bold text-cyan-400">理解度: {rec.diagnosis.comprehensionRate}%</span>
                                  </div>
                                </div>
                                <div className="font-mono text-white font-bold">{rec.sentenceEn}</div>
                                <div className="text-slate-400 text-[11px]">訳: {rec.translationJa}</div>

                                {/* Chunks preview in record */}
                                <div className="flex flex-wrap gap-1.5 pt-1">
                                  {recChunks.map((rc, rcIdx) => (
                                    <span key={rcIdx} className="px-2 py-0.5 rounded-lg bg-indigo-950/60 border border-indigo-500/30 text-[10px] text-indigo-200 font-mono">
                                      {rc.text}
                                    </span>
                                  ))}
                                </div>

                                {rec.userResponse && (
                                  <div className="text-slate-300 text-[11px] bg-slate-950 p-2 rounded-lg border border-slate-800">
                                    <span className="text-indigo-400 font-semibold mr-1">回答メモ:</span>
                                    {rec.userResponse}
                                  </div>
                                )}
                                <div className="text-slate-400 text-[11px] italic bg-slate-950/60 p-2 rounded-lg">
                                  <span className="text-cyan-400 font-semibold mr-1">AI診断:</span>
                                  {rec.diagnosis.diagnosis}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Export & Data Management Strip */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-800/80">
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={handleCopyRecords}
                className="flex items-center space-x-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-750 text-slate-200 rounded-xl text-xs font-bold border border-slate-700 transition-all"
              >
                <Download className="w-3.5 h-3.5 text-indigo-400" />
                <span>{copiedExport ? 'JSONコピー完了！' : '測定ログをJSONコピー'}</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleClearData}
              className="flex items-center space-x-1.5 px-3.5 py-2 bg-red-950/40 hover:bg-red-900/60 text-red-300 border border-red-500/30 rounded-xl text-xs font-bold transition-all"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>全測定履歴をリセット</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
