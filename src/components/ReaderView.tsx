import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Story } from '../types/story';
import { VocabItem } from '../types/vocab';
import { DifficultSentenceItem, DifficultyReasonCategory } from '../types/sentence';
import { Sparkles, Languages, CheckCircle2, ChevronDown, ChevronUp, ArrowLeft, Tag, Headphones, BookOpen, Pause, Play, Square, Gauge, BookmarkCheck, RotateCcw, Eye, ChevronLeft, BookmarkPlus, Zap } from 'lucide-react';
import confetti from 'canvas-confetti';
import { speakText, stopSpeech } from '../utils/speech';
import { translateWithGoogleFree } from '../services/translate';

interface ReaderViewProps {
  currentStory: Story;
  vocabs: VocabItem[];
  difficultSentences?: DifficultSentenceItem[];
  onWordOrPhraseTap: (text: string, contextSentence: string) => void;
  selectedPhrase: string;
  onClearSelection: () => void;
  onMasterVocab: (vocabId: string) => void;
  onLapseVocab: (phrase: string, meaning: string) => void;
  onSaveDifficultSentence?: (sentence: string, translation: string, phrase: string) => void;
  onUpdateSentenceReason?: (sentenceId: string, category: DifficultyReasonCategory, note: string) => void;
  onRecordStoryRead?: (storyId: string, wpm?: number) => void;
  onBackToBookshelf: () => void;
}

interface Segment {
  isWord: boolean;
  text: string;
  wIdx: number;
  cleanWord: string;
  charStart: number;
  charEnd: number;
}

