import React, { useState, useMemo } from 'react';
import {
  loadDailySnapshots,
  computeAllLevelProgress,
  loadReadingSessionLogs,
  deleteReadingSessionLog,
} from '../services/storage';
import { ReadingSessionLog } from '../types/mastery';
import { DailySnapshot } from '../types/mastery';
import { VocabItem } from '../types/vocab';
import { ExpressionErrorItem } from '../types/expressionError';
import { Story } from '../types/story';
import {
  Zap, Volume2, Search, Trash2, ShieldCheck, Filter, BarChart3, Globe,
  ChevronDown, ChevronUp, Calendar, BookOpen, PenTool, Sparkles
} from 'lucide-react';
import { speakText } from '../utils/speech';
import { getTodayDateString } from '../utils/srs';

interface MasteryDashboardViewProps {
  onNavigateToCreate?: () => void;
  savedVocabs?: VocabItem[];
  difficultSentences?: any[];
  expressionErrors?: ExpressionErrorItem[];
  stories?: Story[];
  onMasterVocab?: (vocabId: string) => void;
  onDeleteVocab?: (vocabId: string) => void;
  onDeleteSentence?: (sentenceId: string) => void;
  onDeleteExpressionError?: (errorId: string) => void;
}

type SavedStockTab = 'cards' | 'errors';
type CardFilterType = 'all' | 'word' | 'pattern' | 'mastered' | 'learning';
type TimeScale = 'daily' | 'weekly' | 'monthly';
export type CefrProgressMode = 'comprehension' | 'assembly';

interface TrendPoint {
  label: string; // e.g. "9/14", "第36週", "9月"
  wordsRead: number;
  wpm: number;
  // 理解 (Comprehension)
  compMasteredPct: number;
  compLearningPct: number;
  compUnseenPct: number;
  // 組立 (Assembly)
  assemMasteredPct: number;
  assemLearningPct: number;
  assemUnseenPct: number;
  dateKey: string;
}

function formatDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function computeDailyStreak(snapshots: DailySnapshot[]): number {
  if (!snapshots || snapshots.length === 0) return 0;
  
  const activeDates = new Set(
    snapshots
      .filter(s => (s.wordsRead && s.wordsRead > 0) || (s.newMasteredVocabsCount && s.newMasteredVocabsCount > 0))
      .map(s => s.date)
  );

  if (activeDates.size === 0) return 0;

  const now = new Date();
  const checkDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  let dateKey = formatDateKey(checkDate);
  if (!activeDates.has(dateKey)) {
    checkDate.setDate(checkDate.getDate() - 1);
    dateKey = formatDateKey(checkDate);
    if (!activeDates.has(dateKey)) {
      return 0;
    }
  }

  let streak = 0;
  while (activeDates.has(formatDateKey(checkDate))) {
    streak++;
    checkDate.setDate(checkDate.getDate() - 1);
  }

  return streak;
}

function extractProgressMetrics(snap: DailySnapshot) {
  const summaries = [snap.a1Progress, snap.a2Progress, snap.b1Progress, snap.b2Progress].filter(Boolean);
  if (summaries.length === 0) {
    return {
      compMasteredPct: 0,
      compLearningPct: 0,
      compUnseenPct: 100,
      assemMasteredPct: 0,
      assemLearningPct: 0,
      assemUnseenPct: 100,
    };
  }

  const compMastered = summaries.reduce((acc, s) => acc + (s.patternMastered || 0) + (s.vocabMastered || 0), 0);
  const compLearning = summaries.reduce((acc, s) => acc + (s.patternExposed || 0) + (s.patternLapsed || 0) + (s.vocabExposed || 0) + (s.vocabLapsed || 0), 0);
  const compUnseen = summaries.reduce((acc, s) => acc + (s.patternUnseen || 0) + (s.vocabUnseen || 0), 0);
  const compTotal = compMastered + compLearning + compUnseen || 1;

  const assemMastered = summaries.reduce((acc, s) => acc + (s.patternAssemblyMastered || 0) + (s.vocabAssemblyMastered || 0), 0);
  const assemTotal = compTotal;
  const assemMasteredPct = Math.round((assemMastered / assemTotal) * 100);
  const assemLearningPct = Math.min(100 - assemMasteredPct, Math.round((compLearning / assemTotal) * 100));
  const assemUnseenPct = Math.max(0, 100 - assemMasteredPct - assemLearningPct);

  return {
    compMasteredPct: Math.round((compMastered / compTotal) * 100),
    compLearningPct: Math.round((compLearning / compTotal) * 100),
    compUnseenPct: Math.max(0, 100 - Math.round((compMastered / compTotal) * 100) - Math.round((compLearning / compTotal) * 100)),
    assemMasteredPct,
    assemLearningPct,
    assemUnseenPct,
  };
}

