import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Story } from '../types/story';
import {
  ArrowLeft, Headphones, RotateCcw,
  ChevronLeft, Eye, EyeOff,
  CheckCircle2, Trophy, BookOpen
} from 'lucide-react';
import { speakText, stopSpeech } from '../utils/speech';
import { splitStoryIntoSentences, StorySentenceItem } from '../utils/sentenceUtils';
import { recordSpeechPracticeProgress, recordSpeechPracticeEvent } from '../services/storage';

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
  onOpenListening,
}) => {
  const [speechRate, setSpeechRate] = useState<number>(1.0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showEnglishInShadowing, setShowEnglishInShadowing] = useState<boolean>(false);
  const [isAllCompleted, setIsAllCompleted] = useState<boolean>(false);

  // Sentences list
  const sentences = useMemo(() => {
    return splitStoryIntoSentences(story.storyContent);
  }, [story.storyContent]);

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

  const silentAudioRef = useRef<HTMLAudioElement | null>(null);
  const currentSentence: StorySentenceItem | undefined = sentences[currentIndex];
  const currentRatingInfo = useMemo(() => {
    const r = sentenceRatings[currentIndex]?.rating;
    return getRatingBadge(r);
  }, [sentenceRatings, currentIndex]);

  // Stop audio safely
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

  // Play audio for current sentence
  const playCurrentSentenceAudio = useCallback((index: number, currentSubStep: 'overlapping' | 'shadowing') => {
    const target = sentences[index];
    if (!target) return;

    stopAudio();
    setIsPlaying(true);

    // Record speech practice attempt event for insights & daily progress
    recordSpeechPracticeEvent({
      storyId: story.id,
      storyTitle: story.title,
      sentenceIdx: index,
      subStep: currentSubStep,
      sentenceText: target.text,
    });

    try {
      if (!silentAudioRef.current) {
        silentAudioRef.current = new Audio(SILENT_AUDIO_URI);
        silentAudioRef.current.loop = true;
      }
      silentAudioRef.current.play().catch(() => {});
    } catch (_) {}

    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: `[発話 ${index + 1}/${sentences.length} - ${currentSubStep === 'overlapping' ? 'オーバーラップ' : 'シャドーイング'}] ${target.text}`,
          artist: story.title,
          album: `CompileEng - ${story.cefrLevel || 'A2'} 発話特訓`,
        });
        navigator.mediaSession.playbackState = 'playing';
      } catch (_) {}
    }

    speakText(target.text, speechRate, 'en-US', () => {
      setIsPlaying(false);
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused';
      }
    });
  }, [sentences, speechRate, stopAudio, story.id, story.title, story.cefrLevel]);

  // Play on initial mount
  useEffect(() => {
    playCurrentSentenceAudio(currentIndex, subStep);
  }, []);

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

  // 1. Advance to Next Sub-Step: Overlapping ➔ Shadowing ➔ Next Sentence Overlapping
  const handleAdvanceStep = useCallback(() => {
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
        speakText(`全${sentences.length}文の発話特訓完了です。お疲れ様でした！`, 1.0, 'ja-JP');
      }
    }
  }, [subStep, currentIndex, sentences.length, saveProgress, playCurrentSentenceAudio, stopAudio]);

  // 2. Step Back (Undo mistake / go back to previous step)
  const handleStepBack = useCallback(() => {
    if (subStep === 'shadowing') {
      // Step 2 ➔ Step 1: Same sentence, return to Overlapping
      setSubStep('overlapping');
      setShowEnglishInShadowing(false);
      saveProgress(currentIndex, 'overlapping', 'in_progress');
      playCurrentSentenceAudio(currentIndex, 'overlapping');
    } else if (currentIndex > 0) {
      // Step 1 ➔ Previous sentence's Step 2 (Shadowing)
      const prevIdx = currentIndex - 1;
      setCurrentIndex(prevIdx);
      setSubStep('shadowing');
      setShowEnglishInShadowing(false);
      saveProgress(prevIdx, 'shadowing', 'in_progress');
      playCurrentSentenceAudio(prevIdx, 'shadowing');
    }
  }, [subStep, currentIndex, saveProgress, playCurrentSentenceAudio]);

  // Direct jump to sentence
  const handleJumpToSentence = useCallback((targetIdx: number) => {
    if (targetIdx >= 0 && targetIdx < sentences.length && targetIdx !== currentIndex) {
      setCurrentIndex(targetIdx);
      setSubStep('overlapping');
      setShowEnglishInShadowing(false);
      saveProgress(targetIdx, 'overlapping', 'in_progress');
      playCurrentSentenceAudio(targetIdx, 'overlapping');
    }
  }, [sentences.length, currentIndex, saveProgress, playCurrentSentenceAudio]);

  // Replay current sentence
  const handleReplay = useCallback(() => {
    playCurrentSentenceAudio(currentIndex, subStep);
  }, [currentIndex, subStep, playCurrentSentenceAudio]);

  // Toggle shadowing english visibility
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
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        handleStepBack();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleAdvanceStep, handleReplay, handleStepBack, toggleShadowingEnglish]);

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
              発話特訓（全{sentences.length}文）完走！🎉
            </h2>
            <p className="text-sm text-slate-300 max-w-md mx-auto leading-relaxed">
              『{story.title}』のオーバーラッピング＆シャドーイングをすべてやり切りました！口と聴覚野がネイティブのリズムに同期しています。
            </p>
          </div>

          <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={onBackToReader}
              className="w-full sm:w-auto flex items-center justify-center space-x-2 px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm font-bold transition-all shadow-md active:scale-95 cursor-pointer"
            >
              <BookOpen className="w-4 h-4 text-cyan-400" />
              <span>精読画面に戻る</span>
            </button>

            {onOpenListening && (
              <button
                onClick={onOpenListening}
                className="w-full sm:w-auto flex items-center justify-center space-x-2 px-6 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-sm font-black shadow-lg shadow-emerald-600/30 transition-all active:scale-95 cursor-pointer"
              >
                <Headphones className="w-4 h-4 text-white" />
                <span>耳トレで100% 🟢 完全制覇しにいく 🚀</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Calculate total sub-step progress: (currentIndex * 2 + (subStep === 'shadowing' ? 1 : 0)) / (sentences.length * 2)
  const totalSubSteps = sentences.length * 2;
  const currentSubStepNum = currentIndex * 2 + (subStep === 'shadowing' ? 2 : 1);
  const overallPercent = Math.round((currentSubStepNum / totalSubSteps) * 100);

  return (
    <div className="max-w-3xl mx-auto space-y-5 pb-72 sm:pb-80 animate-fadeIn">
      {/* 1. Top Header */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-6 shadow-2xl backdrop-blur-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <button
              onClick={onBackToReader}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-950 hover:bg-slate-850 text-slate-200 border border-slate-800 rounded-xl text-xs font-semibold transition-all group cursor-pointer"
              title="精読画面に戻る"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-cyan-400 group-hover:-translate-x-0.5 transition-transform" />
              <span>精読に戻る</span>
            </button>
            <button
              onClick={onBackToBookshelf}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors hidden sm:inline cursor-pointer"
            >
              本棚へ
            </button>

            <div>
              <div className="flex items-center space-x-2">
                <span className="px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/40 text-[11px] font-bold font-mono">
                  🎙️ 発話特訓（1文ずつ集中）
                </span>
                <span className="text-xs text-slate-400 font-medium">
                  {story.cefrLevel || 'A2'}
                </span>
              </div>
              <h1 className="text-base sm:text-lg font-bold text-white mt-0.5 line-clamp-1">
                {story.title}
              </h1>
            </div>
          </div>

          {/* Speed Selector */}
          <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-xl border border-slate-800 text-xs">
            <span className="text-slate-400 font-medium text-[11px]">速度:</span>
            {SPEECH_RATES.map(r => (
              <button
                key={r.value}
                type="button"
                onClick={() => setSpeechRate(r.value)}
                className={`px-1.5 py-0.5 rounded text-[11px] font-mono font-bold transition-all cursor-pointer ${
                  speechRate === r.value
                    ? 'bg-purple-500 text-slate-950 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* 2-Step Micro Pipeline Indicator for Current Sentence */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          {/* Sub-Step 1: Overlapping */}
          <div className={`p-2.5 sm:p-3 rounded-2xl border transition-all ${
            subStep === 'overlapping'
              ? 'bg-gradient-to-r from-teal-950/80 to-emerald-950/80 border-teal-500/60 shadow-lg shadow-teal-500/10 ring-1 ring-teal-500/30'
              : 'bg-slate-950/60 border-slate-800/80 opacity-60'
          }`}>
            <div className="flex items-center justify-between">
              <span className={`text-xs font-bold flex items-center gap-1.5 ${
                subStep === 'overlapping' ? 'text-teal-300' : 'text-slate-400'
              }`}>
                <span className="w-5 h-5 rounded-full bg-teal-500/20 text-teal-300 border border-teal-500/40 flex items-center justify-center text-[10px] font-bold font-mono">1</span>
                <span>🗣️ オーバーラッピング</span>
              </span>
              <span className="text-[10px] text-teal-400/80 font-medium">【英文を見る】</span>
            </div>
            <p className="text-[11px] text-slate-300 pt-1 leading-tight hidden sm:block">
              英文を目で追いながら、音声と完全にタイミングを合わせて同時に発声します。
            </p>
          </div>

          {/* Sub-Step 2: Shadowing */}
          <div className={`p-2.5 sm:p-3 rounded-2xl border transition-all ${
            subStep === 'shadowing'
              ? 'bg-gradient-to-r from-purple-950/80 to-indigo-950/80 border-purple-500/60 shadow-lg shadow-purple-500/10 ring-1 ring-purple-500/30'
              : 'bg-slate-950/60 border-slate-800/80 opacity-60'
          }`}>
            <div className="flex items-center justify-between">
              <span className={`text-xs font-bold flex items-center gap-1.5 ${
                subStep === 'shadowing' ? 'text-purple-300' : 'text-slate-400'
              }`}>
                <span className="w-5 h-5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/40 flex items-center justify-center text-[10px] font-bold font-mono">2</span>
                <span>🎧 シャドーイング</span>
              </span>
              <span className="text-[10px] text-purple-400/80 font-medium">【英文を隠す】</span>
            </div>
            <p className="text-[11px] text-slate-300 pt-1 leading-tight hidden sm:block">
              英文を隠し、耳に入ってくる音の1拍後ろを影のように追走して声に出します。
            </p>
          </div>
        </div>
      </div>

      {/* 2. Main Sentence Display Card */}
      <div className="space-y-4">
        {/* Progress Bar & Sentence Navigation Map */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3 sm:p-4 shadow-lg space-y-3">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2.5 py-0.5 rounded-md bg-purple-500/20 text-purple-300 font-mono font-bold">
                文 {currentIndex + 1} / {sentences.length}
              </span>
              <span className="text-[11px] text-slate-400">
                ({subStep === 'overlapping' ? '① オーバーラップ' : '② シャドーイング'})
              </span>
              {/* Listening Comprehension Badge for Current Sentence */}
              <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold border font-mono ${currentRatingInfo.bg} ${currentRatingInfo.text} ${currentRatingInfo.border}`}>
                🎧 {currentRatingInfo.label}
              </span>
            </div>

            <span className="text-[11px] text-purple-300 font-mono font-bold">
              全体進捗 {overallPercent}%
            </span>
          </div>

          {/* Mini Sentences Dots Map */}
          <div className="flex items-center gap-1.5 overflow-x-auto py-1 px-0.5 no-scrollbar">
            {sentences.map((_, idx) => {
              const r = sentenceRatings[idx]?.rating;
              const info = getRatingBadge(r);
              const isCurrent = idx === currentIndex;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleJumpToSentence(idx)}
                  className={`h-2.5 rounded-full transition-all shrink-0 cursor-pointer ${
                    isCurrent
                      ? 'w-7 ring-2 ring-purple-400 ring-offset-1 ring-offset-slate-950 ' + info.dot
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
              className={`p-6 sm:p-8 rounded-3xl space-y-3 animate-fadeIn shadow-lg border transition-all ${
                subStep === 'overlapping'
                  ? `bg-slate-900/90 ${currentRatingInfo.cardBorder}`
                  : `bg-slate-900/90 ${currentRatingInfo.cardBorder} cursor-pointer hover:bg-slate-900`
              }`}
              title={subStep === 'shadowing' ? 'クリックして英文を再び隠す (Vキー)' : undefined}
            >
              {/* Listening Rating Header inside box */}
              <div className="flex items-center justify-center gap-2 pb-1">
                <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold font-mono border ${currentRatingInfo.bg} ${currentRatingInfo.text} ${currentRatingInfo.border}`}>
                  リスニング判定: {currentRatingInfo.label}
                </span>
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
              className={`p-8 sm:p-10 bg-slate-900/40 border-2 border-dashed ${currentRatingInfo.cardBorder} hover:bg-slate-900/60 rounded-3xl space-y-3 animate-fadeIn cursor-pointer transition-all group`}
              title="クリックして英文をチラ見 (Vキー)"
            >
              {/* Rating indicator even when masked */}
              <div className="flex items-center justify-center gap-2">
                <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold font-mono border ${currentRatingInfo.bg} ${currentRatingInfo.text} ${currentRatingInfo.border}`}>
                  リスニング判定: {currentRatingInfo.label}
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

          {/* 2. Replay Audio Button (Middle, Medium Emphasis) */}
          <button
            type="button"
            onClick={handleReplay}
            className="w-full flex items-center justify-center space-x-2 py-3 px-4 bg-slate-900 hover:bg-slate-850 text-slate-200 hover:text-white rounded-2xl text-xs sm:text-sm font-bold border border-slate-700 hover:border-slate-600 transition-all cursor-pointer shadow-md active:scale-[0.98] group"
          >
            <RotateCcw className="w-4 h-4 text-purple-400 group-hover:rotate-[-45deg] transition-transform shrink-0" />
            <span>もう一度音声を聴いて発音する (R)</span>
          </button>

          {/* 3. Step Back Button (Bottom, Subtle Emphasis, Only if previous step exists) */}
          {(currentIndex > 0 || subStep === 'shadowing') && (
            <button
              type="button"
              onClick={handleStepBack}
              className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 bg-slate-950 hover:bg-slate-900 text-slate-400 hover:text-slate-200 rounded-2xl text-xs font-semibold border border-slate-800 hover:border-slate-700 transition-all cursor-pointer active:scale-[0.98]"
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
