import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Story } from '../types/story';
import {
  ArrowLeft,
  Headphones,
  RotateCcw,
  ChevronLeft,
  Eye,
  EyeOff,
  CheckCircle2,
  Trophy,
  BookOpen,
  BookmarkPlus,
  Sparkles,
  Check,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { speakText, stopSpeech } from '../utils/speech';
import { splitStoryIntoSentences, StorySentenceItem } from '../utils/sentenceUtils';
import {
  recordSpeechPracticeProgress,
  recordSpeechPracticeEvent,
  saveListeningCard,
  enrichListeningCard,
  loadVocabs,
  loadSettings,
} from '../services/storage';
import { enrichListeningSentenceWithGemini } from '../services/listeningLabService';

interface StoryShadowingViewProps {
  story: Story;
  onUpdateStory?: (story: Story) => void;
  onBackToReader: () => void;
  onBackToBookshelf: () => void;
  onOpenListening?: () => void;
}

const SPEECH_RATES = [
  { label: '0.8x', value: 0.8 },
  { label: '0.9x', value: 0.9 },
  { label: '1.0x', value: 1.0 },
  { label: '1.15x', value: 1.15 },
  { label: '1.25x', value: 1.25 },
];

const SILENT_AUDIO_URI = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

function getRatingBadge(rating?: 1 | 2 | 3 | 4) {
  if (rating === 4) {
    return {
      label: '🟢 即座に理解',
      bg: 'bg-emerald-500/20',
      text: 'text-emerald-300',
      border: 'border-emerald-500/40',
      cardBorder: 'border-emerald-500/40',
      dot: 'bg-emerald-400',
    };
  }
  if (rating === 3) {
    return {
      label: '🔵 理解',
      bg: 'bg-sky-500/20',
      text: 'text-sky-300',
      border: 'border-sky-500/40',
      cardBorder: 'border-sky-500/40',
      dot: 'bg-sky-400',
    };
  }
  if (rating === 2) {
    return {
      label: '🟡 曖昧 (要反復)',
      bg: 'bg-amber-500/20',
      text: 'text-amber-300',
      border: 'border-amber-500/40',
      cardBorder: 'border-amber-500/50 ring-1 ring-amber-500/20',
      dot: 'bg-amber-400',
    };
  }
  if (rating === 1) {
    return {
      label: '🔴 要復習 (重点)',
      bg: 'bg-rose-500/20',
      text: 'text-rose-300',
      border: 'border-rose-500/40',
      cardBorder: 'border-rose-500/60 ring-1 ring-rose-500/30',
      dot: 'bg-rose-400',
    };
  }
  return {
    label: '⚪ 未評価',
    bg: 'bg-slate-800/40',
    text: 'text-slate-400',
    border: 'border-slate-700/40',
    cardBorder: 'border-slate-800',
    dot: 'bg-slate-700',
  };
}

export const StoryShadowingView: React.FC<StoryShadowingViewProps> = ({
  story,
  onUpdateStory,
  onBackToReader,
  onBackToBookshelf,
  onOpenListening: _onOpenListening,
}) => {
  const [speechRate, setSpeechRate] = useState<number>(1.0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showEnglishInShadowing, setShowEnglishInShadowing] = useState<boolean>(false);
  const [isAllCompleted, setIsAllCompleted] = useState<boolean>(false);

  // Sentences list
  const sentences = useMemo(() => {
    return splitStoryIntoSentences(story.storyContent);
  }, [story.storyContent]);

  // Japanese translations per sentence
  const jaSentences = useMemo(() => {
    return (story.japaneseTranslation || '')
      .replace(/\r\n/g, '\n')
      .split(/(?<=[。！？\n])\s*/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }, [story.japaneseTranslation]);

  // Listening ratings map
  const sentenceRatings = useMemo(() => {
    return story.sentenceRatings || story.listeningMetrics?.sentenceRatings || {};
  }, [story.sentenceRatings, story.listeningMetrics]);

  // Initial sentence and sub-step from saved progress
  const initialSentenceIdx = useMemo(() => {
    return Math.min(Math.max(0, sentences.length - 1), Math.max(0, story.practiceSentenceIdx || 0));
  }, [story.practiceSentenceIdx, sentences.length]);

  const initialSubStep = useMemo(() => {
    return story.practiceSubStep || 'overlapping';
  }, [story.practiceSubStep]);

  const [currentIndex, setCurrentIndex] = useState<number>(initialSentenceIdx);
  const [subStep, setSubStep] = useState<'overlapping' | 'shadowing'>(initialSubStep);

  // Anki Listening card state & Background Enrichment tracking
  const [savedListeningCards, setSavedListeningCards] = useState<Map<string, string>>(() => {
    const map = new Map<string, string>();
    try {
      const vocabs = loadVocabs();
      vocabs
        .filter(v => v.focusType === 'listening')
        .forEach(v => {
          const text = (v.sentence || v.phrase || '').trim().toLowerCase();
          if (text) map.set(text, v.id);
        });
    } catch (_) {}
    return map;
  });

  const [enrichingCardIds, setEnrichingCardIds] = useState<Set<string>>(new Set());
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const silentAudioRef = useRef<HTMLAudioElement | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  const currentSentence: StorySentenceItem | undefined = sentences[currentIndex];
  const currentSentenceKey = (currentSentence?.text || '').trim().toLowerCase();
  const currentSavedCardId = savedListeningCards.get(currentSentenceKey);
  const isCurrentSentenceSaved = Boolean(currentSavedCardId);
  const isCurrentEnriching = currentSavedCardId ? enrichingCardIds.has(currentSavedCardId) : false;

  const currentRatingInfo = useMemo(() => {
    const r = sentenceRatings[currentIndex]?.rating;
    return getRatingBadge(r);
  }, [sentenceRatings, currentIndex]);

  // Show temporary toast message
  const showToast = useCallback((msg: string, durationMs: number = 3000) => {
    if (toastTimeoutRef.current) {
      window.clearTimeout(toastTimeoutRef.current);
    }
    setToastMessage(msg);
    toastTimeoutRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimeoutRef.current = null;
    }, durationMs);
  }, []);

  // Stop audio helper
  const stopAudio = useCallback(() => {
    stopSpeech();
    setIsPlaying(false);
    try {
      if (silentAudioRef.current) {
        silentAudioRef.current.pause();
      }
    } catch (_) {}
  }, []);

  // Play audio for current sentence
  const playCurrentSentenceAudio = useCallback((index: number, step: 'overlapping' | 'shadowing') => {
    const sent = sentences[index];
    if (!sent) return;

    stopAudio();
    setIsPlaying(true);

    try {
      if (silentAudioRef.current) {
        silentAudioRef.current.currentTime = 0;
        silentAudioRef.current.play().catch(() => {});
      }
    } catch (_) {}

    const rateToUse = step === 'overlapping' ? speechRate : 1.0;
    speakText(
      sent.text,
      rateToUse,
      'en-US',
      () => {
        setIsPlaying(false);
      }
    );
  }, [sentences, speechRate, stopAudio]);

  // Save progress helper
  const saveProgress = useCallback((sentenceIdx: number, newSubStep: 'overlapping' | 'shadowing', status: 'unstarted' | 'in_progress' | 'completed') => {
    const updated = recordSpeechPracticeProgress(
      story.id,
      sentenceIdx,
      newSubStep,
      status
    );
    if (updated && onUpdateStory) {
      onUpdateStory(updated);
    }
  }, [story.id, onUpdateStory]);

  // -------------------------------------------------------------------------
  // Ankiリスニングカード登録（並列バックグラウンド英英日AI解析）
  // -------------------------------------------------------------------------
  const handleSaveToListeningAnki = useCallback(async () => {
    if (!currentSentence) return;
    const cleanText = currentSentence.text.trim();
    if (!cleanText) return;

    const sentenceJa = jaSentences[currentIndex] || (currentIndex === 0 ? story.japaneseTranslation : '');

    // 1. 即座にAnkiリスニングカードを作成・保存（UIをブロックしない）
    const speed = speechRate || 1.0;
    const newCard = saveListeningCard({
      sentence: cleanText,
      translation: sentenceJa,
      targetSpeedRate: speed,
      cefrLevel: story.cefrLevel,
      englishExplanation: `Story: ${story.title}`,
    });

    const key = cleanText.toLowerCase();
    setSavedListeningCards(prev => new Map(prev).set(key, newCard.id));
    setEnrichingCardIds(prev => new Set(prev).add(newCard.id));

    confetti({ particleCount: 20, spread: 50, origin: { y: 0.7 } });
    showToast('🎧 リスニングAnkiに保存しました！ バックグラウンドで英英日解説を生成中...', 3500);

    // 2. 非同期（並列）でGeminiによる英英日・音声変化の解析を実行
    const settings = loadSettings();
    if (settings.geminiApiKey) {
      enrichListeningSentenceWithGemini({
        cardId: newCard.id,
        sentenceEn: cleanText,
        contextJa: sentenceJa,
        storyTitle: story.title,
        apiKey: settings.geminiApiKey,
        model: settings.geminiModel,
      }).then((result) => {
        if (result) {
          enrichListeningCard(newCard.id, {
            translation: result.translation,
            englishExplanation: result.englishExplanation,
            markedTokens: result.markedTokens,
          });
          showToast('✨ リスニングカードの英英日解説が完了しました！', 3000);
        }
        setEnrichingCardIds(prev => {
          const next = new Set(prev);
          next.delete(newCard.id);
          return next;
        });
      }).catch(err => {
        console.warn('Background enrichment failed', err);
        setEnrichingCardIds(prev => {
          const next = new Set(prev);
          next.delete(newCard.id);
          return next;
        });
      });
    } else {
      setEnrichingCardIds(prev => {
        const next = new Set(prev);
        next.delete(newCard.id);
        return next;
      });
    }
  }, [currentSentence, currentIndex, jaSentences, story, speechRate, showToast]);

  // 1. Advance to Next Sub-Step: Overlapping ➔ Shadowing ➔ Next Sentence Overlapping
  const handleAdvanceStep = useCallback(() => {
    // Record utterance event for Mastery Analytics
    if (currentSentence) {
      recordSpeechPracticeEvent({
        storyId: story.id,
        storyTitle: story.title,
        sentenceIdx: currentIndex,
        subStep: subStep,
        sentenceText: currentSentence.text,
      });
    }

    if (subStep === 'overlapping') {
      // Step 1 ➔ Step 2: Same sentence, switch to Shadowing (text hidden)
      setSubStep('shadowing');
      setShowEnglishInShadowing(false);
      saveProgress(currentIndex, 'shadowing', 'in_progress');
      playCurrentSentenceAudio(currentIndex, 'shadowing');
    } else {
      // Step 2 (Shadowing) ➔ Next Sentence's Step 1 (Overlapping)
      if (currentIndex + 1 < sentences.length) {
        const nextIdx = currentIndex + 1;
        setCurrentIndex(nextIdx);
        setSubStep('overlapping');
        setShowEnglishInShadowing(false);
        saveProgress(nextIdx, 'overlapping', 'in_progress');
        playCurrentSentenceAudio(nextIdx, 'overlapping');
      } else {
        // All sentences completed!
        stopAudio();
        setIsAllCompleted(true);
        saveProgress(currentIndex, 'shadowing', 'completed');
        confetti({
          particleCount: 80,
          spread: 80,
          origin: { y: 0.6 },
        });
      }
    }
  }, [subStep, currentIndex, sentences.length, currentSentence, story.id, story.title, saveProgress, playCurrentSentenceAudio, stopAudio]);

  // 2. Step Back (Previous Sub-Step or Previous Sentence)
  const handleStepBack = useCallback(() => {
    if (subStep === 'shadowing') {
      // Return to Overlapping of current sentence
      setSubStep('overlapping');
      setShowEnglishInShadowing(false);
      saveProgress(currentIndex, 'overlapping', 'in_progress');
      playCurrentSentenceAudio(currentIndex, 'overlapping');
    } else if (currentIndex > 0) {
      // Return to Shadowing of previous sentence
      const prevIdx = currentIndex - 1;
      setCurrentIndex(prevIdx);
      setSubStep('shadowing');
      setShowEnglishInShadowing(false);
      saveProgress(prevIdx, 'shadowing', 'in_progress');
      playCurrentSentenceAudio(prevIdx, 'shadowing');
    }
  }, [subStep, currentIndex, saveProgress, playCurrentSentenceAudio]);

  // 3. Replay Current Sentence Audio
  const handleReplay = useCallback(() => {
    playCurrentSentenceAudio(currentIndex, subStep);
  }, [currentIndex, subStep, playCurrentSentenceAudio]);

  // 4. Toggle English visibility in Shadowing step
  const toggleShadowingEnglish = useCallback(() => {
    if (subStep === 'shadowing') {
      setShowEnglishInShadowing(prev => !prev);
    }
  }, [subStep]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        handleAdvanceStep();
      } else if (e.code === 'KeyR') {
        e.preventDefault();
        handleReplay();
      } else if (e.code === 'KeyV') {
        e.preventDefault();
        toggleShadowingEnglish();
      } else if (e.code === 'KeyA') {
        e.preventDefault();
        handleSaveToListeningAnki();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        handleStepBack();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleAdvanceStep, handleReplay, handleStepBack, toggleShadowingEnglish, handleSaveToListeningAnki]);

  // MediaSession API handler
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    try {
      navigator.mediaSession.setActionHandler('play', () => {
        handleReplay();
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        stopAudio();
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        handleAdvanceStep();
      });
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        handleStepBack();
      });
    } catch (_) {}

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
  }, [handleReplay, stopAudio, handleAdvanceStep, handleStepBack]);

  // All-completed celebration screen
  if (isAllCompleted) {
    return (
      <div className="max-w-2xl mx-auto space-y-6 py-8 animate-fadeIn text-center">
        <div className="bg-slate-900/95 border border-purple-500/40 rounded-3xl p-8 sm:p-12 shadow-2xl space-y-6 backdrop-blur-xl">
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-purple-500 via-indigo-600 to-cyan-500 flex items-center justify-center mx-auto shadow-xl shadow-purple-500/25">
            <Trophy className="w-10 h-10 text-white" />
          </div>

          <div className="space-y-2">
            <span className="px-3 py-1 rounded-full bg-purple-500/20 text-purple-300 font-bold border border-purple-500/30 text-xs uppercase tracking-wider">
              Speech Practice Completed
            </span>
            <h2 className="text-2xl sm:text-3xl font-black text-white">
              全{sentences.length}文の発話特訓をコンプリート！
            </h2>
            <p className="text-xs sm:text-sm text-slate-400">
              「オーバーラッピング」と「シャドーイング」の2段階トレーニングを達成しました。
            </p>
          </div>

          <div className="p-4 bg-slate-950/80 rounded-2xl border border-slate-800 flex items-center justify-around text-center">
            <div>
              <div className="text-xs text-slate-400 font-medium">総センテンス数</div>
              <div className="text-xl font-black text-purple-300">{sentences.length} 文</div>
            </div>
            <div className="h-8 w-px bg-slate-800" />
            <div>
              <div className="text-xs text-slate-400 font-medium">総発話回数</div>
              <div className="text-xl font-black text-cyan-300">{sentences.length * 2} 回</div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              onClick={() => {
                setIsAllCompleted(false);
                setCurrentIndex(0);
                setSubStep('overlapping');
                setShowEnglishInShadowing(false);
                saveProgress(0, 'overlapping', 'in_progress');
                playCurrentSentenceAudio(0, 'overlapping');
              }}
              className="flex-1 py-3.5 px-5 bg-slate-800 hover:bg-slate-750 text-slate-200 rounded-2xl text-xs sm:text-sm font-bold border border-slate-700 transition-all flex items-center justify-center space-x-2 cursor-pointer shadow-lg active:scale-95"
            >
              <RotateCcw className="w-4 h-4" />
              <span>もう一度最初から練習する</span>
            </button>

            <button
              onClick={onBackToReader}
              className="flex-1 py-3.5 px-5 bg-gradient-to-r from-purple-600 via-indigo-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 text-white rounded-2xl text-xs sm:text-sm font-black transition-all flex items-center justify-center space-x-2 cursor-pointer shadow-xl shadow-purple-600/30 active:scale-95"
            >
              <BookOpen className="w-4 h-4" />
              <span>リーダーに戻る</span>
            </button>

            {onBackToBookshelf && (
              <button
                onClick={onBackToBookshelf}
                className="py-3.5 px-4 bg-slate-800 hover:bg-slate-750 text-slate-300 rounded-2xl text-xs sm:text-sm font-bold border border-slate-700 transition-all flex items-center justify-center space-x-1.5 cursor-pointer active:scale-95"
              >
                <span>本棚へ</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Progress percentage
  const currentStepNum = currentIndex * 2 + (subStep === 'overlapping' ? 1 : 2);
  const totalSteps = sentences.length * 2;
  const overallPercent = Math.round((currentStepNum / totalSteps) * 100);

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-48 animate-fadeIn relative">
      <audio ref={silentAudioRef} src={SILENT_AUDIO_URI} preload="auto" loop />

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className="fixed top-16 left-1/2 transform -translate-x-1/2 z-50 px-4 py-2.5 rounded-2xl bg-slate-900/95 border border-cyan-500/50 shadow-2xl text-cyan-200 text-xs sm:text-sm font-bold flex items-center space-x-2 animate-bounce backdrop-blur-md">
          <Sparkles className="w-4 h-4 text-cyan-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 1. Header Navigation & Mode / Speed Controls */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xl backdrop-blur-md space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button
              onClick={onBackToReader}
              className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
              title="リーダーに戻る"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center gap-1">
                  <Headphones className="w-3 h-3 inline" />
                  <span>発話特訓モード</span>
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  文 {currentIndex + 1} / {sentences.length}
                </span>
              </div>
              <h1 className="text-base sm:text-lg font-bold text-white truncate max-w-[200px] sm:max-w-md">
                {story.title}
              </h1>
            </div>
          </div>

          {/* Speed Selector (Active in Overlapping) */}
          <div className="flex items-center space-x-1 bg-slate-950/80 p-1 rounded-2xl border border-slate-800">
            {SPEECH_RATES.map(rate => (
              <button
                key={rate.value}
                type="button"
                onClick={() => {
                  setSpeechRate(rate.value);
                  if (subStep === 'overlapping') {
                    stopAudio();
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

        {/* 2-Step Stage Indicator */}
        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-800/80">
          <div
            className={`p-2.5 sm:p-3 rounded-2xl border transition-all text-center flex items-center justify-center space-x-2 ${
              subStep === 'overlapping'
                ? 'bg-gradient-to-r from-teal-500/20 to-emerald-500/20 border-teal-500/40 text-teal-300 ring-1 ring-teal-500/30'
                : 'bg-slate-950/40 border-slate-800/60 text-slate-500'
            }`}
          >
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${
              subStep === 'overlapping' ? 'bg-teal-500 text-slate-950' : 'bg-slate-800 text-slate-400'
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
              subStep === 'shadowing'
                ? 'bg-gradient-to-r from-purple-500/20 to-indigo-500/20 border-purple-500/40 text-purple-300 ring-1 ring-purple-500/30'
                : 'bg-slate-950/40 border-slate-800/60 text-slate-500'
            }`}
          >
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${
              subStep === 'shadowing' ? 'bg-purple-500 text-white' : 'bg-slate-800 text-slate-400'
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
            <span className="font-semibold text-slate-300">特訓進捗ミニマップ</span>
            <span className="font-mono text-purple-300 font-bold">{overallPercent}% 完了</span>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-thin">
            {sentences.map((sent, idx) => {
              const isCurrent = idx === currentIndex;
              const isPast = idx < currentIndex;
              const r = sentenceRatings[idx]?.rating;
              const info = getRatingBadge(r);

              return (
                <button
                  key={sent.id}
                  type="button"
                  onClick={() => {
                    setCurrentIndex(idx);
                    setSubStep('overlapping');
                    setShowEnglishInShadowing(false);
                    saveProgress(idx, 'overlapping', 'in_progress');
                    playCurrentSentenceAudio(idx, 'overlapping');
                  }}
                  className={`h-3 rounded-full transition-all duration-200 shrink-0 cursor-pointer ${
                    isCurrent
                      ? 'w-8 bg-purple-400 ring-2 ring-purple-400/50'
                      : isPast
                      ? 'w-3.5 bg-slate-600 hover:bg-slate-500'
                      : `w-3 hover:w-5 opacity-80 hover:opacity-100 ` + info.dot
                  }`}
                  title={`文 ${idx + 1}: ${info.label}`}
                />
              );
            })}
          </div>

          <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden border border-slate-800/80">
            <div
              className="bg-gradient-to-r from-teal-400 via-purple-500 to-indigo-400 h-full transition-all duration-300"
              style={{ width: `${overallPercent}%` }}
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
                  isPlaying
                    ? subStep === 'overlapping'
                      ? 'bg-gradient-to-t from-teal-400 to-emerald-300 animate-pulse'
                      : 'bg-gradient-to-t from-purple-400 to-indigo-300 animate-pulse'
                    : 'bg-slate-800'
                }`}
                style={{
                  height: isPlaying ? `${Math.max(16, heightRatio * 44)}px` : '10px',
                  animationDelay: `${i * 100}ms`,
                }}
              />
            ))}
          </div>

          {/* English Text: Visible in Overlapping, Toggleable in Shadowing */}
          {subStep === 'overlapping' || showEnglishInShadowing ? (
            <div
              onClick={() => {
                if (subStep === 'shadowing') {
                  setShowEnglishInShadowing(false);
                }
              }}
              className={`p-6 sm:p-8 rounded-3xl space-y-3 animate-fadeIn shadow-lg border transition-all relative ${
                subStep === 'overlapping'
                  ? `bg-slate-900/90 ${currentRatingInfo.cardBorder}`
                  : `bg-slate-900/90 ${currentRatingInfo.cardBorder} cursor-pointer hover:bg-slate-900`
              }`}
              title={subStep === 'shadowing' ? 'クリックして英文を再び隠す (Vキー)' : undefined}
            >
              {/* Badges & Actions inside box */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
                <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold font-mono border ${currentRatingInfo.bg} ${currentRatingInfo.text} ${currentRatingInfo.border}`}>
                  リスニング判定: {currentRatingInfo.label}
                </span>

                {/* Dedicated Anki Listening Card Send Button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSaveToListeningAnki();
                  }}
                  className={`inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer ${
                    isCurrentSentenceSaved
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30'
                      : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-cyan-600/25 ring-1 ring-cyan-400/40'
                  }`}
                  title="この文をリスニングAnkiに保存 (Aキー)"
                >
                  {isCurrentSentenceSaved ? (
                    <Check className="w-3.5 h-3.5 text-cyan-400" />
                  ) : (
                    <BookmarkPlus className="w-3.5 h-3.5 text-white" />
                  )}
                  <span>
                    {isCurrentSentenceSaved ? `✅ リスニングAnki登録済 (${speechRate}x)` : '🎧 リスニングAnkiに送る (A)'}
                  </span>
                  {isCurrentEnriching && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-cyan-300 animate-pulse ml-1">
                      <Sparkles className="w-3 h-3" />
                      英英日解析中...
                    </span>
                  )}
                </button>
              </div>

              <p className="text-xl sm:text-2xl font-bold text-white leading-relaxed font-serif">
                {currentSentence?.text}
              </p>

              {subStep === 'shadowing' && (
                <div className="text-xs text-purple-400 font-bold flex items-center justify-center gap-1.5 pt-2 border-t border-purple-500/20">
                  <EyeOff className="w-4 h-4" />
                  <span>英文を表示中（クリック または Vキー で再び隠す）</span>
                </div>
              )}
            </div>
          ) : (
            <div
              onClick={() => setShowEnglishInShadowing(true)}
              className={`p-8 sm:p-10 bg-slate-900/40 border-2 border-dashed ${currentRatingInfo.cardBorder} hover:bg-slate-900/60 rounded-3xl space-y-3 animate-fadeIn cursor-pointer transition-all group relative`}
              title="クリックして英文をチラ見 (Vキー)"
            >
              {/* Badges & Actions even when masked */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold font-mono border ${currentRatingInfo.bg} ${currentRatingInfo.text} ${currentRatingInfo.border}`}>
                  リスニング判定: {currentRatingInfo.label}
                </span>

                {/* Dedicated Anki Listening Card Send Button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSaveToListeningAnki();
                  }}
                  className={`inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer ${
                    isCurrentSentenceSaved
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30'
                      : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-cyan-600/25 ring-1 ring-cyan-400/40'
                  }`}
                  title="この文をリスニングAnkiに保存 (Aキー)"
                >
                  {isCurrentSentenceSaved ? (
                    <Check className="w-3.5 h-3.5 text-cyan-400" />
                  ) : (
                    <BookmarkPlus className="w-3.5 h-3.5 text-white" />
                  )}
                  <span>
                    {isCurrentSentenceSaved ? `✅ リスニングAnki登録済 (${speechRate}x)` : '🎧 リスニングAnkiに送る (A)'}
                  </span>
                  {isCurrentEnriching && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-cyan-300 animate-pulse ml-1">
                      <Sparkles className="w-3 h-3" />
                      英英日解析中...
                    </span>
                  )}
                </button>
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
            onClick={handleAdvanceStep}
            className={`w-full flex items-center justify-center space-x-2 py-3.5 px-6 rounded-2xl text-sm sm:text-base font-black shadow-xl transition-all active:scale-[0.98] cursor-pointer ${
              subStep === 'overlapping'
                ? 'bg-gradient-to-r from-teal-600 via-emerald-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 text-white shadow-teal-600/30 ring-1 ring-teal-400/40'
                : 'bg-gradient-to-r from-purple-600 via-indigo-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 text-white shadow-purple-600/30 ring-1 ring-purple-400/40'
            }`}
          >
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <span className="truncate">
              {subStep === 'overlapping'
                ? '🗣️ オーバーラップ完了 ➔ ② シャドーイングへ (Space / Enter)'
                : currentIndex + 1 < sentences.length
                ? `🎧 シャドーイング完了 ➔ 次の文 (文 ${currentIndex + 2}) へ (Space / Enter)`
                : '🎉 全文の発話特訓を完了する！'}
            </span>
          </button>

          {/* 2. Secondary Row: Replay & Anki Send */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleReplay}
              className="flex-1 flex items-center justify-center space-x-2 py-3 px-4 bg-slate-900 hover:bg-slate-850 text-slate-200 hover:text-white rounded-2xl text-xs sm:text-sm font-bold border border-slate-700 hover:border-slate-600 transition-all cursor-pointer shadow-md active:scale-[0.98] group"
            >
              <RotateCcw className="w-4 h-4 text-purple-400 group-hover:rotate-[-45deg] transition-transform shrink-0" />
              <span>もう一度聴く (R)</span>
            </button>

            <button
              type="button"
              onClick={handleSaveToListeningAnki}
              className={`flex-1 flex items-center justify-center space-x-2 py-3 px-4 rounded-2xl text-xs sm:text-sm font-bold border transition-all cursor-pointer shadow-md active:scale-[0.98] ${
                isCurrentSentenceSaved
                  ? 'bg-cyan-950/60 border-cyan-500/40 text-cyan-300'
                  : 'bg-slate-900 hover:bg-slate-850 border-slate-700 text-cyan-300 hover:text-cyan-200'
              }`}
            >
              {isCurrentSentenceSaved ? (
                <Check className="w-4 h-4 text-cyan-400 shrink-0" />
              ) : (
                <BookmarkPlus className="w-4 h-4 text-cyan-400 shrink-0" />
              )}
              <span className="truncate">
                {isCurrentSentenceSaved ? 'Anki登録済' : 'Ankiリスニング (A)'}
              </span>
            </button>
          </div>

          {/* 3. Step Back Button (Bottom, Subtle Emphasis, Only if previous step exists) */}
          {(currentIndex > 0 || subStep === 'shadowing') && (
            <button
              type="button"
              onClick={handleStepBack}
              className="w-full flex items-center justify-center space-x-2 py-2 px-4 bg-slate-950 hover:bg-slate-900 text-slate-400 hover:text-slate-200 rounded-2xl text-xs font-semibold border border-slate-800 hover:border-slate-700 transition-all cursor-pointer active:scale-[0.98]"
            >
              <ChevronLeft className="w-4 h-4 shrink-0" />
              <span>
                {subStep === 'shadowing'
                  ? '⏮️ ① オーバーラップに戻る (←キー)'
                  : `⏮️ 前の文 (文 ${currentIndex}) のシャドーイングに戻る (←キー)`}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