// 日・週・月ごとのトレンド集計ロジック
function aggregateSnapshots(snapshots: DailySnapshot[], scale: TimeScale): TrendPoint[] {
  if (!snapshots || snapshots.length === 0) return [];

  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));

  if (scale === 'daily') {
    return sorted.slice(-14).map(s => {
      const parts = s.date.split('-');
      const label = `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`;
      const metrics = extractProgressMetrics(s);
      return {
        label,
        wordsRead: s.wordsRead || 0,
        wpm: s.averageWpm || 0,
        ...metrics,
        dateKey: s.date,
      };
    });
  }

  if (scale === 'weekly') {
    const weekMap: Record<string, { label: string; words: number; wpms: number[]; latestSnap: DailySnapshot }> = {};
    
    sorted.forEach(s => {
      const d = new Date(s.date);
      const startOfYear = new Date(d.getFullYear(), 0, 1);
      const weekNum = Math.ceil((((d.getTime() - startOfYear.getTime()) / 86400000) + startOfYear.getDay() + 1) / 7);
      const key = `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
      const label = `W${weekNum}`;

      if (!weekMap[key]) {
        weekMap[key] = { label, words: 0, wpms: [], latestSnap: s };
      }
      weekMap[key].words += s.wordsRead || 0;
      if (s.averageWpm && s.averageWpm > 0) weekMap[key].wpms.push(s.averageWpm);
      weekMap[key].latestSnap = s;
    });

    return Object.keys(weekMap).sort().slice(-8).map(key => {
      const item = weekMap[key];
      const avgWpm = item.wpms.length > 0 ? Math.round(item.wpms.reduce((a, b) => a + b, 0) / item.wpms.length) : 0;
      const metrics = extractProgressMetrics(item.latestSnap);
      return {
        label: item.label,
        wordsRead: item.words,
        wpm: avgWpm,
        ...metrics,
        dateKey: key,
      };
    });
  }

  if (scale === 'monthly') {
    const monthMap: Record<string, { label: string; words: number; wpms: number[]; latestSnap: DailySnapshot }> = {};
    
    sorted.forEach(s => {
      const key = s.date.substring(0, 7);
      const parts = key.split('-');
      const label = `${parseInt(parts[1], 10)}月`;

      if (!monthMap[key]) {
        monthMap[key] = { label, words: 0, wpms: [], latestSnap: s };
      }
      monthMap[key].words += s.wordsRead || 0;
      if (s.averageWpm && s.averageWpm > 0) monthMap[key].wpms.push(s.averageWpm);
      monthMap[key].latestSnap = s;
    });

    return Object.keys(monthMap).sort().slice(-6).map(key => {
      const item = monthMap[key];
      const avgWpm = item.wpms.length > 0 ? Math.round(item.wpms.reduce((a, b) => a + b, 0) / item.wpms.length) : 0;
      const metrics = extractProgressMetrics(item.latestSnap);
      return {
        label: item.label,
        wordsRead: item.words,
        wpm: avgWpm,
        ...metrics,
        dateKey: key,
      };
    });
  }

  return [];
}

export const MasteryDashboardView: React.FC<MasteryDashboardViewProps> = ({
  savedVocabs = [],
  expressionErrors = [],
  stories = [],
  onDeleteVocab,
  onDeleteExpressionError,
}) => {
  // マイトロフィー（武器庫）のタブ & フィルター
  const [savedTab, setSavedTab] = useState<SavedStockTab>('cards');
  const [cardFilter, setCardFilter] = useState<CardFilterType>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // リアルCEFR進捗マップの展開状態 & タイムスケール（日/週/月） & 理解/組立小タブ
  const [isReadingLogsExpanded, setIsReadingLogsExpanded] = useState(false);
  const [timeScale, setTimeScale] = useState<TimeScale>('daily');
  const [cefrMode, setCefrMode] = useState<CefrProgressMode>('comprehension');

  // 日次スナップショット & 読了ログの取得
  const [dailySnapshots, setDailySnapshots] = useState<DailySnapshot[]>(() => loadDailySnapshots());
  const [readingLogs, setReadingLogs] = useState<ReadingSessionLog[]>(() => loadReadingSessionLogs());

  const handleDeleteReadingLog = (logId: string) => {
    const { logs, snapshots } = deleteReadingSessionLog(logId);
    setReadingLogs(logs);
    setDailySnapshots(snapshots);
  };

  const allCefrProgress = useMemo(() => computeAllLevelProgress(), []);

  // 全レベルの平均制覇率（理解 ＆ 組立）
  const overallAvgCompPct = useMemo(() => {
    return Math.round(
      (allCefrProgress.A1.overallPct +
       allCefrProgress.A2.overallPct +
       allCefrProgress.B1.overallPct +
       allCefrProgress.B2.overallPct) / 4
    );
  }, [allCefrProgress]);

  const overallAvgAssemPct = useMemo(() => {
    return Math.round(
      ((allCefrProgress.A1.overallAssemblyPct || 0) +
       (allCefrProgress.A2.overallAssemblyPct || 0) +
       (allCefrProgress.B1.overallAssemblyPct || 0) +
       (allCefrProgress.B2.overallAssemblyPct || 0)) / 4
    );
  }, [allCefrProgress]);

  // 1. 総読了語数の集計（青天井）
  const totalWordsRead = useMemo(() => {
    const fromSnapshots = dailySnapshots.reduce((acc, s) => acc + (s.wordsRead || 0), 0);
    if (fromSnapshots > 0) return fromSnapshots;
    return stories.reduce((acc, st) => {
      if (st.actualWordCount && st.actualWordCount > 0) return acc + st.actualWordCount;
      const text = st.storyContent || '';
      const words = text.split(/\s+/).filter(Boolean).length;
      return acc + words;
    }, 0);
  }, [dailySnapshots, stories]);

  // 2. 平均読書スピード（WPM）の集計
  const { averageWpm, wpmTier } = useMemo(() => {
    const validWpms = dailySnapshots
      .map(s => s.averageWpm)
      .filter((w): w is number => typeof w === 'number' && w > 0);

    const avg = validWpms.length > 0
      ? Math.round(validWpms.reduce((a, b) => a + b, 0) / validWpms.length)
      : 0;

    let tier = { label: '未測定', color: 'text-slate-400', desc: '物語を読了するとWPMが記録されます' };
    if (avg > 0 && avg < 100) {
      tier = { label: 'じっくり精読', color: 'text-amber-400', desc: '1文ずつ確実に理解しながら読解中' };
    } else if (avg >= 100 && avg < 150) {
      tier = { label: 'スムーズ読破', color: 'text-cyan-400', desc: '英語の語順のままスラスラ読める段階' };
    } else if (avg >= 150 && avg < 200) {
      tier = { label: 'ネイティブ並速読', color: 'text-emerald-400', desc: '日本語に訳さず直読直解できている速度' };
    } else if (avg >= 200) {
      tier = { label: '超高速英語脳', color: 'text-purple-400', desc: '圧倒的な処理速度で情報処理が可能' };
    }

    return { averageWpm: avg, wpmTier: tier };
  }, [dailySnapshots]);

  // 3. 連続学習ストリーク（日数）
  const streakDays = useMemo(() => computeDailyStreak(dailySnapshots), [dailySnapshots]);

  // 4. センテンス武器庫のステータス集計
  const { masteredCardsCount, learningCardsCount, wordCardsCount, patternCardsCount } = useMemo(() => {
    let mastered = 0;
    let learning = 0;
    let words = 0;
    let patterns = 0;

    savedVocabs.forEach(v => {
      const isMastered = (v.intervalDays && v.intervalDays >= 21) || (v.repetitionCount && v.repetitionCount >= 4);
      if (isMastered) mastered++;
      else learning++;

      if (v.focusType === 'pattern' || (v.corePatterns && v.corePatterns.length > 0)) patterns++;
      else words++;
    });

    return {
      masteredCardsCount: mastered,
      learningCardsCount: learning,
      wordCardsCount: words,
      patternCardsCount: patterns,
    };
  }, [savedVocabs]);

  // 5. 直近7日間の日次データ
  const last7DaysData = useMemo(() => {
    const result: { date: string; displayDate: string; words: number; wpm: number; isToday: boolean }[] = [];
    const todayStr = getTodayDateString();
    
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = formatDateKey(d);
      const displayDate = `${d.getMonth() + 1}/${d.getDate()}`;
      const snap = dailySnapshots.find(s => s.date === dateStr);
      result.push({
        date: dateStr,
        displayDate,
        words: snap?.wordsRead || 0,
        wpm: snap?.averageWpm || 0,
        isToday: dateStr === todayStr,
      });
    }
    return result;
  }, [dailySnapshots]);

  const maxWordsIn7Days = useMemo(() => {
    return Math.max(...last7DaysData.map(d => d.words), 200);
  }, [last7DaysData]);

  // 6. 日・週・月ごとのトレンドデータ
  const trendData = useMemo(() => {
    return aggregateSnapshots(dailySnapshots, timeScale);
  }, [dailySnapshots, timeScale]);

  // 7. 1センテンス Ankiカードのフィルタリング & 検索
  const filteredCards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return savedVocabs.filter(v => {
      // フィルター判定
      const isMastered = (v.intervalDays && v.intervalDays >= 21) || (v.repetitionCount && v.repetitionCount >= 4);
      const isPattern = v.focusType === 'pattern' || (v.corePatterns && v.corePatterns.length > 0);

      if (cardFilter === 'mastered' && !isMastered) return false;
      if (cardFilter === 'learning' && isMastered) return false;
      if (cardFilter === 'word' && isPattern) return false;
      if (cardFilter === 'pattern' && !isPattern) return false;

      // 検索ワード判定
      if (!q) return true;
      const targetText = [
        v.phrase,
        v.focusWord,
        v.meaning,
        v.focusMeaning,
        v.sentence,
        v.translation,
        v.contextNote,
        ...(v.corePatterns?.map(p => p.patternName + ' ' + p.formula) || []),
      ].join(' ').toLowerCase();

      return targetText.includes(q);
    });
  }, [savedVocabs, cardFilter, searchQuery]);

  // 8. 偽英語・発話カルテのフィルタリング
  const filteredErrors = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return expressionErrors.filter(e => {
      if (!q) return true;
      return (
        e.userUtterance.toLowerCase().includes(q) ||
                e.naturalExpression.toLowerCase().includes(q) ||
        e.explanation.toLowerCase().includes(q) ||
        e.corePattern.toLowerCase().includes(q)
      );
    });
  }, [expressionErrors, searchQuery]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      {/* 1. TOP SUMMARY CARDS (4-GRID) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Card 1: 総読了語数 */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xl space-y-1.5 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-semibold">総読了語数</span>
            <BookOpen className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="flex items-baseline space-x-1.5">
            <span className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              {totalWordsRead.toLocaleString()}
            </span>
            <span className="text-xs font-bold text-cyan-400">語</span>
          </div>
          <p className="text-[11px] text-slate-400">
            多読ストック: {stories.length} 冊読破
          </p>
        </div>

        {/* Card 2: 読書スピード (WPM) */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xl space-y-1.5 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-semibold">読書速度 (WPM)</span>
            <Zap className="w-4 h-4 text-amber-400" />
          </div>
          <div className="flex items-baseline space-x-1.5">
            <span className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              {averageWpm > 0 ? averageWpm : '--'}
            </span>
            <span className="text-xs font-bold text-amber-400">wpm</span>
          </div>
          <p className={`text-[11px] font-bold ${wpmTier.color}`}>
            {wpmTier.label}
          </p>
        </div>

        {/* Card 3: 連続学習ストリーク */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xl space-y-1.5 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-semibold">連続学習日数</span>
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex items-baseline space-x-1.5">
            <span className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              {streakDays}
            </span>
            <span className="text-xs font-bold text-emerald-400">日連続</span>
          </div>
          <p className="text-[11px] text-slate-400">
            習慣化が英語脳を構築します
          </p>
        </div>

        {/* Card 4: マイ武器庫 (Ankiカード) */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xl space-y-1.5 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-semibold">Ankiカード装備数</span>
            <Sparkles className="w-4 h-4 text-purple-400" />
          </div>
          <div className="flex items-baseline space-x-1.5">
            <span className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              {savedVocabs.length}
            </span>
            <span className="text-xs font-bold text-purple-400">文</span>
          </div>
          <p className="text-[11px] text-slate-400">
            定着: <strong className="text-emerald-400 font-bold">{masteredCardsCount}</strong> / 修行中: {learningCardsCount}
          </p>
        </div>
      </div>

      {/* 2. 7-DAY ACTIVITY & WPM TREND CHART */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <BarChart3 className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-white">
              直近7日間の読書アクティビティ & 処理速度推移
            </h3>
          </div>
          <span className="text-[11px] text-slate-400">日次読了語数 ＆ WPM</span>
        </div>

        {/* Bar Visualizer */}
        <div className="grid grid-cols-7 gap-2 sm:gap-3 pt-3">
          {last7DaysData.map(d => {
            const heightPercent = d.words > 0 ? Math.max(15, Math.min(100, Math.round((d.words / maxWordsIn7Days) * 100))) : 4;

            return (
              <div key={d.date} className="flex flex-col items-center space-y-2">
                <div className="h-5 flex items-center justify-center">
                  {d.wpm > 0 ? (
                    <span className="text-[9px] font-extrabold text-cyan-300 bg-cyan-950/80 border border-cyan-500/40 px-1 rounded">
                      {d.wpm}wpm
                    </span>
                  ) : d.words > 0 ? (
                    <span className="text-[9px] text-slate-400 font-medium">
                      {d.words}語
                    </span>
                  ) : null}
                </div>

                <div className="w-full bg-slate-950/80 rounded-xl h-24 sm:h-28 p-1 flex items-end justify-center border border-slate-800/80">
                  <div
                    className={`w-full rounded-lg transition-all duration-700 ${
                      d.words > 0
                        ? d.isToday
                          ? 'bg-gradient-to-t from-cyan-600 via-blue-500 to-indigo-500 shadow-md shadow-cyan-500/20'
                          : 'bg-gradient-to-t from-slate-700 to-slate-500'
                        : 'bg-slate-900/50'
                    }`}
                    style={{ height: `${heightPercent}%` }}
                  />
                </div>

                <div className="text-center">
                  <span className={`text-[10px] font-bold block ${d.isToday ? 'text-cyan-400' : 'text-slate-400'}`}>
                    {d.displayDate}
                  </span>
                  {d.isToday && (
                    <span className="text-[8px] text-cyan-500 font-extrabold block -mt-0.5">TODAY</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. 📖 読了セッション履歴 & ログ管理 (折りたたみ) */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-4 transition-all">
        <button
          onClick={() => setIsReadingLogsExpanded(!isReadingLogsExpanded)}
          className="w-full flex items-center justify-between text-left group"
        >
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-950 border border-cyan-500/30 flex items-center justify-center text-cyan-400 group-hover:scale-105 transition-transform">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-sm sm:text-base font-black text-white group-hover:text-cyan-300 transition-colors">
                  📖 読了セッション履歴 & ログ管理
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold">
                  {readingLogs.length}件の記録
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                読了したストーリーの日時・語数・WPMログ（誤タップ等のノイズはここから個別削除できます）
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-1.5 text-slate-400 group-hover:text-white transition-colors pl-2">
            <span className="text-xs font-semibold hidden sm:inline">
              {isReadingLogsExpanded ? '閉じる' : '履歴を見る'}
            </span>
            {isReadingLogsExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </button>

        {isReadingLogsExpanded && (
          <div className="pt-4 border-t border-slate-800 space-y-3 animate-fadeIn">
            {readingLogs.length === 0 ? (
              <div className="py-8 text-center text-slate-500 text-xs">
                まだ読了ログがありません。ストーリーを最後まで読むと自動で記録されます。
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {readingLogs.map(log => (
                  <div
                    key={log.id}
                    className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-2xl flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="font-bold text-white truncate">
                        {log.storyTitle || '無題の物語'}
                      </div>
                      <div className="flex items-center space-x-3 text-[11px] text-slate-400">
                        <span>📅 {log.dateString}</span>
                        <span>📄 {log.wordsCount} 語</span>
                        <span className="text-cyan-400 font-bold">⚡ {log.wpm} wpm</span>
                      </div>
                    </div>

                    <button
                      onClick={() => handleDeleteReadingLog(log.id)}
                      className="p-2 text-slate-500 hover:text-rose-400 hover:bg-rose-950/50 rounded-xl transition-colors shrink-0"
                      title="この読了記録を削除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 4. 🌐 リアルCEFRシラバス進捗マップ (A1〜B2) ＆ 理解/組立 3状態グラフ */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-5 transition-all">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-950 border border-blue-500/30 flex items-center justify-center text-sky-400">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base sm:text-lg font-black text-white">
                  🌐 リアルCEFRシラバス進捗マップ (A1〜B2)
                </h3>
              </div>
              <p className="text-[11px] text-slate-400">
                マスターDBに基づく【🟢 既知 / 🟡 学習中 / ⚪ 未知】の3状態リアル分布
              </p>
            </div>
          </div>

          {/* Sub-tab Switcher: Comprehension (理解) vs Assembly (組立) */}
          <div className="flex items-center bg-slate-950 p-1 rounded-2xl border border-slate-800">
            <button
              onClick={() => setCefrMode('comprehension')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                cefrMode === 'comprehension'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>📖 理解 ({overallAvgCompPct}%)</span>
            </button>

            <button
              onClick={() => setCefrMode('assembly')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                cefrMode === 'assembly'
                  ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <PenTool className="w-3.5 h-3.5" />
              <span>⚙️ 組立 ({overallAvgAssemPct}%)</span>
            </button>
          </div>
        </div>

        {/* Level Progress Cards (A1, A2, B1, B2) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {(['A1', 'A2', 'B1', 'B2'] as const).map(lvl => {
            const prog = allCefrProgress[lvl];
            const levelTitle = {
              A1: '超初級 (A1)',
              A2: '初級 (A2)',
              B1: '中級 (B1)',
              B2: '中上級 (B2)',
            }[lvl];

            if (cefrMode === 'comprehension') {
              const patternLearning = (prog.patternExposed || 0) + (prog.patternLapsed || 0);
              const vocabLearning = (prog.vocabExposed || 0) + (prog.vocabLapsed || 0);

              const patternMasteredPct = Math.round(((prog.patternMastered || 0) / (prog.patternTotal || 1)) * 100);
              const patternLearningPct = Math.round((patternLearning / (prog.patternTotal || 1)) * 100);

              const vocabMasteredPct = Math.round(((prog.vocabMastered || 0) / (prog.vocabTotal || 1)) * 100);
              const vocabLearningPct = Math.round((vocabLearning / (prog.vocabTotal || 1)) * 100);

              return (
                <div
                  key={lvl}
                  className="p-4 rounded-2xl border bg-slate-950/80 border-slate-800 text-left space-y-3 shadow-md"
                >
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                    <span className="text-xs font-bold text-slate-200">{levelTitle}</span>
                    <span className="text-xs font-black text-sky-400">
                      理解 {Math.round(prog.overallPct)}%
                    </span>
                  </div>

                  <div className="space-y-2.5 text-[10px] text-slate-400">
                    {/* 構文 3-state */}
                    <div className="space-y-1">
                      <div className="flex justify-between font-semibold">
                        <span>💡 構文 ({prog.patternMastered}/{prog.patternTotal})</span>
                        <span className="text-slate-300">
                          🟢 {prog.patternMastered} 🟡 {patternLearning} ⚪ {prog.patternUnseen}
                        </span>
                      </div>
                      <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden flex border border-slate-800">
                        <div
                          className="h-full bg-emerald-500"
                          style={{ width: `${patternMasteredPct}%` }}
                          title={`既知: ${prog.patternMastered}`}
                        />
                        <div
                          className="h-full bg-amber-400"
                          style={{ width: `${patternLearningPct}%` }}
                          title={`学習中・Anki中: ${patternLearning}`}
                        />
                      </div>
                    </div>

                    {/* 語彙 3-state */}
                    <div className="space-y-1 pt-1 border-t border-slate-900">
                      <div className="flex justify-between font-semibold">
                        <span>🔤 語彙 ({prog.vocabMastered}/{prog.vocabTotal})</span>
                        <span className="text-slate-300">
                          🟢 {prog.vocabMastered} 🟡 {vocabLearning} ⚪ {prog.vocabUnseen}
                        </span>
                      </div>
                      <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden flex border border-slate-800">
                        <div
                          className="h-full bg-teal-400"
                          style={{ width: `${vocabMasteredPct}%` }}
                          title={`既知: ${prog.vocabMastered}`}
                        />
                        <div
                          className="h-full bg-yellow-400"
                          style={{ width: `${vocabLearningPct}%` }}
                          title={`学習中・Anki中: ${vocabLearning}`}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            } else {
              // 組立 (Assembly) Mode
              const patternAssemblyMastered = prog.patternAssemblyMastered || 0;
              const vocabAssemblyMastered = prog.vocabAssemblyMastered || 0;

              const patternAssemblyPct = prog.patternAssemblyPct || 0;
              const vocabAssemblyPct = prog.vocabAssemblyPct || 0;

              return (
                <div
                  key={lvl}
                  className="p-4 rounded-2xl border bg-slate-950/80 border-purple-500/20 text-left space-y-3 shadow-md"
                >
                  <div className="flex items-center justify-between border-b border-purple-500/20 pb-2">
                    <span className="text-xs font-bold text-purple-200">{levelTitle}</span>
                    <span className="text-xs font-black text-purple-400">
                      組立 {Math.round(prog.overallAssemblyPct || 0)}%
                    </span>
                  </div>

                  <div className="space-y-2.5 text-[10px] text-slate-400">
                    {/* 構文 組立 */}
                    <div className="space-y-1">
                      <div className="flex justify-between font-semibold">
                        <span>⚙️ 構文組立 ({patternAssemblyMastered}/{prog.patternTotal})</span>
                        <span className="text-purple-300 font-bold">{patternAssemblyPct}%</span>
                      </div>
                      <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden flex border border-slate-800">
                        <div
                          className="h-full bg-purple-500"
                          style={{ width: `${patternAssemblyPct}%` }}
                          title={`組立マスター: ${patternAssemblyMastered}`}
                        />
                      </div>
                    </div>

                    {/* 語彙 組立 */}
                    <div className="space-y-1 pt-1 border-t border-slate-900">
                      <div className="flex justify-between font-semibold">
                        <span>⚙️ 語彙組立 ({vocabAssemblyMastered}/{prog.vocabTotal})</span>
                        <span className="text-indigo-300 font-bold">{vocabAssemblyPct}%</span>
                      </div>
                      <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden flex border border-slate-800">
                        <div
                          className="h-full bg-indigo-500"
                          style={{ width: `${vocabAssemblyPct}%` }}
                          title={`組立マスター: ${vocabAssemblyMastered}`}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            }
          })}
        </div>

        {/* Time Scale Trend Graph (日 / 週 / 月) with 3-State Stacked Bars */}
        <div className="p-4 sm:p-5 bg-slate-950/60 border border-slate-800 rounded-2xl space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
            <div className="flex items-center space-x-2">
              <Calendar className="w-4 h-4 text-sky-400" />
              <span className="text-xs sm:text-sm font-bold text-white">
                期間別・CEFR{cefrMode === 'comprehension' ? '理解' : '組立'}推移グラフ（🟢既知 🟡学習中 ⚪未知）
              </span>
            </div>

            {/* Scale Switcher: Daily / Weekly / Monthly */}
            <div className="flex items-center p-1 bg-slate-900 rounded-xl border border-slate-800 text-[11px] space-x-1">
              {[
                { id: 'daily', label: '📅 日次' },
                { id: 'weekly', label: '📆 週次' },
                { id: 'monthly', label: '🗓️ 月次' },
              ].map(s => (
                <button
                  key={s.id}
                  onClick={() => setTimeScale(s.id as TimeScale)}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all ${
                    timeScale === s.id
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Trend Chart Stacked Bars */}
          {trendData.length === 0 ? (
            <div className="py-8 text-center text-slate-500 text-xs">
              まだ十分な日次データがありません。ストーリーを読破すると履歴が積み上がります。
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${trendData.length}, minmax(0, 1fr))` }}>
                {trendData.map((point, idx) => {
                  const masteredPct = cefrMode === 'comprehension' ? point.compMasteredPct : point.assemMasteredPct;
                  const learningPct = cefrMode === 'comprehension' ? point.compLearningPct : point.assemLearningPct;
                  const unseenPct = cefrMode === 'comprehension' ? point.compUnseenPct : point.assemUnseenPct;

                  return (
                    <div key={idx} className="flex flex-col items-center space-y-1.5">
                      <span className="text-[9px] font-black text-sky-300">
                        {masteredPct}%
                      </span>

                      {/* 3-State Stacked Vertical Bar */}
                      <div className="w-full bg-slate-900 rounded-lg h-24 p-0.5 flex flex-col justify-end border border-slate-800 overflow-hidden">
                        {/* ⚪ 未知 */}
                        <div
                          className="w-full bg-slate-800/80 transition-all duration-500"
                          style={{ height: `${unseenPct}%` }}
                          title={`未知: ${unseenPct}%`}
                        />
                        {/* 🟡 学習中 */}
                        <div
                          className={`w-full ${cefrMode === 'comprehension' ? 'bg-amber-400' : 'bg-indigo-400'} transition-all duration-500`}
                          style={{ height: `${learningPct}%` }}
                          title={`学習中: ${learningPct}%`}
                        />
                        {/* 🟢 既知 */}
                        <div
                          className={`w-full ${cefrMode === 'comprehension' ? 'bg-emerald-500' : 'bg-purple-500'} transition-all duration-500`}
                          style={{ height: `${masteredPct}%` }}
                          title={`既知: ${masteredPct}%`}
                        />
                      </div>

                      <span className="text-[9px] font-bold text-slate-400 block truncate max-w-[40px]">
                        {point.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Legend */}
              <div className="flex items-center justify-center space-x-4 text-[11px] text-slate-400 pt-1">
                <div className="flex items-center space-x-1.5">
                  <span className={`w-2.5 h-2.5 rounded-sm ${cefrMode === 'comprehension' ? 'bg-emerald-500' : 'bg-purple-500'}`} />
                  <span>🟢 既知 (Mastered)</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <span className={`w-2.5 h-2.5 rounded-sm ${cefrMode === 'comprehension' ? 'bg-amber-400' : 'bg-indigo-400'}`} />
                  <span>🟡 学習中 (In Progress)</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-slate-800" />
                  <span>⚪ 未知 (Unseen)</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 5. センテンス武器庫 & 発話カルテ (MY WEAPONRY) */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-7 shadow-2xl space-y-6">
        {/* Header & Sub-Tab Switcher */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
          <div>
            <h3 className="text-base sm:text-lg font-black text-white flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              <span>マイ武器庫 ＆ 発話カルテ</span>
            </h3>
            <p className="text-xs text-slate-400">
              多読・英会話・ドリルで獲得した1センテンスAnkiカードと発話ミス改善ログ
            </p>
          </div>

          <div className="flex items-center bg-slate-950 p-1 rounded-2xl border border-slate-800">
            <button
              onClick={() => setSavedTab('cards')}
              className={`flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                savedTab === 'cards'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Ankiカード ({savedVocabs.length})</span>
            </button>

            <button
              onClick={() => setSavedTab('errors')}
              className={`flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                savedTab === 'errors'
                  ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>発話カルテ ({expressionErrors.length})</span>
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="キーワードで武器庫を検索..."
            className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-2xl pl-10 pr-4 py-2.5 text-xs sm:text-sm text-slate-200 placeholder-slate-500 outline-none transition-colors"
          />
        </div>

        {/* TAB 1: 1センテンス Ankiカード一覧 */}
        {savedTab === 'cards' && (
          <div className="space-y-4">
            {/* Filter Buttons */}
            <div className="flex items-center space-x-1.5 flex-wrap gap-y-1 text-xs">
              <span className="text-slate-500 flex items-center gap-1 mr-1 text-[11px]">
                <Filter className="w-3.5 h-3.5" /> 絞込:
              </span>
              {[
                { id: 'all', label: `すべて (${savedVocabs.length})` },
                { id: 'learning', label: `🟡 修行中 (${learningCardsCount})` },
                { id: 'mastered', label: `🟢 定着 (${masteredCardsCount})` },
                { id: 'word', label: `🔤 単語 (${wordCardsCount})` },
                { id: 'pattern', label: `💡 構文 (${patternCardsCount})` },
              ].map(f => (
                <button
                  key={f.id}
                  onClick={() => setCardFilter(f.id as CardFilterType)}
                  className={`px-3 py-1 rounded-xl text-[11px] font-bold transition-all ${
                    cardFilter === f.id
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-slate-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {filteredCards.length === 0 ? (
              <div className="py-16 text-center text-slate-500 text-xs">
                条件に一致するAnkiカードはありません。
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredCards.map(c => {
                  const isMature = (c.intervalDays && c.intervalDays >= 21) || (c.repetitionCount && c.repetitionCount >= 4);

                  return (
                    <div
                      key={c.id}
                      className="p-4 bg-slate-950/70 border border-slate-800 hover:border-slate-700 rounded-2xl space-y-2.5 transition-all text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            isMature
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          }`}>
                            {isMature ? '🟢 既知' : '🟡 修行中'}
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-[10px] font-bold">
                            {c.cardDirection === 'ja_to_en' ? '✍️ 作文' : '📖 読解'}
                          </span>
                        </div>

                        <div className="flex items-center space-x-1">
                          <button
                            onClick={() => speakText(c.sentence || c.phrase)}
                            className="p-1.5 text-slate-400 hover:text-sky-300 rounded-lg"
                            title="発音再生"
                          >
                            <Volume2 className="w-3.5 h-3.5" />
                          </button>
                          {onDeleteVocab && (
                            <button
                              onClick={() => onDeleteVocab(c.id)}
                              className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg"
                              title="カード削除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="font-bold text-white text-sm">
                        {c.sentence || c.phrase}
                      </div>

                      <div className="text-slate-300 text-xs">
                        {c.translation || c.meaning}
                      </div>

                      {c.corePatterns && c.corePatterns.length > 0 && (
                        <div className="pt-1 flex flex-wrap gap-1">
                          {c.corePatterns.map((cp, idx) => (
                            <span key={idx} className="text-[10px] px-2 py-0.5 rounded bg-purple-950/80 border border-purple-500/30 text-purple-300">
                              💡 {cp.patternName}: {cp.formula}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: 偽英語・発話カルテ */}
        {savedTab === 'errors' && (
          <div className="space-y-3">
            {filteredErrors.length === 0 ? (
              <div className="py-16 text-center text-slate-500 text-xs">
                カルテに記録された発話エラーはありません。
              </div>
            ) : (
              <div className="space-y-2.5">
                {filteredErrors.map(e => (
                  <div
                    key={e.id}
                    className="p-4 bg-slate-950/70 border border-rose-500/20 rounded-2xl space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold">
                        ⚠️ 発話改善ログ
                      </span>
                      {onDeleteExpressionError && (
                        <button
                          onClick={() => onDeleteExpressionError(e.id)}
                          className="p-1 text-slate-500 hover:text-rose-400 rounded-lg"
                          title="カルテ削除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="space-y-1">
                      <div className="text-rose-300/90">
                        <span className="font-bold">あなたの発話:</span> {e.userUtterance}
                      </div>
                      <div className="text-emerald-300 font-bold">
                        <span>✨ 洗練表現:</span> {e.naturalExpression}
                      </div>
                      <div className="text-slate-400 text-[11px]">
                        💡 {e.explanation}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
