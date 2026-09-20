import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  BarChart3
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
  exportLabRecordsJson
} from '../services/listeningLabService';

interface ListeningLabViewProps {
  apiKey: string;
  selectedModel?: string;
  userLevel?: CefrLevel;
}

const WORD_COUNT_OPTIONS = [4, 6, 8, 12, 16, 20] as const;
const SPEED_WPM_OPTIONS = [
  { wpm: 60, label: '60 WPM (1秒/語・超じっくり)' },
  { wpm: 100, label: '100 WPM (ゆったり基礎)' },
  { wpm: 140, label: '140 WPM (標準日常会話)' },
  { wpm: 180, label: '180 WPM (ネイティブ実速)' },
  { wpm: 220, label: '220 WPM (高速ポッドキャスト)' },
] as const;

type ActiveTab = 'training' | 'analytics';
type DisplayMode = 'audio_only' | 'rsvp_flash' | 'text_reveal';

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
  const [cefrLevel, setCefrLevel] = useState<CefrLevel>(userLevel);

  // Batch Session State
  const [questions, setQuestions] = useState<LabQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isGeneratingBatch, setIsGeneratingBatch] = useState<boolean>(false);

  // Playback & RSVP Flash State
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [activeWordIndex, setActiveWordIndex] = useState<number>(-1);
  const playbackTimerRef = useRef<any>(null);

  // User Input & AI Diagnosis State
  const [userResponse, setUserResponse] = useState<string>('');
  const [isDiagnosing, setIsDiagnosing] = useState<boolean>(false);
  const [diagnosisResult, setDiagnosisResult] = useState<LabDiagnosisResult | null>(null);
  const [isSessionCompleted, setIsSessionCompleted] = useState<boolean>(false);

  // Analytics State
  const [analytics, setAnalytics] = useState<LabAnalyticsSummary>(() => calculateLabAnalytics());
  const [copiedExport, setCopiedExport] = useState<boolean>(false);

  const currentQuestion = questions[currentIndex] || null;

  // Refresh analytics
  const refreshAnalytics = useCallback(() => {
    setAnalytics(calculateLabAnalytics());
  }, []);

  // Generate a batch of 5 questions
  const handleGenerateBatch = useCallback(async () => {
    if (isGeneratingBatch) return;
    setIsGeneratingBatch(true);
    setCurrentIndex(0);
    setUserResponse('');
    setDiagnosisResult(null);
    setIsSessionCompleted(false);
    setActiveWordIndex(-1);

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
      clearInterval(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsPlaying(false);
    setActiveWordIndex(-1);
  };

  useEffect(() => {
    return () => {
      stopPlayback();
    };
  }, []);

  // Step-by-step Audio Playback Engine
  const playCurrentQuestion = () => {
    if (!currentQuestion) return;
    stopPlayback();
    setIsPlaying(true);

    const words = currentQuestion.words;
    const intervalMs = Math.round((60 / targetSpeedWpm) * 1000);

    if (targetSpeedWpm <= 80) {
      // 60 WPM: 1語ずつ1秒おきに区切って明瞭に発音
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
      playbackTimerRef.current = setInterval(speakNextWord, intervalMs);
    } else {
      // 100+ WPM: フレーズ全体を指定WPMレート（0.9〜1.4x）で流しつつ、単語ハイライトを同期
      const mappedRate = Math.min(1.8, Math.max(0.7, targetSpeedWpm / 150));

      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(currentQuestion.sentenceEn);
        utterance.lang = 'en-US';
        utterance.rate = mappedRate;

        utterance.onend = () => {
          stopPlayback();
        };

        utterance.onerror = () => {
          stopPlayback();
        };

        let currentWordIdx = 0;
        setActiveWordIndex(0);
        playbackTimerRef.current = setInterval(() => {
          currentWordIdx++;
          if (currentWordIdx < words.length) {
            setActiveWordIndex(currentWordIdx);
          }
        }, intervalMs);

        window.speechSynthesis.speak(utterance);
      }
    }
  };

  // Submit Free Response for AI Diagnosis
  const handleDiagnose = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!currentQuestion || isDiagnosing) return;

    setIsDiagnosing(true);
    stopPlayback();

    try {
      const diag = await diagnoseUserResponse({
        question: currentQuestion,
        userResponse: userResponse.trim(),
        speedWpm: targetSpeedWpm,
        wordCount: targetWordCount,
        apiKey,
        model: selectedModel,
      });

      setDiagnosisResult(diag);

      // Record to LocalStorage
      const record: LabQuestionRecord = {
        id: 'rec_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        timestamp: new Date().toISOString(),
        dateString: new Date().toLocaleDateString('ja-JP'),
        sentenceEn: currentQuestion.sentenceEn,
        translationJa: currentQuestion.translationJa,
        wordCount: targetWordCount,
        speedWpm: targetSpeedWpm,
        cefrLevel,
        userResponse: userResponse.trim(),
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

  // Next Question
  const handleNextQuestion = () => {
    stopPlayback();
    setUserResponse('');
    setDiagnosisResult(null);
    setActiveWordIndex(-1);

    if (currentIndex + 1 < questions.length) {
      setCurrentIndex(prev => prev + 1);
    } else {
      setIsSessionCompleted(true);
    }
  };

  // Quick chip click helper
  const addQuickChip = (text: string) => {
    setUserResponse(prev => (prev ? `${prev} / ${text}` : text));
  };

  // Matrix cell color helper
  const getCellColor = (cell?: { avgScore: number; attempts: number }) => {
    if (!cell || cell.attempts === 0) return 'bg-slate-950 text-slate-600 border-slate-800/80';
    if (cell.avgScore >= 90) return 'bg-emerald-950/80 text-emerald-300 border-emerald-500/50 shadow-sm shadow-emerald-500/10 font-bold';
    if (cell.avgScore >= 70) return 'bg-amber-950/80 text-amber-300 border-amber-500/40 font-semibold';
    return 'bg-red-950/80 text-red-300 border-red-500/40 font-semibold';
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-24 px-3 sm:px-4 animate-fadeIn">
      {/* 1. Header & Tab Navigation */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-gradient-to-tr from-cyan-500 to-indigo-600 rounded-2xl shadow-lg shadow-indigo-500/20 text-white">
              <FlaskConical className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                  リスニング限界突破ラボ
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                  実験室
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-400 font-medium">
                1語ストリーミング再生 × 自然言語振り返りで、脳内キャッシュのパンク原因を特定する
              </p>
            </div>
          </div>

          {/* Sub-navigation Tabs */}
          <div className="flex items-center space-x-1.5 bg-slate-950 p-1.5 rounded-2xl border border-slate-800 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setActiveTab('training')}
              className={`flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'training'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>🧪 トレーニング</span>
            </button>
            <button
              type="button"
              onClick={() => {
                refreshAnalytics();
                setActiveTab('analytics');
              }}
              className={`flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'analytics'
                  ? 'bg-cyan-600 text-white shadow-md shadow-cyan-600/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>📊 限界値マトリクス ({analytics.totalQuestions})</span>
            </button>
          </div>
        </div>

        {/* Training Parameters Drawer (only in training tab) */}
        {activeTab === 'training' && (
          <div className="pt-4 border-t border-slate-800 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              {/* CEFR Level */}
              <div>
                <label className="block text-[11px] font-bold text-slate-400 mb-1.5 flex items-center gap-1">
                  <span>難易度 (CEFR)</span>
                </label>
                <div className="flex flex-wrap gap-1">
                  {(['A1', 'A2', 'B1', 'B2', 'C1'] as CefrLevel[]).map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => setCefrLevel(lvl)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                        cefrLevel === lvl
                          ? 'bg-cyan-600 text-white shadow-sm'
                          : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                      }`}
                    >
                      {lvl}
                    </button>
                  ))}
                </div>
              </div>
              {/* Word Count */}
              <div>
                <label className="block text-[11px] font-bold text-slate-400 mb-1.5 flex items-center gap-1">
                  <Layers className="w-3.5 h-3.5 text-indigo-400" />
                  <span>単語数 (文の長さ)</span>
                </label>
                <div className="flex flex-wrap gap-1">
                  {WORD_COUNT_OPTIONS.map((wc) => (
                    <button
                      key={wc}
                      type="button"
                      onClick={() => setTargetWordCount(wc)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                        targetWordCount === wc
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                      }`}
                    >
                      {wc}語
                    </button>
                  ))}
                </div>
              </div>

              {/* Speed WPM */}
              <div>
                <label className="block text-[11px] font-bold text-slate-400 mb-1.5 flex items-center gap-1">
                  <Activity className="w-3.5 h-3.5 text-cyan-400" />
                  <span>再生速度 (テンポ)</span>
                </label>
                <select
                  value={targetSpeedWpm}
                  onChange={(e) => setTargetSpeedWpm(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-xs rounded-xl px-3 py-1.5 font-semibold focus:outline-none focus:border-indigo-500"
                >
                  {SPEED_WPM_OPTIONS.map((opt) => (
                    <option key={opt.wpm} value={opt.wpm}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Display Mode */}
              <div>
                <label className="block text-[11px] font-bold text-slate-400 mb-1.5 flex items-center gap-1">
                  <Headphones className="w-3.5 h-3.5 text-emerald-400" />
                  <span>表示モード</span>
                </label>
                <select
                  value={displayMode}
                  onChange={(e) => setDisplayMode(e.target.value as DisplayMode)}
                  className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-xs rounded-xl px-3 py-1.5 font-semibold focus:outline-none focus:border-indigo-500"
                >
                  <option value="audio_only">🎧 音声のみ（耳に集中・推奨）</option>
                  <option value="rsvp_flash">⚡ 1語RSVPフラッシュ（視覚補助）</option>
                  <option value="text_reveal">📖 テキスト表示（答え合わせ）</option>
                </select>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
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
                  自然な口語スクリプト5問を作成しています
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
                  【{targetWordCount}単語 × {targetSpeedWpm} WPM】でのリスニング結果がマトリクスに記録されました。
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
                  <span>限界値マトリクスを確認</span>
                </button>
              </div>
            </div>
          ) : currentQuestion ? (
            /* Active Question Card */
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
              {/* Question Progress Header */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center space-x-2">
                  <span className="px-2.5 py-0.5 rounded-lg bg-indigo-950/80 text-indigo-300 text-xs font-bold border border-indigo-500/30">
                    第 {currentIndex + 1} / {questions.length} 問
                  </span>
                  <span className="text-xs text-slate-400 font-medium">
                    {currentQuestion.wordCount} 語
                  </span>
                </div>
                <span className="text-xs text-cyan-400 font-mono font-bold bg-cyan-950/50 border border-cyan-500/30 px-2.5 py-0.5 rounded-full">
                  {targetSpeedWpm} WPM
                </span>
              </div>

              {/* Streaming Audio Visualizer & RSVP Area */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-6 sm:p-8 text-center space-y-4 min-h-[160px] flex flex-col items-center justify-center relative overflow-hidden">
                {/* Visual Mode: RSVP Flash */}
                {displayMode === 'rsvp_flash' ? (
                  <div className="space-y-2">
                    <span className="text-[11px] font-bold text-slate-500 block uppercase tracking-wider">
                      1語フラッシュ
                    </span>
                    <div className="text-3xl sm:text-4xl font-extrabold text-white font-mono min-h-[50px] flex items-center justify-center">
                      {isPlaying && activeWordIndex >= 0 && activeWordIndex < currentQuestion.words.length ? (
                        <span className="text-cyan-400 scale-110 transition-transform duration-150 inline-block drop-shadow-[0_0_12px_rgba(34,211,238,0.4)]">
                          {currentQuestion.words[activeWordIndex]}
                        </span>
                      ) : isPlaying ? (
                        <span className="text-slate-500 text-lg animate-pulse">ストリーミング中...</span>
                      ) : (
                        <span className="text-slate-500 text-lg font-normal">「再生」を押すと1語ずつフラッシュします</span>
                      )}
                    </div>
                  </div>
                ) : displayMode === 'text_reveal' || diagnosisResult ? (
                  /* Text Reveal Mode (or when diagnosed) */
                  <div className="space-y-2">
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
                          <span>AIが脱落原因を診断中...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4 text-amber-300" />
                          <span>AIで原因を診断する</span>
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  </div>
                </form>
              ) : (
                /* Diagnosis Result Feedback Card */
                <div className="bg-slate-950/90 border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4 animate-fadeIn">
                  <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
                    <div className="flex items-center space-x-3">
                      <div
                        className={`text-xl sm:text-2xl font-black px-3 py-1 rounded-xl border ${
                          diagnosisResult.comprehensionRate >= 90
                            ? 'bg-emerald-950/80 text-emerald-400 border-emerald-500/40'
                            : diagnosisResult.comprehensionRate >= 60
                            ? 'bg-amber-950/80 text-amber-400 border-amber-500/40'
                            : 'bg-red-950/80 text-red-400 border-red-500/40'
                        }`}
                      >
                        {diagnosisResult.comprehensionRate}% 理解
                      </div>
                      <div>
                        <div className="text-xs text-slate-400 font-semibold">パンク・脱落原因分類:</div>
                        <span className="text-xs sm:text-sm font-bold text-cyan-300">
                          🏷️ {diagnosisResult.bottleneckLabel}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Breakdown OK and Missed */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="bg-emerald-950/20 border border-emerald-500/30 rounded-xl p-3.5 space-y-1">
                      <div className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>聞き取れていた部分 (OK)</span>
                      </div>
                      <p className="text-xs text-slate-200 leading-relaxed">
                        {diagnosisResult.understood}
                      </p>
                    </div>

                    <div className="bg-red-950/20 border border-red-500/30 rounded-xl p-3.5 space-y-1">
                      <div className="text-xs font-bold text-red-400 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>脱落・聞き取れなかった部分 (NG)</span>
                      </div>
                      <p className="text-xs text-slate-200 leading-relaxed">
                        {diagnosisResult.missed}
                      </p>
                    </div>
                  </div>

                  {/* Deep AI Diagnosis & Coaching Tip */}
                  <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-2">
                    <div className="text-xs font-bold text-indigo-300 flex items-center gap-1">
                      <Brain className="w-4 h-4" />
                      <span>脳内メカニズム分析:</span>
                    </div>
                    <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                      {diagnosisResult.diagnosis}
                    </p>
                    <div className="pt-2 border-t border-slate-800/80 text-xs text-cyan-300 flex items-start gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span><strong>アドバイス:</strong> {diagnosisResult.coachingTip}</span>
                    </div>
                  </div>

                  {/* Next Question Action */}
                  <div className="flex justify-end pt-2">
                    <button
                      type="button"
                      onClick={handleNextQuestion}
                      className="flex items-center space-x-2 px-8 py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl text-sm sm:text-base font-extrabold shadow-lg shadow-indigo-600/30 transition-all active:scale-95"
                    >
                      <span>
                        {currentIndex + 1 < questions.length ? '次の問題へ (Enter)' : 'セッションを完了する'}
                      </span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* 3. Analytics & Comprehension Matrix Tab */}
      {activeTab === 'analytics' && (
        <div className="space-y-6 animate-fadeIn">
          {/* Summary Stats Overview */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2.5 text-white font-bold text-lg">
                <BarChart3 className="w-5 h-5 text-cyan-400" />
                <span>「単語数 × 速度」リスニング限界値マトリクス</span>
              </div>
              <span className="text-xs font-semibold text-slate-300 bg-slate-800 border border-slate-700 px-2.5 py-0.5 rounded-full">
                総測定数: {analytics.totalQuestions} 問
              </span>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              あなたの脳内ワーキングメモリが<strong>「何単語までならどの速度（WPM）でキャッシュパンクせずに理解できるか」</strong>をヒートマップで可視化しています。
            </p>

            {/* Matrix Heatmap Table */}
            <div className="overflow-x-auto pt-2">
              <table className="w-full text-center border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-bold">
                    <th className="p-2.5 text-left">単語数 (長さ)</th>
                    <th className="p-2.5">60 WPM<br /><span className="text-[10px] font-normal text-slate-500">(1秒/語)</span></th>
                    <th className="p-2.5">100 WPM<br /><span className="text-[10px] font-normal text-slate-500">(ゆったり)</span></th>
                    <th className="p-2.5">140 WPM<br /><span className="text-[10px] font-normal text-slate-500">(標準会話)</span></th>
                    <th className="p-2.5">180 WPM<br /><span className="text-[10px] font-normal text-slate-500">(実速度)</span></th>
                    <th className="p-2.5">220 WPM<br /><span className="text-[10px] font-normal text-slate-500">(高速)</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {WORD_COUNT_OPTIONS.map((wc) => (
                    <tr key={wc}>
                      <td className="p-2.5 text-left font-bold text-slate-200">
                        {wc} 単語
                      </td>
                      {[60, 100, 140, 180, 220].map((wpm) => {
                        const cell = analytics.matrix[wc]?.[wpm];
                        const cellClass = getCellColor(cell);
                        return (
                          <td key={wpm} className="p-1.5">
                            <div className={`p-2.5 rounded-xl border text-center transition-all ${cellClass}`}>
                              {cell && cell.attempts > 0 ? (
                                <>
                                  <div className="text-sm font-extrabold font-mono">{cell.avgScore}%</div>
                                  <div className="text-[10px] opacity-70">({cell.attempts}回)</div>
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

          {/* Bottleneck Cause Breakdown */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-4">
            <div className="flex items-center space-x-2.5 text-white font-bold text-lg border-b border-slate-800 pb-3">
              <Brain className="w-5 h-5 text-indigo-400" />
              <span>弱点・パンク原因の内訳</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { type: 'memory_overflow', label: 'ワーキングメモリ（文長）オーバーフロー', color: 'bg-red-500' },
                { type: 'backward_parsing', label: '関係詞・前置詞での返り読み癖', color: 'bg-amber-500' },
                { type: 'phonetic_linking', label: '音声変化・リンキング・弱形脱落', color: 'bg-purple-500' },
                { type: 'unknown_vocab', label: '未知語・多義語での思考停止', color: 'bg-blue-500' },
                { type: 'perfect', label: 'パーフェクト理解', color: 'bg-emerald-500' },
              ].map((item) => {
                const count = analytics.bottleneckCounts[item.type as LabBottleneckType] || 0;
                const pct = analytics.totalQuestions > 0 ? Math.round((count / analytics.totalQuestions) * 100) : 0;
                return (
                  <div key={item.type} className="bg-slate-950/80 border border-slate-800 p-3.5 rounded-xl space-y-1.5">
                    <div className="flex justify-between text-xs font-semibold">
                      <span className="text-slate-300">{item.label}</span>
                      <span className="text-slate-400 font-mono">{count}件 ({pct}%)</span>
                    </div>
                    <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                      <div className={`h-full ${item.color}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recent Records & Export Bar */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <span className="text-white font-bold text-lg">測定履歴 & データ管理</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const json = exportLabRecordsJson();
                    navigator.clipboard.writeText(json);
                    setCopiedExport(true);
                    setTimeout(() => setCopiedExport(false), 2000);
                  }}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold transition-all"
                >
                  {copiedExport ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Download className="w-3.5 h-3.5 text-indigo-400" />}
                  <span>{copiedExport ? 'JSONコピー完了！' : 'JSON出力'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm('リスニングラボの全測定履歴を消去しますか？')) {
                      clearLabRecords();
                      refreshAnalytics();
                    }
                  }}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-850 hover:bg-red-950/60 text-slate-400 hover:text-red-300 border border-slate-800 rounded-xl text-xs font-bold transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>履歴消去</span>
                </button>
              </div>
            </div>

            {analytics.recentRecords.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">
                測定データはまだありません。「トレーニング」タブで問題を解くと自動で集計されます。
              </p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto font-sans text-xs">
                {analytics.recentRecords.map((rec) => (
                  <div key={rec.id} className="bg-slate-950 border border-slate-850 p-3 rounded-xl space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span className="font-bold text-slate-300">
                        {rec.wordCount}語 × {rec.speedWpm} WPM
                      </span>
                      <span className="font-mono font-bold text-cyan-400">
                        理解度: {rec.diagnosis.comprehensionRate}%
                      </span>
                    </div>
                    <div className="text-slate-200 font-mono font-bold">
                      {rec.sentenceEn}
                    </div>
                    {rec.userResponse && (
                      <div className="text-slate-400 text-[11px] bg-slate-900/60 p-2 rounded-lg border border-slate-850">
                        <span className="text-indigo-400 font-semibold mr-1">回答メモ:</span>
                        {rec.userResponse}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
