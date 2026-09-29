import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Headphones,
  Play,
  Sparkles,
  CheckCircle2,
  BarChart3,
  Minus,
  Plus,
  Volume2,
  BookmarkPlus,
  RefreshCw,
  Eye,
  EyeOff,
  RotateCcw,
  HelpCircle,
  TrendingUp,
  Mic,
  ChevronLeft,
  List,
  X,
} from 'lucide-react';
import { CefrLevel } from '../types/settings';
import { enqueueMasteryScanTask } from '../services/cefrScanner';
import { LabQuestion, LabAnalyticsSummary } from '../types/listeningLab';
import { VocabItem } from '../types/vocab';
import {
  generateLabBatch,
  saveLabQuestionRecord,
  calculateLabAnalytics,
  calculateListeningPower,
} from '../services/listeningLabService';
import {
  loadVocabs,
  saveListeningCard,
  saveSentenceCardWithSiblings,
  enqueueBgVocabItem,
  recordAnkiSpeechPractice,
} from '../services/storage';
import { speakText, stopSpeech } from '../utils/speech';
import confetti from 'canvas-confetti';

interface ListeningLabViewProps {
  apiKey: string;
  selectedModel?: string;
  userLevel?: CefrLevel;
  onListeningCardSaved?: () => void;
}

type LabMode = 'ai_generator' | 'anki_speech';

const WORD_COUNT_PRESETS = [4, 6, 8, 10, 12, 14, 16, 20] as const;
const CEFR_LEVELS: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1'];
const SPEED_RATES = [
  { label: '0.8x', value: 0.8 },
  { label: '0.9x', value: 0.9 },
  { label: '1.0x', value: 1.0 },
  { label: '1.1x', value: 1.1 },
  { label: '1.2x', value: 1.2 },
];

const SPEECH_PRACTICE_RATES = [
  { label: '0.8x', value: 0.8 },
  { label: '0.9x', value: 0.9 },
  { label: '1.0x', value: 1.0 },
  { label: '1.15x', value: 1.15 },
  { label: '1.25x', value: 1.25 },
];