export const ReaderView: React.FC<ReaderViewProps> = ({
  currentStory,
  vocabs,
  difficultSentences = [],
  onWordOrPhraseTap,
  selectedPhrase,
  onClearSelection,
  onMasterVocab,
  onLapseVocab,
  onSaveDifficultSentence,
  onUpdateSentenceReason,
  onRecordStoryRead,
  onBackToBookshelf,
}) => {
  const [viewMode, setViewMode] = useState<'read' | 'listen'>('read');
  const [listeningStyle, setListeningStyle] = useState<'step_by_step' | 'continuous'>('step_by_step');
  const [speechRate, setSpeechRate] = useState<number>(0.95);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);

  // 一文ずつリスニングモードの状態
  const [currentSentenceIdx, setCurrentSentenceIdx] = useState(0);
  const [showSentenceEnglish, setShowSentenceEnglish] = useState(false);
  const [showSentenceTranslation, setShowSentenceTranslation] = useState(false);
  const [sentenceTranslationText, setSentenceTranslationText] = useState('');
  const [isTranslatingSentence, setIsTranslatingSentence] = useState(false);

  const [showTranslation, setShowTranslation] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [startTime] = useState<number>(Date.now());
  const [calculatedWpm, setCalculatedWpm] = useState<number | null>(null);

  const [tappedWordsDuringStory, setTappedWordsDuringStory] = useState<Set<string>>(new Set());
  const [vocabEvaluations, setVocabEvaluations] = useState<Record<string, 'easy' | 'hard'>>({});

  // 今回の読書セッションでマークされた「訳せなかった文」の理由編集用
  const [sessionSentenceReasons, setSessionSentenceReasons] = useState<Record<string, { category: DifficultyReasonCategory; note: string }>>({});

  const [selectionRange, setSelectionRange] = useState<{
    pIdx: number;
    startWIdx: number;
    endWIdx: number;
  } | null>(null);

  useEffect(() => {
    setIsFinished(false);
    setShowTranslation(false);
    setSelectionRange(null);
    setTappedWordsDuringStory(new Set());
    setVocabEvaluations({});
    stopSpeech();
    setIsPlayingAudio(false);
    setCurrentSentenceIdx(0);
    setShowSentenceEnglish(false);
    setShowSentenceTranslation(false);
    setSentenceTranslationText('');
  }, [currentStory.id]);

  useEffect(() => {
    return () => {
      stopSpeech();
    };
  }, []);

  useEffect(() => {
    if (!selectedPhrase) {
      setSelectionRange(null);
    }
  }, [selectedPhrase]);

  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.closest('[data-word="true"]') || target.closest('button') || target.closest('input') || target.closest('select') || target.closest('.pointer-events-auto') || target.closest('.modal-content'))) {
        return;
      }
      if (selectedPhrase) {
        onClearSelection();
      }
    };

    window.addEventListener('click', handleGlobalClick);
    window.addEventListener('touchend', handleGlobalClick);
    return () => {
      window.removeEventListener('click', handleGlobalClick);
      window.removeEventListener('touchend', handleGlobalClick);
    };
  }, [selectedPhrase, onClearSelection]);

  // 段落リスト
  const paragraphs = useMemo(() => {
    return currentStory.storyContent.split('\n\n').filter(p => p.trim().length > 0);
  }, [currentStory.storyContent]);

  // 一文ごとのリスト（一文リスニング用）
  const sentenceList = useMemo(() => {
    const result: { id: number; text: string; pIdx: number }[] = [];
    let counter = 0;

    paragraphs.forEach((p, pIdx) => {
      const rawSentences = p.match(/[^.!?]+[.!?]+["']?|[^.!?]+$/g) || [p];
      rawSentences.forEach((raw) => {
        const trimmed = raw.trim();
        if (trimmed.length > 0) {
          result.push({
            id: counter++,
            text: trimmed,
            pIdx,
          });
        }
      });
    });

    return result;
  }, [paragraphs]);

  const currentSentence = sentenceList[currentSentenceIdx];

  // 一文再生ハンドラー
  const handlePlaySentence = useCallback((index: number) => {
    const target = sentenceList[index];
    if (!target) return;

    stopSpeech();
    setIsPlayingAudio(true);
    speakText(target.text, speechRate, 'en-US', () => {
      setIsPlayingAudio(false);
    });
  }, [sentenceList, speechRate]);

  // 一文モードで次の文に進む
  const handleNextSentence = () => {
    if (currentSentenceIdx + 1 < sentenceList.length) {
      const nextIdx = currentSentenceIdx + 1;
      setCurrentSentenceIdx(nextIdx);
      setShowSentenceEnglish(false);
      setShowSentenceTranslation(false);
      setSentenceTranslationText('');
      handlePlaySentence(nextIdx);
    }
  };

  // 一文モードで前の文に戻る
  const handlePrevSentence = () => {
    if (currentSentenceIdx > 0) {
      const prevIdx = currentSentenceIdx - 1;
      setCurrentSentenceIdx(prevIdx);
      setShowSentenceEnglish(false);
      setShowSentenceTranslation(false);
      setSentenceTranslationText('');
      handlePlaySentence(prevIdx);
    }
  };

  // 一文モードの日本語訳取得＆表示
  const handleFetchSentenceTranslation = async () => {
    if (!currentSentence) return;
    if (showSentenceTranslation) {
      setShowSentenceTranslation(false);
      return;
    }

    if (sentenceTranslationText) {
      setShowSentenceTranslation(true);
      return;
    }

    setIsTranslatingSentence(true);
    try {
      const res = await translateWithGoogleFree(currentSentence.text);
      setSentenceTranslationText(res.translatedText);
      setShowSentenceTranslation(true);
    } catch (e) {
      setSentenceTranslationText('（翻訳取得失敗）');
      setShowSentenceTranslation(true);
    } finally {
      setIsTranslatingSentence(false);
    }
  };

  // 一文モードで「訳せなかった文」として保存
  const handleBookmarkCurrentSentence = () => {
    if (!currentSentence || !onSaveDifficultSentence) return;
    onSaveDifficultSentence(currentSentence.text, sentenceTranslationText || '要確認', '');
    alert('📌 訳せなかった文リストに保存しました！');
  };

  const paragraphSegments = useMemo(() => {
    return paragraphs.map((para, pIdx) => {
      const regex = /([a-zA-Z0-9'-]+)/g;
      const segments: Segment[] = [];
      let lastIndex = 0;
      let wordCounter = 0;
      let match: RegExpExecArray | null;

      while ((match = regex.exec(para)) !== null) {
        if (match.index > lastIndex) {
          segments.push({
            isWord: false,
            text: para.substring(lastIndex, match.index),
            wIdx: wordCounter - 1,
            cleanWord: '',
            charStart: lastIndex,
            charEnd: match.index,
          });
        }

        const rawWord = match[0];
        const cleanWord = rawWord.replace(/^[^\w]+|[^\w]+$/g, '');
        segments.push({
          isWord: true,
          text: rawWord,
          wIdx: wordCounter++,
          cleanWord,
          charStart: match.index,
          charEnd: regex.lastIndex,
        });

        lastIndex = regex.lastIndex;
      }

      if (lastIndex < para.length) {
        segments.push({
          isWord: false,
          text: para.substring(lastIndex),
          wIdx: wordCounter - 1,
          cleanWord: '',
          charStart: lastIndex,
          charEnd: para.length,
        });
      }

      const targetMatches: { start: number; end: number }[] = [];
      const savedMatches: { start: number; end: number }[] = [];

      const targetList = currentStory.targetVocabList || [];
      const lowerPara = para.toLowerCase();

      targetList.forEach(t => {
        const cleanTarget = t.replace(/\s*\([^)]*\)/g, '').trim().toLowerCase();
        if (!cleanTarget) return;
        let pos = 0;
        while ((pos = lowerPara.indexOf(cleanTarget, pos)) !== -1) {
          targetMatches.push({ start: pos, end: pos + cleanTarget.length });
          pos += cleanTarget.length;
        }
      });

      vocabs.forEach(v => {
        const cleanPhrase = v.phrase.trim().toLowerCase();
        if (!cleanPhrase || cleanPhrase.length < 2) return;
        let pos = 0;
        while ((pos = lowerPara.indexOf(cleanPhrase, pos)) !== -1) {
          savedMatches.push({ start: pos, end: pos + cleanPhrase.length });
          pos += cleanPhrase.length;
        }
      });

      return {
        pIdx,
        fullParaText: para,
        segments,
        targetMatches,
        savedMatches,
      };
    });
  }, [paragraphs, currentStory, vocabs]);

  // 音声再生・停止（通しモード）
  const handleToggleAudio = () => {
    if (isPlayingAudio) {
      stopSpeech();
      setIsPlayingAudio(false);
    } else {
      setIsPlayingAudio(true);
      speakText(currentStory.storyContent, speechRate, 'en-US', () => {
        setIsPlayingAudio(false);
      });
    }
  };

  const handleStopAudio = () => {
    stopSpeech();
    setIsPlayingAudio(false);
  };

  const handleWordClick = (pIdx: number, wIdx: number, fullParaText: string, e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    if (wIdx < 0) return;

    if (selectionRange && selectionRange.pIdx === pIdx) {
      if (wIdx >= selectionRange.startWIdx && wIdx <= selectionRange.endWIdx && selectionRange.startWIdx !== selectionRange.endWIdx) {
        const newRange = { pIdx, startWIdx: wIdx, endWIdx: wIdx };
        setSelectionRange(newRange);
        emitSelectedPhrase(newRange, fullParaText);
        return;
      }

      const newStart = Math.min(selectionRange.startWIdx, wIdx);
      const newEnd = Math.max(selectionRange.endWIdx, wIdx);
      
      if (newEnd - newStart < 50) {
        const newRange = { pIdx, startWIdx: newStart, endWIdx: newEnd };
        setSelectionRange(newRange);
        emitSelectedPhrase(newRange, fullParaText);
        return;
      }
    }

    const newRange = { pIdx, startWIdx: wIdx, endWIdx: wIdx };
    setSelectionRange(newRange);
    emitSelectedPhrase(newRange, fullParaText);
  };

  const emitSelectedPhrase = (range: { pIdx: number; startWIdx: number; endWIdx: number }, fullParaText: string) => {
    const para = paragraphSegments[range.pIdx];
    if (!para) return;

    const selectedTokens: string[] = [];
    let insideSelection = false;

    para.segments.forEach(s => {
      if (s.isWord) {
        if (s.wIdx === range.startWIdx) insideSelection = true;
        if (insideSelection) {
          selectedTokens.push(s.text);
          setTappedWordsDuringStory(prev => new Set(prev).add(s.cleanWord.toLowerCase()));
        }
        if (s.wIdx === range.endWIdx) insideSelection = false;
      } else if (insideSelection) {
        selectedTokens.push(s.text);
      }
    });

    const phrase = selectedTokens.join('').replace(/\s+/g, ' ').trim();
    if (phrase) {
      onWordOrPhraseTap(phrase, fullParaText);
    }
  };

  // 読了ハンドラー ＆ WPM計算
  const handleFinishStory = () => {
    setIsFinished(true);
    stopSpeech();
    setIsPlayingAudio(false);

    // WPM 計算
    const durationMinutes = Math.max(0.2, (Date.now() - startTime) / 60000);
    const wordCount = currentStory.actualWordCount || currentStory.targetWordCount || 700;
    const wpm = Math.round(wordCount / durationMinutes);
    setCalculatedWpm(wpm);

    if (onRecordStoryRead) {
      onRecordStoryRead(currentStory.id, wpm);
    }

    const initialEvals: Record<string, 'easy' | 'hard'> = {};
    if (currentStory && currentStory.targetVocabList) {
      currentStory.targetVocabList.forEach(t => {
        const cleanTarget = t.replace(/\s*\([^)]*\)/g, '').trim().toLowerCase();
        const wasTapped = tappedWordsDuringStory.has(cleanTarget);
        if (!wasTapped) {
          initialEvals[cleanTarget] = 'easy';
          const vocabMatch = vocabs.find(v => v.phrase.toLowerCase() === cleanTarget);
          if (vocabMatch) {
            onMasterVocab(vocabMatch.id);
          }
        } else {
          initialEvals[cleanTarget] = 'hard';
        }
      });
    }
    setVocabEvaluations(initialEvals);

    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.7 },
      colors: ['#3b82f6', '#60a5fa', '#38bdf8', '#fbbf24', '#818cf8']
    });
  };

  const handleRateEasy = (cleanPhrase: string) => {
    const key = cleanPhrase.toLowerCase();
    setVocabEvaluations(prev => ({ ...prev, [key]: 'easy' }));
    const match = vocabs.find(v => v.phrase.toLowerCase() === key);
    if (match) {
      onMasterVocab(match.id);
    }
  };

  const handleRateHard = (cleanPhrase: string) => {
    const key = cleanPhrase.toLowerCase();
    setVocabEvaluations(prev => ({ ...prev, [key]: 'hard' }));
    onLapseVocab(cleanPhrase, '要復習');
  };

  // 今回のストーリーで記録された「訳せなかった文」
  const sessionDifficultSentences = useMemo(() => {
    return difficultSentences.filter(s => s.sourceStoryId === currentStory.id);
  }, [difficultSentences, currentStory.id]);

  const handleSetSentenceReason = (sentenceId: string, category: DifficultyReasonCategory, note: string) => {
    setSessionSentenceReasons(prev => ({ ...prev, [sentenceId]: { category, note } }));
    if (onUpdateSentenceReason) {
      onUpdateSentenceReason(sentenceId, category, note);
    }
  };

  const getContentTypeBadge = () => {
    if (currentStory.contentType === 'podcast') {
      return <span className="px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-300 font-bold border border-purple-500/30">🎙️ Podcast</span>;
    }
    if (currentStory.contentType === 'dialogue') {
      return <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">💬 Dialogue</span>;
    }
    return <span className="px-2 py-0.5 rounded-md bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30">📖 Story</span>;
  };

  return (
    <div className="max-w-3xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4">
      {/* 1. Top Control Bar: Back to Bookshelf & View Mode Switcher */}
      <div className="flex items-center justify-between flex-wrap gap-2.5">
        <button
          onClick={onBackToBookshelf}
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-850 text-slate-200 border border-slate-800 rounded-xl text-xs font-semibold transition-all group"
        >
          <ArrowLeft className="w-3.5 h-3.5 text-cyan-400 group-hover:-translate-x-0.5 transition-transform" />
          <span>本棚に戻る</span>
        </button>

        {/* View Mode Toggle: Read vs Listen */}
        <div className="flex items-center bg-slate-900 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => {
              setViewMode('read');
              stopSpeech();
              setIsPlayingAudio(false);
            }}
            className={`flex items-center space-x-1 px-3 py-1 rounded-lg text-xs font-bold transition-all ${
              viewMode === 'read'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>読むモード</span>
          </button>
          <button
            onClick={() => {
              setViewMode('listen');
              stopSpeech();
              setIsPlayingAudio(false);
              if (listeningStyle === 'step_by_step') {
                handlePlaySentence(currentSentenceIdx);
              }
            }}
            className={`flex items-center space-x-1 px-3 py-1 rounded-lg text-xs font-bold transition-all ${
              viewMode === 'listen'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Headphones className="w-3.5 h-3.5" />
            <span>🎧 聴くモード (Listening)</span>
          </button>
        </div>

        <div className="flex items-center space-x-2 text-xs">
          {getContentTypeBadge()}
          <span className="px-2 py-0.5 rounded-md bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30">
            {currentStory.cefrLevel || 'A2'}
          </span>
        </div>
      </div>

      {/* 2. Audio Playback & Speed Bar */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3 sm:p-4 shadow-xl flex items-center justify-between flex-wrap gap-3">
        {/* If in Listen mode: Sub-toggle for Step-by-Step vs Continuous */}
        {viewMode === 'listen' ? (
          <div className="flex items-center space-x-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => {
                setListeningStyle('step_by_step');
                stopSpeech();
                setIsPlayingAudio(false);
                handlePlaySentence(currentSentenceIdx);
              }}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg font-bold transition-all ${
                listeningStyle === 'step_by_step'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Zap className="w-3 h-3 text-yellow-300" />
              <span>⚡ 一文ずつ集中</span>
            </button>
            <button
              onClick={() => {
                setListeningStyle('continuous');
                stopSpeech();
                setIsPlayingAudio(false);
              }}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg font-bold transition-all ${
                listeningStyle === 'continuous'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Play className="w-3 h-3" />
              <span>🌊 通し再生</span>
            </button>
          </div>
        ) : (
          /* Reading Mode Audio Toggle */
          <div className="flex items-center space-x-2">
            <button
              onClick={handleToggleAudio}
              className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold shadow-md transition-all ${
                isPlayingAudio
                  ? 'bg-amber-600 hover:bg-amber-500 text-white'
                  : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-600/25'
              }`}
            >
              {isPlayingAudio ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
              <span>{isPlayingAudio ? '一時停止' : '全文音声を再生'}</span>
            </button>

            {isPlayingAudio && (
              <button
                onClick={handleStopAudio}
                className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-xl transition-colors border border-slate-800"
                title="停止"
              >
                <Square className="w-4 h-4 fill-current" />
              </button>
            )}
          </div>
        )}

        {/* Speed Pills (0.8x, 1.0x, 1.1x, 1.25x) */}
        <div className="flex items-center space-x-1 text-xs">
          <span className="text-slate-400 text-[11px] mr-1 flex items-center gap-1">
            <Gauge className="w-3.5 h-3.5 text-cyan-400" /> 速度:
          </span>
          {[0.8, 0.95, 1.1, 1.25].map((rate) => {
            const label = rate === 0.8 ? '0.8x' : rate === 0.95 ? '1.0x' : rate === 1.1 ? '1.1x' : '1.25x';
            const isSelected = speechRate === rate;

            return (
              <button
                key={rate}
                type="button"
                onClick={() => {
                  setSpeechRate(rate);
                  if (isPlayingAudio) {
                    stopSpeech();
                    setIsPlayingAudio(true);
                    if (viewMode === 'listen' && listeningStyle === 'step_by_step') {
                      speakText(currentSentence?.text || '', rate, 'en-US', () => setIsPlayingAudio(false));
                    } else {
                      speakText(currentStory.storyContent, rate, 'en-US', () => setIsPlayingAudio(false));
                    }
                  }
                }}
                className={`px-2.5 py-1 rounded-lg font-bold transition-all ${
                  isSelected
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Content Area: Listening Mode vs Reading Mode */}
      {viewMode === 'listen' ? (
        /* Listening Mode */
        listeningStyle === 'step_by_step' ? (
          /* 3-A. ⚡ 一文ずつ集中モード（Step-by-Step） */
          <div className="bg-slate-900/90 border border-purple-500/40 rounded-3xl p-5 sm:p-8 shadow-2xl space-y-5 animate-fadeIn">
            {/* Header: Progress Counter */}
            <div className="flex items-center justify-between text-xs text-slate-400 border-b border-slate-800 pb-3">
              <span className="font-bold text-purple-300 flex items-center gap-1.5">
                <Zap className="w-4 h-4 text-yellow-400" />
                一文集中リスニング ({currentSentenceIdx + 1} / {sentenceList.length} 文)
              </span>

              {onSaveDifficultSentence && (
                <button
                  onClick={handleBookmarkCurrentSentence}
                  className="flex items-center space-x-1 text-slate-400 hover:text-indigo-300 transition-colors"
                  title="この文を訳せなかった文として保存"
                >
                  <BookmarkPlus className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="text-[11px]">訳せなかった文に保存</span>
                </button>
              )}
            </div>

            {/* Central Listening Box */}
            <div className="py-6 sm:py-8 text-center space-y-5 min-h-[160px] flex flex-col justify-center items-center">
              {/* Audio Pulse Ring */}
              <button
                onClick={() => handlePlaySentence(currentSentenceIdx)}
                className="relative group p-4 rounded-full bg-purple-950/80 border border-purple-500/50 hover:border-purple-400 transition-all shadow-xl shadow-purple-950/50 active:scale-95"
                title="もう一度聴く"
              >
                <RotateCcw className={`w-7 h-7 text-purple-300 ${isPlayingAudio ? 'animate-spin' : 'group-hover:rotate-45'} transition-transform`} />
                {isPlayingAudio && (
                  <span className="absolute inset-0 rounded-full border-2 border-purple-400 animate-ping" />
                )}
              </button>

              <div className="space-y-1">
                <span className="text-xs text-purple-300 font-bold block">
                  {isPlayingAudio ? '🔊 音声を再生中...' : '👆 アイコンを押してもう一度聴く'}
                </span>
                <p className="text-[11px] text-slate-500">
                  英語の語順のまま頭から意味が入ってくるか確認してみましょう
                </p>
              </div>

              {/* Reveal 1: English Sentence (ボタンを押すと下に表示) */}
              {showSentenceEnglish && currentSentence && (
                <div className="w-full bg-slate-950 border border-purple-500/30 p-4 rounded-2xl text-left space-y-2 animate-slideUp">
                  <div className="flex items-center justify-between text-[11px] text-purple-400 font-bold">
                    <span>📖 英文スクリプト:</span>
                    <button
                      onClick={() => speakText(currentSentence.text, speechRate)}
                      className="text-slate-400 hover:text-purple-300 p-1"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-base sm:text-lg font-serif text-slate-100 leading-relaxed">
                    {currentSentence.text}
                  </p>
                </div>
              )}

              {/* Reveal 2: Japanese Translation (さらにボタンを押すと下に表示) */}
              {showSentenceTranslation && (
                <div className="w-full bg-slate-950/80 border border-indigo-500/30 p-3.5 rounded-2xl text-left space-y-1 animate-slideUp">
                  <span className="text-[11px] text-indigo-400 font-bold">🇯🇵 日本語訳:</span>
                  <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                    {isTranslatingSentence ? '翻訳中...' : sentenceTranslationText}
                  </p>
                </div>
              )}
            </div>

            {/* Check Actions: Reveal English & Translation */}
            <div className="flex flex-wrap items-center justify-center gap-2 pt-2 border-t border-slate-800">
              {!showSentenceEnglish && (
                <button
                  onClick={() => setShowSentenceEnglish(true)}
                  className="flex items-center space-x-1.5 px-4 py-2 bg-slate-950 hover:bg-slate-800 text-slate-200 border border-slate-800 rounded-xl text-xs font-semibold transition-all"
                >
                  <Eye className="w-3.5 h-3.5 text-purple-400" />
                  <span>英文を確認する</span>
                </button>
              )}

              <button
                onClick={handleFetchSentenceTranslation}
                disabled={isTranslatingSentence}
                className="flex items-center space-x-1.5 px-4 py-2 bg-slate-950 hover:bg-slate-800 text-slate-200 border border-slate-800 rounded-xl text-xs font-semibold transition-all"
              >
                <Languages className="w-3.5 h-3.5 text-indigo-400" />
                <span>{showSentenceTranslation ? '日本語訳を隠す' : '日本語訳を確認する'}</span>
              </button>
            </div>

            {/* Step Navigation Bar: Prev & Next Buttons */}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={handlePrevSentence}
                disabled={currentSentenceIdx === 0}
                className="flex items-center justify-center space-x-2 py-3 bg-slate-950 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed text-slate-200 border border-slate-800 rounded-2xl text-xs sm:text-sm font-bold transition-all"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>前の文</span>
              </button>

              <button
                onClick={handleNextSentence}
                disabled={currentSentenceIdx + 1 >= sentenceList.length}
                className="flex items-center justify-center space-x-2 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-2xl text-xs sm:text-sm font-bold shadow-lg shadow-purple-600/30 transition-all active:scale-[0.98]"
              >
                <span>{currentSentenceIdx + 1 >= sentenceList.length ? '完了！' : '次の文へ ➔'}</span>
              </button>
            </div>
          </div>
        ) : (
          /* 3-B. 🌊 通し再生モード（Continuous Streaming） */
          <div className="bg-slate-900/60 border border-purple-500/30 rounded-3xl p-6 sm:p-10 shadow-2xl space-y-6 text-center animate-fadeIn">
            <div className="w-16 h-16 mx-auto rounded-3xl bg-purple-950/60 border border-purple-500/40 flex items-center justify-center">
              <Headphones className={`w-8 h-8 text-purple-400 ${isPlayingAudio ? 'animate-pulse' : ''}`} />
            </div>

            <div className="space-y-2">
              <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                {currentStory.title}
              </h2>
              <p className="text-xs sm:text-sm text-purple-300 font-medium">
                {currentStory.titleJa}
              </p>
            </div>

            <div className="bg-slate-950/70 border border-slate-800 p-4 rounded-2xl max-w-lg mx-auto text-xs text-slate-300 space-y-2">
              <p className="font-semibold text-white">🌊 通しリスニング中</p>
              <p className="text-slate-400 leading-relaxed">
                全文をストリーミング再生しています。全体の流れとスピード感を耳で掴みましょう。
              </p>
            </div>

            <div className="pt-2 flex justify-center gap-3">
              <button
                onClick={handleToggleAudio}
                className="flex items-center space-x-2 px-6 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs sm:text-sm font-bold shadow-lg shadow-purple-600/30 transition-all"
              >
                {isPlayingAudio ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                <span>{isPlayingAudio ? '一時停止' : '通し再生を開始'}</span>
              </button>
            </div>
          </div>
        )
      ) : (
        /* Reading Mode: Full Interactive Text */
        <article className="bg-slate-900/60 border border-slate-800/80 rounded-3xl p-5 sm:p-9 shadow-2xl backdrop-blur-sm space-y-6 animate-fadeIn">
          <div className="border-b border-slate-800/80 pb-5 space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <h1 className="text-xl sm:text-3xl font-bold text-white tracking-tight">
                  {currentStory.title}
                </h1>
                <p className="text-sm sm:text-base text-cyan-300 font-medium">
                  {currentStory.titleJa}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {currentStory.genres && currentStory.genres.length > 0 && currentStory.genres.map((g, idx) => (
                <span key={idx} className="inline-flex items-center gap-1 text-[11px] font-semibold bg-indigo-950/60 text-indigo-300 border border-indigo-500/30 px-2.5 py-0.5 rounded-full">
                  <Tag className="w-3 h-3 text-indigo-400" />
                  {g}
                </span>
              ))}

              {currentStory.summary && (
                <span className="inline-block text-xs bg-slate-800/90 text-slate-300 px-3 py-1 rounded-lg border border-slate-700/60 leading-relaxed">
                  💡 <strong>導入</strong>: {currentStory.summary}
                </span>
              )}
            </div>
          </div>

          <div className="text-xs text-slate-400 flex items-center justify-between bg-slate-950/50 p-2.5 rounded-xl border border-slate-800/50">
            <span>👆 <strong>操作ヒント:</strong> 単語を押すと即時翻訳。複数単語・1文まるごと選択も可能です。</span>
          </div>

          {/* Story Content Paragraphs */}
          <div className="story-body select-none py-2 space-y-6">
            {paragraphSegments.map((para) => {
              return (
                <p key={para.pIdx} className="leading-relaxed text-slate-200 text-lg sm:text-xl font-serif">
                  {para.segments.map((seg, sIdx) => {
                    const isSelected = 
                      selectionRange && 
                      selectionRange.pIdx === para.pIdx && 
                      ((seg.isWord && seg.wIdx >= selectionRange.startWIdx && seg.wIdx <= selectionRange.endWIdx) ||
                       (!seg.isWord && seg.wIdx >= selectionRange.startWIdx && seg.wIdx < selectionRange.endWIdx));

                    const isTarget = para.targetMatches.some(m => seg.charStart >= m.start && seg.charEnd <= m.end);
                    const isSaved = para.savedMatches.some(m => seg.charStart >= m.start && seg.charEnd <= m.end);

                    if (!seg.isWord) {
                      if (isSelected) {
                        return (
                          <span key={sIdx} className="bg-blue-600 text-white font-bold inline">
                            {seg.text}
                          </span>
                        );
                      }
                      return <span key={sIdx}>{seg.text}</span>;
                    }

                    let wordStyle = 'hover:bg-blue-500/20 hover:text-cyan-300';

                    if (isSelected) {
                      wordStyle = 'bg-blue-600 text-white font-bold shadow-sm shadow-blue-500/40';
                    } else if (isTarget) {
                      wordStyle = 'text-amber-300 font-semibold underline decoration-amber-400/90 decoration-2 underline-offset-4 bg-amber-950/30 hover:bg-amber-950/60';
                    } else if (isSaved) {
                      wordStyle = 'text-sky-300 font-medium underline decoration-sky-400/70 decoration-2 underline-offset-4 bg-sky-950/20 hover:bg-sky-950/50';
                    }

                    return (
                      <span
                        key={sIdx}
                        data-word="true"
                        onClick={(e) => handleWordClick(para.pIdx, seg.wIdx, para.fullParaText, e)}
                        className={`inline cursor-pointer rounded px-0.5 transition-all ${wordStyle}`}
                      >
                        {seg.text}
                      </span>
                    );
                  })}
                </p>
              );
            })}
          </div>

          {/* Bottom Actions: Finish & Translations */}
          <div className="pt-4 border-t border-slate-800/80 space-y-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <button
                onClick={handleFinishStory}
                className={`w-full sm:w-auto flex items-center justify-center space-x-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  isFinished
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                    : 'bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 hover:border-slate-600'
                }`}
              >
                <CheckCircle2 className="w-4 h-4 text-cyan-400" />
                <span>{isFinished ? '読了完了！お疲れ様でした 🎉' : '読み終わった！ (読了)'}</span>
              </button>

              <button
                onClick={() => setShowTranslation(!showTranslation)}
                className="w-full sm:w-auto flex items-center justify-center space-x-1.5 px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 rounded-xl transition-all"
              >
                <Languages className="w-4 h-4" />
                <span>{showTranslation ? '日本語訳を隠す' : '全文日本語訳を表示'}</span>
                {showTranslation ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            </div>

            {/* WPM & Speed Stat Banner */}
            {isFinished && calculatedWpm && (
              <div className="p-3.5 bg-blue-950/60 border border-blue-500/30 rounded-2xl flex items-center justify-between text-xs animate-fadeIn">
                <div className="flex items-center space-x-2">
                  <Gauge className="w-4 h-4 text-cyan-400" />
                  <span className="text-slate-300">
                    今回の読書スピード: <strong className="text-white text-sm">{calculatedWpm} WPM</strong>
                  </span>
                </div>
                <span className="text-[11px] text-cyan-300 font-medium">
                  {calculatedWpm >= 130 ? '🔥 リアルタイムコンパイル達成！' : '💡 頭から読む意識でスピードUP！'}
                </span>
              </div>
            )}

            {/* 読了時：訳せなかった文の理由記録カード */}
            {isFinished && sessionDifficultSentences.length > 0 && (
              <div className="p-4 bg-slate-950/90 border border-indigo-500/30 rounded-2xl space-y-3 animate-fadeIn">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-indigo-400 flex items-center gap-1.5">
                    <BookmarkCheck className="w-3.5 h-3.5 text-indigo-400" />
                    今回「訳せなかった」文の理由を記録（自己分析用）
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {sessionDifficultSentences.length} 件
                  </span>
                </div>

                <div className="space-y-3">
                  {sessionDifficultSentences.map((item) => {
                    const currentReason = sessionSentenceReasons[item.id] || {
                      category: item.reasonCategory || 'word',
                      note: item.reasonNote || '',
                    };

                    const categories: { id: DifficultyReasonCategory; label: string }[] = [
                      { id: 'word', label: '🔤 単語・熟語' },
                      { id: 'modifier', label: '⛓️ 修飾関係・文構造' },
                      { id: 'grammar', label: '🧩 文法・構文' },
                      { id: 'speed', label: '⚡ 処理スピード' },
                    ];

                    return (
                      <div key={item.id} className="bg-slate-900 border border-slate-800 p-3 rounded-xl space-y-2 text-xs">
                        <p className="text-slate-200 font-serif italic">
                          "{item.sentence}"
                        </p>

                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          <span className="text-[11px] text-slate-400 mr-1">詰まった理由:</span>
                          {categories.map((cat) => (
                            <button
                              key={cat.id}
                              type="button"
                              onClick={() => handleSetSentenceReason(item.id, cat.id, currentReason.note)}
                              className={`px-2 py-0.5 rounded-lg text-[11px] font-bold transition-all ${
                                currentReason.category === cat.id
                                  ? 'bg-indigo-600 text-white shadow-sm'
                                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                              }`}
                            >
                              {cat.label}
                            </button>
                          ))}
                        </div>

                        <input
                          type="text"
                          value={currentReason.note}
                          onChange={(e) => handleSetSentenceReason(item.id, currentReason.category, e.target.value)}
                          placeholder="メモ（例: whose の係り先が分からなかった）"
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-indigo-500"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 読了後の語彙セルフ評価カード */}
            {isFinished && currentStory.targetVocabList && currentStory.targetVocabList.length > 0 && (
              <div className="p-4 bg-slate-950/90 border border-blue-500/30 rounded-2xl space-y-3 animate-fadeIn">
                <div className="flex items-center justify-between flex-wrap gap-1">
                  <span className="text-xs font-bold text-cyan-400 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" /> 今回の登場語彙の定着度チェック
                  </span>
                  <span className="text-[11px] text-slate-400">
                    単語ごとに「簡単」「難しい」を個別に調整できます
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  {currentStory.targetVocabList.map((t, idx) => {
                    const cleanPhrase = t.replace(/\s*\([^)]*\)/g, '').trim();
                    const key = cleanPhrase.toLowerCase();
                    const currentRating = vocabEvaluations[key] || (tappedWordsDuringStory.has(key) ? 'hard' : 'easy');

                    return (
                      <div key={idx} className="bg-slate-900 border border-slate-800 p-2.5 rounded-xl flex items-center justify-between text-xs gap-2">
                        <div className="min-w-0 flex-1">
                          <span className="font-bold text-white block truncate">{cleanPhrase}</span>
                          <span className="text-[10px] text-slate-400">
                            {currentRating === 'easy' ? '🟢 スラスラ読めた（定着）' : '🔴 要復習（次回再出題）'}
                          </span>
                        </div>

                        <div className="flex items-center space-x-1 flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => handleRateEasy(cleanPhrase)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                              currentRating === 'easy'
                                ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/30 border border-emerald-400'
                                : 'bg-slate-950 text-slate-400 hover:text-emerald-400 border border-slate-800'
                            }`}
                          >
                            🟢 簡単
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRateHard(cleanPhrase)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                              currentRating === 'hard'
                                ? 'bg-amber-600 text-white shadow-sm shadow-amber-600/30 border border-amber-400'
                                : 'bg-slate-950 text-slate-400 hover:text-amber-400 border border-slate-800'
                            }`}
                          >
                            🔴 難しい
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {showTranslation && (
              <div className="p-4 sm:p-5 bg-slate-950/70 border border-slate-800/90 rounded-2xl space-y-2 animate-fadeIn">
                <span className="text-xs font-bold uppercase text-cyan-400 tracking-wider">全文日本語訳</span>
                <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">
                  {currentStory.japaneseTranslation}
                </p>
              </div>
            )}
          </div>
        </article>
      )}
    </div>
  );
};
