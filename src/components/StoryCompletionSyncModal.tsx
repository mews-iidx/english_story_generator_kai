import React, { useState, useMemo } from 'react';
import { Story } from '../types/story';
import { CefrLevel } from '../types/settings';
import { ExtractedStoryVocab } from '../utils/storyVocabExtractor';
import { Check, AlertCircle, Sparkles, BookOpen, ChevronRight, ChevronDown, ChevronUp, CheckCircle2 } from 'lucide-react';

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

  // 単語ごとのステータス管理: デフォルトは「未遭遇/スキップ(unseen)」、読書中に追加されたものは「要復習(lapsed)」
  const [vocabStatusMap, setVocabStatusMap] = useState<Record<string, SyncVocabStatus>>(() => {
    const initial: Record<string, SyncVocabStatus> = {};
    extractedVocabs.forEach(v => {
      const isLapsed = initialLapsedPhrases.has(v.phrase.toLowerCase()) || 
                       initialLapsedPhrases.has(v.matchedText.toLowerCase());
      initial[v.id] = isLapsed ? 'lapsed' : 'unseen';
    });
    return initial;
  });

  // AI出題ターゲット構文のステータス管理（デフォルト: 習得済み）
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

  // 単語ステータスの3段階トグル: unseen -> mastered -> lapsed -> unseen
  const cycleVocabStatus = (id: string) => {
    setVocabStatusMap(prev => {
      const cur = prev[id] || 'unseen';
      const nextStatus: SyncVocabStatus = 
        cur === 'unseen' ? 'mastered' : 
        cur === 'mastered' ? 'lapsed' : 'unseen';
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
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                読了完了！お疲れ様でした 🎉
              </h2>
              <p className="text-xs text-slate-400">
                読破スピード: <strong className="text-sky-300">{calculatedWpm} WPM</strong>
              </p>
            </div>
          </div>

          <button
            onClick={onSkipSync}
            className="text-slate-400 hover:text-white p-1.5 rounded-xl hover:bg-slate-800 transition-colors"
            title="閉じる"
          >
            ✕
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
          {/* Section 1: AI出題ターゲット構文（主役機能） */}
          {targetPatterns.length > 0 ? (
            <div className="space-y-2.5 bg-slate-950/70 border border-purple-500/30 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs sm:text-sm text-purple-300 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                  今回の出題ターゲット構文（{targetPatterns.length}件）
                </span>
                <span className="text-[11px] text-slate-400">タップで習得 / 要復習を切替</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                {targetPatterns.map(pat => {
                  const isMastered = patternStatusMap[pat.targetId] !== false;
                  return (
                    <button
                      key={pat.targetId}
                      type="button"
                      onClick={() => togglePatternStatus(pat.targetId)}
                      className={`p-3.5 rounded-2xl border text-left transition-all flex items-start justify-between gap-2.5 ${
                        isMastered
                          ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-100 hover:bg-emerald-900/40 shadow-sm'
                          : 'bg-rose-950/40 border-rose-500/40 text-rose-200 hover:bg-rose-900/40'
                      }`}
                    >
                      <div className="space-y-1 pr-1 flex-1">
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
                          <span className="flex items-center space-x-1 text-[11px] font-bold text-emerald-300 bg-emerald-950 px-2.5 py-1 rounded-xl border border-emerald-500/30 shadow-sm">
                            <Check className="w-3.5 h-3.5" />
                            <span>習得済</span>
                          </span>
                        ) : (
                          <span className="flex items-center space-x-1 text-[11px] font-bold text-rose-300 bg-rose-950 px-2.5 py-1 rounded-xl border border-rose-500/30">
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>要復習</span>
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl text-xs text-slate-300 space-y-1">
              <span className="font-bold text-white block">📖 今回の読書実績が記録されます</span>
              <span className="text-slate-400 text-[11px]">
                読書履歴・読破単語数・読書スピード（WPM）がダッシュボードへ記録されます。
              </span>
            </div>
          )}

          {/* Section 2: 本文の出現単語（パッシブ一括登録・完全オプション） */}
          <div className="space-y-2 bg-slate-950/50 border border-slate-800/60 rounded-2xl p-3.5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center space-x-2">
                <BookOpen className="w-4 h-4 text-slate-400" />
                <span className="text-xs sm:text-sm text-slate-300 font-semibold">
                  本文の出現単語を一括登録（オプション）
                </span>
                {(masteredVocabs.length > 0 || lapsedVocabs.length > 0) && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-bold border border-blue-500/30">
                    🟢 {masteredVocabs.length} / 🔴 {lapsedVocabs.length}
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => setIsVocabsExpanded(!isVocabsExpanded)}
                className="flex items-center space-x-1 px-2.5 py-1 bg-slate-900 hover:bg-slate-850 text-slate-300 hover:text-white border border-slate-750 rounded-lg text-xs font-semibold transition-all"
              >
                <span>{isVocabsExpanded ? '閉じる' : '展開して一括登録'}</span>
                {isVocabsExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            </div>

            {/* Collapsible Content */}
            {isVocabsExpanded && (
              <div className="pt-3 border-t border-slate-800/80 space-y-3 animate-fadeIn">
                <div className="text-[11px] text-slate-400 flex items-center justify-between flex-wrap gap-2">
                  <span>💡 知っている単語を一括でマスター登録したい場合にご利用ください。</span>
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
                      すべて解除(スキップ)
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
                <div className="p-3.5 bg-slate-950/90 border border-slate-800 rounded-2xl max-h-56 overflow-y-auto">
                  <div className="flex flex-wrap gap-1.5">
                    {filteredVocabs.map(v => {
                      const st = vocabStatusMap[v.id] || 'unseen';
                      
                      let chipStyle = 'bg-slate-900/50 border-slate-800 text-slate-500 hover:bg-slate-850 hover:text-slate-300';
                      let icon = '⚪';
                      if (st === 'mastered') {
                        chipStyle = 'bg-emerald-950/60 border-emerald-500/50 text-emerald-200 hover:bg-emerald-900/60 shadow-sm';
                        icon = '✓';
                      } else if (st === 'lapsed') {
                        chipStyle = 'bg-rose-950/60 border-rose-500/60 text-rose-200 hover:bg-rose-900/70 shadow-sm';
                        icon = '!';
                      }

                      return (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => cycleVocabStatus(v.id)}
                          title={`${v.phrase} (${v.partOfSpeech}): ${v.meaning}`}
                          className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold transition-all border ${chipStyle}`}
                        >
                          <span className="font-bold text-[10px]">{icon}</span>
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
        <div className="p-4 sm:p-5 bg-slate-950 border-t border-slate-800 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onSkipSync}
            className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-900 rounded-xl transition-colors"
          >
            キャンセル
          </button>

          <button
            type="button"
            onClick={handleConfirm}
            className="flex-1 sm:flex-initial flex items-center justify-center space-x-2 px-8 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 active:scale-[0.98] text-white rounded-2xl text-xs sm:text-sm font-bold shadow-xl shadow-blue-600/30 transition-all"
          >
            <Sparkles className="w-4 h-4 text-amber-300" />
            <span>
              読了を記録して完了
              {targetPatterns.length > 0 && `（構文 ${Object.values(patternStatusMap).filter(Boolean).length}個）`}
              {(masteredVocabs.length > 0 || lapsedVocabs.length > 0) && ` ＋ 単語(${masteredVocabs.length + lapsedVocabs.length}語)`}
            </span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
