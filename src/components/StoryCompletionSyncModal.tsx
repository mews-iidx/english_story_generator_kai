import React, { useState, useMemo } from 'react';
import { Story } from '../types/story';
import { CefrLevel } from '../types/settings';
import { ExtractedStoryVocab } from '../utils/storyVocabExtractor';
import { Check, AlertCircle, Sparkles, BookOpen, ChevronRight, X } from 'lucide-react';

interface StoryCompletionSyncModalProps {
  story: Story;
  calculatedWpm: number;
  extractedVocabs: ExtractedStoryVocab[];
  initialLapsedPhrases: Set<string>; // 読書中に単語帳に追加された単語
  onConfirmSync: (
    masteredVocabs: ExtractedStoryVocab[],
    lapsedVocabs: ExtractedStoryVocab[],
    masteredPatternIds: string[],
    lapsedPatternIds: string[]
  ) => void;
  onSkipSync: () => void;
}

export const StoryCompletionSyncModal: React.FC<StoryCompletionSyncModalProps> = ({
  story,
  calculatedWpm,
  extractedVocabs,
  initialLapsedPhrases,
  onConfirmSync,
  onSkipSync,
}) => {
  // 単語ごとのステータス管理: true = 習得済み(mastered), false = 要復習(lapsed)
  const [vocabStatusMap, setVocabStatusMap] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    extractedVocabs.forEach(v => {
      // 読書中に単語帳に追加されたものは false (要復習)、それ以外は true (習得済み)
      const isLapsed = initialLapsedPhrases.has(v.phrase.toLowerCase()) || 
                       initialLapsedPhrases.has(v.matchedText.toLowerCase());
      initial[v.id] = !isLapsed;
    });
    return initial;
  });

  // 構文ごとのステータス管理
  const targetPatterns = useMemo(() => {
    return (story.targetEmbeddings || []).filter(e => e.type === 'pattern' && e.targetId);
  }, [story.targetEmbeddings]);

  const [patternStatusMap, setPatternStatusMap] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    targetPatterns.forEach(p => {
      initial[p.targetId] = true; // デフォルトは習得済み
    });
    return initial;
  });

  // 選択中レベルフィルター
  const [selectedLevelFilter, setSelectedLevelFilter] = useState<'ALL' | CefrLevel>('ALL');

  const toggleVocabStatus = (id: string) => {
    setVocabStatusMap(prev => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const togglePatternStatus = (targetId: string) => {
    setPatternStatusMap(prev => ({
      ...prev,
      [targetId]: !prev[targetId],
    }));
  };

  const setAllVocabsInView = (status: boolean) => {
    setVocabStatusMap(prev => {
      const next = { ...prev };
      filteredVocabs.forEach(v => {
        next[v.id] = status;
      });
      return next;
    });
  };

  // フィルター後の単語リスト
  const filteredVocabs = useMemo(() => {
    if (selectedLevelFilter === 'ALL') return extractedVocabs;
    return extractedVocabs.filter(v => v.cefr === selectedLevelFilter);
  }, [extractedVocabs, selectedLevelFilter]);

  // レベル別カウント
  const levelCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: extractedVocabs.length, A1: 0, A2: 0, B1: 0, B2: 0, C1: 0 };
    extractedVocabs.forEach(v => {
      counts[v.cefr] = (counts[v.cefr] || 0) + 1;
    });
    return counts;
  }, [extractedVocabs]);

  // 集計カウント
  const masteredVocabCount = useMemo(() => {
    return Object.values(vocabStatusMap).filter(Boolean).length;
  }, [vocabStatusMap]);

  const lapsedVocabCount = extractedVocabs.length - masteredVocabCount;

  const handleConfirm = () => {
    const masteredVocabs = extractedVocabs.filter(v => vocabStatusMap[v.id] !== false);
    const lapsedVocabs = extractedVocabs.filter(v => vocabStatusMap[v.id] === false);

    const masteredPatternIds: string[] = [];
    const lapsedPatternIds: string[] = [];

    targetPatterns.forEach(p => {
      if (patternStatusMap[p.targetId] !== false) {
        masteredPatternIds.push(p.targetId);
      } else {
        lapsedPatternIds.push(p.targetId);
      }
    });

    onConfirmSync(masteredVocabs, lapsedVocabs, masteredPatternIds, lapsedPatternIds);
  };

  const levelBadgeColors: Record<CefrLevel, string> = {
    A1: 'bg-emerald-950 text-emerald-300 border-emerald-500/40',
    A2: 'bg-teal-950 text-teal-300 border-teal-500/40',
    B1: 'bg-blue-950 text-blue-300 border-blue-500/40',
    B2: 'bg-indigo-950 text-indigo-300 border-indigo-500/40',
    C1: 'bg-purple-950 text-purple-300 border-purple-500/40',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="bg-slate-900 border border-slate-750 rounded-3xl w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="p-5 sm:p-6 bg-gradient-to-r from-blue-900/60 via-indigo-900/40 to-slate-900 border-b border-slate-800 flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center space-x-2">
              <span className="text-xl">🎉</span>
              <h2 className="text-lg sm:text-xl font-extrabold text-white tracking-tight">
                読了おめでとうございます！
              </h2>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-500/30 text-blue-200 font-bold border border-blue-400/30">
                {calculatedWpm} WPM
              </span>
            </div>
            <p className="text-xs sm:text-sm font-semibold text-slate-300 line-clamp-1">
              『{story.titleJa || story.title}』
            </p>
            <p className="text-xs text-slate-400">
              つまずかずに読めた語彙・構文をマスターDBに一括同期して習熟度を更新します。
            </p>
          </div>

          <button
            onClick={onSkipSync}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors"
            title="スキップして閉じる"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 text-slate-200">

          {/* Section 1: Target Grammar Patterns */}
          {targetPatterns.length > 0 && (
            <div className="space-y-3 bg-slate-950/70 border border-amber-500/25 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <span className="font-bold text-xs sm:text-sm text-slate-200">
                    出題ターゲット構文（{targetPatterns.length}個）
                  </span>
                </div>
                <span className="text-[11px] text-slate-400">
                  タップで「習得済み」⇄「要復習」を切替
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {targetPatterns.map((pat) => {
                  const isMastered = patternStatusMap[pat.targetId] !== false;
                  return (
                    <button
                      key={pat.targetId}
                      type="button"
                      onClick={() => togglePatternStatus(pat.targetId)}
                      className={`p-3 rounded-xl border text-left transition-all flex items-start justify-between gap-2 ${
                        isMastered
                          ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-100 hover:bg-emerald-900/40'
                          : 'bg-rose-950/40 border-rose-500/40 text-rose-200 hover:bg-rose-900/40'
                      }`}
                    >
                      <div className="space-y-1 pr-1">
                        <div className="font-bold text-xs sm:text-sm text-white flex items-center gap-1.5">
                          <span>{pat.targetName}</span>
                        </div>
                        {pat.textSpan && (
                          <div className="text-xs text-sky-300 font-medium italic">
                            "{pat.textSpan}"
                          </div>
                        )}
                        {pat.focusPoint && (
                          <div className="text-[11px] text-slate-400 leading-tight">
                            {pat.focusPoint}
                          </div>
                        )}
                      </div>

                      <div className="flex-shrink-0 pt-0.5">
                        {isMastered ? (
                          <span className="flex items-center space-x-1 text-[11px] font-bold text-emerald-300 bg-emerald-950 px-2 py-0.5 rounded-lg border border-emerald-500/30">
                            <Check className="w-3 h-3" />
                            <span>習得済</span>
                          </span>
                        ) : (
                          <span className="flex items-center space-x-1 text-[11px] font-bold text-rose-300 bg-rose-950 px-2 py-0.5 rounded-lg border border-rose-500/30">
                            <AlertCircle className="w-3 h-3" />
                            <span>要復習</span>
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Section 2: Story Vocabularies */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center space-x-2">
                <BookOpen className="w-4 h-4 text-blue-400" />
                <span className="font-bold text-xs sm:text-sm text-white">
                  本文で登場した全英単語（{extractedVocabs.length}語）
                </span>
              </div>

              <div className="flex items-center space-x-2 text-xs font-semibold">
                <span className="text-emerald-400">🟢 習得済: {masteredVocabCount}語</span>
                <span className="text-slate-500">/</span>
                <span className="text-rose-400">🔴 要復習: {lapsedVocabCount}語</span>
              </div>
            </div>

            <div className="text-[11px] text-slate-400 flex items-center justify-between flex-wrap gap-2">
              <span>💡 気になった単語をタップすると「要復習」に切り替えられます。</span>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setAllVocabsInView(true)}
                  className="text-[11px] text-emerald-400 hover:underline"
                >
                  表示中をすべて習得済みに
                </button>
                <span className="text-slate-600">|</span>
                <button
                  type="button"
                  onClick={() => setAllVocabsInView(false)}
                  className="text-[11px] text-rose-400 hover:underline"
                >
                  表示中をすべて要復習に
                </button>
              </div>
            </div>

            {/* Level Filter Tabs */}
            <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 text-xs">
              {(['ALL', 'A1', 'A2', 'B1', 'B2', 'C1'] as const).map(lvl => {
                const count = levelCounts[lvl] || 0;
                if (lvl !== 'ALL' && count === 0) return null;
                const isSelected = selectedLevelFilter === lvl;
                return (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setSelectedLevelFilter(lvl)}
                    className={`px-3 py-1.5 rounded-xl font-bold transition-all whitespace-nowrap ${
                      isSelected
                        ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                        : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                    }`}
                  >
                    {lvl === 'ALL' ? 'すべて' : lvl} ({count})
                  </button>
                );
              })}
            </div>

            {/* Vocab Chips List */}
            <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl max-h-72 overflow-y-auto">
              <div className="flex flex-wrap gap-1.5">
                {filteredVocabs.map(v => {
                  const isMastered = vocabStatusMap[v.id] !== false;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => toggleVocabStatus(v.id)}
                      title={`${v.phrase} (${v.partOfSpeech}): ${v.meaning}`}
                      className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold transition-all border ${
                        isMastered
                          ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200 hover:bg-emerald-900/50'
                          : 'bg-rose-950/60 border-rose-500/60 text-rose-200 hover:bg-rose-900/70 shadow-sm'
                      }`}
                    >
                      <span>{isMastered ? '✓' : '!'}</span>
                      <span className="font-bold">{v.phrase}</span>
                      <span className="text-[10px] text-slate-400 max-w-[90px] truncate">
                        {v.meaning.split(',')[0]}
                      </span>
                      <span className={`text-[9px] px-1 py-0.2 rounded font-bold border ${levelBadgeColors[v.cefr] || 'text-slate-400'}`}>
                        {v.cefr}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 sm:p-5 bg-slate-950 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
          <button
            type="button"
            onClick={onSkipSync}
            className="w-full sm:w-auto px-4 py-2.5 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors"
          >
            同期せずに読了のみ記録
          </button>

          <button
            type="button"
            onClick={handleConfirm}
            className="w-full sm:w-auto flex items-center justify-center space-x-2 px-7 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 active:scale-[0.98] text-white rounded-2xl text-xs sm:text-sm font-bold shadow-xl shadow-blue-600/30 transition-all"
          >
            <Sparkles className="w-4 h-4 text-amber-300" />
            <span>
              一括同期して完了（🟢 {masteredVocabCount}語 / 構文 {Object.values(patternStatusMap).filter(Boolean).length}個）
            </span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
