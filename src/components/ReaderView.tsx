import React, { useState, useEffect, useMemo } from 'react';
import { Story } from '../types/story';
import { VocabItem } from '../types/vocab';
import { CefrLevel } from '../types/settings';
import { Sparkles, Languages, CheckCircle2, ChevronDown, ChevronUp, Volume2, RefreshCw, FileJson, Tag } from 'lucide-react';
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
  onOpenImportModal: () => void;
  onMasterVocab: (vocabId: string) => void;
  onLapseVocab: (phrase: string, meaning: string) => void;
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
  currentLevel,
  onLevelChange,
  isGenerating,
  onGenerate,
  onWordOrPhraseTap,
  selectedPhrase,
  onClearSelection,
  onOpenImportModal,
  onMasterVocab,
  onLapseVocab,
}) => {
  const [promptInput, setPromptInput] = useState('');
  const [showTranslation, setShowTranslation] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [tappedWordsDuringStory, setTappedWordsDuringStory] = useState<Set<string>>(new Set());

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

  const handleFinishStory = () => {
    setIsFinished(true);

    if (currentStory && currentStory.targetVocabList) {
      currentStory.targetVocabList.forEach(t => {
        const cleanTarget = t.replace(/\s*\([^)]*\)/g, '').trim().toLowerCase();
        if (!tappedWordsDuringStory.has(cleanTarget)) {
          const vocabMatch = vocabs.find(v => v.phrase.toLowerCase() === cleanTarget);
          if (vocabMatch) {
            onMasterVocab(vocabMatch.id);
          }
        }
      });
    }

    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.7 },
      colors: ['#3b82f6', '#60a5fa', '#38bdf8', '#fbbf24', '#818cf8']
    });
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* 1. Generator & Import Control Bar */}
      <div className="bg-slate-900/90 border border-slate-800/90 rounded-2xl p-4 sm:p-5 shadow-xl shadow-black/20 space-y-4">
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
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  {lvl}
                </button>
              );
            })}
          </div>

          <button
            onClick={onOpenImportModal}
            className="flex items-center space-x-1.5 px-3 py-1 bg-slate-950 hover:bg-slate-800 text-blue-400 hover:text-blue-300 border border-blue-500/30 rounded-lg text-xs font-semibold transition-colors"
            title="外部GeminiやChatGPTで生成したJSONをインポート"
          >
            <FileJson className="w-3.5 h-3.5" />
            <span>外部AIプロンプト / JSONインポート</span>
          </button>
        </div>

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
              placeholder="テーマ・ジャンル（例: 冒険, SF, カフェでの再会, 未指定でおまかせ）"
              className="w-full bg-slate-950/80 border border-slate-700/80 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-none transition-all"
            />
          </div>
          <button
            onClick={() => onGenerate(promptInput)}
            disabled={isGenerating}
            className="flex items-center justify-center space-x-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 active:scale-[0.98] text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-lg shadow-blue-600/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
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
          <div className="border-b border-slate-800/80 pb-5 space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center space-x-2 flex-wrap">
                  <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
                    {currentStory.title}
                  </h1>
                  <span className="text-[10px] px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-400 font-bold border border-blue-500/30">
                    {currentStory.cefrLevel || 'A2'}
                  </span>
                </div>
                <p className="text-sm sm:text-base text-blue-400/90 font-medium">
                  {currentStory.titleJa}
                </p>
              </div>

              <button
                onClick={() => speakText(currentStory.storyContent)}
                className="p-2 text-slate-400 hover:text-blue-400 hover:bg-slate-800 rounded-xl transition-colors flex-shrink-0"
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
                <p key={para.pIdx} className="leading-relaxed text-slate-200 text-lg sm:text-xl">
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

            {/* 読了後の語彙セルフ評価カード */}
            {isFinished && currentStory.targetVocabList && currentStory.targetVocabList.length > 0 && (
              <div className="p-4 bg-slate-950/90 border border-blue-500/30 rounded-2xl space-y-3 animate-fadeIn">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-blue-400 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" /> 今回の登場語彙の定着度チェック（Anki風SRS）
                  </span>
                  <span className="text-[11px] text-slate-400">
                    ※タップしなかった単語は自動で「覚えた」になります
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  {currentStory.targetVocabList.map((t, idx) => {
                    const cleanPhrase = t.replace(/\s*\([^)]*\)/g, '').trim();
                    const wasTapped = tappedWordsDuringStory.has(cleanPhrase.toLowerCase());

                    return (
                      <div key={idx} className="bg-slate-900 border border-slate-800 p-2.5 rounded-xl flex items-center justify-between text-xs">
                        <div>
                          <span className="font-bold text-white block">{cleanPhrase}</span>
                          <span className="text-[11px] text-slate-400">
                            {wasTapped ? '読書中にタップ・確認' : 'スラスラ読めた（定着）'}
                          </span>
                        </div>

                        <div className="flex items-center space-x-1">
                          <button
                            onClick={() => {
                              const match = vocabs.find(v => v.phrase.toLowerCase() === cleanPhrase.toLowerCase());
                              if (match) onMasterVocab(match.id);
                            }}
                            className="px-2 py-1 bg-emerald-950/60 hover:bg-emerald-900 text-emerald-400 border border-emerald-500/30 rounded-lg text-[11px] font-semibold"
                            title="簡単！覚えた（次回期日を延長）"
                          >
                            🟢 簡単
                          </button>
                          <button
                            onClick={() => onLapseVocab(cleanPhrase, '要復習')}
                            className="px-2 py-1 bg-amber-950/60 hover:bg-amber-900 text-amber-400 border border-amber-500/30 rounded-lg text-[11px] font-semibold"
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
      ) : (
        <div className="py-16 text-center space-y-4 bg-slate-900/40 border border-slate-800/60 rounded-3xl p-8">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-blue-950/60 border border-blue-500/30 flex items-center justify-center">
            <Sparkles className="w-8 h-8 text-blue-400" />
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