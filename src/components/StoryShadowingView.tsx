import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Story } from '../types/story';
import {
  ArrowLeft, Headphones, Mic, RotateCcw,
  ChevronLeft, ChevronRight, Eye, EyeOff,
  CheckCircle2
} from 'lucide-react';
import { speakText, stopSpeech } from '../utils/speech';
import { splitStoryIntoSentences, StorySentenceItem } from '../utils/sentenceUtils';
import { recordStoryPracticeProgress } from '../services/storage';

interface StoryShadowingViewProps {
  story: Story;
  onUpdateStory?: (story: Story) => void;
  onBackToReader: () => void;
  onBackToBookshelf: () => void;
}

export type ShadowingPracticeMode = 'overlapping' | 'shadowing';

const SPEECH_RATES = [
  { label: '0.8x', value: 0.8 },
  { label: '0.9x', value: 0.9 },
  { label: '1.0x', value: 1.0 },
  { label: '1.15x', value: 1.15 },
  { label: '1.25x', value: 1.25 },
];

const SILENT_AUDIO_URI = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

export const StoryShadowingView: React.FC<StoryShadowingViewProps> = ({
  story,
  onUpdateStory,
  onBackToReader,
  onBackToBookshelf,
}) => {
  const [practiceMode, setPracticeMode] = useState<ShadowingPracticeMode>('overlapping');
  const [speechRate, setSpeechRate] = useState<number>(1.0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playStyle, setPlayStyle] = useState<'step_by_step' | 'continuous'>('step_by_step');
  
  // Sentences list
  const sentences = useMemo(() => {
    return splitStoryIntoSentences(story.storyContent);
  }, [story.storyContent]);

  // Initial resume index based on mode
  const initialIndex = useMemo(() => {
    if (practiceMode === 'shadowing') {
      return Math.min(sentences.length - 1, Math.max(0, story.shadowingLastSentenceIdx || 0));
    }
    return Math.min(sentences.length - 1, Math.max(0, story.overlappingLastSentenceIdx || 0));
  }, [practiceMode, story.shadowingLastSentenceIdx, story.overlappingLastSentenceIdx, sentences.length]);

  const [currentIndex, setCurrentIndex] = useState<number>(initialIndex);
  const [showEnglishInShadowing, setShowEnglishInShadowing] = useState<boolean>(false);
  const [notificationToast, setNotificationToast] = useState<string | null>(null);

  const silentAudioRef = useRef<HTMLAudioElement | null>(null);
  const currentSentence: StorySentenceItem | undefined = sentences[currentIndex];

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

  // Play audio for target sentence
  const playSentenceAudio = useCallback((index: number) => {
    const target = sentences[index];
    if (!target) return;

    stopAudio();
    setIsPlaying(true);

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
          title: `[発話特訓 ${index + 1}/${sentences.length}] ${target.text}`,
          artist: story.title,
          album: `CompileEng - ${practiceMode === 'overlapping' ? 'オーバーラッピング' : 'シャドーイング'}`,
        });
        navigator.mediaSession.playbackState = 'playing';
      } catch (_) {}
    }

    speakText(target.text, speechRate, 'en-US', () => {
      setIsPlaying(false);
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused';
      }

      // If continuous mode, advance to next
      if (playStyle === 'continuous' && index + 1 < sentences.length) {
        setTimeout(() => {
          const nextIdx = index + 1;
          setCurrentIndex(nextIdx);
          saveProgress(nextIdx);
          playSentenceAudio(nextIdx);
        }, 500);
      }
    });
  }, [sentences, speechRate, stopAudio, story.title, practiceMode, playStyle]);

  // Save in-progress position
  const saveProgress = useCallback((sentenceIdx: number) => {
    const updated = recordStoryPracticeProgress(
      story.id,
      practiceMode,
      'in_progress',
      sentenceIdx
    );
    if (updated && onUpdateStory) {
      onUpdateStory(updated);
    }
  }, [story.id, practiceMode, onUpdateStory]);

  // Advance to next sentence
  const handleNext = useCallback(() => {
    if (currentIndex + 1 < sentences.length) {
      const nextIdx = currentIndex + 1;
      setCurrentIndex(nextIdx);
      saveProgress(nextIdx);
      playSentenceAudio(nextIdx);
    }
  }, [currentIndex, sentences.length, saveProgress, playSentenceAudio]);

  // Go to previous sentence
  const handlePrevious = useCallback(() => {
    if (currentIndex > 0) {
      const prevIdx = currentIndex - 1;
      setCurrentIndex(prevIdx);
      saveProgress(prevIdx);
      playSentenceAudio(prevIdx);
    }
  }, [currentIndex, saveProgress, playSentenceAudio]);

  // Replay current sentence
  const handleReplay = useCallback(() => {
    playSentenceAudio(currentIndex);
  }, [currentIndex, playSentenceAudio]);

  // Mark status as completed
  const handleMarkCompleted = (type: 'shadowing' | 'overlapping') => {
    const updated = recordStoryPracticeProgress(
      story.id,
      type,
      'completed',
      sentences.length - 1
    );
    if (updated && onUpdateStory) {
      onUpdateStory(updated);
    }
    const label = type === 'overlapping' ? 'オーバーラッピング' : 'シャドーイング';
    setNotificationToast(`🎉 『${story.title}』の${label}を「完了」として記録しました！`);
    setTimeout(() => {
      setNotificationToast(null);
    }, 4000);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        handleNext();
      } else if (e.code === 'KeyR') {
        e.preventDefault();
        handleReplay();
      } else if (e.code === 'KeyV') {
        e.preventDefault();
        setShowEnglishInShadowing(prev => !prev);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        handlePrevious();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        handleNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleNext, handleReplay, handlePrevious]);

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
        handleNext();
      });
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        handlePrevious();
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
  }, [handleReplay, stopAudio, handleNext, handlePrevious]);

  return (
    <div className="max-w-4xl mx-auto space-y-5 pb-64 sm:pb-56 animate-fadeIn">
      {/* Toast Notification */}
      {notificationToast && (
        <div className="fixed top-16 right-4 z-50 max-w-sm bg-emerald-600 border border-emerald-400 text-white px-4 py-3 rounded-2xl shadow-2xl backdrop-blur-md animate-slideDown flex items-center justify-between gap-3">
          <span className="text-xs sm:text-sm font-bold flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-200" />
            {notificationToast}
          </span>
          <button
            onClick={() => setNotificationToast(null)}
            className="text-white/80 hover:text-white text-xs font-bold px-1.5 py-0.5 rounded-lg hover:bg-emerald-700/50"
          >
            ✕
          </button>
        </div>
      )}

      {/* 1. Header Navigation & Mode Selector */}
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
                  🎙️ 発話特訓
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

          {/* Overlapping vs Shadowing Switcher */}
          <div className="flex items-center bg-slate-950 p-1 rounded-2xl border border-slate-800">
            <button
              type="button"
              onClick={() => {
                setPracticeMode('overlapping');
                stopAudio();
                const targetIdx = Math.min(sentences.length - 1, Math.max(0, story.overlappingLastSentenceIdx || 0));
                setCurrentIndex(targetIdx);
              }}
              className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                practiceMode === 'overlapping'
                  ? 'bg-gradient-to-r from-teal-600 to-emerald-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Mic className="w-3.5 h-3.5" />
              <span>🗣️ オーバーラッピング</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setPracticeMode('shadowing');
                stopAudio();
                const targetIdx = Math.min(sentences.length - 1, Math.max(0, story.shadowingLastSentenceIdx || 0));
                setCurrentIndex(targetIdx);
              }}
              className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                practiceMode === 'shadowing'
                  ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Headphones className="w-3.5 h-3.5" />
              <span>🎧 シャドーイング</span>
            </button>
          </div>
        </div>

        {/* Practice Mode Guide Banner */}
        <div className="p-3 bg-slate-950/80 border border-slate-850 rounded-2xl flex items-center justify-between text-xs flex-wrap gap-2">
          <div className="text-slate-300">
            {practiceMode === 'overlapping' ? (
              <span>🗣️ <strong>オーバーラッピング</strong>: 英文を見ながら、音声と完全にタイミングを合わせて発声します。</span>
            ) : (
              <span>🎧 <strong>シャドーイング</strong>: 音声の1拍後ろを影のように追いかけて復唱します（英文非表示推奨）。</span>
            )}
          </div>
          <div className="text-[11px] text-slate-500 font-mono">
            ※理解度やCEFRステータスは変化しません。口を動かすことに集中しましょう。
          </div>
        </div>
      </div>

      {/* 2. Main Practice Card */}
      <div className="space-y-4">
        {/* Progress bar & rate bar */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-2">
          <div className="flex items-center justify-between text-xs flex-wrap gap-2">
            <span className="font-bold text-slate-300 flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-md bg-purple-500/20 text-purple-300 font-mono font-bold">
                文 {currentIndex + 1} / {sentences.length}
              </span>
              <span className="text-[11px] text-slate-400">
                (途中再開位置は自動保存されます)
              </span>
            </span>

            <div className="flex items-center space-x-2">
              {/* Play style: Step by step vs continuous */}
              <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[10px] font-bold">
                <button
                  type="button"
                  onClick={() => setPlayStyle('step_by_step')}
                  className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                    playStyle === 'step_by_step'
                      ? 'bg-purple-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  1文ずつ
                </button>
                <button
                  type="button"
                  onClick={() => setPlayStyle('continuous')}
                  className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                    playStyle === 'continuous'
                      ? 'bg-purple-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  通し再生
                </button>
              </div>

              {/* Speed rates */}
              <div className="flex items-center gap-1 bg-slate-950 px-1.5 py-0.5 rounded-lg border border-slate-800">
                {SPEECH_RATES.map(r => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setSpeechRate(r.value)}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition-all cursor-pointer ${
                      speechRate === r.value
                        ? 'bg-purple-500 text-slate-950'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>

              <span className="text-[11px] text-slate-400 font-mono">
                {Math.round(((currentIndex + 1) / sentences.length) * 100)}%
              </span>
            </div>
          </div>

          <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
            <div
              className="bg-gradient-to-r from-teal-500 via-purple-500 to-indigo-400 h-full transition-all duration-300"
              style={{ width: `${((currentIndex + 1) / sentences.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Center Sentence Display */}
        <div className="bg-slate-950/90 border border-slate-800/90 rounded-3xl p-6 sm:p-10 space-y-6 text-center shadow-inner relative overflow-hidden min-h-[220px] flex flex-col justify-center">
          {/* Wave pulse animation */}
          <div className="flex items-center justify-center gap-1.5 py-2">
            {[0.4, 0.7, 1.0, 0.6, 0.9, 0.5, 0.8, 0.3].map((heightRatio, i) => (
              <div
                key={i}
                className={`w-1.5 rounded-full transition-all duration-200 ${
                  isPlaying
                    ? 'bg-gradient-to-t from-teal-400 to-purple-400 animate-pulse'
                    : 'bg-slate-800'
                }`}
                style={{
                  height: isPlaying ? `${Math.max(16, heightRatio * 44)}px` : '10px',
                  animationDelay: `${i * 100}ms`,
                }}
              />
            ))}
          </div>

          {/* Target Text */}
          {practiceMode === 'overlapping' || showEnglishInShadowing ? (
            <div className="p-5 sm:p-7 bg-slate-900/90 border border-slate-800 rounded-3xl space-y-3 animate-fadeIn shadow-lg">
              <p className="text-lg sm:text-2xl font-bold text-white leading-relaxed font-serif">
                {currentSentence?.text}
              </p>
              {practiceMode === 'shadowing' && (
                <div className="text-[10px] text-purple-400 font-medium">
                  👁️ 英文を表示中（慣れたら非表示にして耳だけ追走）
                </div>
              )}
            </div>
          ) : (
            <div className="p-8 bg-slate-900/40 border border-dashed border-slate-800 rounded-3xl space-y-3">
              <p className="text-sm text-slate-400 font-medium leading-relaxed">
                🎧 音の1拍後ろを影のように追いかけて声に出しましょう
              </p>
              <button
                type="button"
                onClick={() => setShowEnglishInShadowing(true)}
                className="text-xs font-bold text-purple-400 hover:text-purple-300 hover:underline transition-all cursor-pointer inline-flex items-center gap-1 pt-1"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>英文を表示して確認 (Vキー)</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 3. Sticky Bottom Dock for Speech Training */}
      <div
        className="fixed bottom-0 inset-x-0 z-50 bg-slate-950/95 backdrop-blur-xl border-t border-slate-800 shadow-2xl p-3 sm:p-4 space-y-2.5 max-w-4xl mx-auto"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 16px))' }}
      >
        {/* Row 1: Playback Controls */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Prev sentence */}
            {currentIndex > 0 && (
              <button
                type="button"
                onClick={handlePrevious}
                className="flex items-center space-x-1 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white rounded-xl text-xs font-bold border border-slate-700 transition-all cursor-pointer shadow-sm active:scale-95"
                title="1つ前の文へ戻る (←キー)"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>前の文</span>
              </button>
            )}

            {/* Replay current */}
            <button
              type="button"
              onClick={handleReplay}
              className="flex items-center space-x-1.5 px-3.5 py-2 bg-gradient-to-r from-purple-600/30 to-indigo-600/30 hover:from-purple-600/40 hover:to-indigo-600/40 text-purple-200 hover:text-white rounded-xl text-xs font-bold border border-purple-500/40 hover:border-purple-400 transition-all cursor-pointer shadow-sm active:scale-95 group"
              title="もう一度再生 (Rキー)"
            >
              <RotateCcw className="w-3.5 h-3.5 text-purple-400 group-hover:rotate-[-45deg] transition-transform" />
              <span>もう一度聴いて発音 (R)</span>
            </button>

            {/* In Shadowing mode, toggle English */}
            {practiceMode === 'shadowing' && (
              <button
                type="button"
                onClick={() => setShowEnglishInShadowing(prev => !prev)}
                className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer shadow-sm active:scale-95 ${
                  showEnglishInShadowing
                    ? 'bg-purple-500/20 text-purple-200 border-purple-500/50'
                    : 'bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border-slate-700'
                }`}
                title="英文を見る / 隠す (Vキー)"
              >
                {showEnglishInShadowing ? (
                  <>
                    <EyeOff className="w-3.5 h-3.5 text-purple-400" />
                    <span>英文を隠す</span>
                  </>
                ) : (
                  <>
                    <Eye className="w-3.5 h-3.5 text-purple-400" />
                    <span>英文を見る (V)</span>
                  </>
                )}
              </button>
            )}
          </div>

          {/* Next sentence button */}
          <button
            type="button"
            onClick={handleNext}
            className="flex items-center space-x-1.5 px-4 sm:px-5 py-2 bg-gradient-to-r from-purple-600 via-indigo-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 text-white rounded-xl text-xs sm:text-sm font-black shadow-lg shadow-purple-600/30 transition-all active:scale-95 cursor-pointer ml-auto shrink-0"
          >
            <span>次の文へ (Space)</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Row 2: One-Click Finish Tracking Buttons */}
        <div className="pt-2 border-t border-slate-850 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-400 font-bold">特訓ステータス:</span>
            <span className={`px-2 py-0.5 rounded-lg font-mono text-[11px] ${
              story.overlappingStatus === 'completed'
                ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30'
                : 'bg-slate-900 text-slate-500'
            }`}>
              🗣️ オーバーラップ: {story.overlappingStatus === 'completed' ? '完了済' : story.overlappingStatus === 'in_progress' ? '進行中' : '未'}
            </span>
            <span className={`px-2 py-0.5 rounded-lg font-mono text-[11px] ${
              story.shadowingStatus === 'completed'
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                : 'bg-slate-900 text-slate-500'
            }`}>
              🎧 シャドーイング: {story.shadowingStatus === 'completed' ? '完了済' : story.shadowingStatus === 'in_progress' ? '進行中' : '未'}
            </span>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={() => handleMarkCompleted('overlapping')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer active:scale-95 ${
                story.overlappingStatus === 'completed'
                  ? 'bg-teal-950 text-teal-300 border-teal-500/60'
                  : 'bg-slate-900 hover:bg-slate-800 text-teal-300 hover:text-white border-teal-500/40'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-teal-400" />
              <span>🗣️ オーバーラッピング完了にする</span>
            </button>

            <button
              type="button"
              onClick={() => handleMarkCompleted('shadowing')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer active:scale-95 ${
                story.shadowingStatus === 'completed'
                  ? 'bg-purple-950 text-purple-300 border-purple-500/60'
                  : 'bg-slate-900 hover:bg-slate-800 text-purple-300 hover:text-white border-purple-500/40'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-purple-400" />
              <span>🎙️ シャドーイング完了にする</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