function highlightMarkedTokensInSentence(sentence: string, markedTokens?: string[]) {
  if (!markedTokens || markedTokens.length === 0) {
    return <span>{sentence}</span>;
  }
  const cleanTokens = markedTokens.map(t => t.trim().toLowerCase()).filter(Boolean);
  const words = sentence.split(/(\s+)/);
  return (
    <span>
      {words.map((w, i) => {
        const cleanW = w.toLowerCase().replace(/[^a-z0-9']/g, '');
        const isMarked = cleanTokens.some(ct => cleanW === ct || ct.split(/\s+/).includes(cleanW));
        if (isMarked) {
          return (
            <span key={i} className="bg-rose-500/30 text-rose-200 border-b-2 border-rose-400 px-1 py-0.5 rounded font-bold">
              {w}
            </span>
          );
        }
        return <span key={i}>{w}</span>;
      })}
    </span>
  );
}

export const ListeningLabView: React.FC<ListeningLabViewProps> = ({
  apiKey,
  selectedModel = 'gemini-2.0-flash',
  userLevel = 'A2',
  onListeningCardSaved,
}) => {
  // Mode State: 'ai_generator' (AI新規文特訓) | 'anki_speech' (Ankiカード無限発話特訓)
  const [activeMode, setActiveMode] = useState<LabMode>('ai_generator');

  // ==========================================
  // 1. AI新規文特訓 State
  // ==========================================
  const [targetWordCount, setTargetWordCount] = useState<number>(10);
  const [targetSpeedRate, setTargetSpeedRate] = useState<number>(1.0);
  const [targetCefrLevel, setTargetCefrLevel] = useState<CefrLevel>(userLevel);

  const [questions, setQuestions] = useState<LabQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isSessionCompleted, setIsSessionCompleted] = useState<boolean>(false);

  const [isRevealed, setIsRevealed] = useState<boolean>(false);
  const [soundMissIndices, setSoundMissIndices] = useState<Set<number>>(new Set());
  const [unknownVocabIndices, setUnknownVocabIndices] = useState<Set<number>>(new Set());
  const [playCount, setPlayCount] = useState<number>(0);
  const [isPlayingAudio, setIsPlayingAudio] = useState<boolean>(false);

  const [sessionPerfectCount, setSessionPerfectCount] = useState<number>(0);
  const [sessionSavedListeningCount, setSessionSavedListeningCount] = useState<number>(0);
  const [sessionSavedVocabCount, setSessionSavedVocabCount] = useState<number>(0);

  const [analytics, setAnalytics] = useState<LabAnalyticsSummary>(() => calculateLabAnalytics());
  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState<boolean>(false);

  const currentQuestion: LabQuestion | undefined = questions[currentIndex];

  // ==========================================
  // 2. Ankiカード発話特訓 (無限ストリーム) State
  // ==========================================
  const [allVocabs, setAllVocabs] = useState<VocabItem[]>(() => loadVocabs());
  const [speechCardIndex, setSpeechCardIndex] = useState<number>(0);
  const [speechSubStep, setSpeechSubStep] = useState<'overlapping' | 'shadowing'>('overlapping');
  const [speechRate, setSpeechRate] = useState<number>(1.0);
  const [showEnglishInShadowing, setShowEnglishInShadowing] = useState<boolean>(false);
  const [isCardListOpen, setIsCardListOpen] = useState<boolean>(false);

  // リスニング専用Ankiカードのみを抽出し、未練習優先＆鮮度優先（Hot & Fresh Priority）でソート
  const ankiCards = useMemo(() => {
    return allVocabs
      .filter(v => v.focusType === 'listening')
      .sort((a, b) => {
        // 未発話または発話回数が少ないものを優先
        const practiceDiff = (a.speechPracticeCount || 0) - (b.speechPracticeCount || 0);
        if (practiceDiff !== 0) return practiceDiff;
        // 最新作成日時順（Hot Priority）
        const timeA = new Date(a.createdAt || a.lastReviewedAt || 0).getTime();
        const timeB = new Date(b.createdAt || b.lastReviewedAt || 0).getTime();
        return timeB - timeA;
      });
  }, [allVocabs]);

  const currentSpeechCard: VocabItem | undefined = ankiCards[speechCardIndex];

  // Reload vocabs when switching to anki_speech
  useEffect(() => {
    if (activeMode === 'anki_speech') {
      setAllVocabs(loadVocabs());
    }
  }, [activeMode]);

  // ----------------------------------------------------
  // AI特訓: Batch generation
  // ----------------------------------------------------
  const handleGenerateBatch = useCallback(async (count = 5) => {
    stopSpeech();
    setIsGenerating(true);
    setIsSessionCompleted(false);
    setCurrentIndex(0);
    setIsRevealed(false);
    setSoundMissIndices(new Set());
    setUnknownVocabIndices(new Set());
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

  const handlePlayAudio = useCallback((rate = targetSpeedRate) => {
    if (!currentQuestion) return;
    stopSpeech();
    setIsPlayingAudio(true);
    setPlayCount(prev => prev + 1);
    speakText(currentQuestion.sentenceEn, rate, 'en-US', () => {
      setIsPlayingAudio(false);
    });
  }, [currentQuestion, targetSpeedRate]);

  const handleToggleWordMark = (wordIdx: number) => {
    if (soundMissIndices.has(wordIdx)) {
      setSoundMissIndices(prev => {
        const next = new Set(prev);
        next.delete(wordIdx);
        return next;
      });
      setUnknownVocabIndices(prev => new Set(prev).add(wordIdx));
    } else if (unknownVocabIndices.has(wordIdx)) {
      setUnknownVocabIndices(prev => {
        const next = new Set(prev);
        next.delete(wordIdx);
        return next;
      });
    } else {
      setSoundMissIndices(prev => new Set(prev).add(wordIdx));
    }
  };

  const handleCompleteQuestion = useCallback((actionType: 'perfect' | 'sound_miss' | 'unknown_vocab') => {
    if (!currentQuestion) return;
    stopSpeech();

    const isVocabGap = actionType === 'unknown_vocab' || unknownVocabIndices.size > 0;
    const isPerfect = actionType === 'perfect';

    const soundMissList = Array.from(soundMissIndices)
      .sort((a, b) => a - b)
      .map(idx => currentQuestion.words[idx])
      .filter(Boolean);

    const unknownVocabList = Array.from(unknownVocabIndices)
      .sort((a, b) => a - b)
      .map(idx => currentQuestion.words[idx])
      .filter(Boolean);

    const lpScore = calculateListeningPower({
      wordCount: currentQuestion.words.length,
      speedRate: targetSpeedRate,
      missedSoundCount: soundMissList.length,
      unknownVocabCount: unknownVocabList.length,
      playCount: Math.max(1, playCount),
      isVocabGap: actionType === 'unknown_vocab',
    });

    saveLabQuestionRecord({
      id: `rec_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      dateString: new Date().toISOString().split('T')[0],
      sentenceEn: currentQuestion.sentenceEn,
      translationJa: currentQuestion.translationJa,
      wordCount: currentQuestion.words.length,
      speedRate: targetSpeedRate,
      cefrLevel: targetCefrLevel,
      markedTokens: soundMissList,
      unknownVocabTokens: unknownVocabList,
      isVocabGap,
      playCount: Math.max(1, playCount),
      listeningPowerScore: lpScore,
      isPerfect,
      savedToAnki: actionType !== 'perfect',
    });

    // CEFR 理解度スキャンタスクを投入 (リスニングで聞き取れた/スルーした単語・構文を「理解」へ自動反映)
    try {
      enqueueMasteryScanTask({
        sourceType: 'listening_lab',
        sourceId: currentQuestion.id || `lab_${Date.now()}`,
        title: `リスニング特訓 (${targetCefrLevel})`,
        text: currentQuestion.sentenceEn,
        lookedUpTokens: unknownVocabList,
      });
    } catch (e) {
      console.error('Failed to enqueue listening mastery scan task', e);
    }

    if (actionType === 'perfect') {
      setSessionPerfectCount(prev => prev + 1);
    } else if (actionType === 'sound_miss') {
      saveListeningCard({
        sentence: currentQuestion.sentenceEn,
        translation: currentQuestion.translationJa,
        markedTokens: soundMissList,
        targetSpeedRate: targetSpeedRate,
        englishExplanation: currentQuestion.englishExplanation || (currentQuestion.phoneticPoints ? `音声変化: ${currentQuestion.phoneticPoints}` : undefined),
        cefrLevel: targetCefrLevel,
        wordCount: currentQuestion.words.length,
      });

      setSessionSavedListeningCount(prev => prev + 1);
      setAllVocabs(loadVocabs());
      if (onListeningCardSaved) onListeningCardSaved();

      confetti({ particleCount: 20, spread: 45, origin: { y: 0.8 } });
    } else if (actionType === 'unknown_vocab') {
      const primaryWord = unknownVocabList[0] || currentQuestion.words[0] || 'Unknown word';
      saveSentenceCardWithSiblings({
        sentence: currentQuestion.sentenceEn,
        translation: currentQuestion.translationJa,
        focusType: 'word',
        focusWord: primaryWord,
        focusMeaning: currentQuestion.translationJa,
      });

      enqueueBgVocabItem({
        phrase: primaryWord,
        partOfSpeech: '単語・表現',
        meaning: currentQuestion.translationJa,
        cefr: targetCefrLevel,
      });

      setSessionSavedVocabCount(prev => prev + 1);
      setAllVocabs(loadVocabs());
      if (onListeningCardSaved) onListeningCardSaved();

      confetti({ particleCount: 25, spread: 50, origin: { y: 0.8 } });
    }

    setAnalytics(calculateLabAnalytics());

    if (currentIndex + 1 < questions.length) {
      const nextIdx = currentIndex + 1;
      setCurrentIndex(nextIdx);
      setIsRevealed(false);
      setSoundMissIndices(new Set());
      setUnknownVocabIndices(new Set());
      setPlayCount(0);

      setTimeout(() => {
        if (questions[nextIdx]) {
          speakText(questions[nextIdx].sentenceEn, targetSpeedRate, 'en-US', () => setIsPlayingAudio(false));
          setIsPlayingAudio(true);
          setPlayCount(1);
        }
      }, 300);
    } else {
      setIsSessionCompleted(true);
      confetti({ particleCount: 60, spread: 70, origin: { y: 0.6 } });
    }
  }, [currentQuestion, soundMissIndices, unknownVocabIndices, targetSpeedRate, targetCefrLevel, playCount, currentIndex, questions, onListeningCardSaved]);

  // ----------------------------------------------------
  // Anki発話特訓: Speech Practice Flow & UX
  // ----------------------------------------------------
  const overallSpeechPercent = useMemo(() => {
    if (ankiCards.length === 0) return 0;
    const progress = speechCardIndex + (speechSubStep === 'shadowing' ? 0.5 : 0);
    return Math.min(100, Math.round((progress / ankiCards.length) * 100));
  }, [ankiCards.length, speechCardIndex, speechSubStep]);

  const playSpeechCardAudio = useCallback((index: number, step: 'overlapping' | 'shadowing') => {
    const card = ankiCards[index];
    if (!card) return;
    const sentence = card.sentence || card.exampleSentence || card.phrase;
    if (!sentence) return;

    stopSpeech();
    setIsPlayingAudio(true);
    const rateToUse = step === 'overlapping' ? speechRate : 1.0;
    speakText(sentence, rateToUse, 'en-US', () => setIsPlayingAudio(false));
  }, [ankiCards, speechRate]);

  // Advance speech sub-step or next card (Overlapping ➔ Shadowing ➔ Next Card)
  const handleAdvanceSpeechStep = useCallback(() => {
    if (!currentSpeechCard) return;
    stopSpeech();

    const sentence = currentSpeechCard.sentence || currentSpeechCard.exampleSentence || currentSpeechCard.phrase || '';

    // Log speech event & increment card counter
    recordAnkiSpeechPractice({
      vocabId: currentSpeechCard.id,
      subStep: speechSubStep,
      sentenceText: sentence,
    });

    // Refresh allVocabs so cumulative count badge updates immediately
    setAllVocabs(loadVocabs());

    if (speechSubStep === 'overlapping') {
      // Step 1 ➔ Step 2: Shadowing (English hidden)
      setSpeechSubStep('shadowing');
      setShowEnglishInShadowing(false);
      setTimeout(() => {
        playSpeechCardAudio(speechCardIndex, 'shadowing');
      }, 150);
    } else {
      // Step 2 ➔ Next card Step 1
      if (speechCardIndex + 1 < ankiCards.length) {
        const nextIdx = speechCardIndex + 1;
        setSpeechCardIndex(nextIdx);
        setSpeechSubStep('overlapping');
        setShowEnglishInShadowing(false);
        setTimeout(() => {
          playSpeechCardAudio(nextIdx, 'overlapping');
        }, 150);
      } else {
        // Completed all cards in current deck queue!
        confetti({ particleCount: 50, spread: 60, origin: { y: 0.6 } });
        const nextIdx = 0;
        setSpeechCardIndex(nextIdx);
        setSpeechSubStep('overlapping');
        setShowEnglishInShadowing(false);
        setTimeout(() => {
          playSpeechCardAudio(nextIdx, 'overlapping');
        }, 200);
      }
    }
  }, [currentSpeechCard, speechSubStep, speechCardIndex, ankiCards.length, playSpeechCardAudio]);

  // Step back (Shadowing ➔ Overlapping; or Overlapping ➔ Previous Card Shadowing)
  const handleStepBackSpeech = useCallback(() => {
    stopSpeech();
    if (speechSubStep === 'shadowing') {
      setSpeechSubStep('overlapping');
      setShowEnglishInShadowing(false);
      setTimeout(() => {
        playSpeechCardAudio(speechCardIndex, 'overlapping');
      }, 100);
    } else if (speechCardIndex > 0) {
      const prevIdx = speechCardIndex - 1;
      setSpeechCardIndex(prevIdx);
      setSpeechSubStep('shadowing');
      setShowEnglishInShadowing(false);
      setTimeout(() => {
        playSpeechCardAudio(prevIdx, 'shadowing');
      }, 100);
    }
  }, [speechSubStep, speechCardIndex, playSpeechCardAudio]);

  // Skip card
  const handleSkipSpeechCard = useCallback(() => {
    stopSpeech();
    const nextIdx = (speechCardIndex + 1) % Math.max(1, ankiCards.length);
    setSpeechCardIndex(nextIdx);
    setSpeechSubStep('overlapping');
    setShowEnglishInShadowing(false);
    setTimeout(() => {
      playSpeechCardAudio(nextIdx, 'overlapping');
    }, 100);
  }, [speechCardIndex, ankiCards.length, playSpeechCardAudio]);

  // Replay speech audio
  const handleReplaySpeech = useCallback(() => {
    playSpeechCardAudio(speechCardIndex, speechSubStep);
  }, [speechCardIndex, speechSubStep, playSpeechCardAudio]);

  // Toggle English in Shadowing step
  const toggleShadowingEnglish = useCallback(() => {
    if (speechSubStep === 'shadowing') {
      setShowEnglishInShadowing(prev => !prev);
    }
  }, [speechSubStep]);

  // Keyboard Navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (activeMode === 'ai_generator') {
        if (e.code === 'Space' || e.code === 'KeyR') {
          e.preventDefault();
          handlePlayAudio();
        } else if (e.code === 'Enter') {
          e.preventDefault();
          if (!isRevealed) {
            setIsRevealed(true);
          } else {
            if (unknownVocabIndices.size > 0) {
              handleCompleteQuestion('unknown_vocab');
            } else if (soundMissIndices.size > 0) {
              handleCompleteQuestion('sound_miss');
            } else {
              handleCompleteQuestion('perfect');
            }
          }
        }
      } else if (activeMode === 'anki_speech') {
        if (e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault();
          handleAdvanceSpeechStep();
        } else if (e.code === 'KeyR') {
          e.preventDefault();
          handleReplaySpeech();
        } else if (e.code === 'KeyV') {
          e.preventDefault();
          toggleShadowingEnglish();
        } else if (e.code === 'ArrowLeft' || e.code === 'KeyZ') {
          e.preventDefault();
          handleStepBackSpeech();
        } else if (e.code === 'ArrowRight' || e.code === 'KeyS') {
          e.preventDefault();
          handleSkipSpeechCard();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeMode,
    isRevealed,
    soundMissIndices,
    unknownVocabIndices,
    handlePlayAudio,
    handleCompleteQuestion,
    handleAdvanceSpeechStep,
    handleReplaySpeech,
    toggleShadowingEnglish,
    handleStepBackSpeech,
    handleSkipSpeechCard
  ]);

  return (
    <div className="max-w-4xl mx-auto px-3 sm:px-6 py-4 sm:py-8 space-y-6 pb-36 animate-fadeIn">
      {/* Mode Switcher Tabs */}
      <div className="flex items-center justify-center space-x-2 bg-slate-900/90 p-1.5 rounded-2xl border border-slate-800 max-w-md mx-auto">
        <button
          onClick={() => {
            stopSpeech();
            setActiveMode('ai_generator');
          }}
          className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-1.5 ${
            activeMode === 'ai_generator'
              ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-md shadow-cyan-600/30'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>AI新規文で帯域特訓</span>
        </button>

        <button
          onClick={() => {
            stopSpeech();
            setActiveMode('anki_speech');
          }}
          className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-1.5 ${
            activeMode === 'anki_speech'
              ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md shadow-indigo-600/30'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <Mic className="w-3.5 h-3.5" />
          <span>Ankiカード発話特訓</span>
          {ankiCards.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-indigo-950 text-indigo-300 text-[10px] font-mono border border-indigo-500/30">
              {ankiCards.length}
            </span>
          )}
        </button>
      </div>

      {/* =========================================================================
          MODE 1: AI新規文で帯域特訓 (Listening Power Benchmark)
          ========================================================================= */}
      {activeMode === 'ai_generator' && (
        <div className="space-y-6 animate-fadeIn">
          {/* Top Power KPI Card */}
          <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-4">
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
                      帯域パワー特訓
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    純粋な聴覚ワーキングメモリ・音声知覚パワー（LP）を拡張する
                  </p>
                </div>
              </div>

              <button
                onClick={() => setIsAnalyticsOpen(true)}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-2xl bg-slate-950/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 transition-colors text-xs self-start sm:self-auto"
                title="詳細分析を見る"
              >
                <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
                <span className="font-bold">分析詳細</span>
              </button>
            </div>

            {/* Live Power Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
              <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-2xl">
                <span className="text-[10px] text-slate-400 block font-bold">今日の平均パワー</span>
                <div className="flex items-baseline space-x-1.5 mt-0.5">
                  <strong className="text-lg sm:text-xl font-black text-amber-300 font-mono">
                    {analytics.todayAverageLP > 0 ? `${analytics.todayAverageLP} LP` : '-'}
                  </strong>
                  {analytics.deltaVsYesterday !== 0 && (
                    <span className={`text-[10px] font-bold ${analytics.deltaVsYesterday > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {analytics.deltaVsYesterday > 0 ? `+${analytics.deltaVsYesterday}` : analytics.deltaVsYesterday}
                    </span>
                  )}
                </div>
              </div>

              <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-2xl">
                <span className="text-[10px] text-slate-400 block font-bold">7日間移動平均</span>
                <div className="flex items-baseline space-x-1.5 mt-0.5">
                  <strong className="text-lg sm:text-xl font-black text-cyan-300 font-mono">
                    {analytics.movingAverageLP7Days > 0 ? `${analytics.movingAverageLP7Days} LP` : '-'}
                  </strong>
                  <TrendingUp className="w-3 h-3 text-cyan-400" />
                </div>
              </div>

              <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-2xl">
                <span className="text-[10px] text-slate-400 block font-bold">処理可能単語数</span>
                <strong className="text-lg sm:text-xl font-black text-indigo-300 font-mono block mt-0.5">
                  {analytics.movingAverageWordCapacity > 0 ? `${analytics.movingAverageWordCapacity} 語` : '-'}
                </strong>
              </div>

              <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-2xl">
                <span className="text-[10px] text-slate-400 block font-bold">完全突破率</span>
                <strong className="text-lg sm:text-xl font-black text-emerald-300 font-mono block mt-0.5">
                  {analytics.perfectPassRate}%
                </strong>
              </div>
            </div>

            {/* Controls */}
            <div className="pt-2 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-300">文長（目標単語数）:</span>
                  <div className="flex items-center space-x-1.5">
                    <button
                      onClick={() => setTargetWordCount(prev => Math.max(4, prev - 1))}
                      className="w-6 h-6 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition-colors font-bold"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="font-mono font-black text-cyan-300 px-1 text-sm">{targetWordCount} 語</span>
                    <button
                      onClick={() => setTargetWordCount(prev => Math.min(25, prev + 1))}
                      className="w-6 h-6 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition-colors font-bold"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {WORD_COUNT_PRESETS.map(count => (
                    <button
                      key={count}
                      onClick={() => setTargetWordCount(count)}
                      className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all ${
                        targetWordCount === count ? 'bg-cyan-500 text-slate-950 shadow-sm' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
                      }`}
                    >
                      {count}語
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-2">
                <span className="font-bold text-slate-300 block">難易度 (CEFR):</span>
                <div className="grid grid-cols-5 gap-1">
                  {CEFR_LEVELS.map(level => (
                    <button
                      key={level}
                      onClick={() => setTargetCefrLevel(level)}
                      className={`py-1 rounded-xl text-center text-xs font-bold transition-all ${
                        targetCefrLevel === level ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-2">
                <span className="font-bold text-slate-300 block">再生速度 (TTS):</span>
                <div className="grid grid-cols-5 gap-1">
                  {SPEED_RATES.map(rate => (
                    <button
                      key={rate.value}
                      onClick={() => setTargetSpeedRate(rate.value)}
                      className={`py-1 rounded-xl text-center text-xs font-bold transition-all ${
                        targetSpeedRate === rate.value ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
                      }`}
                    >
                      {rate.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Action */}
            <div className="flex items-center justify-between pt-1">
              <div className="text-[11px] text-slate-400">
                {isGenerating ? (
                  <span className="flex items-center space-x-1.5 text-cyan-300 animate-pulse">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>AIが{targetWordCount}語（{targetCefrLevel}）の特訓文を生成中...</span>
                  </span>
                ) : questions.length > 0 ? (
                  <span>問題: <strong className="text-white">{currentIndex + 1}</strong> / {questions.length} 問</span>
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

          {/* Main Training Area */}
          {isSessionCompleted ? (
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-8 sm:p-10 shadow-2xl text-center space-y-6 animate-fadeIn">
              <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center mx-auto shadow-xl shadow-emerald-500/25">
                <CheckCircle2 className="w-9 h-9 text-white" />
              </div>

              <div className="space-y-2">
                <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">セッション完了！ 🎉</h2>
                <p className="text-sm text-slate-300 max-w-md mx-auto leading-relaxed">
                  目標 {targetWordCount} 語（{targetCefrLevel} / {targetSpeedRate}x）の特訓を完走しました！
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-xl mx-auto text-center">
                <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl">
                  <span className="text-[11px] text-slate-400 block font-bold">完全突破</span>
                  <strong className="text-xl sm:text-2xl font-black text-emerald-300 font-mono">{sessionPerfectCount} / {questions.length}</strong>
                </div>
                <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl">
                  <span className="text-[11px] text-slate-400 block font-bold">リスニングAnki</span>
                  <strong className="text-xl sm:text-2xl font-black text-rose-300 font-mono">{sessionSavedListeningCount}</strong>
                </div>
                <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl">
                  <span className="text-[11px] text-slate-400 block font-bold">単語Anki (未知語)</span>
                  <strong className="text-xl sm:text-2xl font-black text-purple-300 font-mono">{sessionSavedVocabCount}</strong>
                </div>
                <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl">
                  <span className="text-[11px] text-slate-400 block font-bold">今日の平均パワー</span>
                  <strong className="text-xl sm:text-2xl font-black text-amber-300 font-mono">{analytics.todayAverageLP > 0 ? `${analytics.todayAverageLP} LP` : '-'}</strong>
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
          ) : questions.length === 0 ? (
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-8 sm:p-12 shadow-2xl text-center space-y-6 animate-fadeIn">
              <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-cyan-600 via-blue-600 to-indigo-600 flex items-center justify-center mx-auto shadow-xl shadow-cyan-500/25">
                <Headphones className="w-8 h-8 text-white" />
              </div>

              <div className="space-y-2">
                <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">リスニング集中特訓をスタート</h2>
                <p className="text-xs sm:text-sm text-slate-300 max-w-md mx-auto leading-relaxed">
                  単語数・難易度・再生速度を設定して「特訓を開始」を押すと、AIが5問の短文を生成します。
                </p>
                <p className="text-[11px] text-slate-500">※ボタンを押すまでAPIトークンは一切消費されません。</p>
              </div>

              <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl max-w-sm mx-auto flex items-center justify-around text-xs">
                <div>
                  <span className="text-[10px] text-slate-400 block font-bold">文長</span>
                  <span className="text-sm font-black text-cyan-300 font-mono">{targetWordCount} 語</span>
                </div>
                <div className="w-px h-6 bg-slate-800" />
                <div>
                  <span className="text-[10px] text-slate-400 block font-bold">難易度</span>
                  <span className="text-sm font-black text-blue-400 font-mono">{targetCefrLevel}</span>
                </div>
                <div className="w-px h-6 bg-slate-800" />
                <div>
                  <span className="text-[10px] text-slate-400 block font-bold">速度</span>
                  <span className="text-sm font-black text-indigo-300 font-mono">{targetSpeedRate}x</span>
                </div>
              </div>

              <div className="pt-2">
                <button
                  onClick={() => handleGenerateBatch(5)}
                  disabled={isGenerating}
                  className="px-8 py-4 bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 active:scale-95 text-white rounded-2xl font-bold shadow-xl shadow-cyan-600/30 transition-all text-sm sm:text-base flex items-center space-x-2 mx-auto"
                >
                  <Sparkles className="w-5 h-5" />
                  <span>✨ 特訓を開始する（5問生成）</span>
                </button>
              </div>
            </div>
          ) : currentQuestion ? (
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 relative overflow-hidden animate-fadeIn">
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

              {!isRevealed ? (
                <div className="py-8 flex flex-col items-center justify-center space-y-6 text-center">
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
                    <p className="text-sm font-bold text-white">英文は隠された状態です 🎧</p>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      頭の中で英語と意味が鮮明に浮かぶまで、何度でも再生してください。
                    </p>
                  </div>

                  <div className="flex items-center space-x-2 pt-2">
                    <button onClick={() => handlePlayAudio(0.8)} className="px-3 py-1 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-xl text-xs font-bold transition-colors">▶ 0.8x</button>
                    <button onClick={() => handlePlayAudio(1.0)} className="px-3 py-1 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-xl text-xs font-bold transition-colors">▶ 1.0x</button>
                    <button onClick={() => handlePlayAudio(1.2)} className="px-3 py-1 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-xl text-xs font-bold transition-colors">▶ 1.2x</button>
                  </div>

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
                <div className="space-y-6 animate-fadeIn">
                  <div className="p-5 bg-slate-950/80 border border-slate-800 rounded-2xl space-y-3 text-left">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] font-bold text-slate-300 flex items-center space-x-3">
                        <span>タップで分類:</span>
                        <span className="text-rose-400">🔴 音の脱落</span>
                        <span className="text-purple-400">🟣 未知語</span>
                      </div>
                      <div className="flex items-center space-x-1.5">
                        <button onClick={() => handlePlayAudio(0.8)} className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 rounded-lg text-xs font-bold transition-colors">▶ 0.8x</button>
                        <button onClick={() => handlePlayAudio(1.0)} className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 rounded-lg text-xs font-bold transition-colors">▶ 1.0x</button>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 py-2">
                      {currentQuestion.words.map((word, wIdx) => {
                        const isSoundMiss = soundMissIndices.has(wIdx);
                        const isUnknownVocab = unknownVocabIndices.has(wIdx);

                        return (
                          <button
                            key={wIdx}
                            onClick={() => handleToggleWordMark(wIdx)}
                            className={`px-3 py-1.5 rounded-xl text-base sm:text-lg font-serif font-bold transition-all ${
                              isUnknownVocab
                                ? 'bg-purple-950/90 text-purple-200 border-2 border-purple-500 shadow-lg shadow-purple-500/20 scale-105'
                                : isSoundMiss
                                ? 'bg-rose-950/90 text-rose-200 border-2 border-rose-500 shadow-lg shadow-rose-500/20 scale-105'
                                : 'bg-slate-900/90 hover:bg-slate-800 text-slate-100 border border-slate-800'
                            }`}
                            title="タップで切替: 🔴音抜け ➔ 🟣未知語 ➔ 解除"
                          >
                            {word}
                          </button>
                        );
                      })}
                    </div>

                    <div className="text-xs space-y-1">
                      {unknownVocabIndices.size > 0 ? (
                        <p className="text-purple-300 font-bold">
                          🟣 未知語 {unknownVocabIndices.size} 語マーク中（★パワー計算から除外され、通常単語Ankiに登録されます）
                        </p>
                      ) : soundMissIndices.size > 0 ? (
                        <p className="text-rose-400 font-bold animate-pulse">
                          🔴 音声変化・聞き取り弱点 {soundMissIndices.size} 語マーク中 ➔ 🎧 リスニングAnkiに登録されます
                        </p>
                      ) : (
                        <p className="text-emerald-400">✨ すべて聞き取れた場合はマーク不要です（そのまま完璧ボタンへ）</p>
                      )}
                    </div>
                  </div>

                  <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-1 text-left">
                    <span className="text-[11px] font-bold text-slate-400 block">日本語訳:</span>
                    <p className="text-sm sm:text-base font-bold text-slate-200 leading-relaxed">
                      {currentQuestion.translationJa}
                    </p>
                  </div>

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

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2">
                    <button
                      onClick={() => handleCompleteQuestion('perfect')}
                      className="py-3.5 px-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-[0.98] text-white rounded-2xl text-xs sm:text-sm font-bold shadow-lg shadow-emerald-600/20 transition-all flex items-center justify-center space-x-1.5"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>🟢 完璧 (100% LP)</span>
                    </button>

                    <button
                      onClick={() => handleCompleteQuestion('sound_miss')}
                      className="py-3.5 px-4 bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 active:scale-[0.98] text-white rounded-2xl text-xs sm:text-sm font-bold shadow-lg shadow-rose-600/20 transition-all flex items-center justify-center space-x-1.5"
                    >
                      <BookmarkPlus className="w-4 h-4" />
                      <span>🔴 音が聴き取れず (🎧Anki)</span>
                    </button>

                    <button
                      onClick={() => handleCompleteQuestion('unknown_vocab')}
                      className="py-3.5 px-4 bg-gradient-to-r from-purple-700 to-indigo-700 hover:from-purple-600 hover:to-indigo-600 active:scale-[0.98] text-white rounded-2xl text-xs sm:text-sm font-bold shadow-lg shadow-purple-600/20 transition-all flex items-center justify-center space-x-1.5"
                    >
                      <HelpCircle className="w-4 h-4" />
                      <span>❓ 未知語 (除外＆通常Anki)</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* =========================================================================
          MODE 2: Ankiカード発話特訓 (無限シャドーイングストリーム)
          ========================================================================= */}
      {activeMode === 'anki_speech' && (
        <div className="space-y-5 animate-fadeIn">
          {ankiCards.length === 0 ? (
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-8 sm:p-12 text-center space-y-4 shadow-xl">
              <div className="w-16 h-16 rounded-3xl bg-indigo-950 border border-indigo-500/30 flex items-center justify-center mx-auto text-indigo-400">
                <Headphones className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h2 className="text-xl font-bold text-white">リスニング専用Ankiカードがまだありません</h2>
                <p className="text-xs sm:text-sm text-slate-400 max-w-md mx-auto">
                  「AI無制限特訓」で聞き取れなかった文を「🎧 リスニングAnkiに保存」すると、ここにストックされてStoryと同様のUIで無限に発話特訓できます。
                </p>
              </div>
              <button
                onClick={() => setActiveMode('ai_generator')}
                className="px-6 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-2xl text-xs font-bold shadow-lg shadow-cyan-600/20"
              >
                AI特訓へ移動する
              </button>
            </div>
          ) : currentSpeechCard ? (
            <>
              {/* 1. Header Navigation & Mode / Speed Controls (Matching StoryShadowingView) */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xl backdrop-blur-md space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center gap-1">
                          <Headphones className="w-3 h-3 inline" />
                          <span>発話特訓モード</span>
                        </span>
                        <span className="text-xs text-slate-400 font-mono">
                          カード {speechCardIndex + 1} / {ankiCards.length}
                        </span>
                      </div>
                      <h1 className="text-base sm:text-lg font-bold text-white truncate max-w-[200px] sm:max-w-md mt-0.5">
                        {currentSpeechCard.phrase || 'リスニングAnkiカード'}
                      </h1>
                    </div>
                  </div>

                  {/* Speed Selector */}
                  <div className="flex items-center space-x-1 bg-slate-950/80 p-1 rounded-2xl border border-slate-800">
                    {SPEECH_PRACTICE_RATES.map(rate => (
                      <button
                        key={rate.value}
                        type="button"
                        onClick={() => {
                          setSpeechRate(rate.value);
                          if (speechSubStep === 'overlapping') {
                            stopSpeech();
                          }
                        }}
                        className={`px-2 sm:px-2.5 py-1 rounded-xl text-[11px] font-mono font-bold transition-all cursor-pointer ${
                          speechRate === rate.value
                            ? 'bg-purple-600 text-white shadow-md'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                        title={`再生速度: ${rate.label}`}
                      >
                        {rate.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 2-Step Stage Indicator Grid */}
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-800/80">
                  <div
                    className={`p-2.5 sm:p-3 rounded-2xl border transition-all text-center flex items-center justify-center space-x-2 ${
                      speechSubStep === 'overlapping'
                        ? 'bg-gradient-to-r from-teal-500/20 to-emerald-500/20 border-teal-500/40 text-teal-300 ring-1 ring-teal-500/30'
                        : 'bg-slate-950/40 border-slate-800/60 text-slate-500'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${
                      speechSubStep === 'overlapping' ? 'bg-teal-500 text-slate-950' : 'bg-slate-800 text-slate-400'
                    }`}>
                      1
                    </div>
                    <div className="text-left">
                      <div className="text-xs font-bold leading-tight">オーバーラッピング</div>
                      <div className="text-[10px] text-slate-400">英文を見ながら同時に発音</div>
                    </div>
                  </div>

                  <div
                    className={`p-2.5 sm:p-3 rounded-2xl border transition-all text-center flex items-center justify-center space-x-2 ${
                      speechSubStep === 'shadowing'
                        ? 'bg-gradient-to-r from-purple-500/20 to-indigo-500/20 border-purple-500/40 text-purple-300 ring-1 ring-purple-500/30'
                        : 'bg-slate-950/40 border-slate-800/60 text-slate-500'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${
                      speechSubStep === 'shadowing' ? 'bg-purple-500 text-white' : 'bg-slate-800 text-slate-400'
                    }`}>
                      2
                    </div>
                    <div className="text-left">
                      <div className="text-xs font-bold leading-tight">シャドーイング</div>
                      <div className="text-[10px] text-slate-400">耳だけ（1拍遅れて影追走）</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. Sentence Display & Progress */}
              <div className="space-y-4">
                {/* Sentence Mini-Map Pills */}
                <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-3 space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
                    <div className="flex items-center space-x-2">
                      <span className="font-semibold text-slate-300">特訓進捗ミニマップ</span>
                      <button
                        type="button"
                        onClick={() => setIsCardListOpen(true)}
                        className="inline-flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 font-bold ml-2 underline cursor-pointer"
                      >
                        <List className="w-3 h-3" />
                        <span>カード一覧 ({ankiCards.length}枚)</span>
                      </button>
                    </div>
                    <span className="font-mono text-purple-300 font-bold">{overallSpeechPercent}% 完了</span>
                  </div>

                  <div className="flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-thin">
                    {ankiCards.map((card, idx) => {
                      const isCurrent = idx === speechCardIndex;
                      const isPast = idx < speechCardIndex;
                      const practiced = (card.speechPracticeCount || 0) > 0;

                      return (
                        <button
                          key={card.id}
                          type="button"
                          onClick={() => {
                            setSpeechCardIndex(idx);
                            setSpeechSubStep('overlapping');
                            setShowEnglishInShadowing(false);
                            setTimeout(() => {
                              playSpeechCardAudio(idx, 'overlapping');
                            }, 100);
                          }}
                          className={`h-3 rounded-full transition-all duration-200 shrink-0 cursor-pointer ${
                            isCurrent
                              ? 'w-8 bg-purple-400 ring-2 ring-purple-400/50'
                              : isPast
                              ? 'w-3.5 bg-slate-600 hover:bg-slate-500'
                              : practiced
                              ? 'w-3 bg-emerald-500/70 hover:w-5'
                              : 'w-3 bg-slate-700 hover:w-5'
                          }`}
                          title={`カード ${idx + 1}: ${card.phrase || ''} (発話 ${card.speechPracticeCount || 0}回)`}
                        />
                      );
                    })}
                  </div>

                  <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden border border-slate-800/80">
                    <div
                      className="bg-gradient-to-r from-teal-400 via-purple-500 to-indigo-400 h-full transition-all duration-300"
                      style={{ width: `${overallSpeechPercent}%` }}
                    />
                  </div>
                </div>

                {/* Big Center Display */}
                <div className="bg-slate-950/90 border border-slate-800/90 rounded-3xl p-6 sm:p-8 space-y-5 text-center shadow-inner relative overflow-hidden min-h-[260px] flex flex-col justify-center">
                  {/* Audio Wave Visualizer */}
                  <div className="flex items-center justify-center gap-1.5 py-1">
                    {[0.4, 0.7, 1.0, 0.6, 0.9, 0.5, 0.8, 0.3].map((heightRatio, i) => (
                      <div
                        key={i}
                        className={`w-1.5 rounded-full transition-all duration-200 ${
                          isPlayingAudio
                            ? speechSubStep === 'overlapping'
                              ? 'bg-gradient-to-t from-teal-400 to-emerald-300 animate-pulse'
                              : 'bg-gradient-to-t from-purple-400 to-indigo-300 animate-pulse'
                            : 'bg-slate-800'
                        }`}
                        style={{
                          height: isPlayingAudio ? `${Math.max(16, heightRatio * 44)}px` : '10px',
                          animationDelay: `${i * 100}ms`,
                        }}
                      />
                    ))}
                  </div>

                  {/* English Text: Visible in Overlapping, Toggleable in Shadowing */}
                  {speechSubStep === 'overlapping' || showEnglishInShadowing ? (
                    <div
                      onClick={() => {
                        if (speechSubStep === 'shadowing') {
                          setShowEnglishInShadowing(false);
                        }
                      }}
                      className={`p-6 sm:p-8 rounded-3xl space-y-3 animate-fadeIn shadow-lg border transition-all relative ${
                        speechSubStep === 'overlapping'
                          ? 'bg-slate-900/90 border-slate-800'
                          : 'bg-purple-950/40 border-purple-500/40 ring-1 ring-purple-500/30 cursor-pointer'
                      }`}
                    >
                      {/* Badges & Actions */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center space-x-2">
                          <span className="text-[10px] px-2 py-0.5 rounded-md font-bold font-mono border bg-indigo-500/20 text-indigo-300 border-indigo-500/40">
                            Ankiリスニングカード
                          </span>

                          {currentSpeechCard.targetSpeedRate && (
                            <span className="text-[10px] px-2 py-0.5 rounded-md font-bold font-mono border bg-slate-800 text-slate-300 border-slate-700">
                              🔒 登録 {currentSpeechCard.targetSpeedRate}x
                            </span>
                          )}
                        </div>

                        <span className="text-[11px] font-mono text-slate-400">
                          累計発話: <strong className="text-amber-300 font-bold">{currentSpeechCard.speechPracticeCount || 0}</strong> 回
                        </span>
                      </div>

                      <p className="text-xl sm:text-2xl font-bold text-white leading-relaxed font-serif">
                        {highlightMarkedTokensInSentence(
                          currentSpeechCard.sentence || currentSpeechCard.exampleSentence || currentSpeechCard.phrase,
                          currentSpeechCard.markedTokens
                        )}
                      </p>

                      {/* Japanese translation */}
                      {(currentSpeechCard.translation || currentSpeechCard.meaning) && (
                        <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-2xl text-xs text-slate-300 max-w-lg mx-auto">
                          <span className="text-[10px] font-bold text-slate-500 block mb-0.5">日本語訳:</span>
                          {currentSpeechCard.translation || currentSpeechCard.meaning}
                        </div>
                      )}

                      {/* Linguistic note */}
                      {(currentSpeechCard.englishExplanation || currentSpeechCard.contextNote) && (
                        <div className="text-[11px] text-purple-300/80 max-w-md mx-auto pt-1">
                          💡 {currentSpeechCard.englishExplanation || currentSpeechCard.contextNote}
                        </div>
                      )}

                      {speechSubStep === 'shadowing' && (
                        <div className="text-xs text-purple-400 font-bold flex items-center justify-center gap-1.5 pt-2 border-t border-purple-500/20">
                          <EyeOff className="w-4 h-4" />
                          <span>英文を表示中（クリック または Vキー で再び隠す）</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div
                      onClick={() => setShowEnglishInShadowing(true)}
                      className="p-8 sm:p-10 bg-slate-900/40 border-2 border-dashed border-purple-500/40 hover:bg-slate-900/60 rounded-3xl space-y-3 animate-fadeIn cursor-pointer transition-all group relative"
                      title="クリックして英文をチラ見 (Vキー)"
                    >
                      {/* Badges */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center space-x-2">
                          <span className="text-[10px] px-2 py-0.5 rounded-md font-bold font-mono border bg-indigo-500/20 text-indigo-300 border-indigo-500/40">
                            Ankiリスニングカード
                          </span>

                        </div>

                        <span className="text-[11px] font-mono text-slate-400">
                          累計発話: <strong className="text-amber-300 font-bold">{currentSpeechCard.speechPracticeCount || 0}</strong> 回
                        </span>
                      </div>

                      <p className="text-sm sm:text-base text-purple-200/90 font-bold leading-relaxed">
                        🎧 英文は非表示です（音の1拍後ろを影のように追走）
                      </p>
                      <div className="text-xs font-bold text-purple-400 group-hover:text-purple-300 transition-all inline-flex items-center gap-1.5 pt-1">
                        <Eye className="w-4 h-4" />
                        <span>英文を見る / チラ見する (タップ または Vキー)</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 3. Sticky Bottom Control Bar with Full-Width Vertically Stacked Buttons */}
              <div
                className="fixed bottom-0 inset-x-0 z-50 bg-slate-950/95 backdrop-blur-xl border-t border-slate-800 shadow-2xl p-3.5 sm:p-4 max-w-3xl mx-auto"
                style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom, 20px))' }}
              >
                <div className="flex flex-col gap-2.5 w-full">
                  {/* 1. Main Complete / Advance Button (Top, Large, Primary Emphasis) */}
                  <button
                    type="button"
                    onClick={handleAdvanceSpeechStep}
                    className={`w-full flex items-center justify-center space-x-2 py-3.5 px-6 rounded-2xl text-sm sm:text-base font-black shadow-xl transition-all active:scale-[0.98] cursor-pointer ${
                      speechSubStep === 'overlapping'
                        ? 'bg-gradient-to-r from-teal-600 via-emerald-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 text-white shadow-teal-600/30 ring-1 ring-teal-400/40'
                        : 'bg-gradient-to-r from-purple-600 via-indigo-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 text-white shadow-purple-600/30 ring-1 ring-purple-400/40'
                    }`}
                  >
                    <CheckCircle2 className="w-5 h-5 shrink-0" />
                    <span className="truncate">
                      {speechSubStep === 'overlapping'
                        ? '🗣️ オーバーラップ完了 ➔ ② シャドーイングへ (Space / Enter)'
                        : speechCardIndex + 1 < ankiCards.length
                        ? `🎧 シャドーイング完了 ➔ 次のカード (カード ${speechCardIndex + 2}) へ (Space / Enter)`
                        : '🎉 全カードの発話特訓を完了！ 次の周へ (Space / Enter)'}
                    </span>
                  </button>

                  {/* 2. Secondary Row: Replay, Card List, Back, Skip */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleReplaySpeech}
                      className="flex-1 flex items-center justify-center space-x-2 py-3 px-3 sm:px-4 bg-slate-900 hover:bg-slate-850 text-slate-200 hover:text-white rounded-2xl text-xs sm:text-sm font-bold border border-slate-700 hover:border-slate-600 transition-all cursor-pointer shadow-md active:scale-[0.98] group"
                    >
                      <RotateCcw className="w-4 h-4 text-purple-400 group-hover:rotate-[-45deg] transition-transform shrink-0" />
                      <span>もう一度聴く (R)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setIsCardListOpen(true)}
                      className="flex-1 flex items-center justify-center space-x-2 py-3 px-3 sm:px-4 bg-slate-900 hover:bg-slate-850 text-slate-200 hover:text-white rounded-2xl text-xs sm:text-sm font-bold border border-slate-700 hover:border-slate-600 transition-all cursor-pointer shadow-md active:scale-[0.98]"
                    >
                      <List className="w-4 h-4 text-indigo-400 shrink-0" />
                      <span>カード一覧</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleStepBackSpeech}
                      className="flex-none p-3 bg-slate-900 hover:bg-slate-850 text-slate-300 hover:text-white rounded-2xl border border-slate-700 transition-all cursor-pointer shadow-md active:scale-[0.98]"
                      title="1つ前に戻る (← / Z)"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={handleSkipSpeechCard}
                      className="flex-none py-3 px-3 sm:px-4 bg-slate-900 hover:bg-slate-850 text-slate-300 hover:text-white rounded-2xl text-xs sm:text-sm font-bold border border-slate-700 transition-all cursor-pointer shadow-md active:scale-[0.98]"
                      title="スキップ (S / →)"
                    >
                      スキップ
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* Card Picker Modal */}
      {isCardListOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-xl w-full max-h-[85vh] overflow-y-auto space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <List className="w-4 h-4 text-indigo-400" />
                <span>リスニングAnkiカード一覧 ({ankiCards.length}枚)</span>
              </h2>
              <button
                onClick={() => setIsCardListOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              {ankiCards.map((card, idx) => (
                <div
                  key={card.id}
                  onClick={() => {
                    setSpeechCardIndex(idx);
                    setSpeechSubStep('overlapping');
                    setIsCardListOpen(false);
                  }}
                  className={`p-3 rounded-xl border text-left cursor-pointer transition-colors ${
                    speechCardIndex === idx
                      ? 'bg-indigo-950/80 border-indigo-500/50 text-white'
                      : 'bg-slate-950/70 border-slate-800 hover:bg-slate-850 text-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                    <span className="font-mono font-bold text-indigo-400">#{idx + 1}</span>
                    <span>発話: {card.speechPracticeCount || 0}回</span>
                  </div>
                  <p className="text-xs sm:text-sm font-bold font-serif leading-snug">
                    {card.sentence || card.exampleSentence || card.phrase}
                  </p>
                  {(card.translation || card.meaning) && (
                    <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">
                      {card.translation || card.meaning}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Analytics Modal */}
      {isAnalyticsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 max-w-xl w-full max-h-[90vh] overflow-y-auto space-y-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <BarChart3 className="w-5 h-5 text-cyan-400" />
                <h2 className="text-lg font-bold text-white">リスニング処理パワー 分析</h2>
              </div>
              <button
                onClick={() => setIsAnalyticsOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-2xl">
                <span className="text-[10px] text-slate-400 block font-bold">今日</span>
                <strong className="text-base sm:text-lg font-black text-amber-300 font-mono">
                  {analytics.todayAverageLP > 0 ? `${analytics.todayAverageLP} LP` : '-'}
                </strong>
              </div>
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-2xl">
                <span className="text-[10px] text-slate-400 block font-bold">7日移動平均</span>
                <strong className="text-base sm:text-lg font-black text-cyan-300 font-mono">
                  {analytics.movingAverageLP7Days > 0 ? `${analytics.movingAverageLP7Days} LP` : '-'}
                </strong>
              </div>
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-2xl">
                <span className="text-[10px] text-slate-400 block font-bold">完全突破率</span>
                <strong className="text-base sm:text-lg font-black text-emerald-300 font-mono">
                  {analytics.perfectPassRate}%
                </strong>
              </div>
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-2xl">
                <span className="text-[10px] text-slate-400 block font-bold">総回答数</span>
                <strong className="text-base sm:text-lg font-black text-white font-mono">
                  {analytics.totalQuestions}
                </strong>
              </div>
            </div>

            {analytics.dailyHistory.length > 0 && (
              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-300">日次パワー推移（直近）:</span>
                <div className="space-y-1.5">
                  {analytics.dailyHistory.slice(0, 7).map(d => (
                    <div key={d.dateString} className="p-2.5 bg-slate-950 border border-slate-800/80 rounded-xl flex items-center justify-between text-xs">
                      <span className="font-mono text-slate-300 font-bold">{d.dateString}</span>
                      <span className="text-slate-400 font-mono">{d.questionCount} 問</span>
                      <strong className="font-mono text-amber-300">{d.avgLP} LP</strong>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-300">文長別の完全突破率 & 平均パワー:</span>
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
                    <div className="text-right font-mono space-x-2">
                      <span className="text-slate-400 text-[11px]">{stat.passRate}%</span>
                      <strong className="text-amber-300">{stat.avgLP > 0 ? `${stat.avgLP} LP` : '-'}</strong>
                    </div>
                  </div>
                ))}
              </div>
            </div>

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
