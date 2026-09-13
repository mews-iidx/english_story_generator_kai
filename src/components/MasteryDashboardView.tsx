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
import { getPatternsByLevel, CEFR_PATTERNS_MASTER } from '../data/cefrPatternsMaster';
import { getVocabMasterByLevel, getVocabByPhrase, CEFR_VOCAB_MASTER } from '../data/cefrVocabMaster';
import { MasteryStatus, MyGoal } from '../types/mastery';
import { VocabItem } from '../types/vocab';
import { DifficultSentenceItem } from '../types/sentence';
import { ExpressionErrorItem } from '../types/expressionError';
import {
  Target, Sparkles, CheckCircle2, AlertCircle, ChevronDown, ChevronUp,
  TrendingUp, BookOpen, Award, Layers, Volume2, Search, Trash2, BookmarkCheck,
  FileText
} from 'lucide-react';
import { speakText } from '../utils/speech';
import { addDaysToDate, getTodayDateString } from '../utils/srs';

interface MasteryDashboardViewProps {
  onNavigateToCreate?: () => void;
  savedVocabs?: VocabItem[];
  difficultSentences?: DifficultSentenceItem[];
  expressionErrors?: ExpressionErrorItem[];
  onMasterVocab?: (vocabId: string) => void;
  onDeleteVocab?: (vocabId: string) => void;
  onDeleteSentence?: (sentenceId: string) => void;
  onDeleteExpressionError?: (errorId: string) => void;
}

type MainViewMode = 'curriculum' | 'saved';
type CefrTab = 'A1' | 'A2' | 'B1' | 'B2';
type ItemTypeTab = 'patterns' | 'vocabs';
type StatusFilter = 'all' | 'mastered' | 'lapsed' | 'unseen';
type SavedStockTab = 'words' | 'sentences' | 'errors';

