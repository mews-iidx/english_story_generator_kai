import React, { useState, useEffect, useMemo } from 'react';
import { Story } from '../types/story';
import { VocabItem } from '../types/vocab';
import { Sparkles, Languages, CheckCircle2, ChevronDown, ChevronUp, Volume2, ArrowLeft, Tag } from 'lucide-react';
import confetti from 'canvas-confetti';
import { speakText } from '../utils/speech';

interface ReaderViewProps {
  currentStory: Story;
  vocabs: VocabItem[];
  onWordOrPhraseTap: (text: string, contextSentence: string) => void;
  selectedPhrase: string;
  onClearSelection: () => void;
  onMasterVocab: (vocabId: string) => void;
  onLapseVocab: (phrase: string, meaning: string) => void;
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
  onWordOrPhraseTap,
  selectedPhrase,
  onClearSelection,
  onMasterVocab,
  onLapseVocab,
  onBackToBookshelf,
}) => {
  const [showTranslation, setShowTranslation] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [tappedWordsDuringStory, setTappedWordsDuringStory] = useState<Set<string>>(new Set());

  // 単語ごとの読了後評価状態 ('easy' | 'hard') を個別キーで管理
  const [vocabEvaluations, setVocabEvaluations] = useState<Record<string, 'easy' | 'hard'>>({});

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
  }, [currentStory?.id]);

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

  const paragraphSegments = useMemo(() => {
    if (!currentStory) return [];

    const paragraphs = currentStory.storyContent.split('\n\n').filter(p => p.trim().length > 0);

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
  }, [currentStory, vocabs]);

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

  // 読了ハンドラー
  const handleFinishStory = () => {
    setIsFinished(true);

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

  // 個別単語の「簡単」ボタン押下ハンドラー
  const handleRateEasy = (cleanPhrase: string) => {
    const key = cleanPhrase.toLowerCase();
    setVocabEvaluations(prev => ({ ...prev, [key]: 'easy' }));
    const match = vocabs.find(v => v.phrase.toLowerCase() === key);
    if (match) {
      onMasterVocab(match.id);
    }
  };

  // 個別単語の「難しい」ボタン押下ハンドラー
  const handleRateHard = (cleanPhrase: string) => {
    const key = cleanPhrase.toLowerCase();
    setVocabEvaluations(prev => ({ ...prev, [key]: 'hard' }));
    onLapseVocab(cleanPhrase, '要復習');
  };

  return (
    <div className="max-w-3xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4">
      {/* 1. Top Navigation Bar (Back to Bookshelf) */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBackToBookshelf}
          className="flex items-center space-x-2 px-3.5 py-2 bg-slate-900 hover:bg-slate-850 text-slate-200 border border-slate-800 rounded-xl text-xs sm:text-sm font-semibold transition-all group"
        >
          <ArrowLeft className="w-4 h-4 text-blue-400 group-hover:-translate-x-0.5 transition-transform" />
          <span>本棚に戻る</span>
        </button>

        <div className="flex items-center space-x-2 text-xs">
          <span className="px-2.5 py-1 rounded-lg bg-blue-500/20 text-blue-400 font-bold border border-blue-500/30">
            {currentStory.cefrLevel || 'A2'}
          </span>
          {currentStory.targetWordCount && (
            <span className="px-2 py-1 rounded-lg bg-slate-900 text-slate-400 font-medium border border-slate-800">
              約{currentStory.targetWordCount}語
            </span>
          )}
        </div>
      </div>

      {/* 2. Story Content Area */}
      <article className="bg-slate-900/60 border border-slate-800/80 rounded-3xl p-5 sm:p-9 shadow-2xl backdrop-blur-sm space-y-6">
        <div className="border-b border-slate-800/80 pb-5 space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1">
              <h1 className="text-xl sm:text-3xl font-bold text-white tracking-tight">
                {currentStory.title}
              </h1>
              <p className="text-sm sm:text-base text-blue-400/90 font-medium">
                {currentStory.titleJa}
              </p>
            </div>

            <button
              onClick={() => speakText(currentStory.storyContent)}
              className="p-2.5 text-slate-400 hover:text-blue-400 hover:bg-slate-800 rounded-2xl transition-colors border border-slate-800 flex-shrink-0"
              title="全文を音声再生"
            >
              <Volume2 className="w-5 h-5" />
            </button>
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
          <span>👆 <strong>操作ヒント:</strong> 単語を押すと選択。離れた単語を押せば文全体もまとめて選択できます。余白を押すと解除されます。</span>
        </div>

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

                  let wordStyle = 'hover:bg-blue-500/20 hover:text-blue-300';

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
              <CheckCircle2 className="w-4 h-4 text-sky-400" />
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

          {/* 読了後の語彙セルフ評価カード（単語ごとに独立した評価ボタングループ） */}
          {isFinished && currentStory.targetVocabList && currentStory.targetVocabList.length > 0 && (
            <div className="p-4 bg-slate-950/90 border border-blue-500/30 rounded-2xl space-y-3 animate-fadeIn">
              <div className="flex items-center justify-between flex-wrap gap-1">
                <span className="text-xs font-bold text-blue-400 flex items-center gap-1.5">
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

                      {/* 単語ごとに独立した [簡単] / [難しい] ボタングループ */}
                      <div className="flex items-center space-x-1 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => handleRateEasy(cleanPhrase)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                            currentRating === 'easy'
                              ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/30 border border-emerald-400'
                              : 'bg-slate-950 text-slate-400 hover:text-emerald-400 border border-slate-800'
                          }`}
                          title="簡単！覚えた（次回期日を延長）"
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
                          title="難しかった（次回すぐ再出題）"
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
              <span className="text-xs font-bold uppercase text-blue-400 tracking-wider">全文日本語訳</span>
              <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">
                {currentStory.japaneseTranslation}
              </p>
            </div>
          )}
        </div>
      </article>
    </div>
  );
};