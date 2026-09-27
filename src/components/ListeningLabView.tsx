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
  HelpCircle,
  TrendingUp,
  Mic,
  ArrowRight,
  ChevronLeft,
  List,
  X
} from 'lucide-react';
import { CefrLevel } from '../types/settings';
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

  // 鮮度優先（Hot & Fresh Priority）でソートされたAnkiカード群
  const ankiCards = useMemo(() => {
    return allVocabs
      .filter(v => v.focusType === 'listening' || Boolean(v.sentence || v.exampleSentence))
      .sort((a, b) => {
        // Listeningカードを最優先
        if (a.focusType === 'listening' && b.focusType !== 'listening') return -1;
        if (b.focusType === 'listening' && a.focusType !== 'listening') return 1;
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
  // Anki発話特訓: Speech Practice Flow
  // ----------------------------------------------------
  const handlePlaySpeechCardAudio = useCallback((rate = speechRate) => {
    if (!currentSpeechCard) return;
    const sentence = currentSpeechCard.sentence || currentSpeechCard.exampleSentence || currentSpeechCard.phrase;
    if (!sentence) return;

    stopSpeech();
    setIsPlayingAudio(true);
    speakText(sentence, rate, 'en-US', () => setIsPlayingAudio(false));
  }, [currentSpeechCard, speechRate]);

  // Advance speech sub-step or next card
  const handleCompleteSpeechStep = useCallback(() => {
    if (!currentSpeechCard) return;
    stopSpeech();

    const sentence = currentSpeechCard.sentence || currentSpeechCard.exampleSentence || currentSpeechCard.phrase || '';

    // Log speech event & increment card counter
    recordAnkiSpeechPractice({
      vocabId: currentSpeechCard.id,
      subStep: speechSubStep,
      sentenceText: sentence,
    });

    if (speechSubStep === 'overlapping') {
      // Advance to Shadowing
      setSpeechSubStep('shadowing');
      // Auto-play at normal speed for shadowing
      setTimeout(() => {
        handlePlaySpeechCardAudio(1.0);
      }, 250);
    } else {
      // Advance to Next Card
      const nextCardIdx = (speechCardIndex + 1) % Math.max(1, ankiCards.length);
      setSpeechCardIndex(nextCardIdx);
      setSpeechSubStep('overlapping');

      setTimeout(() => {
        if (ankiCards[nextCardIdx]) {
          const nextSentence = ankiCards[nextCardIdx].sentence || ankiCards[nextCardIdx].exampleSentence || ankiCards[nextCardIdx].phrase;
          if (nextSentence) {
            speakText(nextSentence, speechRate, 'en-US', () => setIsPlayingAudio(false));
            setIsPlayingAudio(true);
          }
        }
      }, 300);
    }
  }, [currentSpeechCard, speechSubStep, speechCardIndex, ankiCards, speechRate, handlePlaySpeechCardAudio]);

  const handleSkipSpeechCard = () => {
    stopSpeech();
    const nextCardIdx = (speechCardIndex + 1) % Math.max(1, ankiCards.length);
    setSpeechCardIndex(nextCardIdx);
    setSpeechSubStep('overlapping');
  };

  const handlePrevSpeechCard = () => {
    stopSpeech();
    const prevIdx = speechCardIndex > 0 ? speechCardIndex - 1 : ankiCards.length - 1;
    setSpeechCardIndex(prevIdx);
    setSpeechSubStep('overlapping');
  };

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
        if (e.code === 'Space' || e.code === 'KeyR') {
          e.preventDefault();
          handlePlaySpeechCardAudio();
        } else if (e.code === 'Enter') {
          e.preventDefault();
          handleCompleteSpeechStep();
        } else if (e.code === 'KeyS' || e.code === 'ArrowRight') {
          e.preventDefault();
          handleSkipSpeechCard();
        } else if (e.code === 'KeyZ' || e.code === 'ArrowLeft') {
          e.preventDefault();
          handlePrevSpeechCard();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeMode, isRevealed, soundMissIndices, unknownVocabIndices, handlePlayAudio, handleCompleteQuestion, handlePlaySpeechCardAudio, handleCompleteSpeechStep]);

  return (
    <div className="max-w-4xl mx-auto px-3 sm:px-6 py-4 sm:py-8 space-y-6 pb-28 animate-fadeIn">
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
        <div className="space-y-6 animate-fadeIn">
          {ankiCards.length === 0 ? (
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-8 sm:p-12 text-center space-y-4 shadow-xl">
              <div className="w-16 h-16 rounded-3xl bg-indigo-950 border border-indigo-500/30 flex items-center justify-center mx-auto text-indigo-400">
                <Mic className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h2 className="text-xl font-bold text-white">Ankiカードがまだありません</h2>
                <p className="text-xs sm:text-sm text-slate-400 max-w-md mx-auto">
                  「AI新規文で帯域特訓」で聞き取れなかった文や、Ankiに登録された英文がここにストックされます。
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
            <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 relative overflow-hidden">
              {/* Header & Badges */}
              <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                <div className="flex items-center space-x-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-bold flex items-center space-x-1">
                    <Mic className="w-3 h-3" />
                    <span>発話特訓 (Hot Priority)</span>
                  </span>
                  <span className="font-mono text-slate-400 text-xs">
                    {speechCardIndex + 1} / {ankiCards.length} 枚
                  </span>
                  {currentSpeechCard.targetSpeedRate && (
                    <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-mono text-[10px]">
                      🔒 登録 {currentSpeechCard.targetSpeedRate}x
                    </span>
                  )}
                </div>

                <div className="flex items-center space-x-2">
                  <span className="text-slate-500 text-[11px] font-mono">
                    累計発話: <strong className="text-amber-300">{currentSpeechCard.speechPracticeCount || 0}</strong> 回
                  </span>
                  <button
                    onClick={() => setIsCardListOpen(true)}
                    className="p-1.5 text-slate-400 hover:text-white bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-xl transition-colors"
                    title="カード一覧から選択"
                  >
                    <List className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Sub-step Indicator Banner */}
              <div className="flex items-center justify-between p-3 bg-slate-950/80 border border-slate-800 rounded-2xl">
                <div className="flex items-center space-x-3">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs ${
                    speechSubStep === 'overlapping'
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                      : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  }`}>
                    {speechSubStep === 'overlapping' ? '1' : '2'}
                  </div>
                  <div>
                    <span className="font-bold text-xs block text-white">
                      {speechSubStep === 'overlapping' ? 'Step 1: オーバーラッピング' : 'Step 2: シャドーイング'}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {speechSubStep === 'overlapping' ? '音声を流しながらぴったり重ねて声に出す' : '音声の少し後を追いかけて発話する'}
                    </span>
                  </div>
                </div>

                {/* Speed selector */}
                <div className="flex items-center space-x-1">
                  {SPEECH_PRACTICE_RATES.map(r => (
                    <button
                      key={r.value}
                      onClick={() => setSpeechRate(r.value)}
                      className={`px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold transition-all ${
                        speechRate === r.value
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Main Sentence Area */}
              <div className="p-6 bg-slate-950/90 border border-slate-800 rounded-2xl space-y-4 text-center">
                {/* Audio Play Trigger */}
                <button
                  onClick={() => handlePlaySpeechCardAudio()}
                  className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto transition-all ${
                    isPlayingAudio
                      ? 'bg-gradient-to-tr from-indigo-500 to-purple-600 text-white shadow-2xl shadow-indigo-500/50 scale-105 animate-pulse'
                      : 'bg-slate-900 hover:bg-slate-800 border-2 border-slate-700 text-indigo-400 shadow-xl hover:scale-105'
                  }`}
                  title="音声を再生 (Space / R)"
                >
                  {isPlayingAudio ? (
                    <Volume2 className="w-8 h-8 text-white animate-bounce" />
                  ) : (
                    <Play className="w-8 h-8 text-indigo-400 ml-1" />
                  )}
                </button>

                {/* Sentence English Display */}
                {speechSubStep === 'overlapping' || showEnglishInShadowing ? (
                  <div className="space-y-2">
                    <p className="text-lg sm:text-2xl font-bold text-white font-serif leading-relaxed px-2">
                      {highlightMarkedTokensInSentence(
                        currentSpeechCard.sentence || currentSpeechCard.exampleSentence || currentSpeechCard.phrase,
                        currentSpeechCard.markedTokens
                      )}
                    </p>
                  </div>
                ) : (
                  <div className="py-4 space-y-2">
                    <p className="text-sm font-bold text-slate-400">英文は非表示です（音声だけでシャドーイング）</p>
                    <button
                      onClick={() => setShowEnglishInShadowing(true)}
                      className="inline-flex items-center space-x-1 px-3 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 rounded-xl text-xs"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>英文を見る</span>
                    </button>
                  </div>
                )}

                {/* Translation Box */}
                {(currentSpeechCard.translation || currentSpeechCard.meaning) && (
                  <div className="p-3 bg-slate-900/60 border border-slate-800/80 rounded-xl text-xs text-slate-300 max-w-lg mx-auto">
                    <span className="text-[10px] font-bold text-slate-500 block mb-0.5">日本語訳:</span>
                    {currentSpeechCard.translation || currentSpeechCard.meaning}
                  </div>
                )}

                {/* Explanation note */}
                {(currentSpeechCard.englishExplanation || currentSpeechCard.contextNote) && (
                  <div className="text-[11px] text-purple-300/80 max-w-md mx-auto">
                    💡 {currentSpeechCard.englishExplanation || currentSpeechCard.contextNote}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between gap-2 pt-2">
                <div className="flex items-center space-x-2">
                  <button
                    onClick={handlePrevSpeechCard}
                    className="p-3 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white rounded-2xl transition-colors text-xs font-bold"
                    title="1つ戻る (Z)"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleSkipSpeechCard}
                    className="px-3.5 py-3 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white rounded-2xl transition-colors text-xs font-bold"
                    title="スキップ (S)"
                  >
                    スキップ
                  </button>
                </div>

                <button
                  onClick={handleCompleteSpeechStep}
                  className="flex-1 py-3.5 px-6 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 active:scale-[0.99] text-white rounded-2xl text-xs sm:text-sm font-bold shadow-xl shadow-indigo-600/30 transition-all flex items-center justify-center space-x-2"
                >
                  <span>
                    {speechSubStep === 'overlapping' ? '完了 ➔ シャドーイングへ (Enter)' : '完了 ➔ 次のカードへ (Enter)'}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
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
                <span>Ankiカード一覧 ({ankiCards.length}枚)</span>
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
