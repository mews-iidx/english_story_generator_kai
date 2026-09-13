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
import { getVocabMasterByLevel, CEFR_VOCAB_MASTER } from '../data/cefrVocabMaster';
import { MasteryStatus, MyGoal, PatternMasterItem, VocabMasterItem } from '../types/mastery';
import { VocabItem } from '../types/vocab';
import { DifficultSentenceItem } from '../types/sentence';
import { ExpressionErrorItem } from '../types/expressionError';
import {
  Target, Sparkles, AlertCircle, ChevronDown, ChevronUp,
  TrendingUp, BookOpen, Award, Layers, Volume2, Search, Trash2,
  FileText, BarChart3
} from 'lucide-react';
import { speakText } from '../utils/speech';
import { addDaysToDate } from '../utils/srs';

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

type MainTabMode = 'insights' | 'dictionary';
type CefrFilter = 'ALL' | 'A1' | 'A2' | 'B1' | 'B2';
type ItemTypeTab = 'vocabs' | 'patterns';
type StatusFilter = 'all' | 'mastered' | 'lapsed' | 'unseen';
type SavedStockTab = 'words' | 'sentences' | 'errors';

export const MasteryDashboardView: React.FC<MasteryDashboardViewProps> = ({
  onNavigateToCreate,
  savedVocabs = [],
  difficultSentences = [],
  expressionErrors = [],
  onDeleteVocab,
  onDeleteSentence,
  onDeleteExpressionError,
}) => {
  // メイン画面モード: 📊 インサイト（進捗ビュー） vs 📖 辞書・シラバス検索
  const [mainTab, setMainTab] = useState<MainTabMode>('insights');

  // 📖 辞書用ステート
  const [dictItemType, setDictItemType] = useState<ItemTypeTab>('vocabs'); // デフォルトは語彙
  const [dictLevelFilter, setDictLevelFilter] = useState<CefrFilter>('ALL'); // デフォルトは全レベル
  const [dictStatusFilter, setDictStatusFilter] = useState<StatusFilter>('all');
  const [dictSearchQuery, setDictSearchQuery] = useState('');
  const [displayLimit, setDisplayLimit] = useState(60);
  const [expandedPatternId, setExpandedPatternId] = useState<string | null>(null);

  // 📊 インサイト / マイトロフィー用ステート
  const [savedTab, setSavedTab] = useState<SavedStockTab>('words');
  const [savedSearchQuery, setSavedSearchQuery] = useState('');


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
  const levelNames: Record<'A1' | 'A2' | 'B1' | 'B2', { name: string; desc: string }> = {
    A1: { name: '超初級 (A1)', desc: '中学1〜2年・最重要基礎構文と語彙' },
    A2: { name: '初級 (A2)', desc: '中学3年〜日常会話基礎・表現の骨格' },
    B1: { name: '中級 (B1)', desc: '高校〜実用英会話・複文・関係詞・仮定法' },
    B2: { name: '中上級 (B2)', desc: '高度な構文・句動詞・自然なイディオム' },
  };

  // -------------------------------------------------------------
  // 📖 辞書・シラバス検索ロジック（完全一致最優先 ＆ デフォルト全語彙）
  // -------------------------------------------------------------
  const baseVocabPool = useMemo(() => {
    if (dictLevelFilter === 'ALL') return CEFR_VOCAB_MASTER;
    return getVocabMasterByLevel(dictLevelFilter);
  }, [dictLevelFilter]);

  const basePatternPool = useMemo(() => {
    if (dictLevelFilter === 'ALL') return CEFR_PATTERNS_MASTER;
    return getPatternsByLevel(dictLevelFilter);
  }, [dictLevelFilter]);

  // 単語検索＆完全一致最優先ソート
  const filteredDictVocabs = useMemo(() => {
    const q = dictSearchQuery.trim().toLowerCase();
    const items = baseVocabPool.filter(v => {
      const st = masteryState.vocabs[v.id]?.status || masteryState.vocabs[v.phrase.toLowerCase()]?.status || 'unseen';
      if (dictStatusFilter === 'mastered' && st !== 'mastered') return false;
      if (dictStatusFilter === 'lapsed' && st !== 'lapsed') return false;
      if (dictStatusFilter === 'unseen' && (st !== 'unseen' && st !== 'exposed')) return false;

      if (q) {
        const matchesPhrase = v.phrase.toLowerCase().includes(q);
        const matchesMeaning = v.meaning.toLowerCase().includes(q);
        return matchesPhrase || matchesMeaning;
      }
      return true;
    });

    if (q) {
      return [...items].sort((a, b) => {
        const score = (v: VocabMasterItem) => {
          const phrase = v.phrase.toLowerCase();
          if (phrase === q) return 1000; // 完全一致最優先
          if (phrase.startsWith(q + ' ') || phrase.startsWith(q)) return 500; // 前方一致
          if (phrase.includes(q)) return 200; // フレーズ内一致
          if (v.meaning.toLowerCase().includes(q)) return 100; // 意味一致
          return 10;
        };
        const diff = score(b) - score(a);
        if (diff !== 0) return diff;
        return a.phrase.localeCompare(b.phrase);
      });
    }

    return items;
  }, [baseVocabPool, masteryState, dictStatusFilter, dictSearchQuery]);

  // 構文検索＆完全一致最優先ソート
  const filteredDictPatterns = useMemo(() => {
    const q = dictSearchQuery.trim().toLowerCase();
    const items = basePatternPool.filter(p => {
      const st = masteryState.patterns[p.id]?.status || 'unseen';
      if (dictStatusFilter === 'mastered' && st !== 'mastered') return false;
      if (dictStatusFilter === 'lapsed' && st !== 'lapsed') return false;
      if (dictStatusFilter === 'unseen' && (st !== 'unseen' && st !== 'exposed')) return false;

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
        const score = (p: PatternMasterItem) => {
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
  }, [basePatternPool, masteryState, dictStatusFilter, dictSearchQuery]);

  // -------------------------------------------------------------
  // 📊 インサイト / マイトロフィーフィルタリング
  // -------------------------------------------------------------
  const filteredSavedVocabs = useMemo(() => {
    const q = savedSearchQuery.trim().toLowerCase();
    const items = savedVocabs.filter(v => {
      const matchesSearch =
        !q ||
        v.phrase.toLowerCase().includes(q) ||
        v.meaning.toLowerCase().includes(q) ||
        (v.contextNote && v.contextNote.toLowerCase().includes(q));

      return matchesSearch;
    });

    if (q) {
      return [...items].sort((a, b) => {
        const score = (v: VocabItem) => {
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
  }, [savedVocabs, savedSearchQuery]);

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
    const current = masteryState.patterns[patternId]?.status || 'unseen';
    const nextStatus: MasteryStatus = current === clickedStatus ? 'unseen' : clickedStatus;
    recordPatternStatus(patternId, nextStatus);
    setMasteryState(loadMasteryState());
  };

  const handleToggleVocabStatus = (vocabPhraseOrId: string, clickedStatus: MasteryStatus) => {
    const current = masteryState.vocabs[vocabPhraseOrId]?.status || 'unseen';
    const nextStatus: MasteryStatus = current === clickedStatus ? 'unseen' : clickedStatus;
    recordVocabMasteryStatus(vocabPhraseOrId, nextStatus);
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
    const targetLvl = (myGoal?.targetCefr || 'B1') as 'A1' | 'A2' | 'B1' | 'B2';
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

  

  return (
    <div className="max-w-4xl mx-auto px-3 sm:px-4 py-6 space-y-6">
      {/* 1. Top Header & Tab Switcher (インサイト vs 辞書) */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-7 shadow-2xl space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-cyan-500 via-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/25 border border-cyan-400/30">
              <Target className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center space-x-2">
                <span>{mainTab === 'insights' ? '学習進捗＆インサイト' : 'CEFR 辞書＆シラバス'}</span>
                <Sparkles className="w-4 h-4 text-amber-400" />
              </h2>
              <p className="text-xs text-slate-400">
                {mainTab === 'insights'
                  ? 'あなたの学習達成率、読破スピード、マイトロフィーの閲覧'
                  : 'Oxford 4,538語 ＆ Cambridge 996構文の完全一致検索・シラバス'}
              </p>
            </div>
          </div>

          {/* Main Top Tab Switcher */}
          <div className="flex items-center p-1 bg-slate-950 rounded-2xl border border-slate-800 space-x-1">
            <button
              onClick={() => setMainTab('insights')}
              className={`flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                mainTab === 'insights'
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>📊 インサイト</span>
            </button>

            <button
              onClick={() => setMainTab('dictionary')}
              className={`flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all relative ${
                mainTab === 'dictionary'
                  ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md shadow-emerald-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Search className="w-3.5 h-3.5" />
              <span>📖 辞書・シラバス</span>
            </button>
          </div>
        </div>

        {/* Goal / ETA Section (Visible in Insights mode) */}
        {mainTab === 'insights' && (
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

      {/* ========================================================= */}
      {/* 2. MODE CONTENT: 📊 インサイト (ビュー専用) */}
      {/* ========================================================= */}
      {mainTab === 'insights' ? (
        <div className="space-y-6 animate-fadeIn">
          {/* Level Overview Progress Cards (A1, A2, B1, B2) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {(['A1', 'A2', 'B1', 'B2'] as const).map(lvl => {
              const prog = allProgress[lvl];
              return (
                <div
                  key={lvl}
                  className="p-4 rounded-3xl border bg-slate-900/80 border-slate-800 text-left space-y-3 shadow-lg"
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
                </div>
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

          {/* 🏆 マイトロフィー（マイ単語帳・保存文・苦手表現リスト） */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-7 shadow-2xl space-y-5">
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
                  <span>マイ単語帳 ({savedVocabs.length})</span>
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
                  <span>難解文 ({difficultSentences.length})</span>
                </button>

                <button
                  onClick={() => setSavedTab('errors')}
                  className={`flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                    savedTab === 'errors'
                      ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>苦手表現 ({expressionErrors.length})</span>
                </button>
              </div>

              {/* Search Bar for Saved */}
              <div className="relative w-full sm:w-56">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="ストック内を検索..."
                  value={savedSearchQuery}
                  onChange={(e) => setSavedSearchQuery(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            {/* Saved Tab Content */}
            {savedTab === 'words' && (
              <div className="space-y-2.5">
                {filteredSavedVocabs.length === 0 ? (
                  <div className="py-12 text-center text-slate-500 text-xs space-y-1">
                    <p className="font-bold text-slate-400">登録された単語はありません</p>
                    <p>ストーリー読書中に単語をタップして「＋単語帳に追加」するとここに蓄積されます。</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {filteredSavedVocabs.map(v => (
                      <div
                        key={v.id}
                        className="p-3.5 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-1.5 hover:border-slate-700 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <span className="font-bold text-sm text-white">{v.phrase}</span>
                            <button
                              onClick={() => speakText(v.phrase)}
                              className="text-slate-400 hover:text-cyan-400 p-1"
                              title="発音を聞く"
                            >
                              <Volume2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          {onDeleteVocab && (
                            <button
                              onClick={() => onDeleteVocab(v.id)}
                              className="text-slate-600 hover:text-rose-400 p-1"
                              title="削除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        <div className="text-xs text-slate-300 font-medium">
                          {v.meaning}
                        </div>
                        {v.exampleSentence && (
                          <div className="text-[11px] text-sky-300/90 italic pt-0.5">
                            "{v.exampleSentence}"
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {savedTab === 'sentences' && (
              <div className="space-y-2.5">
                {filteredDifficultSentences.length === 0 ? (
                  <div className="py-12 text-center text-slate-500 text-xs">
                    難解文のストックはありません。
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {filteredDifficultSentences.map(s => (
                      <div
                        key={s.id}
                        className="p-4 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-1">
                            <p className="text-xs sm:text-sm font-semibold text-white leading-relaxed">
                              {s.sentence}
                            </p>
                            <p className="text-xs text-slate-400">
                              {s.translation}
                            </p>
                          </div>
                          {onDeleteSentence && (
                            <button
                              onClick={() => onDeleteSentence(s.id)}
                              className="text-slate-600 hover:text-rose-400 p-1 flex-shrink-0"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {savedTab === 'errors' && (
              <div className="space-y-2.5">
                {expressionErrors.length === 0 ? (
                  <div className="py-12 text-center text-slate-500 text-xs">
                    苦手表現の記録はありません。
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {expressionErrors.map(err => (
                      <div
                        key={err.id}
                        className="p-4 bg-slate-950/70 border border-rose-500/20 rounded-2xl space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-xs font-bold text-rose-300">
                              苦手構文: {err.corePattern}
                            </div>
                            <p className="text-xs text-slate-300 mt-1">
                              発話: "{err.userUtterance}"
                            </p>
                            <p className="text-xs text-emerald-400 font-semibold">
                              自然な表現: {err.naturalExpression}
                            </p>
                            {err.explanation && (
                              <p className="text-[11px] text-slate-400 mt-0.5">
                                {err.explanation}
                              </p>
                            )}
                          </div>
                          {onDeleteExpressionError && (
                            <button
                              onClick={() => onDeleteExpressionError(err.id)}
                              className="text-slate-600 hover:text-rose-400 p-1 flex-shrink-0"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ========================================================= */
        /* 3. MODE CONTENT: 📖 辞書・シラバス検索（完全一致最優先） */
        /* ========================================================= */
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-7 shadow-2xl space-y-5 animate-fadeIn">
          {/* Controls: Type Tabs (Vocab vs Pattern) & Level Filters & Search */}
          <div className="space-y-4 border-b border-slate-800 pb-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              {/* Type Switcher: 語彙 vs 構文 */}
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => {
                    setDictItemType('vocabs');
                    setDisplayLimit(60);
                  }}
                  className={`flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                    dictItemType === 'vocabs'
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>重要語彙辞書 ({filteredDictVocabs.length}語)</span>
                </button>

                <button
                  onClick={() => {
                    setDictItemType('patterns');
                    setDisplayLimit(60);
                  }}
                  className={`flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                    dictItemType === 'patterns'
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>構文シラバス ({filteredDictPatterns.length}構文)</span>
                </button>
              </div>

              {/* Search Bar */}
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder={dictItemType === 'vocabs' ? "単語・意味を検索 (完全一致最優先)..." : "構文名・意味を検索..."}
                  value={dictSearchQuery}
                  onChange={(e) => setDictSearchQuery(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 shadow-inner"
                />
              </div>
            </div>

            {/* Level Filter Tabs (ALL / A1 / A2 / B1 / B2) */}
            <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
              <div className="flex items-center space-x-1.5 overflow-x-auto text-xs pb-1 sm:pb-0">
                <span className="text-[11px] text-slate-400 font-bold mr-1">レベル:</span>
                {(['ALL', 'A1', 'A2', 'B1', 'B2'] as const).map(lvl => {
                  const isSelected = dictLevelFilter === lvl;
                  return (
                    <button
                      key={lvl}
                      onClick={() => {
                        setDictLevelFilter(lvl);
                        setDisplayLimit(60);
                      }}
                      className={`px-3 py-1 rounded-xl font-bold transition-all ${
                        isSelected
                          ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                          : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                      }`}
                    >
                      {lvl === 'ALL' ? 'すべて (4,538語)' : lvl}
                    </button>
                  );
                })}
              </div>

              {/* Status Filter Tabs (all / mastered / lapsed / unseen) */}
              <div className="flex items-center space-x-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-[11px]">
                {(['all', 'mastered', 'lapsed', 'unseen'] as const).map(st => {
                  const labels = { all: 'すべて', mastered: '習得済', lapsed: '要復習', unseen: '未遭遇' };
                  const isSelected = dictStatusFilter === st;
                  return (
                    <button
                      key={st}
                      onClick={() => setDictStatusFilter(st)}
                      className={`px-2.5 py-0.5 rounded-lg font-bold transition-all ${
                        isSelected
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {labels[st]}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Dictionary List Results */}
          {dictItemType === 'vocabs' ? (
            <div className="space-y-3">
              {filteredDictVocabs.length === 0 ? (
                <div className="py-16 text-center text-slate-500 text-xs">
                  該当する単語は見つかりませんでした。
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {filteredDictVocabs.slice(0, displayLimit).map(v => {
                      const st = masteryState.vocabs[v.id]?.status || masteryState.vocabs[v.phrase.toLowerCase()]?.status || 'unseen';
                      const isExactMatch = dictSearchQuery.trim().toLowerCase() === v.phrase.toLowerCase();

                      return (
                        <div
                          key={v.id}
                          className={`p-3.5 rounded-2xl border transition-all flex flex-col justify-between gap-2 ${
                            isExactMatch
                              ? 'bg-blue-950/40 border-blue-500/80 shadow-md shadow-blue-500/10 ring-1 ring-blue-500/50'
                              : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center space-x-2">
                                <span className="font-extrabold text-sm text-white">{v.phrase}</span>
                                <button
                                  onClick={() => speakText(v.phrase)}
                                  className="text-slate-400 hover:text-cyan-400 p-0.5"
                                  title="発音を聞く"
                                >
                                  <Volume2 className="w-3.5 h-3.5" />
                                </button>
                                {isExactMatch && (
                                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-blue-500/30 text-sky-300 font-bold border border-blue-400/40">
                                    完全一致
                                  </span>
                                )}
                              </div>
                              <span className="text-[9px] px-1.5 py-0.2 rounded font-bold border bg-slate-900 text-slate-300 border-slate-700">
                                {v.cefr} / {v.partOfSpeech}
                              </span>
                            </div>
                            <div className="text-xs text-slate-200 font-medium">
                              {v.meaning}
                            </div>
                          </div>

                          {/* Quick Mastery Toggle */}
                          <div className="flex items-center justify-end space-x-1.5 pt-1 border-t border-slate-850">
                            <button
                              onClick={() => handleToggleVocabStatus(v.phrase, 'mastered')}
                              className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border transition-all ${
                                st === 'mastered'
                                  ? 'bg-emerald-950 text-emerald-300 border-emerald-500 shadow-sm'
                                  : 'bg-slate-900 text-slate-500 border-slate-800 hover:text-slate-300'
                              }`}
                            >
                              ✓ 習得済
                            </button>
                            <button
                              onClick={() => handleToggleVocabStatus(v.phrase, 'lapsed')}
                              className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border transition-all ${
                                st === 'lapsed'
                                  ? 'bg-rose-950 text-rose-300 border-rose-500 shadow-sm'
                                  : 'bg-slate-900 text-slate-500 border-slate-800 hover:text-slate-300'
                              }`}
                            >
                              ! 要復習
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {filteredDictVocabs.length > displayLimit && (
                    <div className="text-center pt-2">
                      <button
                        onClick={() => setDisplayLimit(prev => prev + 60)}
                        className="px-6 py-2.5 bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition-colors"
                      >
                        さらに表示する (+60件 / 残り {filteredDictVocabs.length - displayLimit}件)
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            /* Patterns List */
            <div className="space-y-3">
              {filteredDictPatterns.length === 0 ? (
                <div className="py-16 text-center text-slate-500 text-xs">
                  該当する構文は見つかりませんでした。
                </div>
              ) : (
                <>
                  <div className="space-y-2.5">
                    {filteredDictPatterns.slice(0, displayLimit).map(p => {
                      const st = masteryState.patterns[p.id]?.status || 'unseen';
                      const isExpanded = expandedPatternId === p.id;
                      const isExactMatch = dictSearchQuery.trim().toLowerCase() === p.name.toLowerCase();

                      return (
                        <div
                          key={p.id}
                          className={`p-4 rounded-2xl border transition-all space-y-2.5 ${
                            isExactMatch
                              ? 'bg-blue-950/40 border-blue-500 shadow-md shadow-blue-500/10'
                              : 'bg-slate-950/70 border-slate-800'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="space-y-1 flex-1">
                              <div className="flex items-center space-x-2">
                                <span className="font-extrabold text-sm text-white">{p.name}</span>
                                <span className="text-[10px] text-slate-400 font-medium">({p.categoryLabel})</span>
                                <span className="text-[9px] px-1.5 py-0.2 rounded font-bold border bg-slate-900 text-slate-300 border-slate-700">
                                  {p.cefr}
                                </span>
                              </div>
                              <div className="text-xs text-sky-300 font-semibold">{p.meaning}</div>
                              <div className="text-[11px] text-slate-400 leading-relaxed">{p.focus}</div>
                            </div>

                            <div className="flex items-center space-x-1.5 flex-shrink-0">
                              <button
                                onClick={() => handleTogglePatternStatus(p.id, 'mastered')}
                                className={`px-2.5 py-1 rounded-xl text-xs font-bold border transition-all ${
                                  st === 'mastered'
                                    ? 'bg-emerald-950 text-emerald-300 border-emerald-500 shadow-sm'
                                    : 'bg-slate-900 text-slate-500 border-slate-800 hover:text-slate-300'
                                }`}
                              >
                                ✓ 習得済
                              </button>
                              <button
                                onClick={() => handleTogglePatternStatus(p.id, 'lapsed')}
                                className={`px-2.5 py-1 rounded-xl text-xs font-bold border transition-all ${
                                  st === 'lapsed'
                                    ? 'bg-rose-950 text-rose-300 border-rose-500 shadow-sm'
                                    : 'bg-slate-900 text-slate-500 border-slate-800 hover:text-slate-300'
                                }`}
                              >
                                ! 要復習
                              </button>
                            </div>
                          </div>

                          {/* Variations Accordion */}
                          <div className="pt-2 border-t border-slate-850 flex items-center justify-between">
                            <button
                              onClick={() => setExpandedPatternId(isExpanded ? null : p.id)}
                              className="text-[11px] text-sky-400 hover:underline flex items-center gap-1 font-semibold"
                            >
                              <span>例文 ({p.variations.length}パターン)</span>
                              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>
                          </div>

                          {isExpanded && (
                            <div className="p-3 bg-slate-900/90 rounded-xl space-y-2 border border-slate-800 text-xs animate-fadeIn">
                              {p.variations.map((v, vIdx) => (
                                <div key={vIdx} className="space-y-0.5 border-b border-slate-800/60 pb-1.5 last:border-b-0 last:pb-0">
                                  <div className="flex items-center justify-between">
                                    <span className="font-bold text-white">{v.sentence}</span>
                                    <button
                                      onClick={() => speakText(v.sentence)}
                                      className="text-slate-400 hover:text-cyan-400 p-0.5"
                                    >
                                      <Volume2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                  <div className="text-[11px] text-slate-400">{v.translation}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {filteredDictPatterns.length > displayLimit && (
                    <div className="text-center pt-2">
                      <button
                        onClick={() => setDisplayLimit(prev => prev + 60)}
                        className="px-6 py-2.5 bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition-colors"
                      >
                        さらに表示する (+60件 / 残り {filteredDictPatterns.length - displayLimit}件)
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
