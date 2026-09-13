import React, { useState, useMemo } from 'react';
import { Story } from '../types/story';
import { CefrLevel } from '../types/settings';
import { ExtractedStoryVocab } from '../utils/storyVocabExtractor';
import { Check, AlertCircle, Sparkles, BookOpen, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';

export type SyncVocabStatus = 'mastered' | 'lapsed' | 'unseen';

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
  // パッシブ抽出単語リストの展開・折りたたみ（デフォルト: 折りたたみ）
  const [isVocabsExpanded, setIsVocabsExpanded] = useState(false);

  // 単語ごとのステータス管理: 'mastered'(習得済) | 'lapsed'(要復習) | 'unseen'(未遭遇/スキップ)
  const [vocabStatusMap, setVocabStatusMap] = useState<Record<string, SyncVocabStatus>>(() => {
    const initial: Record<string, SyncVocabStatus> = {};
    extractedVocabs.forEach(v => {
      const isLapsed = initialLapsedPhrases.has(v.phrase.toLowerCase()) || 
                       initialLapsedPhrases.has(v.matchedText.toLowerCase());
      initial[v.id] = isLapsed ? 'lapsed' : 'mastered';
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

  // 単語ステータスの3段階トグル: mastered -> lapsed -> unseen -> mastered
  const cycleVocabStatus = (id: string) => {
    setVocabStatusMap(prev => {
      const cur = prev[id] || 'mastered';
      const nextStatus: SyncVocabStatus = 
        cur === 'mastered' ? 'lapsed' : 
        cur === 'lapsed' ? 'unseen' : 'mastered';
      return { ...prev, [id]: nextStatus };
    });
  };

  const togglePatternStatus = (targetId: string) => {
    setPatternStatusMap(prev => ({
      ...prev,
      [targetId]: !prev[targetId],
    }));
  };

  // 表示中の一括ステータス変更
  const setAllVocabsInView = (status: SyncVocabStatus) => {
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
  const masteredVocabs = useMemo(() => {
    return extractedVocabs.filter(v => vocabStatusMap[v.id] === 'mastered');
  }, [extractedVocabs, vocabStatusMap]);

  const lapsedVocabs = useMemo(() => {
    return extractedVocabs.filter(v => vocabStatusMap[v.id] === 'lapsed');
  }, [extractedVocabs, vocabStatusMap]);

  const unseenVocabs = useMemo(() => {
    return extractedVocabs.filter(v => vocabStatusMap[v.id] === 'unseen');
  }, [extractedVocabs, vocabStatusMap]);

  const levelBadgeColors: Record<CefrLevel, string> = {
    A1: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    A2: 'bg-teal-500/20 text-teal-300 border-teal-500/40',
    B1: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
    B2: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
    C1: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  };

  const handleConfirm = () => {
    const masteredPatternIds: string[] = [];
    const lapsedPatternIds: string[] = [];

    targetPatterns.forEach(p => {
      if (patternStatusMap[p.targetId]) {
        masteredPatternIds.push(p.targetId);
      } else {
        lapsedPatternIds.push(p.targetId);
      }
    });

    onConfirmSync(masteredVocabs, lapsedVocabs, masteredPatternIds, lapsedPatternIds);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
      <div 
        className="w-full max-w-2xl bg-slate-900 border border-slate-750 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-blue-950/80 via-slate-900 to-indigo-950/80 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-600/30 border border-blue-500/40 flex items-center justify-center text-blue-300">
              <Sparkles className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                読了チェックイン ＆ 習熟度同期
              </h2>
              <p className="text-xs text-slate-400">
                読破スピード: <strong className="text-sky-300">{calculatedWpm} WPM</strong>
              </p>
            </div>
          </div>

          <button
            onClick={onSkipSync}
            className="text-slate-400 hover:text-white p-1.5 rounded-xl hover:bg-slate-800 transition-colors"
            title="スキップして閉じる"
          >
            ✕
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
          {/* Section 1: Target Syntax Patterns (if any) */}
          {targetPatterns.length > 0 && (
            <div className="space-y-2.5 bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs sm:text-sm text-purple-300 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                  今回の出題ターゲット構文（{targetPatterns.length}件）
                </span>
                <span className="text-[11px] text-slate-400">タップで要復習に変更</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {targetPatterns.map(pat => {
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

          {/* Section 2: Story Extracted Vocabularies (Collapsible, Default Closed) */}
          <div className="space-y-3 bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3.5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center space-x-2">
                <BookOpen className="w-4 h-4 text-blue-400" />
                <span className="font-bold text-xs sm:text-sm text-white">
                  本文の抽出単語（{extractedVocabs.length}語）
                </span>
              </div>

              <div className="flex items-center space-x-2 text-xs font-semibold">
                <span className="text-emerald-400">🟢 習得: {masteredVocabs.length}</span>
                {lapsedVocabs.length > 0 && <span className="text-rose-400">🔴 要復習: {lapsedVocabs.length}</span>}
                {unseenVocabs.length > 0 && <span className="text-slate-400">⚪ スキップ: {unseenVocabs.length}</span>}
                <button
                  type="button"
                  onClick={() => setIsVocabsExpanded(!isVocabsExpanded)}
                  className="flex items-center space-x-1 px-2.5 py-1 bg-slate-900 hover:bg-slate-850 text-sky-300 border border-slate-750 rounded-lg text-xs font-bold transition-all ml-1"
                >
                  <span>{isVocabsExpanded ? '折りたたむ' : '確認・変更'}</span>
                  {isVocabsExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Collapsible Content */}
            {isVocabsExpanded && (
              <div className="pt-2 border-t border-slate-800 space-y-3 animate-fadeIn">
                <div className="text-[11px] text-slate-400 flex items-center justify-between flex-wrap gap-2">
                  <span>💡 単語タップで 🟢習得済 ➔ 🔴要復習 ➔ ⚪未遭遇(スキップ) に切り替わります。</span>
                  <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                    <button
                      type="button"
                      onClick={() => setAllVocabsInView('mastered')}
                      className="text-[11px] text-emerald-400 hover:underline font-semibold"
                    >
                      すべて習得済に
                    </button>
                    <span className="text-slate-600">|</span>
                    <button
                      type="button"
                      onClick={() => setAllVocabsInView('lapsed')}
                      className="text-[11px] text-rose-400 hover:underline font-semibold"
                    >
                      すべて要復習に
                    </button>
                    <span className="text-slate-600">|</span>
                    <button
                      type="button"
                      onClick={() => setAllVocabsInView('unseen')}
                      className="text-[11px] text-slate-400 hover:underline font-semibold"
                    >
                      すべてスキップに
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
                        className={`px-3 py-1 rounded-xl font-bold transition-all whitespace-nowrap ${
                          isSelected
                            ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                            : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                        }`}
                      >
                        {lvl === 'ALL' ? 'すべて' : lvl} ({count})
                      </button>
                    );
                  })}
                </div>

                {/* Vocab Chips List */}
                <div className="p-3.5 bg-slate-950/90 border border-slate-800 rounded-2xl max-h-64 overflow-y-auto">
                  <div className="flex flex-wrap gap-1.5">
                    {filteredVocabs.map(v => {
                      const st = vocabStatusMap[v.id] || 'mastered';
                      
                      let chipStyle = 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200 hover:bg-emerald-900/50';
                      let icon = '✓';
                      if (st === 'lapsed') {
                        chipStyle = 'bg-rose-950/60 border-rose-500/60 text-rose-200 hover:bg-rose-900/70 shadow-sm';
                        icon = '!';
                      } else if (st === 'unseen') {
                        chipStyle = 'bg-slate-900/50 border-slate-800 text-slate-500 hover:bg-slate-850 hover:text-slate-400 line-through';
                        icon = '✕';
                      }

                      return (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => cycleVocabStatus(v.id)}
                          title={`${v.phrase} (${v.partOfSpeech}): ${v.meaning} [クリックで状態切替: 習得 -> 要復習 -> 未遭遇]`}
                          className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold transition-all border ${chipStyle}`}
                        >
                          <span className="font-bold">{icon}</span>
                          <span className="font-bold">{v.phrase}</span>
                          <span className="text-[10px] text-slate-400 max-w-[85px] truncate">
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
            )}
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
              一括同期して完了（🟢 {masteredVocabs.length}語 / 構文 {Object.values(patternStatusMap).filter(Boolean).length}個）
            </span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