export const MasteryDashboardView: React.FC<MasteryDashboardViewProps> = ({
  onNavigateToCreate,
  savedVocabs = [],
  difficultSentences = [],
  expressionErrors = [],
  onMasterVocab,
  onDeleteVocab,
  onDeleteSentence,
  onDeleteExpressionError,
}) => {
  // メイン画面モード: カリキュラム全体 vs マイトロフィー単語帳
  const [mainMode, setMainMode] = useState<MainViewMode>('curriculum');

  // カリキュラム用ステート
  const [selectedLevel, setSelectedLevel] = useState<CefrTab>('B1');
  const [selectedItemType, setSelectedItemType] = useState<ItemTypeTab>('patterns');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [displayLimit, setDisplayLimit] = useState(60);
  const [expandedPatternId, setExpandedPatternId] = useState<string | null>(null);

  // マイトロフィー用ステート
  const [savedTab, setSavedTab] = useState<SavedStockTab>('words');
  const [savedSearchQuery, setSavedSearchQuery] = useState('');
  const [savedStatusFilter, setSavedStatusFilter] = useState<'all' | 'due' | 'learning' | 'mastered'>('all');
  const [savedExpandedId, setSavedExpandedId] = useState<string | null>(null);

  const today = getTodayDateString();

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

  // 選択中レベルの構文リストと単語リスト（検索ワードがある場合は全レベルを対象に検索）
  const currentPatterns = useMemo(() => {
    if (searchQuery.trim()) {
      return CEFR_PATTERNS_MASTER;
    }
    return getPatternsByLevel(selectedLevel);
  }, [selectedLevel, searchQuery]);

  const currentVocabs = useMemo(() => {
    if (searchQuery.trim()) {
      return CEFR_VOCAB_MASTER;
    }
    return getVocabMasterByLevel(selectedLevel);
  }, [selectedLevel, searchQuery]);

  // フィルタリング＆完全一致優先ソート (構文)
  const filteredPatterns = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const items = currentPatterns.filter(p => {
      const st = masteryState.patterns[p.id]?.status || 'unseen';
      if (statusFilter === 'mastered' && st !== 'mastered') return false;
      if (statusFilter === 'lapsed' && st !== 'lapsed') return false;
      if (statusFilter === 'unseen' && (st !== 'unseen' && st !== 'exposed')) return false;

      if (q) {
        const matchesName = p.name.toLowerCase().includes(q);
        const matchesMeaning = p.meaning.toLowerCase().includes(q);
        const matchesFocus = p.focus.toLowerCase().includes(q);
        const matchesCat = p.categoryLabel.toLowerCase().includes(q);
        return matchesName || matchesMeaning || matchesFocus || matchesCat;
      }
      return true;
    });

    if (q) {
      return [...items].sort((a, b) => {
        const score = (p: typeof a) => {
          const name = p.name.toLowerCase();
          if (name === q) return 1000;
          if (name.startsWith(q)) return 500;
          if (name.includes(q)) return 200;
          if (p.meaning.toLowerCase().includes(q)) return 100;
          return 10;
        };
        return score(b) - score(a);
      });
    }

    return items;
  }, [currentPatterns, masteryState, statusFilter, searchQuery]);

  // フィルタリング＆完全一致優先ソート (単語)
  const filteredVocabs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const items = currentVocabs.filter(v => {
      const st = masteryState.vocabs[v.id]?.status || masteryState.vocabs[v.phrase.toLowerCase()]?.status || 'unseen';
      if (statusFilter === 'mastered' && st !== 'mastered') return false;
      if (statusFilter === 'lapsed' && st !== 'lapsed') return false;
      if (statusFilter === 'unseen' && (st !== 'unseen' && st !== 'exposed')) return false;

      if (q) {
        const matchesPhrase = v.phrase.toLowerCase().includes(q);
        const matchesMeaning = v.meaning.toLowerCase().includes(q);
        return matchesPhrase || matchesMeaning;
      }
      return true;
    });

    if (q) {
      return [...items].sort((a, b) => {
        const score = (v: typeof a) => {
          const phrase = v.phrase.toLowerCase();
          if (phrase === q) return 1000;
          if (phrase.startsWith(q + ' ') || phrase.startsWith(q)) return 500;
          if (phrase.includes(q)) return 200;
          if (v.meaning.toLowerCase().includes(q)) return 100;
          return 10;
        };
        const diff = score(b) - score(a);
        if (diff !== 0) return diff;
        return a.phrase.localeCompare(b.phrase);
      });
    }

    return items;
  }, [currentVocabs, masteryState, statusFilter, searchQuery]);

  // マイトロフィー単語フィルタリング＆完全一致優先ソート
  const filteredSavedVocabs = useMemo(() => {
    const q = savedSearchQuery.trim().toLowerCase();
    const items = savedVocabs.filter(v => {
      const matchesSearch =
        !q ||
        v.phrase.toLowerCase().includes(q) ||
        v.meaning.toLowerCase().includes(q) ||
        (v.contextNote && v.contextNote.toLowerCase().includes(q));

      if (!matchesSearch) return false;

      if (savedStatusFilter === 'due') {
        return v.nextReviewDate <= today || v.cardState === 'learning' || v.cardState === 'relearning';
      }
      if (savedStatusFilter === 'mastered') {
        return (v.repetitionCount || 0) >= 4;
      }
      if (savedStatusFilter === 'learning') {
        return (v.repetitionCount || 0) < 4;
      }
      return true;
    });

    if (q) {
      return [...items].sort((a, b) => {
        const score = (v: typeof a) => {
          const phrase = v.phrase.toLowerCase();
          if (phrase === q) return 1000;
          if (phrase.startsWith(q + ' ') || phrase.startsWith(q)) return 500;
          if (phrase.includes(q)) return 200;
          if (v.meaning.toLowerCase().includes(q)) return 100;
          return 10;
        };
        const diff = score(b) - score(a);
        if (diff !== 0) return diff;
        return a.phrase.localeCompare(b.phrase);
      });
    }

    return items;
  }, [savedVocabs, savedSearchQuery, savedStatusFilter, today]);

  // マイトロフィー文フィルタリング
  const filteredDifficultSentences = useMemo(() => {
    const q = savedSearchQuery.trim().toLowerCase();
    return difficultSentences.filter(s => {
      return (
        !q ||
        s.sentence.toLowerCase().includes(q) ||
        s.translation.toLowerCase().includes(q) ||
        (s.highlightedPhrase && s.highlightedPhrase.toLowerCase().includes(q))
      );
    });
  }, [difficultSentences, savedSearchQuery]);

  // ステータス手動トグル (すでに同じステータスの場合は未遭遇'unseen'に戻す)
  const handleTogglePatternStatus = (patternId: string, clickedStatus: MasteryStatus) => {
    const currentStatus = masteryState.patterns[patternId]?.status || 'unseen';
    const newStatus: MasteryStatus = currentStatus === clickedStatus ? 'unseen' : clickedStatus;
    recordPatternStatus(patternId, newStatus);
    setMasteryState(loadMasteryState());
  };

  const handleToggleVocabStatus = (phraseOrId: string, clickedStatus: MasteryStatus) => {
    const key = phraseOrId.trim().toLowerCase();
    const currentStatus = masteryState.vocabs[key]?.status || 'unseen';
    const newStatus: MasteryStatus = currentStatus === clickedStatus ? 'unseen' : clickedStatus;
    recordVocabMasteryStatus(key, newStatus);
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

  const recentSnapshots = useMemo(() => {
    return [...dailySnapshots].slice(-7);
  }, [dailySnapshots]);

  const savedDueCount = savedVocabs.filter(v => v.nextReviewDate <= today || v.cardState === 'learning' || v.cardState === 'relearning').length;

  return (
    <div className="max-w-4xl mx-auto px-3 sm:px-4 py-6 space-y-6">
      {/* 1. Cockpit Header & Main Mode Switcher */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-7 shadow-2xl space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-cyan-500 via-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/25 border border-cyan-400/30">
              <Target className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center space-x-2">
                <span>CEFR 習熟度＆単語帳</span>
                <Sparkles className="w-4 h-4 text-amber-400" />
              </h2>
              <p className="text-xs text-slate-400">
                Cambridge 996構文 ＆ Oxford 4,538語の公式シラバス ＋ マイトロフィー
              </p>
            </div>
          </div>

          {/* Main Subtab Switcher */}
          <div className="flex items-center p-1 bg-slate-950 rounded-2xl border border-slate-800 space-x-1">
            <button
              onClick={() => setMainMode('curriculum')}
              className={`flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                mainMode === 'curriculum'
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>🌟 全カリキュラム</span>
            </button>

            <button
              onClick={() => setMainMode('saved')}
              className={`flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all relative ${
                mainMode === 'saved'
                  ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md shadow-emerald-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>📚 マイ単語帳 ({savedVocabs.length})</span>
              {savedDueCount > 0 && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full text-[9px] font-black bg-amber-500 text-slate-950">
                  {savedDueCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Goal / ETA Section (Visible in Curriculum mode) */}
        {mainMode === 'curriculum' && (
          <div className="pt-2 border-t border-slate-800">
            {!myGoal ? (
              <div className="flex items-center justify-between p-3.5 bg-blue-950/40 border border-blue-500/20 rounded-2xl">
                <div className="flex items-center space-x-2 text-xs text-sky-200">
                  <Award className="w-4 h-4 text-sky-400 flex-shrink-0" />
                  <span>目標レベル（例: 60日でB1制覇）を設定して達成予測を可視化しましょう</span>
                </div>
                <button
                  onClick={() => setIsEditingGoal(true)}
                  className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-colors shadow-md shadow-blue-600/20"
                >
                  目標を設定
                </button>
              </div>
            ) : isEditingGoal ? (
              <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200">目標設定の編集</span>
                  <button onClick={() => setIsEditingGoal(false)} className="text-slate-400 hover:text-slate-200 text-xs">
                    閉じる
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-slate-400 font-bold mb-1">目標レベル</label>
                    <select
                      value={goalTargetLevel}
                      onChange={(e) => setGoalTargetLevel(e.target.value as any)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="A1">A1 (超初級)</option>
                      <option value="A2">A2 (初級)</option>
                      <option value="B1">B1 (中級・日常会話自立)</option>
                      <option value="B2">B2 (中上級・高度表現)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 font-bold mb-1">目標日数</label>
                    <input
                      type="number"
                      min={7}
                      max={365}
                      value={goalTargetDays}
                      onChange={(e) => setGoalTargetDays(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
                <div className="flex space-x-2 pt-1">
                  <button
                    onClick={handleSaveGoal}
                    className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs transition-colors"
                  >
                    保存する
                  </button>
                  <button
                    onClick={handleClearGoal}
                    className="px-3 py-1.5 bg-rose-950/60 border border-rose-500/30 text-rose-300 font-bold rounded-xl text-xs hover:bg-rose-900/60 transition-colors"
                  >
                    目標解除
                  </button>
                </div>
              </div>
            ) : (
              etaCalculation && (
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 bg-gradient-to-r from-blue-950/50 via-slate-900/80 to-indigo-950/50 border border-blue-500/30 rounded-2xl">
                  <div className="space-y-0.5">
                    <div className="flex items-center space-x-2">
                      <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/20 text-sky-300 border border-blue-500/40 font-bold">
                        AI ペース予測
                      </span>
                      <span className="text-xs text-slate-300">
                        目標: <strong className="text-white">CEFR {etaCalculation.targetLevel} 完全習得</strong>
                        （現在: <strong className="text-sky-400">{etaCalculation.progressPercent}%</strong>）
                      </span>
                    </div>
                    <div className="text-slate-400 text-[11px]">
                      未マスター: 構文 {etaCalculation.remainingPatterns}個 / 単語 {etaCalculation.remainingVocabs}語
                    </div>
                  </div>

                  <div className="flex items-center space-x-3 self-end sm:self-auto">
                    <div className="px-3 py-1.5 bg-blue-950/70 border border-blue-500/30 rounded-xl text-right">
                      <span className="text-[10px] text-sky-400 block font-semibold">達成予測</span>
                      <strong className="text-xs sm:text-sm font-extrabold text-white">
                        あと約 {etaCalculation.estimatedDays} 日 ({etaCalculation.estimatedDate})
                      </strong>
                    </div>
                    {onNavigateToCreate && (
                      <button
                        onClick={onNavigateToCreate}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs transition-colors shadow-md shadow-blue-600/20"
                      >
                        物語で特訓
                      </button>
                    )}
                    <button
                      onClick={() => setIsEditingGoal(true)}
                      className="text-[10px] text-slate-400 hover:text-slate-200 underline"
                    >
                      変更
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* 2. MAIN MODE CONTENT */}
      {mainMode === 'curriculum' ? (
        <>
          {/* Level Overview Progress Cards (A1, A2, B1, B2) */}
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

          {/* Growth Diff Analytics HUD (日次推移) */}
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

          {/* Interactive Drill-Down Skill Tree */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-7 shadow-2xl space-y-5">
            {/* Controls: Type Tabs & Status Filters & Search */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => {
                    setSelectedItemType('patterns');
                    setDisplayLimit(60);
                  }}
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
                  onClick={() => {
                    setSelectedItemType('vocabs');
                    setDisplayLimit(60);
                  }}
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

              {/* Search Bar & Status Filter Pills */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
                <div className="relative flex-1 sm:w-48">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder={selectedItemType === 'patterns' ? "構文・日本語検索..." : "単語・意味検索..."}
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setDisplayLimit(60);
                    }}
                    className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>

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
                        onClick={() => {
                          setStatusFilter(st);
                          setDisplayLimit(60);
                        }}
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
            </div>

            {/* Hint for unchecking */}
            <div className="text-[11px] text-slate-400 bg-slate-950/60 px-3 py-1.5 rounded-xl border border-slate-850 flex items-center justify-between">
              <span>💡 チェックボタンをもう一度押すと、選択を解除して「未遭遇（⚪）」に戻せます。</span>
              <span>該当件数: {selectedItemType === 'patterns' ? filteredPatterns.length : filteredVocabs.length} 件</span>
            </div>

            {/* List of Items */}
            {selectedItemType === 'patterns' ? (
              <div className="space-y-3">
                {filteredPatterns.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500">
                    該当する構文パターンはありません。
                  </div>
                ) : (
                  <>
                    {filteredPatterns.slice(0, displayLimit).map(p => {
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

                            {/* Status Toggle Buttons (Clicking active toggles to unseen) */}
                            <div className="flex items-center space-x-1.5 flex-shrink-0">
                              <button
                                onClick={() => handleTogglePatternStatus(p.id, 'lapsed')}
                                className={`p-1.5 rounded-lg text-xs transition-colors flex items-center space-x-1 ${
                                  status === 'lapsed'
                                    ? 'bg-rose-600 text-white shadow-md ring-2 ring-rose-400/50'
                                    : 'bg-slate-900 text-slate-400 hover:text-rose-300 hover:bg-slate-850'
                                }`}
                                title={status === 'lapsed' ? 'クリックで未遭遇に解除' : '要復習に設定'}
                              >
                                <AlertCircle className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleTogglePatternStatus(p.id, 'mastered')}
                                className={`p-1.5 rounded-lg text-xs transition-colors flex items-center space-x-1 ${
                                  status === 'mastered'
                                    ? 'bg-emerald-600 text-white shadow-md ring-2 ring-emerald-400/50'
                                    : 'bg-slate-900 text-slate-400 hover:text-emerald-300 hover:bg-slate-850'
                                }`}
                                title={status === 'mastered' ? 'クリックで未遭遇に解除' : '習得済みに設定'}
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
                    })}

                    {filteredPatterns.length > displayLimit && (
                      <div className="pt-3 text-center">
                        <button
                          onClick={() => setDisplayLimit(prev => prev + 60)}
                          className="px-5 py-2 bg-slate-950 border border-slate-800 hover:border-slate-700 text-xs font-bold text-sky-400 rounded-xl transition-all shadow"
                        >
                          さらに表示 (+60件 / 残り {filteredPatterns.length - displayLimit}件)
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              /* Vocab List */
              <div className="space-y-3">
                {filteredVocabs.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500">
                    該当する語彙はありません。
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {filteredVocabs.slice(0, displayLimit).map(v => {
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
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-900 border border-slate-800 text-slate-400 font-normal">
                                  {v.partOfSpeech}
                                </span>
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
                                onClick={() => handleToggleVocabStatus(v.phrase, 'lapsed')}
                                className={`p-1.5 rounded-lg text-xs transition-colors ${
                                  status === 'lapsed'
                                    ? 'bg-rose-600 text-white ring-2 ring-rose-400/50 shadow-md'
                                    : 'bg-slate-900 text-slate-400 hover:text-rose-300'
                                }`}
                                title={status === 'lapsed' ? 'クリックで未遭遇に解除' : '要復習に設定'}
                              >
                                <AlertCircle className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleToggleVocabStatus(v.phrase, 'mastered')}
                                className={`p-1.5 rounded-lg text-xs transition-colors ${
                                  status === 'mastered'
                                    ? 'bg-emerald-600 text-white ring-2 ring-emerald-400/50 shadow-md'
                                    : 'bg-slate-900 text-slate-400 hover:text-emerald-300'
                                }`}
                                title={status === 'mastered' ? 'クリックで未遭遇に解除' : '習得済みに設定'}
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {filteredVocabs.length > displayLimit && (
                      <div className="pt-3 text-center">
                        <button
                          onClick={() => setDisplayLimit(prev => prev + 60)}
                          className="px-5 py-2 bg-slate-950 border border-slate-800 hover:border-slate-700 text-xs font-bold text-sky-400 rounded-xl transition-all shadow"
                        >
                          さらに表示 (+60件 / 残り {filteredVocabs.length - displayLimit}件)
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </>
      ) : (
        /* 3. MY SAVED STOCK / TROPHY VOCAB BANK VIEW */
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-7 shadow-2xl space-y-5">
          {/* Subtab Switcher (Words / Sentences / Errors) */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setSavedTab('words')}
                className={`flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  savedTab === 'words'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                    : 'bg-slate-950 text-slate-400 hover:text-slate-200'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>保存語彙 ({savedVocabs.length})</span>
              </button>

              <button
                onClick={() => setSavedTab('sentences')}
                className={`flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  savedTab === 'sentences'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                    : 'bg-slate-950 text-slate-400 hover:text-slate-200'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>訳せなかった文 ({difficultSentences.length})</span>
              </button>

              <button
                onClick={() => setSavedTab('errors')}
                className={`flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  savedTab === 'errors'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                    : 'bg-slate-950 text-slate-400 hover:text-slate-200'
                }`}
              >
                <AlertCircle className="w-3.5 h-3.5" />
                <span>表現エラー集 ({expressionErrors.length})</span>
              </button>
            </div>

            {/* Search & Filter */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-48">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="ストック検索..."
                  value={savedSearchQuery}
                  onChange={(e) => setSavedSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {savedTab === 'words' && (
                <div className="flex items-center space-x-1 text-xs">
                  {(['all', 'due', 'learning', 'mastered'] as const).map(st => {
                    const labels = {
                      all: 'すべて',
                      due: '⏰ 復習期日',
                      learning: '📖 習得中',
                      mastered: '🟢 習得済',
                    };
                    return (
                      <button
                        key={st}
                        onClick={() => setSavedStatusFilter(st)}
                        className={`px-2.5 py-1 rounded-lg font-bold transition-all ${
                          savedStatusFilter === st
                            ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/50'
                            : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                        }`}
                      >
                        {labels[st]}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Saved Words List */}
          {savedTab === 'words' && (
            <div className="space-y-3">
              {filteredSavedVocabs.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500 space-y-2">
                  <p>保存された語彙はありません。</p>
                  <p className="text-[11px] text-slate-600">
                    物語を読んでいるときに分からない単語をタップ・長押しすると自動でここにストックされます。
                  </p>
                </div>
              ) : (
                filteredSavedVocabs.map(v => {
                  const cefrItem = getVocabByPhrase(v.phrase);
                  const resolvedLevel = cefrItem?.cefr || v.level || 'C1';
                  const isExpanded = savedExpandedId === v.id;
                  const isDue = v.nextReviewDate <= today;

                  return (
                    <div
                      key={v.id}
                      className={`p-4 bg-slate-950/70 border rounded-2xl space-y-2.5 transition-all ${
                        isDue ? 'border-amber-500/40 bg-amber-950/10' : 'border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1 flex-1 min-w-0">
                          <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                            {/* Auto-resolved CEFR Badge */}
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${
                              resolvedLevel === 'A1' ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' :
                              resolvedLevel === 'A2' ? 'bg-teal-500/20 text-teal-300 border-teal-500/40' :
                              resolvedLevel === 'B1' ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' :
                              resolvedLevel === 'B2' ? 'bg-purple-500/20 text-purple-300 border-purple-500/40' :
                              'bg-rose-500/20 text-rose-300 border-rose-500/40'
                            }`}>
                              CEFR {resolvedLevel}
                            </span>

                            <span className="text-base font-bold text-white tracking-tight">
                              {v.phrase}
                            </span>

                            <button
                              onClick={() => speakText(v.phrase)}
                              className="text-slate-400 hover:text-emerald-400"
                            >
                              <Volume2 className="w-3.5 h-3.5" />
                            </button>

                            {v.partOfSpeech && (
                              <span className="text-[10px] text-slate-400 px-1.5 py-0.2 rounded bg-slate-900 border border-slate-800">
                                {v.partOfSpeech}
                              </span>
                            )}
                          </div>

                          <div className="text-sm font-semibold text-emerald-300">
                            {v.meaning || cefrItem?.meaning || '（意味未設定）'}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center space-x-1.5 flex-shrink-0">
                          {onMasterVocab && (
                            <button
                              onClick={() => onMasterVocab(v.id)}
                              className="p-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 rounded-lg text-xs transition-colors flex items-center space-x-1"
                              title="覚えた！（次回間隔を延長）"
                            >
                              <BookmarkCheck className="w-4 h-4" />
                            </button>
                          )}
                          {onDeleteVocab && (
                            <button
                              onClick={() => onDeleteVocab(v.id)}
                              className="p-1.5 bg-slate-900 hover:bg-rose-950/60 text-slate-400 hover:text-rose-300 border border-slate-800 rounded-lg text-xs transition-colors"
                              title="削除"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Details / Context */}
                      <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-850">
                        <div className="flex items-center space-x-3">
                          <span>忘れた回数: <strong className="text-white">{v.lapseCount}回</strong></span>
                          <span>定着カウント: <strong className="text-emerald-400">{v.repetitionCount}</strong></span>
                          <span>次回期日: <strong className={isDue ? 'text-amber-400' : 'text-slate-300'}>{v.nextReviewDate}</strong></span>
                        </div>

                        {(v.contextNote || v.exampleSentence) && (
                          <button
                            onClick={() => setSavedExpandedId(isExpanded ? null : v.id)}
                            className="text-emerald-400 hover:text-emerald-300 flex items-center space-x-0.5"
                          >
                            <span>文脈解説</span>
                            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </button>
                        )}
                      </div>

                      {isExpanded && (
                        <div className="p-3 bg-slate-900/90 border border-slate-800 rounded-xl space-y-1.5 text-xs animate-fadeIn">
                          {v.contextNote && (
                            <div>
                              <span className="text-[10px] text-slate-400 font-bold block">ニュアンス・解説</span>
                              <p className="text-slate-300">{v.contextNote}</p>
                            </div>
                          )}
                          {v.exampleSentence && (
                            <div>
                              <span className="text-[10px] text-slate-400 font-bold block">出典の英文</span>
                              <p className="text-slate-300 italic font-serif">"{v.exampleSentence}"</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Difficult Sentences List */}
          {savedTab === 'sentences' && (
            <div className="space-y-3">
              {filteredDifficultSentences.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  保存された文はありません。
                </div>
              ) : (
                filteredDifficultSentences.map(s => (
                  <div key={s.id} className="p-4 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1 flex-1">
                        <div className="text-sm font-medium text-white font-serif">
                          "{s.sentence}"
                        </div>
                        <div className="text-xs text-slate-400">
                          {s.translation}
                        </div>
                        {s.highlightedPhrase && (
                          <span className="inline-block text-[10px] px-2 py-0.5 rounded bg-blue-500/20 text-sky-300 border border-blue-500/30 font-bold">
                            要点: {s.highlightedPhrase}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center space-x-1">
                        <button
                          onClick={() => speakText(s.sentence)}
                          className="p-1.5 text-slate-400 hover:text-sky-300"
                        >
                          <Volume2 className="w-4 h-4" />
                        </button>
                        {onDeleteSentence && (
                          <button
                            onClick={() => onDeleteSentence(s.id)}
                            className="p-1.5 text-slate-400 hover:text-rose-300"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Expression Errors List */}
          {savedTab === 'errors' && (
            <div className="space-y-3">
              {expressionErrors.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  記録された表現エラーはありません。
                </div>
              ) : (
                expressionErrors.map(err => (
                  <div key={err.id} className="p-4 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1 flex-1">
                        <div className="text-xs text-rose-400 line-through">
                          {err.userUtterance}
                        </div>
                        <div className="text-sm font-bold text-emerald-300 font-serif">
                          ➔ {err.naturalExpression}
                        </div>
                        <div className="text-xs text-slate-300">
                          {err.explanation}
                        </div>
                      </div>
                      {onDeleteExpressionError && (
                        <button
                          onClick={() => onDeleteExpressionError(err.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-300"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
