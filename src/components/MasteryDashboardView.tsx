import React, { useState, useMemo } from 'react';
import {
  loadMasteryState,
  computeAllLevelProgress,
  loadDailySnapshots,
  loadMyGoal,
  saveMyGoal,
  clearMyGoal,
  recordPatternStatus,
  recordVocabMasteryStatus
} from '../services/storage';
import { getPatternsByLevel } from '../data/cefrPatternsMaster';
import { getVocabMasterByLevel } from '../data/cefrVocabMaster';
import { MasteryStatus, MyGoal } from '../types/mastery';
import { Target, Sparkles, CheckCircle2, AlertCircle, ChevronDown, ChevronUp, TrendingUp, BookOpen, Award, Layers, Volume2 } from 'lucide-react';
import { speakText } from '../utils/speech';
import { addDaysToDate } from '../utils/srs';

interface MasteryDashboardViewProps {
  onNavigateToCreate?: () => void;
}

type CefrTab = 'A1' | 'A2' | 'B1' | 'B2';
type ItemTypeTab = 'patterns' | 'vocabs';
type StatusFilter = 'all' | 'mastered' | 'lapsed' | 'unseen';

export const MasteryDashboardView: React.FC<MasteryDashboardViewProps> = ({
  onNavigateToCreate,
}) => {
  const [selectedLevel, setSelectedLevel] = useState<CefrTab>('B1');
  const [selectedItemType, setSelectedItemType] = useState<ItemTypeTab>('patterns');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [expandedPatternId, setExpandedPatternId] = useState<string | null>(null);

  // 目標設定状態
  const [myGoal, setMyGoal] = useState<MyGoal | null>(() => loadMyGoal());
  const [isEditingGoal, setIsEditingGoal] = useState(false);
  const [goalTargetLevel, setGoalTargetLevel] = useState<'A1' | 'A2' | 'B1' | 'B2'>(myGoal?.targetCefr as any || 'B1');
  const [goalTargetDays, setGoalTargetDays] = useState<number>(myGoal?.targetDays || 60);

  // マスターステートと進捗の読み込み
  const [masteryState, setMasteryState] = useState(() => loadMasteryState());
  const allProgress = useMemo(() => computeAllLevelProgress(), [masteryState]);
  const dailySnapshots = useMemo(() => loadDailySnapshots(), [masteryState]);

  // レベル別情報
  const levelNames: Record<CefrTab, { name: string; desc: string }> = {
    A1: { name: '超初級 (A1)', desc: '中学1〜2年・最重要基礎構文と語彙' },
    A2: { name: '初級 (A2)', desc: '中学3年〜日常会話基礎・表現の骨格' },
    B1: { name: '中級 (B1)', desc: '高校〜実用英会話・複文・関係詞・仮定法' },
    B2: { name: '中上級 (B2)', desc: '高度な構文・句動詞・自然なイディオム' },
  };

  // 選択中レベルの構文リストと単語リスト
  const currentPatterns = useMemo(() => getPatternsByLevel(selectedLevel), [selectedLevel]);
  const currentVocabs = useMemo(() => getVocabMasterByLevel(selectedLevel), [selectedLevel]);

  // フィルタリング
  const filteredPatterns = useMemo(() => {
    return currentPatterns.filter(p => {
      const st = masteryState.patterns[p.id]?.status || 'unseen';
      if (statusFilter === 'all') return true;
      if (statusFilter === 'mastered') return st === 'mastered';
      if (statusFilter === 'lapsed') return st === 'lapsed';
      if (statusFilter === 'unseen') return st === 'unseen' || st === 'exposed';
      return true;
    });
  }, [currentPatterns, masteryState, statusFilter]);

  const filteredVocabs = useMemo(() => {
    return currentVocabs.filter(v => {
      const st = masteryState.vocabs[v.id]?.status || masteryState.vocabs[v.phrase.toLowerCase()]?.status || 'unseen';
      if (statusFilter === 'all') return true;
      if (statusFilter === 'mastered') return st === 'mastered';
      if (statusFilter === 'lapsed') return st === 'lapsed';
      if (statusFilter === 'unseen') return st === 'unseen' || st === 'exposed';
      return true;
    });
  }, [currentVocabs, masteryState, statusFilter]);

  // ステータス手動トグル
  const handleTogglePatternStatus = (patternId: string, newStatus: MasteryStatus) => {
    recordPatternStatus(patternId, newStatus);
    setMasteryState(loadMasteryState());
  };

  const handleToggleVocabStatus = (vocabId: string, newStatus: MasteryStatus) => {
    recordVocabMasteryStatus(vocabId, newStatus);
    setMasteryState(loadMasteryState());
  };

  // 目標保存
  const handleSaveGoal = () => {
    const goal: MyGoal = {
      targetCefr: goalTargetLevel,
      targetDays: goalTargetDays,
      startDate: new Date().toISOString().substring(0, 10),
      targetDate: addDaysToDate(goalTargetDays),
      isActive: true,
    };
    saveMyGoal(goal);
    setMyGoal(goal);
    setIsEditingGoal(false);
  };

  const handleClearGoal = () => {
    clearMyGoal();
    setMyGoal(null);
    setIsEditingGoal(false);
  };

  // 目標達成予測 (ETA) 計算
  const etaCalculation = useMemo(() => {
    const targetLvl = (myGoal?.targetCefr || 'B1') as CefrTab;
    const p = allProgress[targetLvl];
    if (!p) return null;

    const remainingPatterns = p.patternTotal - p.patternMastered;
    const remainingVocabs = p.vocabTotal - p.vocabMastered;
    const totalRemaining = remainingPatterns + remainingVocabs;

    const itemsPerDay = Math.max(1, Math.round(totalRemaining / Math.max(1, myGoal?.targetDays || 60)));
    const estimatedDays = Math.ceil(totalRemaining / itemsPerDay);
    const estimatedDate = addDaysToDate(estimatedDays);

    return {
      targetLevel: targetLvl,
      remainingPatterns,
      remainingVocabs,
      totalRemaining,
      estimatedDays,
      estimatedDate,
      progressPercent: Math.round(p.overallPct),
    };
  }, [allProgress, myGoal]);

  // 直近7日間のスナップショット
  const recentSnapshots = useMemo(() => {
    return [...dailySnapshots].slice(-7);
  }, [dailySnapshots]);

  return (
    <div className="max-w-4xl mx-auto px-3 sm:px-4 py-6 space-y-6">
      {/* 1. Cockpit Header */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-7 shadow-2xl space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-cyan-500 via-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/25 border border-cyan-400/30">
              <Target className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
                CEFR A1–B2 習得度コックピット 🎯
              </h1>
              <p className="text-xs sm:text-sm text-slate-400">
                読書とAnkiを通じて、全260構文・重要語彙の定着度をリアルタイム解析
              </p>
            </div>
          </div>

          {onNavigateToCreate && (
            <button
              onClick={onNavigateToCreate}
              className="flex items-center space-x-1.5 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-600/30 transition-all"
            >
              <Sparkles className="w-4 h-4" />
              <span>弱点構文で物語を生成</span>
            </button>
          )}
        </div>

        {/* 2. My Goal Navigation Card */}
        <div className="p-4 bg-slate-950/80 border border-blue-500/30 rounded-2xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Award className="w-4 h-4 text-amber-400" />
              <span className="text-xs sm:text-sm font-bold text-white">
                マイゴール（目標逆算ナビ）
              </span>
            </div>
            <button
              onClick={() => setIsEditingGoal(!isEditingGoal)}
              className="text-[11px] font-semibold text-sky-400 hover:text-sky-300"
            >
              {isEditingGoal ? '閉じる' : myGoal ? '目標を変更' : '+ 目標を設定'}
            </button>
          </div>

          {isEditingGoal ? (
            <div className="space-y-3 pt-2 border-t border-slate-800 animate-fadeIn">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(['A1', 'A2', 'B1', 'B2'] as const).map(lvl => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setGoalTargetLevel(lvl)}
                    className={`p-2.5 rounded-xl border text-center transition-all ${
                      goalTargetLevel === lvl
                        ? 'bg-blue-600 text-white border-blue-400 shadow-md font-bold'
                        : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    <div className="text-sm font-bold">{lvl} 達成</div>
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                <span className="text-slate-400">目標達成期間:</span>
                <div className="flex items-center space-x-1.5">
                  {[30, 60, 90, 180].map(days => (
                    <button
                      key={days}
                      type="button"
                      onClick={() => setGoalTargetDays(days)}
                      className={`px-2.5 py-1 rounded-lg font-bold ${
                        goalTargetDays === days
                          ? 'bg-blue-600/30 text-sky-300 border border-blue-500/40'
                          : 'bg-slate-900 text-slate-400 border border-slate-800'
                      }`}
                    >
                      {days}日
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-1">
                {myGoal && (
                  <button
                    onClick={handleClearGoal}
                    className="px-3 py-1.5 text-xs text-rose-400 hover:bg-rose-950/40 rounded-xl"
                  >
                    目標を解除
                  </button>
                )}
                <button
                  onClick={handleSaveGoal}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-600/25"
                >
                  目標を決定
                </button>
              </div>
            </div>
          ) : (
            etaCalculation && (
              <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                <div className="space-y-0.5">
                  <div className="text-slate-300">
                    目標: <strong className="text-white text-sm">CEFR {etaCalculation.targetLevel} 完全習得</strong>
                    （現在進捗: <strong className="text-sky-400">{etaCalculation.progressPercent}%</strong>）
                  </div>
                  <div className="text-slate-400 text-[11px]">
                    未マスター: 構文 {etaCalculation.remainingPatterns}個 / 単語 {etaCalculation.remainingVocabs}語
                  </div>
                </div>

                <div className="px-3 py-1.5 bg-blue-950/70 border border-blue-500/30 rounded-xl text-right">
                  <span className="text-[10px] text-sky-400 block font-semibold">達成予測</span>
                  <strong className="text-sm font-extrabold text-white">
                    あと約 {etaCalculation.estimatedDays} 日 ({etaCalculation.estimatedDate})
                  </strong>
                </div>
              </div>
            )
          )}
        </div>
      </div>

      {/* 3. Level Overview Progress Cards (A1, A2, B1, B2) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {(['A1', 'A2', 'B1', 'B2'] as const).map(lvl => {
          const prog = allProgress[lvl];
          const isSelected = selectedLevel === lvl;
          return (
            <button
              key={lvl}
              onClick={() => setSelectedLevel(lvl)}
              className={`p-4 rounded-3xl border text-left transition-all space-y-3 ${
                isSelected
                  ? 'bg-slate-900 border-blue-500 shadow-xl shadow-blue-500/10 ring-2 ring-blue-500/40'
                  : 'bg-slate-900/70 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-base font-extrabold text-white">{lvl}</span>
                  <span className="text-[10px] text-slate-400 block">{levelNames[lvl].name.split(' ')[0]}</span>
                </div>
                <span className="text-lg font-black text-sky-400">
                  {Math.round(prog.overallPct)}%
                </span>
              </div>

              {/* Progress Bars */}
              <div className="space-y-1.5">
                {/* Patterns */}
                <div className="space-y-0.5">
                  <div className="flex justify-between text-[10px] text-slate-400 font-semibold">
                    <span>💡 構文 ({prog.patternMastered}/{prog.patternTotal})</span>
                    <span>{Math.round(prog.patternPct)}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-500"
                      style={{ width: `${prog.patternPct}%` }}
                    />
                  </div>
                </div>

                {/* Vocabs */}
                <div className="space-y-0.5">
                  <div className="flex justify-between text-[10px] text-slate-400 font-semibold">
                    <span>🔤 語彙 ({prog.vocabMastered}/{prog.vocabTotal})</span>
                    <span>{Math.round(prog.vocabPct)}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-500"
                      style={{ width: `${prog.vocabPct}%` }}
                    />
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* 4. Growth Diff Analytics HUD (日次推移) */}
      {recentSnapshots.length > 0 && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs sm:text-sm font-bold text-white">
                直近の成長推移（日次アクティビティHUD）
              </h3>
            </div>
            <span className="text-[11px] text-slate-400">直近 {recentSnapshots.length} 日間</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {recentSnapshots.map(snap => (
              <div key={snap.date} className="p-3 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-1">
                <span className="text-[10px] font-bold text-slate-400">{snap.date.substring(5)}</span>
                <div className="text-sm font-extrabold text-white">
                  {snap.wordsRead} <span className="text-[10px] font-normal text-slate-400">語読了</span>
                </div>
                <div className="text-xs font-semibold text-emerald-400">
                  +{snap.newMasteredPatternsCount + snap.newMasteredVocabsCount} 項目定着
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. Interactive Drill-Down Skill Tree */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-7 shadow-2xl space-y-5">
        {/* Controls: Type Tabs & Status Filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setSelectedItemType('patterns')}
              className={`flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                selectedItemType === 'patterns'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>構文パターン ({currentPatterns.length})</span>
            </button>

            <button
              onClick={() => setSelectedItemType('vocabs')}
              className={`flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                selectedItemType === 'vocabs'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>重要語彙 ({currentVocabs.length})</span>
            </button>
          </div>

          {/* Status Filter Pills */}
          <div className="flex items-center space-x-1.5 flex-wrap gap-y-1 text-xs">
            {(['all', 'mastered', 'lapsed', 'unseen'] as const).map(st => {
              const labels: Record<StatusFilter, string> = {
                all: 'すべて',
                mastered: '🟢 習得済み',
                lapsed: '🔴 要復習',
                unseen: '⚪ 未遭遇',
              };
              return (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all ${
                    statusFilter === st
                      ? 'bg-blue-600/30 text-sky-300 border border-blue-500/50'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  {labels[st]}
                </button>
              );
            })}
          </div>
        </div>

        {/* List of Items */}
        {selectedItemType === 'patterns' ? (
          <div className="space-y-3">
            {filteredPatterns.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500">
                該当する構文パターンはありません。
              </div>
            ) : (
              filteredPatterns.map(p => {
                const pState = masteryState.patterns[p.id];
                const status = pState?.status || 'unseen';
                const isExpanded = expandedPatternId === p.id;

                return (
                  <div
                    key={p.id}
                    className="p-4 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-3 transition-all hover:border-slate-700"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                            {p.categoryLabel}
                          </span>
                          <span className="text-base font-bold text-white tracking-tight">
                            {p.name}
                          </span>
                        </div>
                        <div className="text-xs text-slate-300 font-medium">
                          {p.meaning}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          💡 要点: {p.focus}
                        </div>
                      </div>

                      {/* Status Toggle Buttons */}
                      <div className="flex items-center space-x-1.5 flex-shrink-0">
                        <button
                          onClick={() => handleTogglePatternStatus(p.id, 'lapsed')}
                          className={`p-1.5 rounded-lg text-xs transition-colors ${
                            status === 'lapsed'
                              ? 'bg-rose-600 text-white shadow-md'
                              : 'bg-slate-900 text-slate-400 hover:text-rose-300 hover:bg-slate-855'
                          }`}
                          title="要復習に設定"
                        >
                          <AlertCircle className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleTogglePatternStatus(p.id, 'mastered')}
                          className={`p-1.5 rounded-lg text-xs transition-colors ${
                            status === 'mastered'
                              ? 'bg-emerald-600 text-white shadow-md'
                              : 'bg-slate-900 text-slate-400 hover:text-emerald-300 hover:bg-slate-855'
                          }`}
                          title="習得済みに設定"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Expand 3 Contextual Variations */}
                    <div className="pt-2 border-t border-slate-850">
                      <button
                        onClick={() => setExpandedPatternId(isExpanded ? null : p.id)}
                        className="flex items-center space-x-1 text-[11px] font-semibold text-sky-400 hover:text-sky-300"
                      >
                        <span>3つの文脈用例 ({p.variations.length})</span>
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>

                      {isExpanded && (
                        <div className="mt-2 space-y-2 animate-fadeIn">
                          {p.variations.map((v, idx) => (
                            <div key={idx} className="p-2.5 bg-slate-900/90 border border-slate-800 rounded-xl space-y-1 text-xs">
                              <div className="flex items-center justify-between">
                                <span className="font-serif text-white font-medium">
                                  {idx + 1}. {v.sentence}
                                </span>
                                <button
                                  onClick={() => speakText(v.sentence)}
                                  className="p-1 text-sky-400 hover:text-sky-300"
                                  title="音声を再生"
                                >
                                  <Volume2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                              <p className="text-[11px] text-slate-400">{v.translation}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          /* Vocab List */
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filteredVocabs.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500 col-span-2">
                該当する語彙はありません。
              </div>
            ) : (
              filteredVocabs.map(v => {
                const vState = masteryState.vocabs[v.id] || masteryState.vocabs[v.phrase.toLowerCase()];
                const status = vState?.status || 'unseen';

                return (
                  <div
                    key={v.id}
                    className="p-3.5 bg-slate-950/70 border border-slate-800 rounded-2xl flex items-center justify-between gap-3 transition-all hover:border-slate-700"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-bold text-sky-400 truncate">{v.phrase}</span>
                        <button
                          onClick={() => speakText(v.phrase)}
                          className="text-slate-400 hover:text-sky-300"
                        >
                          <Volume2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="text-xs text-slate-300 truncate">{v.meaning}</div>
                    </div>

                    <div className="flex items-center space-x-1 flex-shrink-0">
                      <button
                        onClick={() => handleToggleVocabStatus(v.id, 'lapsed')}
                        className={`p-1.5 rounded-lg text-xs transition-colors ${
                          status === 'lapsed'
                            ? 'bg-rose-600 text-white'
                            : 'bg-slate-900 text-slate-400 hover:text-rose-300'
                        }`}
                        title="要復習に設定"
                      >
                        <AlertCircle className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleToggleVocabStatus(v.id, 'mastered')}
                        className={`p-1.5 rounded-lg text-xs transition-colors ${
                          status === 'mastered'
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-900 text-slate-400 hover:text-emerald-300'
                        }`}
                        title="習得済みに設定"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
};
