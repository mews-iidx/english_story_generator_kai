import React, { useState, useEffect, useMemo } from 'react';
import { Story } from '../types/story';
import { VocabItem } from '../types/vocab';
import { CefrLevel } from '../types/settings';
import { Sparkles, Languages, CheckCircle2, ChevronDown, ChevronUp, Volume2, RefreshCw } from 'lucide-react';
import confetti from 'canvas-confetti';
import { speakText } from '../utils/speech';

interface ReaderViewProps {
  currentStory: Story | null;
  vocabs: VocabItem[];
  currentLevel: CefrLevel;
  onLevelChange: (level: CefrLevel) => void;
  isGenerating: boolean;
  onGenerate: (userPrompt?: string) => Promise<void>;
  onWordOrPhraseTap: (text: string, contextSentence: string) => void;
  selectedPhrase: string;
  onClearSelection: () => void;
}

interface Segment {
  isWord: boolean;
  text: string;
  wIdx: number; // 単語インデックス（記号・スペースの場合は -1）
  cleanWord: string;
}

export const ReaderView: React.FC<ReaderViewProps> = ({
  currentStory,
  vocabs,
  currentLevel,
  onLevelChange,
  isGenerating,
  onGenerate,
  onWordOrPhraseTap,
  selectedPhrase,
  onClearSelection,
}) => {
  const [promptInput, setPromptInput] = useState('');
  const [showTranslation, setShowTranslation] = useState(false);
  const [isFinished, setIsFinished] = useState(false);

  const [selectionRange, setSelectionRange] = useState<{
    pIdx: number;
    startWIdx: number;
    endWIdx: number;
  } | null>(null);

  useEffect(() => {
    setIsFinished(false);
    setShowTranslation(false);
    setSelectionRange(null);
  }, [currentStory?.id]);

  useEffect(() => {
    if (!selectedPhrase) {
      setSelectionRange(null);
    }
  }, [selectedPhrase]);

  const savedVocabSet = useMemo(() => {
    const set = new Set<string>();
    vocabs.forEach(v => {
      set.add(v.phrase.trim().toLowerCase());
    });
    return set;
  }, [vocabs]);

  // 段落ごとのテキストを自然な英語タイポグラフィを保ったままセグメント分割
  const paragraphSegments = useMemo(() => {
    if (!currentStory) return [];

    const paragraphs = currentStory.storyContent.split('\n\n').filter(p => p.trim().length > 0);

    return paragraphs.map((para, pIdx) => {
      // 単語（英数字およびアポストロフィ/ハイフン）とその間の区切り文字に正確にマッチ
      const regex = /([a-zA-Z0-9'-]+)/g;
      const segments: Segment[] = [];
      let lastIndex = 0;
      let wordCounter = 0;
      let match: RegExpExecArray | null;

      while ((match = regex.exec(para)) !== null) {
        // マッチ前の区切り文字（スペース、ピリオド、カンマ等）
        if (match.index > lastIndex) {
          segments.push({
            isWord: false,
            text: para.substring(lastIndex, match.index),
            wIdx: -1,
            cleanWord: '',
          });
        }

        // 単語本体
        const rawWord = match[0];
        const cleanWord = rawWord.replace(/^[^\w]+|[^\w]+$/g, '');
        segments.push({
          isWord: true,
          text: rawWord,
          wIdx: wordCounter++,
          cleanWord,
        });

        lastIndex = regex.lastIndex;
      }

      // 末尾の残りの文字
      if (lastIndex < para.length) {
        segments.push({
          isWord: false,
          text: para.substring(lastIndex),
          wIdx: -1,
          cleanWord: '',
        });
      }

      return {
        pIdx,
        fullParaText: para,
        segments,
      };
    });
  }, [currentStory]);

  const handleWordClick = (pIdx: number, wIdx: number, fullParaText: string) => {
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
      
      if (newEnd - newStart < 9) {
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

    const selectedWords: string[] = [];
    para.segments.forEach(s => {
      if (s.isWord && s.wIdx >= range.startWIdx && s.wIdx <= range.endWIdx) {
        selectedWords.push(s.text);
      }
    });

    const phrase = selectedWords.join(' ').replace(/\s+/g, ' ').trim();
    if (phrase) {
      onWordOrPhraseTap(phrase, fullParaText);
    }
  };

  const handleFinishStory = () => {
    setIsFinished(true);
    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.7 },
      colors: ['#10b981', '#34d399', '#6ee7b7', '#f59e0b', '#38bdf8']
    });
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* 1. Generator Control Bar */}
      <div className="bg-slate-900/90 border border-slate-800/90 rounded-2xl p-4 sm:p-5 shadow-xl shadow-black/20 space-y-4">
        {/* Level Selector Pills */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center space-x-1.5">
            <span className="text-xs font-semibold text-slate-400">レベル:</span>
            {(['A1', 'A2', 'B1', 'B2', 'C1'] as const).map((lvl) => {
              const desc = {
                A1: '超初級(中学1-2年)',
                A2: '初級(中学3年-日常)',
                B1: '中級(日常会話)',
                B2: '中上級(自然な表現)',
                C1: '上級(高度な英語)',
              }[lvl];
              return (
                <button
                  key={lvl}
                  onClick={() => onLevelChange(lvl)}
                  title={desc}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                    currentLevel === lvl
                      ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  {lvl}
                </button>
              );
            })}
          </div>

          <span className="text-[11px] text-emerald-400 font-medium">
            {currentLevel === 'A1' && 'A1: やさしい中学英語'}
            {currentLevel === 'A2' && 'A2: 日常基礎英語'}
            {currentLevel === 'B1' && 'B1: 標準的な日常英語'}
            {currentLevel === 'B2' && 'B2: 自然なイディオム'}
            {currentLevel === 'C1' && 'C1: 上級・高度な語彙'}
          </span>
        </div>

        {/* Prompt Input & Generate Button */}
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <input
              type="text"
              value={promptInput}
              onChange={(e) => setPromptInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isGenerating) {
                  onGenerate(promptInput);
                }
              }}
              placeholder="テーマ（例: カフェ、友達との会話、SF、未指定でおまかせ）"
              className="w-full bg-slate-950/80 border border-slate-700/80 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-none transition-all"
            />
          </div>
          <button
            onClick={() => onGenerate(promptInput)}
            disabled={isGenerating}
            className="flex items-center justify-center space-x-2 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 active:scale-[0.98] text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-lg shadow-emerald-600/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isGenerating ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>生成中...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>{currentStory ? '次の物語を生成' : '物語を生成する'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 2. Story Content Area */}
      {currentStory ? (
        <article className="bg-slate-900/60 border border-slate-800/80 rounded-3xl p-6 sm:p-9 shadow-2xl backdrop-blur-sm space-y-6">
          {/* Title Header */}
          <div className="border-b border-slate-800/80 pb-5 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
                {currentStory.title}
              </h1>
              <button
                onClick={() => speakText(currentStory.storyContent)}
                className="p-2 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded-xl transition-colors"
                title="全文を音声再生"
              >
                <Volume2 className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm sm:text-base text-emerald-400/90 font-medium">
              {currentStory.titleJa}
            </p>

            {/* Summary Badge (Spoiler-free) */}
            {currentStory.summary && (
              <div className="pt-2">
                <span className="inline-block text-xs bg-slate-800/90 text-slate-300 px-3 py-1.5 rounded-lg border border-slate-700/60 leading-relaxed">
                  💡 <strong>導入・設定</strong>: {currentStory.summary}
                </span>
              </div>
            )}
          </div>

          {/* Operation Hint */}
          <div className="text-xs text-slate-400 flex items-center justify-between bg-slate-950/50 p-2.5 rounded-xl border border-slate-800/50">
            <span>👆 <strong>操作ヒント:</strong> 単語を押すと選択。続けて前後の単語を押すと熟語として連結選択できます。画面の何もない場所を押すと解除されます。</span>
          </div>

          {/* Story Body (natural typography, select-none to avoid mobile OS popups) */}
          <div className="story-body select-none py-2 space-y-6" onClick={onClearSelection}>
            {paragraphSegments.map((para) => {
              const targetSet = new Set((currentStory.targetVocabList || []).map(t => t.toLowerCase()));

              return (
                <p key={para.pIdx} className="leading-relaxed text-slate-200 text-lg sm:text-xl">
                  {para.segments.map((seg, sIdx) => {
                    if (!seg.isWord) {
                      return <span key={sIdx}>{seg.text}</span>;
                    }

                    const clean = seg.cleanWord.toLowerCase();
                    const isTarget = targetSet.has(clean);
                    const isSaved = savedVocabSet.has(clean);

                    const isSelected = 
                      selectionRange && 
                      selectionRange.pIdx === para.pIdx && 
                      seg.wIdx >= selectionRange.startWIdx && 
                      seg.wIdx <= selectionRange.endWIdx;

                    let wordStyle = 'hover:bg-emerald-500/20 hover:text-emerald-300';

                    if (isSelected) {
                      wordStyle = 'bg-emerald-500 text-slate-950 font-bold shadow-sm shadow-emerald-500/30';
                    } else if (isTarget) {
                      wordStyle = 'text-amber-300 font-semibold underline decoration-amber-400/90 decoration-2 underline-offset-4 bg-amber-950/30 hover:bg-amber-950/60';
                    } else if (isSaved) {
                      wordStyle = 'text-emerald-300 font-medium underline decoration-emerald-500/70 decoration-2 underline-offset-4 bg-emerald-950/20 hover:bg-emerald-950/50';
                    }

                    return (
                      <span
                        key={sIdx}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleWordClick(para.pIdx, seg.wIdx, para.fullParaText);
                        }}
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

          {/* Actions & Full Translation Accordion */}
          <div className="pt-4 border-t border-slate-800/80 space-y-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <button
                onClick={handleFinishStory}
                className={`w-full sm:w-auto flex items-center justify-center space-x-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  isFinished
                    ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/30'
                    : 'bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 hover:border-slate-600'
                }`}
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
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

            {showTranslation && (
              <div className="p-4 sm:p-5 bg-slate-950/70 border border-slate-800/90 rounded-2xl space-y-2 animate-fadeIn">
                <span className="text-xs font-bold uppercase text-emerald-400 tracking-wider">全文日本語訳</span>
                <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">
                  {currentStory.japaneseTranslation}
                </p>
              </div>
            )}
          </div>
        </article>
      ) : (
        <div className="py-16 text-center space-y-4 bg-slate-900/40 border border-slate-800/60 rounded-3xl p-8">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-950/60 border border-emerald-500/30 flex items-center justify-center">
            <Sparkles className="w-8 h-8 text-emerald-400" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-white">物語を生成して学習を始めましょう</h2>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              上部のレベルを選択して「物語を生成する」ボタンを押すと、あなたの弱点語彙を自然に組み込んだショートストーリーが作成されます。
            </p>
          </div>
        </div>
      )}
    </div>
  );
};