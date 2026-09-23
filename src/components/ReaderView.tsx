import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { enqueueMasteryScanTask } from '../services/cefrScanner';
import { Story, TargetEmbedding } from '../types/story';
import { VocabItem } from '../types/vocab';
import { DifficultSentenceItem, DifficultyReasonCategory } from '../types/sentence';
import {
  Languages, CheckCircle2, ChevronDown, ChevronUp, ArrowLeft,
  Headphones, BookOpen, Pause, Play, Square, Eye, EyeOff, Film, Palette
} from 'lucide-react';

import { speakText, stopSpeech } from '../utils/speech';
import { recordDailyReadingActivity, loadMasteryState, extractSingleSentence, recordStoryListeningCompleted } from '../services/storage';
import { StoryListeningStepView } from './StoryListeningStepView';
import { getCandidateLemmas } from '../utils/storyVocabExtractor';
import { splitStoryIntoSentences } from '../utils/sentenceUtils';
import { StoryCompletionSyncModal } from './StoryCompletionSyncModal';

interface ReaderViewProps {
  currentStory: Story;
  allStories?: Story[];
  vocabs: VocabItem[];
  difficultSentences?: DifficultSentenceItem[];
  onWordOrPhraseTap: (text: string, contextSentence: string, targetEmbedding?: TargetEmbedding) => void;
  selectedPhrase: string;
  onClearSelection: () => void;
  onSaveDifficultSentence?: (sentence: string, translation: string, phrase: string) => void;
  onUpdateSentenceReason?: (sentenceId: string, category: DifficultyReasonCategory, note: string) => void;
  onRecordStoryRead?: (storyId: string, wpm?: number) => void;
  onUpdateStory?: (story: Story) => void;
  onSelectStory?: (story: Story) => void;
  onQueueNextEpisode?: (story: Story) => void;
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
  allStories = [],
  vocabs,
  onWordOrPhraseTap,
  selectedPhrase,
  onClearSelection,
  onRecordStoryRead,
  onUpdateStory,
  onSelectStory,
  onBackToBookshelf,
}) => {
  // Active story state ensures newly completed listening metrics & ratings are immediately available
  const [activeStory, setActiveStory] = useState<Story>(currentStory);

  useEffect(() => {
    setActiveStory(currentStory);
  }, [currentStory]);

  // 2-Stage Story Lifecycle: 初見チャンクリスニング ➔ いつものリーダー
  const [isListeningStage, setIsListeningStage] = useState<boolean>(() => {
    return currentStory.listeningStatus !== 'completed';
  });

  useEffect(() => {
    setIsListeningStage(currentStory.listeningStatus !== 'completed');
  }, [currentStory.id, currentStory.listeningStatus]);

  const [speechRate, setSpeechRate] = useState<number>(0.95);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);

  const [showTranslation, setShowTranslation] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [startTime] = useState<number>(Date.now());
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [pendingWpm, setPendingWpm] = useState<number>(150);

  // 全ランクのマスター状態（習得済み・要復習）を取得
  const masteryState = useMemo(() => {
    return loadMasteryState();
  }, [vocabs, activeStory.id, isFinished]);

  const savedVocabSet = useMemo(() => {
    return new Set(
      vocabs
        .filter(v => {
          const st = masteryState.vocabs[v.phrase.toLowerCase()]?.status;
          if (st === 'mastered') return false;
          return (v.repetitionCount || 0) < 4;
        })
        .map(v => v.phrase.toLowerCase())
    );
  }, [vocabs, masteryState]);

  const targetVocabSet = useMemo(() => {
    const list = activeStory.targetVocabList || [];
    const set = new Set<string>();
    list.forEach(t => {
      const clean = t.replace(/\s*\([^)]*\)/g, '').trim().toLowerCase();
      if (clean) {
        set.add(clean);
        getCandidateLemmas(clean).forEach(l => set.add(l));
      }
    });
    return set;
  }, [activeStory.targetVocabList]);

  // 単語ごとのステータス判定（活用形・全CEFRランク対応）
  const getWordStatus = useCallback((cleanWord: string): 'lapsed' | 'mastered' | 'target' | 'unseen' => {
    if (!cleanWord || cleanWord.length < 1) return 'unseen';
    const lower = cleanWord.toLowerCase();
    const lemmas = getCandidateLemmas(lower);

    for (const lemma of lemmas) {
      if (savedVocabSet.has(lemma) || masteryState.vocabs[lemma]?.status === 'lapsed') {
        return 'lapsed';
      }
      if (masteryState.vocabs[lemma]?.status === 'mastered') {
        return 'mastered';
      }
      if (targetVocabSet.has(lemma)) {
        return 'target';
      }
    }
    return 'unseen';
  }, [savedVocabSet, masteryState.vocabs, targetVocabSet]);

  const lapsedTargetIdsRef = useRef<Set<string>>(new Set());
  const sessionLookedUpTokensRef = useRef<Set<string>>(new Set());

  // 初見リスニング理解度カラーの可視化切り替え（デフォルトON）
  const [showComprehensionHighlights, setShowComprehensionHighlights] = useState<boolean>(() => {
    const saved = localStorage.getItem('reader_show_comprehension');
    return saved !== null ? saved === 'true' : true;
  });

  // 出題ターゲット（構文・出題単語）の可視化切り替え（デフォルトOFF）
  const [showTargetHighlights, setShowTargetHighlights] = useState<boolean>(() => {
    return localStorage.getItem('reader_show_targets') === 'true';
  });

  const [selectionRange, setSelectionRange] = useState<{
    pIdx: number;
    startWIdx: number;
    endWIdx: number;
  } | null>(null);

  useEffect(() => {
    setIsFinished(false);
    setShowTranslation(false);
    setSelectionRange(null);
    stopSpeech();
    setIsPlayingAudio(false);
    lapsedTargetIdsRef.current.clear();
    sessionLookedUpTokensRef.current.clear();
  }, [activeStory.id]);

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
    return activeStory.storyContent.split('\n\n').filter(p => p.trim().length > 0);
  }, [activeStory.storyContent]);

  // 一文ごとの統一リスト（理解度カラーマッピング用）
  const sentenceList = useMemo(() => {
    return splitStoryIntoSentences(activeStory.storyContent);
  }, [activeStory.storyContent]);

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

      const targetList = activeStory.targetVocabList || [];
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

      const patternMatches: { start: number; end: number; embedding: TargetEmbedding }[] = [];
      const targetEmbeddings = activeStory.targetEmbeddings || [];
      targetEmbeddings.forEach(emb => {
        const span = (emb.textSpan || '').trim().toLowerCase();
        if (span && span.length > 2) {
          let pos = 0;
          while ((pos = lowerPara.indexOf(span, pos)) !== -1) {
            patternMatches.push({ start: pos, end: pos + span.length, embedding: emb });
            pos += span.length;
          }
        }
      });

      return {
        pIdx,
        fullParaText: para,
        segments,
        targetMatches,
        savedMatches,
        patternMatches,
      };
    });
  }, [paragraphs, activeStory, vocabs]);

  // 音声再生・停止
  const handleToggleAudio = () => {
    if (isPlayingAudio) {
      stopSpeech();
      setIsPlayingAudio(false);
    } else {
      setIsPlayingAudio(true);
      speakText(activeStory.storyContent, speechRate, 'en-US', () => {
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
        }
        if (s.wIdx === range.endWIdx) insideSelection = false;
      } else if (insideSelection) {
        selectedTokens.push(s.text);
      }
    });

    const phrase = selectedTokens.join('').replace(/\s+/g, ' ').trim();
    if (phrase) {
      const startSeg = para.segments.find(s => s.wIdx === range.startWIdx && s.isWord);
      const endSeg = para.segments.find(s => s.wIdx === range.endWIdx && s.isWord);
      
      let matchingEmbedding: TargetEmbedding | undefined = undefined;
      if (startSeg && endSeg) {
        const found = para.patternMatches.find(m => startSeg.charStart < m.end && endSeg.charEnd > m.start);
        if (found) {
          matchingEmbedding = found.embedding;
        }
      }

      if (!matchingEmbedding) {
        const pText = phrase.toLowerCase();
        matchingEmbedding = activeStory.targetEmbeddings?.find(emb => {
          const tText = (emb.textSpan || emb.targetName || '').toLowerCase().trim();
          if (tText && (pText === tText || (pText.length > 3 && tText.includes(pText)))) return true;
          return false;
        });
      }

      const singleSentence = extractSingleSentence(fullParaText, phrase);
      onWordOrPhraseTap(phrase, singleSentence, matchingEmbedding);
    }
  };

  // 読了ハンドラー ＆ クリアHUD起動
  const handleFinishStory = () => {
    stopSpeech();
    setIsPlayingAudio(false);

    // WPM 計算
    const durationMinutes = Math.max(0.2, (Date.now() - startTime) / 60000);
    const wordCount = activeStory.actualWordCount || activeStory.targetWordCount || 700;
    const wpm = Math.round(wordCount / durationMinutes);
    setPendingWpm(wpm);

    // 読書量とWPMを記録
    recordDailyReadingActivity(wordCount, wpm, activeStory.title, activeStory.id);

    if (onRecordStoryRead) {
      onRecordStoryRead(activeStory.id, wpm);
    }

    try {
      enqueueMasteryScanTask({
        sourceType: 'story',
        sourceId: activeStory.id,
        title: activeStory.title,
        text: activeStory.storyContent || (activeStory as any).story || "",
        lookedUpTokens: Array.from(sessionLookedUpTokensRef.current),
      });
    } catch (e) {
      console.error('Failed to enqueue mastery scan task', e);
    }

    setIsFinished(true);
    setIsSyncModalOpen(true);
  };

  // 3部作の次のエピソード探索
  const nextEpisode = useMemo(() => {
    if (!activeStory.seriesId || !activeStory.episodeIndex || !activeStory.totalEpisodes) return null;
    if (activeStory.episodeIndex >= activeStory.totalEpisodes) return null;
    return allStories.find(
      s => s.seriesId === activeStory.seriesId && s.episodeIndex === (activeStory.episodeIndex || 0) + 1
    );
  }, [activeStory, allStories]);

  const getContentTypeBadge = () => {
    if (activeStory.contentType === 'podcast') {
      return <span className="px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-300 font-bold border border-purple-500/30">🎙️ Podcast</span>;
    }
    if (activeStory.contentType === 'dialogue') {
      return <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">💬 Dialogue</span>;
    }
    return <span className="px-2 py-0.5 rounded-md bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30">📖 Story</span>;
  };

  // 第1段階：初見チャンクリスニング
  if (isListeningStage) {
    return (
      <StoryListeningStepView
        story={activeStory}
        onCompleteListening={(metrics) => {
          const updated = recordStoryListeningCompleted(activeStory.id, metrics);
          const finalStory = updated || {
            ...activeStory,
            listeningStatus: 'completed' as const,
            listeningMetrics: metrics,
            sentenceRatings: metrics.sentenceRatings,
          };
          setActiveStory(finalStory);
          onUpdateStory?.(finalStory);
          setIsListeningStage(false);
        }}
        onSkipToReader={() => {
          setIsListeningStage(false);
        }}
        onBackToBookshelf={onBackToBookshelf}
      />
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4">
      {/* 1. Top Control Bar: Back to Bookshelf & View Mode Switcher */}
      <div className="flex items-center justify-between flex-wrap gap-2.5">
        <button
          onClick={onBackToBookshelf}
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-850 text-slate-200 border border-slate-800 rounded-xl text-xs font-semibold transition-all group cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5 text-cyan-400 group-hover:-translate-x-0.5 transition-transform" />
          <span>本棚に戻る</span>
        </button>

        {/* Unified Mode Switcher: 読むモード vs リスニングモード */}
        <div className="flex items-center bg-slate-900 p-1 rounded-2xl border border-slate-800">
          <button
            type="button"
            className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-blue-600 text-white shadow-sm transition-all"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>📖 精読モード</span>
          </button>
          <button
            type="button"
            onClick={() => setIsListeningStage(true)}
            className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold text-slate-400 hover:text-indigo-300 hover:bg-slate-850 transition-all cursor-pointer"
            title="初見リスニング（耳トレ・4段階理解度メモ）へ切り替え"
          >
            <Headphones className="w-3.5 h-3.5 text-indigo-400" />
            <span>🎧 リスニング特訓</span>
          </button>
        </div>

        <div className="flex items-center space-x-2 text-xs">
          {activeStory.episodeIndex && activeStory.totalEpisodes && activeStory.totalEpisodes > 1 && (
            <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30 flex items-center gap-1">
              <Film className="w-3 h-3" />
              第 {activeStory.episodeIndex}/{activeStory.totalEpisodes} 話
            </span>
          )}
          {getContentTypeBadge()}
          <span className="px-2 py-0.5 rounded-md bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30">
            {activeStory.cefrLevel || 'A2'}
          </span>
        </div>
      </div>

      {/* 2. Audio Playback & Speed Bar */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3 sm:p-4 shadow-xl flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center space-x-2">
          <button
            onClick={handleToggleAudio}
            className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              isPlayingAudio
                ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30 animate-pulse'
                : 'bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/20'
            }`}
          >
            {isPlayingAudio ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{isPlayingAudio ? '一時停止' : '全文音声再生'}</span>
          </button>
          {isPlayingAudio && (
            <button
              onClick={handleStopAudio}
              className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              title="停止"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center space-x-2 text-xs">
          <span className="text-slate-400 font-semibold">再生速度:</span>
          {[0.8, 0.95, 1.1, 1.25].map((rate) => (
            <button
              key={rate}
              onClick={() => setSpeechRate(rate)}
              className={`px-2 py-1 rounded-lg font-bold transition-colors cursor-pointer ${
                speechRate === rate
                  ? 'bg-blue-600/30 text-sky-400 border border-blue-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {rate}x
            </button>
          ))}
        </div>
      </div>

      {/* 3. Main Reading Card */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-7 shadow-2xl space-y-6">
        {/* Title & Summary */}
        <div className="border-b border-slate-800 pb-4 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
              {activeStory.title}
            </h1>
          </div>
          {activeStory.titleJa && (
            <p className="text-sm font-semibold text-slate-300">
              {activeStory.titleJa}
            </p>
          )}
          {activeStory.summary && (
            <p className="text-xs text-slate-400 leading-relaxed pt-1">
              {activeStory.summary}
            </p>
          )}

          {/* Highlight Legend & Comprehension / Target Visibility Toggles */}
          <div className="flex items-center justify-between flex-wrap gap-2 pt-2 text-[11px] text-slate-400 border-t border-slate-800/60">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="text-slate-500 font-medium">表示凡例:</span>
              {showComprehensionHighlights && (
                <div className="flex items-center gap-2 px-2 py-0.5 rounded-lg bg-slate-950 border border-slate-800/80 text-[10px]">
                  <span className="text-slate-400 font-bold">リスニング理解度:</span>
                  <span className="text-rose-400 font-medium flex items-center gap-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>1:要復習
                  </span>
                  <span className="text-amber-400 font-medium flex items-center gap-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>2:曖昧
                  </span>
                  <span className="text-sky-300 font-medium flex items-center gap-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-400"></span>3:理解
                  </span>
                  <span className="text-emerald-400 font-medium flex items-center gap-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>4:即解
                  </span>
                </div>
              )}
              {showTargetHighlights && (
                <>
                  <span className="flex items-center space-x-1 text-purple-300 font-medium animate-fadeIn">
                    <span className="w-2 h-2 rounded-full bg-purple-400 inline-block"></span>
                    <span>💡 構文</span>
                  </span>
                  <span className="flex items-center space-x-1 text-sky-300 font-medium animate-fadeIn">
                    <span className="w-2 h-2 rounded-full bg-sky-400 inline-block"></span>
                    <span>🔵 単語</span>
                  </span>
                </>
              )}
              <span className="flex items-center space-x-1 text-amber-300 font-medium">
                <span className="w-2 h-2 rounded-full bg-amber-400 inline-block"></span>
                <span>習得中</span>
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              {/* Comprehension Color Toggle */}
              <button
                onClick={() => {
                  const next = !showComprehensionHighlights;
                  setShowComprehensionHighlights(next);
                  localStorage.setItem('reader_show_comprehension', String(next));
                }}
                className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                  showComprehensionHighlights
                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/50 shadow-sm'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-850'
                }`}
                title="初見リスニングで記録した理解度カラーの表示を切り替えます"
              >
                <Palette className="w-3.5 h-3.5 text-emerald-400" />
                <span>理解度カラー: {showComprehensionHighlights ? 'ON' : 'OFF'}</span>
              </button>

              {/* Target Visibility Toggle */}
              <button
                onClick={() => {
                  const next = !showTargetHighlights;
                  setShowTargetHighlights(next);
                  localStorage.setItem('reader_show_targets', String(next));
                }}
                className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                  showTargetHighlights
                    ? 'bg-purple-950/80 text-purple-300 border-purple-500/50 shadow-sm'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-850'
                }`}
                title="出題された重要構文・単語のハイライト表示を切り替えます"
              >
                {showTargetHighlights ? (
                  <>
                    <Eye className="w-3.5 h-3.5 text-purple-400" />
                    <span>ターゲット: ON</span>
                  </>
                ) : (
                  <>
                    <EyeOff className="w-3.5 h-3.5 text-slate-500" />
                    <span>ターゲット: OFF</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Story Body */}
        <div className="space-y-4 text-base sm:text-lg leading-relaxed text-slate-200">
          {paragraphSegments.map((para) => (
            <p key={para.pIdx} className="leading-relaxed font-normal">
              {para.segments.map((seg, sIdx) => {
                if (!seg.isWord) {
                  return <span key={sIdx}>{seg.text}</span>;
                }

                const isSelected = selectionRange &&
                  selectionRange.pIdx === para.pIdx &&
                  seg.wIdx >= selectionRange.startWIdx &&
                  seg.wIdx <= selectionRange.endWIdx;

                let wordStyle = 'text-slate-200 hover:text-sky-300 hover:underline';

                if (isSelected) {
                  wordStyle = 'bg-blue-600 text-white';
                } else {
                  const isPattern = showTargetHighlights && para.patternMatches.some(m =>
                    (seg.charStart >= m.start && seg.charStart < m.end) ||
                    (seg.charEnd > m.start && seg.charEnd <= m.end)
                  );

                  const lowerClean = seg.cleanWord.toLowerCase();
                  const isTargetMatch = showTargetHighlights && (
                    targetVocabSet.has(lowerClean) ||
                    getCandidateLemmas(lowerClean).some(l => targetVocabSet.has(l)) ||
                    para.targetMatches.some(m =>
                      (seg.charStart >= m.start && seg.charStart < m.end) ||
                      (seg.charEnd > m.start && seg.charEnd <= m.end)
                    )
                  );

                  const status = getWordStatus(seg.cleanWord);

                  // 一意な一文リストからこの単語が含まれる文を探索
                  const sentenceOfSeg = sentenceList.find(s =>
                    s.pIdx === para.pIdx &&
                    ((seg.charStart >= s.charStart && seg.charStart < s.charEnd) ||
                     (seg.charEnd > s.charStart && seg.charEnd <= s.charEnd) ||
                     (s.charStart >= seg.charStart && s.charEnd <= seg.charEnd))
                  );

                  const sentenceRating = sentenceOfSeg
                    ? (activeStory.sentenceRatings?.[sentenceOfSeg.id]?.rating ||
                       activeStory.listeningMetrics?.sentenceRatings?.[sentenceOfSeg.id]?.rating)
                    : undefined;

                  let comprehensionBase = '';
                  if (showComprehensionHighlights && sentenceRating) {
                    if (sentenceRating === 1) {
                      // 1: 要復習 (赤系アンダーライン＆背景)
                      comprehensionBase = 'bg-rose-950/40 text-rose-100 border-b-2 border-rose-500/80 ';
                    } else if (sentenceRating === 2) {
                      // 2: 曖昧 (黄系アンダーライン＆背景)
                      comprehensionBase = 'bg-amber-950/40 text-amber-100 border-b-2 border-amber-400/80 ';
                    } else if (sentenceRating === 3) {
                      // 3: 理解 (青系アンダーライン)
                      comprehensionBase = 'bg-sky-950/30 text-sky-100 border-b border-sky-400/60 ';
                    } else if (sentenceRating === 4) {
                      // 4: 即解 (緑系アンダーライン)
                      comprehensionBase = 'bg-emerald-950/20 text-emerald-100 border-b border-emerald-500/40 ';
                    }
                  }

                  if (isPattern) {
                    // 💡 出題構文（パープル系背景・波線）
                    wordStyle = `${comprehensionBase}bg-purple-950/70 text-purple-200 underline decoration-purple-400 decoration-2 underline-offset-4 font-semibold hover:bg-purple-900/90 hover:text-purple-100 rounded px-0.5`;
                  } else if (isTargetMatch) {
                    // 🔵 出題ターゲット単語（可視化ON時は最優先でスカイブルー強調！）
                    wordStyle = `${comprehensionBase}text-sky-300 underline decoration-sky-400/90 decoration-2 underline-offset-2 hover:text-sky-200 bg-sky-950/50 font-medium rounded px-0.5`;
                  } else if (status === 'lapsed') {
                    // 🟡 習得中 / 要復習（単語帳に登録中・Anki学習中）
                    wordStyle = `${comprehensionBase}text-amber-300 underline decoration-amber-400/80 decoration-2 underline-offset-2 hover:text-amber-200 hover:bg-amber-500/10`;
                  } else if (comprehensionBase) {
                    wordStyle = `${comprehensionBase}hover:text-sky-300 transition-colors`;
                  }
                }

                return (
                  <span
                    key={sIdx}
                    data-word="true"
                    onClick={(e) => handleWordClick(para.pIdx, seg.wIdx, para.fullParaText, e)}
                    className={`inline cursor-pointer px-0 py-0 transition-colors ${wordStyle}`}
                  >
                    {seg.text}
                  </span>
                );
              })}
            </p>
          ))}
        </div>

        {/* Bottom Actions: Finish & Translations */}
        <div className="pt-4 border-t border-slate-800/80 space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <button
              onClick={handleFinishStory}
              className={`w-full sm:w-auto flex items-center justify-center space-x-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer ${
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
              className="w-full sm:w-auto flex items-center justify-center space-x-1.5 px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 rounded-xl transition-all cursor-pointer"
            >
              <Languages className="w-4 h-4" />
              <span>{showTranslation ? '日本語訳を隠す' : '全文日本語訳を表示'}</span>
              {showTranslation ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* Full Japanese Translation */}
          {showTranslation && (
            <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl space-y-3 animate-fadeIn">
              <div className="flex items-center space-x-2 text-xs font-bold text-slate-400">
                <Languages className="w-4 h-4 text-cyan-400" />
                <span>全文日本語訳</span>
              </div>
              <div className="space-y-3 text-sm sm:text-base leading-relaxed text-slate-300 whitespace-pre-line">
                {activeStory.japaneseTranslation || '（日本語訳データがありません）'}
              </div>
            </div>
          )}

          {/* Trilogy Next Episode Banner */}
          {isFinished && nextEpisode && (
            <div className="p-4 bg-gradient-to-r from-blue-900/50 to-indigo-900/50 border border-blue-500/40 rounded-2xl flex items-center justify-between gap-3 animate-fadeIn">
              <div>
                <div className="text-xs font-bold text-blue-300 flex items-center gap-1.5">
                  <Film className="w-3.5 h-3.5 text-amber-400" />
                  <span>{activeStory.seriesType === 'continuous' || activeStory.seriesType === 'trilogy' ? `連載ストーリー: 次の第 ${nextEpisode.episodeIndex} 話へ` : `次の第 ${nextEpisode.episodeIndex} 話へ`}</span>
                </div>
                <div className="text-sm font-bold text-white pt-0.5">
                  『{nextEpisode.titleJa || nextEpisode.title}』
                </div>
              </div>
              <button
                onClick={() => onSelectStory?.(nextEpisode)}
                className="flex items-center space-x-1 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-600/30 transition-all flex-shrink-0 cursor-pointer"
              >
                <span>第 {nextEpisode.episodeIndex} 話を読む</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 読了スコア ＆ 完了HUDモーダル */}
      {isSyncModalOpen && (
        <StoryCompletionSyncModal
          story={activeStory}
          calculatedWpm={pendingWpm}
          newCapturedCount={vocabs.filter(v => v.sourceStoryId === activeStory.id).length}
          onClose={() => {
            setIsSyncModalOpen(false);
          }}
        />
      )}

      {/* 4. Bottom Return Bar */}
      <div className="flex items-center justify-between pt-1 pb-6 px-1">
        <button
          onClick={onBackToBookshelf}
          className="flex items-center space-x-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-850 text-slate-300 hover:text-white border border-slate-800 rounded-xl text-xs font-semibold transition-all group cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 text-cyan-400 group-hover:-translate-x-0.5 transition-transform" />
          <span>本棚に戻る</span>
        </button>
        <span className="text-[11px] text-slate-500 hidden sm:inline">
          💡 スマホの戻るスワイプやブラウザバックでも本棚に戻れます
        </span>
      </div>
    </div>
  );
};
