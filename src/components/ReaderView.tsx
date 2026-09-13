import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Story, TargetEmbedding } from '../types/story';
import { VocabItem } from '../types/vocab';
import { DifficultSentenceItem, DifficultyReasonCategory } from '../types/sentence';
import { Languages, CheckCircle2, ChevronDown, ChevronUp, ArrowLeft, Headphones, BookOpen, Pause, Play, Square, Gauge, BookmarkCheck, RotateCcw, Eye, EyeOff, ChevronLeft, ChevronRight, BookmarkPlus, Film } from 'lucide-react';
import confetti from 'canvas-confetti';
import { speakText, stopSpeech } from '../utils/speech';
import { translateWithGoogleFree } from '../services/translate';
import { recordPatternMasteryBatch, recordVocabMasteryBatch, recordDailyReadingActivity, recordVocabLapse, loadMasteryState } from '../services/storage';
import { extractStoryVocabs, ExtractedStoryVocab, getCandidateLemmas } from '../utils/storyVocabExtractor';
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
  onSelectStory?: (story: Story) => void;
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
  difficultSentences = [],
  onWordOrPhraseTap,
  selectedPhrase,
  onClearSelection,
  onSaveDifficultSentence,
  onUpdateSentenceReason,
  onRecordStoryRead,
  onSelectStory,
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
  // 読了時パッシブ同期モーダル用
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [extractedVocabs, setExtractedVocabs] = useState<ExtractedStoryVocab[]>([]);
  const [pendingWpm, setPendingWpm] = useState<number>(150);

  // 全ランクのマスター状態（習得済み・要復習）を取得
  const masteryState = useMemo(() => {
    return loadMasteryState();
  }, [vocabs, currentStory.id, isFinished]);

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
    const list = currentStory.targetVocabList || [];
    const set = new Set<string>();
    list.forEach(t => {
      const clean = t.replace(/\s*\([^)]*\)/g, '').trim().toLowerCase();
      if (clean) set.add(clean);
    });
    return set;
  }, [currentStory.targetVocabList]);

  // 単語ごとのステータス判定（活用形・全CEFRランク対応）
  const getWordStatus = useCallback((cleanWord: string): 'lapsed' | 'mastered' | 'target' | 'unseen' => {
    if (!cleanWord || cleanWord.length < 1) return 'unseen';
    const lower = cleanWord.toLowerCase();
    const lemmas = getCandidateLemmas(lower);

    for (const lemma of lemmas) {
      // 1. 要復習 / 単語帳に保存中（習得中）
      if (savedVocabSet.has(lemma) || masteryState.vocabs[lemma]?.status === 'lapsed') {
        return 'lapsed';
      }
      // 2. 習得済み (mastered)
      if (masteryState.vocabs[lemma]?.status === 'mastered') {
        return 'mastered';
      }
      // 3. 今回の出題ターゲット語彙
      if (targetVocabSet.has(lemma)) {
        return 'target';
      }
    }
    return 'unseen';
  }, [savedVocabSet, masteryState.vocabs, targetVocabSet]);

  // 今回の読書セッションでマークされた「訳せなかった文」の理由編集用
  const [sessionSentenceReasons, setSessionSentenceReasons] = useState<Record<string, { category: DifficultyReasonCategory; note: string }>>({});

  // 今回のセッションで「要復習」とマークされたターゲットID
  const lapsedTargetIdsRef = useRef<Set<string>>(new Set());

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
    setCurrentSentenceIdx(0);
    setShowSentenceEnglish(false);
    setShowSentenceTranslation(false);
    setSentenceTranslationText('');
    lapsedTargetIdsRef.current.clear();
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

      // ターゲット構文パターンのマッチング
      const patternMatches: { start: number; end: number; embedding: TargetEmbedding }[] = [];
      const targetEmbeddings = currentStory.targetEmbeddings || [];
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
        }
        if (s.wIdx === range.endWIdx) insideSelection = false;
      } else if (insideSelection) {
        selectedTokens.push(s.text);
      }
    });

    const phrase = selectedTokens.join('').replace(/\s+/g, ' ').trim();
    if (phrase) {
      // ターゲット構文・単語の判定
      // 選択位置と重なる patternMatches を優先
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
        matchingEmbedding = currentStory.targetEmbeddings?.find(emb => {
          const tText = (emb.textSpan || emb.targetName || '').toLowerCase().trim();
          if (tText && (pText === tText || (pText.length > 3 && tText.includes(pText)))) return true;
          return false;
        });
      }

      onWordOrPhraseTap(phrase, fullParaText, matchingEmbedding);
    }
  };

  // 読了ハンドラー ＆ パッシブ同期モーダル起動
  const handleFinishStory = () => {
    stopSpeech();
    setIsPlayingAudio(false);

    // WPM 計算
    const durationMinutes = Math.max(0.2, (Date.now() - startTime) / 60000);
    const wordCount = currentStory.actualWordCount || currentStory.targetWordCount || 700;
    const wpm = Math.round(wordCount / durationMinutes);
    setCalculatedWpm(wpm);
    setPendingWpm(wpm);

    // 本文の全単語をOxford 5000 CEFR辞書と突合して抽出
    const extracted = extractStoryVocabs(currentStory.storyContent, currentStory.cefrLevel);
    setExtractedVocabs(extracted);

    setIsSyncModalOpen(true);
  };

  const handleConfirmSync = (
    masteredVocabs: ExtractedStoryVocab[],
    lapsedVocabs: ExtractedStoryVocab[],
    masteredPatternIds: string[],
    lapsedPatternIds: string[]
  ) => {
    // 1. 習得済み単語の一括同期
    if (masteredVocabs.length > 0) {
      recordVocabMasteryBatch(masteredVocabs.map(v => ({ phrase: v.phrase, status: 'mastered' })));
    }

    // 2. 要復習単語の同期 & 単語帳登録
    if (lapsedVocabs.length > 0) {
      recordVocabMasteryBatch(lapsedVocabs.map(v => ({ phrase: v.phrase, status: 'lapsed' })));
      lapsedVocabs.forEach(v => {
        recordVocabLapse({
          phrase: v.phrase,
          meaning: v.meaning,
          part_of_speech: v.partOfSpeech,
          explanation: '',
          context_sentence: '',
        }, currentStory.id);
      });
    }

    // 3. 構文ステータスの一括同期
    if (masteredPatternIds.length > 0) {
      recordPatternMasteryBatch(masteredPatternIds.map(id => ({ patternId: id, status: 'mastered' })));
    }
    if (lapsedPatternIds.length > 0) {
      recordPatternMasteryBatch(lapsedPatternIds.map(id => ({ patternId: id, status: 'lapsed' })));
    }

    // 4. 読書量とWPMを記録
    const wordCount = currentStory.actualWordCount || currentStory.targetWordCount || 700;
    recordDailyReadingActivity(wordCount, pendingWpm);

    if (onRecordStoryRead) {
      onRecordStoryRead(currentStory.id, pendingWpm);
    }

    setIsFinished(true);
    setIsSyncModalOpen(false);

    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.7 },
      colors: ['#3b82f6', '#60a5fa', '#38bdf8', '#fbbf24', '#818cf8']
    });
  };

  const handleSkipSync = () => {
    const wordCount = currentStory.actualWordCount || currentStory.targetWordCount || 700;
    recordDailyReadingActivity(wordCount, pendingWpm);

    if (onRecordStoryRead) {
      onRecordStoryRead(currentStory.id, pendingWpm);
    }

    setIsFinished(true);
    setIsSyncModalOpen(false);

    confetti({
      particleCount: 50,
      spread: 60,
      origin: { y: 0.7 },
      colors: ['#3b82f6', '#60a5fa', '#38bdf8']
    });
  };

  // 3部作の次のエピソード探索
  const nextEpisode = useMemo(() => {
    if (!currentStory.seriesId || !currentStory.episodeIndex || !currentStory.totalEpisodes) return null;
    if (currentStory.episodeIndex >= currentStory.totalEpisodes) return null;
    return allStories.find(
      s => s.seriesId === currentStory.seriesId && s.episodeIndex === (currentStory.episodeIndex || 0) + 1
    );
  }, [currentStory, allStories]);

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
            <span>🎧 聴くモード</span>
          </button>
        </div>

        <div className="flex items-center space-x-2 text-xs">
          {currentStory.episodeIndex && currentStory.totalEpisodes && (
            <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30 flex items-center gap-1">
              <Film className="w-3 h-3" />
              第 {currentStory.episodeIndex}/{currentStory.totalEpisodes} 話
            </span>
          )}
          {getContentTypeBadge()}
          <span className="px-2 py-0.5 rounded-md bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30">
            {currentStory.cefrLevel || 'A2'}
          </span>
        </div>
      </div>

      {/* 2. Audio Playback & Speed Bar */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3 sm:p-4 shadow-xl flex items-center justify-between flex-wrap gap-3">
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
              <span>一文ずつ</span>
            </button>
            <button
              onClick={() => {
                setListeningStyle('continuous');
                stopSpeech();
                setIsPlayingAudio(false);
              }}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg font-bold transition-all ${
                listeningStyle === 'continuous'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>通し聴き</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center space-x-2">
            <button
              onClick={handleToggleAudio}
              className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
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
                className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors"
                title="停止"
              >
                <Square className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        <div className="flex items-center space-x-2 text-xs">
          <span className="text-slate-400 font-semibold">再生速度:</span>
          {[0.8, 0.95, 1.1, 1.25].map((rate) => (
            <button
              key={rate}
              onClick={() => setSpeechRate(rate)}
              className={`px-2 py-1 rounded-lg font-bold transition-colors ${
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
              {currentStory.title}
            </h1>
          </div>
          {currentStory.titleJa && (
            <p className="text-sm font-semibold text-slate-300">
              {currentStory.titleJa}
            </p>
          )}
          {currentStory.summary && (
            <p className="text-xs text-slate-400 leading-relaxed pt-1">
              {currentStory.summary}
            </p>
          )}

          {/* Highlight Legend & Target Visibility Toggle */}
          <div className="flex items-center justify-between flex-wrap gap-2 pt-1 text-[11px] text-slate-400 border-t border-slate-800/60">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-slate-500 font-medium">ハイライト:</span>
              <span className="flex items-center space-x-1 text-amber-300 font-medium">
                <span className="w-2 h-2 rounded-full bg-amber-400 inline-block"></span>
                <span>習得中</span>
              </span>
              <span className="flex items-center space-x-1 text-emerald-300 font-medium">
                <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block"></span>
                <span>習得済み</span>
              </span>
              {showTargetHighlights && (
                <>
                  <span className="flex items-center space-x-1 text-purple-300 font-medium animate-fadeIn">
                    <span className="w-2 h-2 rounded-full bg-purple-400 inline-block"></span>
                    <span>💡 出題構文</span>
                  </span>
                  <span className="flex items-center space-x-1 text-sky-300 font-medium animate-fadeIn">
                    <span className="w-2 h-2 rounded-full bg-sky-400 inline-block"></span>
                    <span>🔵 出題単語</span>
                  </span>
                </>
              )}
            </div>

            <button
              onClick={() => {
                const next = !showTargetHighlights;
                setShowTargetHighlights(next);
                localStorage.setItem('reader_show_targets', String(next));
              }}
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${
                showTargetHighlights
                  ? 'bg-purple-950/80 text-purple-300 border-purple-500/50 shadow-sm'
                  : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-850'
              }`}
              title="出題された重要構文・単語のハイライト表示を切り替えます"
            >
              {showTargetHighlights ? (
                <>
                  <Eye className="w-3.5 h-3.5 text-purple-400" />
                  <span>ターゲット可視化: ON</span>
                </>
              ) : (
                <>
                  <EyeOff className="w-3.5 h-3.5 text-slate-500" />
                  <span>ターゲット可視化: OFF</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Story Body */}
        {viewMode === 'read' ? (
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

                    const isTargetMatch = showTargetHighlights && para.targetMatches.some(m =>
                      (seg.charStart >= m.start && seg.charStart < m.end) ||
                      (seg.charEnd > m.start && seg.charEnd <= m.end)
                    );

                    const status = getWordStatus(seg.cleanWord);

                    if (isPattern) {
                      // 💡 出題構文（パープル系背景・波線）
                      wordStyle = 'bg-purple-950/70 text-purple-200 underline decoration-purple-400 decoration-2 underline-offset-4 font-semibold hover:bg-purple-900/90 hover:text-purple-100 rounded px-0.5';
                    } else if (status === 'lapsed') {
                      // 🟡 習得中 / 要復習（単語帳に登録中）
                      wordStyle = 'text-amber-300 underline decoration-amber-400/80 decoration-2 underline-offset-2 hover:text-amber-200 hover:bg-amber-500/10';
                    } else if (status === 'mastered') {
                      // 🟢 習得済み（マスター済み・忘れた場合はタップで再登録可能）
                      wordStyle = 'text-emerald-300/90 underline decoration-emerald-500/50 decoration-1 underline-offset-2 hover:text-emerald-200 hover:bg-emerald-500/10';
                    } else if (showTargetHighlights && (status === 'target' || isTargetMatch)) {
                      // 🔵 今回の出題ターゲット語彙（可視化ON時のみ）
                      wordStyle = 'text-sky-300 underline decoration-sky-400/80 decoration-2 underline-offset-2 hover:text-sky-200 bg-sky-950/40 rounded px-0.5';
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
        ) : (
          /* Listening Step-by-Step UI */
          <div className="py-6 space-y-6 text-center">
            <div className="p-6 bg-slate-950/80 border border-purple-500/30 rounded-3xl space-y-4">
              <div className="text-xs text-purple-400 font-bold">
                一文リスニング [{currentSentenceIdx + 1} / {sentenceList.length}]
              </div>

              <div className="min-h-[70px] flex items-center justify-center">
                {showSentenceEnglish ? (
                  <p className="text-lg sm:text-xl font-bold text-white leading-relaxed animate-fadeIn">
                    {currentSentence?.text}
                  </p>
                ) : (
                  <button
                    onClick={() => setShowSentenceEnglish(true)}
                    className="flex items-center space-x-1.5 px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 rounded-xl text-xs font-semibold transition-all"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>英文を表示</span>
                  </button>
                )}
              </div>

              {showSentenceTranslation && (
                <p className="text-sm font-semibold text-slate-300 animate-fadeIn">
                  {sentenceTranslationText}
                </p>
              )}

              <div className="flex items-center justify-center space-x-3 pt-2">
                <button
                  onClick={() => handlePlaySentence(currentSentenceIdx)}
                  className="flex items-center space-x-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold shadow-md shadow-purple-600/25 transition-all"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>もう一度聴く</span>
                </button>

                <button
                  onClick={handleFetchSentenceTranslation}
                  disabled={isTranslatingSentence}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 rounded-xl text-xs font-semibold transition-colors"
                >
                  {isTranslatingSentence ? '訳を取得中...' : showSentenceTranslation ? '訳を隠す' : '日本語訳'}
                </button>

                <button
                  onClick={handleBookmarkCurrentSentence}
                  className="p-2 text-indigo-400 hover:bg-indigo-950/60 rounded-xl border border-indigo-500/30 transition-colors"
                  title="訳せなかった文として保存"
                >
                  <BookmarkPlus className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <button
                onClick={handlePrevSentence}
                disabled={currentSentenceIdx === 0}
                className="flex items-center space-x-1 px-4 py-2 bg-slate-800 disabled:opacity-30 text-slate-200 rounded-xl text-xs font-semibold"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>前の文</span>
              </button>
              <button
                onClick={handleNextSentence}
                disabled={currentSentenceIdx + 1 >= sentenceList.length}
                className="flex items-center space-x-1 px-4 py-2 bg-purple-600 disabled:opacity-30 text-white rounded-xl text-xs font-bold shadow-md shadow-purple-600/25"
              >
                <span>次の文</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

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

          {/* Trilogy Next Episode Banner */}
          {isFinished && nextEpisode && (
            <div className="p-4 bg-gradient-to-r from-blue-900/50 to-indigo-900/50 border border-blue-500/40 rounded-2xl flex items-center justify-between gap-3 animate-fadeIn">
              <div>
                <div className="text-xs font-bold text-blue-300 flex items-center gap-1.5">
                  <Film className="w-3.5 h-3.5 text-amber-400" />
                  <span>{currentStory.seriesType === 'continuous' || currentStory.seriesType === 'trilogy' ? `連載ストーリー: 次の第 ${nextEpisode.episodeIndex} 話へ` : `次の第 ${nextEpisode.episodeIndex} 話へ`}</span>
                </div>
                <div className="text-sm font-bold text-white pt-0.5">
                  『{nextEpisode.titleJa || nextEpisode.title}』
                </div>
              </div>
              <button
                onClick={() => onSelectStory?.(nextEpisode)}
                className="flex items-center space-x-1 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-600/30 transition-all flex-shrink-0"
              >
                <span>第 {nextEpisode.episodeIndex} 話を読む</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

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
                    { id: 'grammar', label: '📚 文法・構文' },
                    { id: 'other', label: '💭 ニュアンス・その他' },
                  ];

                  return (
                    <div key={item.id} className="p-3 bg-slate-900/90 border border-slate-800 rounded-xl space-y-2 text-xs">
                      <div className="text-slate-200 font-medium">
                        "{item.sentence}"
                      </div>
                      <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                        {categories.map(c => (
                          <button
                            key={c.id}
                            onClick={() => handleSetSentenceReason(item.id, c.id, currentReason.note)}
                            className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                              currentReason.category === c.id
                                ? 'bg-indigo-600 text-white'
                                : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                            }`}
                          >
                            {c.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 全文日本語訳 */}
          {showTranslation && (
            <div className="p-4 sm:p-5 bg-slate-950/90 border border-slate-800 rounded-2xl space-y-3 animate-fadeIn text-slate-300 text-sm sm:text-base leading-relaxed">
              <h4 className="text-xs font-bold text-sky-400 uppercase tracking-wider">
                【日本語全訳】
              </h4>
              {currentStory.japaneseTranslation.split('\n\n').map((paraJa, idx) => (
                <p key={idx}>{paraJa}</p>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Story Completion Passive Sync Modal */}
      {isSyncModalOpen && (
        <StoryCompletionSyncModal
          story={currentStory}
          calculatedWpm={pendingWpm}
          extractedVocabs={extractedVocabs}
          initialLapsedPhrases={new Set(vocabs.map(v => v.phrase.toLowerCase()))}
          onConfirmSync={handleConfirmSync}
          onSkipSync={handleSkipSync}
        />
      )}
    </div>
  );
};
