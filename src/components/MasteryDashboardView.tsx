import React, { useState, useMemo } from 'react';
import {
  loadDailySnapshots,
  computeAllLevelProgress,
  loadReadingSessionLogs,
  deleteReadingSessionLog,
  getWeakestPatterns,
  getWeakestCategories,
} from '../services/storage';
import { ReadingSessionLog } from '../types/mastery';
import { DailySnapshot } from '../types/mastery';
import { VocabItem } from '../types/vocab';
import { DifficultSentenceItem } from '../types/sentence';
import { ExpressionErrorItem } from '../types/expressionError';
import { Story } from '../types/story';
import {
  Zap, Sparkles, AlertCircle, TrendingUp, BookOpen, Award,
  Volume2, Search, Trash2, FileText, Flame,
  ShieldCheck, Filter, PlayCircle, BarChart3, Globe,
  ChevronDown, ChevronUp, Calendar
} from 'lucide-react';
import { speakText } from '../utils/speech';
import { getTodayDateString } from '../utils/srs';

interface MasteryDashboardViewProps {
  onNavigateToCreate?: () => void;
  savedVocabs?: VocabItem[];
  difficultSentences?: DifficultSentenceItem[];
  expressionErrors?: ExpressionErrorItem[];
  stories?: Story[];
  onMasterVocab?: (vocabId: string) => void;
  onDeleteVocab?: (vocabId: string) => void;
  onDeleteSentence?: (sentenceId: string) => void;
  onDeleteExpressionError?: (errorId: string) => void;
}

type SavedStockTab = 'cards' | 'sentences' | 'errors';
type CardFilterType = 'all' | 'word' | 'pattern' | 'mastered' | 'learning';
type TimeScale = 'daily' | 'weekly' | 'monthly';

interface TrendPoint {
  label: string; // e.g. "9/14", "第36週", "9月"
  wordsRead: number;
  wpm: number;
  overallCefrPct: number;
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

// 日・週・月ごとのトレンド集計ロジック
function aggregateSnapshots(snapshots: DailySnapshot[], scale: TimeScale): TrendPoint[] {
  if (!snapshots || snapshots.length === 0) return [];

  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));

  if (scale === 'daily') {
    return sorted.slice(-14).map(s => {
      const parts = s.date.split('-');
      const label = `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`;
      const avgCefr = Math.round(
        ((s.a1Progress?.overallPct || 0) +
         (s.a2Progress?.overallPct || 0) +
         (s.b1Progress?.overallPct || 0) +
         (s.b2Progress?.overallPct || 0)) / 4
      );
      return {
        label,
        wordsRead: s.wordsRead || 0,
        wpm: s.averageWpm || 0,
        overallCefrPct: avgCefr,
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
      const s = item.latestSnap;
      const avgCefr = Math.round(
        ((s.a1Progress?.overallPct || 0) +
         (s.a2Progress?.overallPct || 0) +
         (s.b1Progress?.overallPct || 0) +
         (s.b2Progress?.overallPct || 0)) / 4
      );
      return {
        label: item.label,
        wordsRead: item.words,
        wpm: avgWpm,
        overallCefrPct: avgCefr,
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
      const s = item.latestSnap;
      const avgCefr = Math.round(
        ((s.a1Progress?.overallPct || 0) +
         (s.a2Progress?.overallPct || 0) +
         (s.b1Progress?.overallPct || 0) +
         (s.b2Progress?.overallPct || 0)) / 4
      );
      return {
        label: item.label,
        wordsRead: item.words,
        wpm: avgWpm,
        overallCefrPct: avgCefr,
        dateKey: key,
      };
    });
  }

  return [];
}

export const MasteryDashboardView: React.FC<MasteryDashboardViewProps> = ({
  onNavigateToCreate,
  savedVocabs = [],
  difficultSentences = [],
  expressionErrors = [],
  stories = [],
  onDeleteVocab,
  onDeleteSentence,
  onDeleteExpressionError,
}) => {
  // マイトロフィー（武器庫）のタブ & フィルター
  const [savedTab, setSavedTab] = useState<SavedStockTab>('cards');
  const [cardFilter, setCardFilter] = useState<CardFilterType>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // リアルCEFR進捗マップの展開状態 & タイムスケール（日/週/月）
  const [isCefrMapExpanded, setIsCefrMapExpanded] = useState(false);
  const [isReadingLogsExpanded, setIsReadingLogsExpanded] = useState(false);
  const [timeScale, setTimeScale] = useState<TimeScale>('weekly');

  // 日次スナップショット & 読了ログの取得
  const [dailySnapshots, setDailySnapshots] = useState<DailySnapshot[]>(() => loadDailySnapshots());
  const [readingLogs, setReadingLogs] = useState<ReadingSessionLog[]>(() => loadReadingSessionLogs());

  const handleDeleteReadingLog = (logId: string) => {
    const { logs, snapshots } = deleteReadingSessionLog(logId);
    setReadingLogs(logs);
    setDailySnapshots(snapshots);
  };
  const allCefrProgress = useMemo(() => computeAllLevelProgress(), []);
  const weakestPatterns = useMemo(() => getWeakestPatterns(5), []);
  const weakestCategories = useMemo(() => getWeakestCategories(), []);

  // 全レベルの平均制覇率
  const overallAvgCefrPct = useMemo(() => {
    return Math.round(
      (allCefrProgress.A1.overallPct +
       allCefrProgress.A2.overallPct +
       allCefrProgress.B1.overallPct +
       allCefrProgress.B2.overallPct) / 4
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
      const isMastered = v.intervalDays >= 21 || v.repetitionCount >= 4;
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

  const maxTrendWords = useMemo(() => {
    return Math.max(...trendData.map(t => t.wordsRead), 500);
  }, [trendData]);

  // 7. 多読マイルストーン判定
  const milestone = useMemo(() => {
    const storiesCount = stories.length;
    const words = totalWordsRead;

    const ranks = [
      { name: '🌱 ビギナー読者', targetWords: 1000, targetStories: 3, desc: '多読の第一歩！短編ストーリーに挑戦中' },
      { name: '🥉 ストーリー探検家', targetWords: 5000, targetStories: 10, desc: '日常的な構文や単語が自然と定着する段階' },
      { name: '🥈 多読ランナー', targetWords: 15000, targetStories: 25, desc: '英語を英語のまま処理する回路が形成中' },
      { name: '🥇 ブックマスター', targetWords: 30000, targetStories: 50, desc: 'ペーパーバック1冊分相当の膨大な英語を読破' },
      { name: '👑 英語脳の達人', targetWords: 100000, targetStories: 100, desc: 'ネイティブ同等の自然な多読力を完全習得' },
    ];

    let currentRankIdx = 0;
    for (let i = 0; i < ranks.length; i++) {
      if (words >= ranks[i].targetWords && storiesCount >= ranks[i].targetStories) {
        currentRankIdx = i;
      }
    }

    const currentRank = ranks[currentRankIdx];
    const nextRank = currentRankIdx < ranks.length - 1 ? ranks[currentRankIdx + 1] : null;

    let progressPct = 100;
    if (nextRank) {
      const wordPct = Math.min(100, Math.round((words / nextRank.targetWords) * 100));
      const storyPct = Math.min(100, Math.round((storiesCount / nextRank.targetStories) * 100));
      progressPct = Math.round((wordPct + storyPct) / 2);
    }

    return {
      currentRank,
      nextRank,
      progressPct,
      storiesCount,
      wordsCount: words,
    };
  }, [stories.length, totalWordsRead]);

  // 8. 1センテンス Ankiカードのフィルタリング & 検索
  const filteredVocabCards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    
    return savedVocabs.filter(card => {
      if (cardFilter === 'word' && card.focusType === 'pattern') return false;
      if (cardFilter === 'pattern' && card.focusType !== 'pattern' && !card.corePatterns?.length) return false;
      
      const isMastered = card.intervalDays >= 21 || card.repetitionCount >= 4;
      if (cardFilter === 'mastered' && !isMastered) return false;
      if (cardFilter === 'learning' && isMastered) return false;

      if (!q) return true;
      const textMatch = 
        (card.sentence && card.sentence.toLowerCase().includes(q)) ||
        (card.exampleSentence && card.exampleSentence.toLowerCase().includes(q)) ||
        (card.phrase && card.phrase.toLowerCase().includes(q)) ||
        (card.meaning && card.meaning.toLowerCase().includes(q)) ||
        (card.translation && card.translation.toLowerCase().includes(q)) ||
        (card.focusWord && card.focusWord.toLowerCase().includes(q)) ||
        (card.corePatterns && card.corePatterns.some(p => 
          p.patternName.toLowerCase().includes(q) ||
          p.formula.toLowerCase().includes(q) ||
          p.meaningTemplate.toLowerCase().includes(q)
        ));

      return textMatch;
    });
  }, [savedVocabs, cardFilter, searchQuery]);

  // 9. 難解文のフィルタリング
  const filteredDifficultSentences = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return difficultSentences.filter(s => {
      if (!q) return true;
      return (
        s.sentence.toLowerCase().includes(q) ||
        s.translation.toLowerCase().includes(q) ||
        (s.highlightedPhrase && s.highlightedPhrase.toLowerCase().includes(q))
      );
    });
  }, [difficultSentences, searchQuery]);

  // 10. 苦手表現のフィルタリング
  const filteredExpressionErrors = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return expressionErrors.filter(err => {
      if (!q) return true;
      return (
        err.userUtterance.toLowerCase().includes(q) ||
        err.naturalExpression.toLowerCase().includes(q) ||
        err.corePattern.toLowerCase().includes(q) ||
        (err.explanation && err.explanation.toLowerCase().includes(q))
      );
    });
  }, [expressionErrors, searchQuery]);

  return (
    <div className="max-w-4xl mx-auto px-3 sm:px-4 py-6 space-y-6">
      {/* 1. TOP HEADER & HUD METRICS (青天井アクティビティ) */}
      <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-5 sm:p-7 shadow-2xl space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center space-x-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-cyan-500 via-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/25 border border-cyan-400/30">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center space-x-2">
                <span>学習進捗 & マイ武器庫</span>
                <Sparkles className="w-4 h-4 text-amber-400" />
              </h2>
              <p className="text-xs text-slate-400">
                読書量・脳内処理速度(WPM)・獲得したセンテンスカードの成長ダッシュボード
              </p>
            </div>
          </div>

          {onNavigateToCreate && (
            <button
              onClick={onNavigateToCreate}
              className="flex items-center space-x-2 px-4 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white rounded-2xl text-xs font-black shadow-lg shadow-cyan-500/20 transition-all hover:scale-105 active:scale-95"
            >
              <PlayCircle className="w-4 h-4" />
              <span>物語で英語多読</span>
            </button>
          )}
        </div>

        {/* 4 Key Stat Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Card 1: 総読了語数 */}
          <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl space-y-1">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[11px] font-bold">総読了語数</span>
              <BookOpen className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="text-xl sm:text-2xl font-black text-white">
              {totalWordsRead.toLocaleString()} <span className="text-xs font-normal text-slate-400">語</span>
            </div>
            <div className="text-[10px] text-cyan-400 font-semibold">
              物語 {stories.length} 冊読破
            </div>
          </div>

          {/* Card 2: 読破スピード (WPM) */}
          <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl space-y-1">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[11px] font-bold">脳内処理速度</span>
              <TrendingUp className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-xl sm:text-2xl font-black text-white">
              {averageWpm > 0 ? averageWpm : '--'} <span className="text-xs font-normal text-slate-400">WPM</span>
            </div>
            <div className={`text-[10px] font-bold ${wpmTier.color}`}>
              {wpmTier.label}
            </div>
          </div>

          {/* Card 3: 連続ストリーク */}
          <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl space-y-1">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[11px] font-bold">学習ストリーク</span>
              <Flame className="w-4 h-4 text-amber-500 fill-amber-500/20" />
            </div>
            <div className="text-xl sm:text-2xl font-black text-white">
              {streakDays} <span className="text-xs font-normal text-slate-400">日連続</span>
            </div>
            <div className="text-[10px] text-amber-400 font-semibold">
              {streakDays > 0 ? '🔥 英語習慣が定着中！' : '今日1話を読んでスタート'}
            </div>
          </div>

          {/* Card 4: マイ武器庫 (Ankiカード) */}
          <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl space-y-1">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[11px] font-bold">センテンス武器庫</span>
              <ShieldCheck className="w-4 h-4 text-purple-400" />
            </div>
            <div className="text-xl sm:text-2xl font-black text-white">
              {savedVocabs.length} <span className="text-xs font-normal text-slate-400">枚</span>
            </div>
            <div className="text-[10px] text-slate-400 flex items-center space-x-1.5 font-semibold">
              <span className="text-emerald-400">定着 {masteredCardsCount}</span>
              <span>/</span>
              <span className="text-amber-400">育成中 {learningCardsCount}</span>
            </div>
          </div>
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
                {/* WPM or Words Badge */}
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

                {/* Vertical Bar */}
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

                {/* Day Label */}
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

      {/* 3. 多読マイルストーン (READING MILESTONE) */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-900/90 to-indigo-950/40 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <Award className="w-5 h-5 text-amber-400" />
            <span className="text-sm font-black text-white">多読マイルストーン</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30 font-bold">
              {milestone.currentRank.name}
            </span>
          </div>

          {milestone.nextRank && (
            <span className="text-xs text-slate-400">
              次のランク: <strong className="text-white">{milestone.nextRank.name}</strong> まであと {Math.max(0, milestone.nextRank.targetWords - milestone.wordsCount).toLocaleString()} 語
            </span>
          )}
        </div>

        {/* Progress Bar */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-[11px] text-slate-300 font-semibold">
            <span>{milestone.currentRank.desc}</span>
            <span className="text-amber-400 font-bold">{milestone.progressPct}%</span>
          </div>
          <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
            <div
              className="h-full bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-300 rounded-full transition-all duration-700 shadow-sm shadow-amber-500/50"
              style={{ width: `${milestone.progressPct}%` }}
            />
          </div>
        </div>
      </div>

            {/* 4. 📖 読了セッション履歴 & ログ管理 (折りたたみ) */}
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
              <div className="py-8 text-center text-xs text-slate-500">
                まだ読了セッションの記録はありません。
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {readingLogs.map((log) => {
                  const d = new Date(log.completedAt);
                  const formattedDate = !isNaN(d.getTime())
                    ? `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
                    : log.dateString;

                  return (
                    <div
                      key={log.id}
                      className="flex items-center justify-between p-3 sm:p-3.5 bg-slate-950/80 border border-slate-800/90 rounded-2xl text-xs hover:border-slate-700 transition-all gap-2"
                    >
                      <div className="flex items-center space-x-2.5 min-w-0 flex-1">
                        <span className="text-[11px] text-slate-400 font-mono shrink-0">
                          {formattedDate}
                        </span>
                        <span className="font-bold text-slate-200 truncate" title={log.storyTitle}>
                          『{log.storyTitle}』
                        </span>
                      </div>

                      <div className="flex items-center space-x-3 shrink-0">
                        <span className="text-slate-300 font-semibold">
                          {log.wordsCount} <span className="text-[10px] text-slate-400">語</span>
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-cyan-950/80 border border-cyan-500/30 text-cyan-300 font-extrabold text-[11px]">
                          {log.wpm} <span className="text-[9px] font-normal">WPM</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDeleteReadingLog(log.id)}
                          className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 rounded-xl transition-colors"
                          title="この読了記録を削除（WPM平均・語数のノイズを除去）"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>


      {/* 4. 🌐 リアルCEFRシラバス進捗マップ (A1〜B2) - 気になったら見に行く折りたたみセクション */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-4 transition-all">
        <button
          onClick={() => setIsCefrMapExpanded(!isCefrMapExpanded)}
          className="w-full flex items-center justify-between text-left group"
        >
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-blue-950 border border-blue-500/30 flex items-center justify-center text-sky-400 group-hover:scale-105 transition-transform">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-sm sm:text-base font-black text-white group-hover:text-sky-300 transition-colors">
                  🌐 リアルCEFRシラバス進捗マップ (A1〜B2)
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-sky-300 border border-blue-500/40 font-bold">
                  全体 {overallAvgCefrPct}% 制覇
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                AIが出題意図を持ってストーリーに組み込み、読破した重要構文・語彙のリアル達成度
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-1.5 text-slate-400 group-hover:text-white transition-colors pl-2">
            <span className="text-xs font-semibold hidden sm:inline">
              {isCefrMapExpanded ? '閉じる' : '進捗を見る'}
            </span>
            {isCefrMapExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </button>

        {isCefrMapExpanded && (
          <div className="pt-4 border-t border-slate-800 space-y-6 animate-fadeIn">
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
                      <div className="flex items-center space-x-1.5">
                        <span className="text-xs font-black text-sky-400">
                          理解 {Math.round(prog.overallPct)}%
                        </span>
                        {typeof prog.overallAssemblyPct === 'number' && (
                          <span className="text-[10px] font-bold text-purple-400 bg-purple-950/60 border border-purple-500/30 px-1 rounded">
                            組立 {Math.round(prog.overallAssemblyPct)}%
                          </span>
                        )}
                      </div>
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
                        {/* 3-Tier Multi-Segment Bar */}
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
                        {typeof prog.patternAssemblyPct === 'number' && (
                          <div className="flex justify-between text-[9px] text-purple-300/80">
                            <span>⚙️ 組立マスター:</span>
                            <span className="font-mono font-bold">{prog.patternAssemblyMastered || 0} ({prog.patternAssemblyPct}%)</span>
                          </div>
                        )}
                      </div>

                      {/* 語彙 3-state */}
                      <div className="space-y-1 pt-1 border-t border-slate-900">
                        <div className="flex justify-between font-semibold">
                          <span>🔤 語彙 ({prog.vocabMastered}/{prog.vocabTotal})</span>
                          <span className="text-slate-300">
                            🟢 {prog.vocabMastered} 🟡 {vocabLearning} ⚪ {prog.vocabUnseen}
                          </span>
                        </div>
                        {/* 3-Tier Multi-Segment Bar */}
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
                        {typeof prog.vocabAssemblyPct === 'number' && (
                          <div className="flex justify-between text-[9px] text-purple-300/80">
                            <span>⚙️ 組立マスター:</span>
                            <span className="font-mono font-bold">{prog.vocabAssemblyMastered || 0} ({prog.vocabAssemblyPct}%)</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Time Scale Trend Graph (日 / 週 / 月) */}
            <div className="p-4 sm:p-5 bg-slate-950/60 border border-slate-800 rounded-2xl space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
                <div className="flex items-center space-x-2">
                  <Calendar className="w-4 h-4 text-sky-400" />
                  <span className="text-xs sm:text-sm font-bold text-white">
                    期間別・CEFR総合進捗推移グラフ
                  </span>
                </div>

                {/* Scale Switcher: Daily / Weekly / Monthly */}
                <div className="flex items-center p-1 bg-slate-900 rounded-xl border border-slate-800 text-[11px] space-x-1">
                  {[
                    { id: 'daily', label: '📅 日次' },
                    { id: 'weekly', label: '📆 週次 (推奨)' },
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

              {/* Trend Chart Bars */}
              {trendData.length === 0 ? (
                <div className="py-8 text-center text-slate-500 text-xs">
                  まだ十分な日次データがありません。ストーリーを読破すると履歴が積み上がります。
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${trendData.length}, minmax(0, 1fr))` }}>
                    {trendData.map((point, idx) => {
                      const barHeight = Math.max(12, Math.min(100, Math.round((point.wordsRead / maxTrendWords) * 100)));

                      return (
                        <div key={idx} className="flex flex-col items-center space-y-1.5">
                          {/* Top CEFR % Badge */}
                          <span className="text-[9px] font-black text-sky-300">
                            {point.overallCefrPct}%
                          </span>

                          {/* Bar */}
                          <div className="w-full bg-slate-900 rounded-lg h-20 p-0.5 flex items-end justify-center border border-slate-800">
                            <div
                              className="w-full bg-gradient-to-t from-blue-600 to-cyan-400 rounded-md transition-all duration-500"
                              style={{ height: `${barHeight}%` }}
                            />
                          </div>

                          {/* Label */}
                          <span className="text-[9px] font-bold text-slate-400 truncate w-full text-center">
                            {point.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <p className="text-[10px] text-slate-500 text-center pt-2">
                    💡 AIがストーリーに組み込んだ構文・重要語彙を読破するたびに、週・月単位で着実に進捗率が成長していきます。
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

            {/* 4.5 🔥 あなたの弱点構文トップ5 (ミス多発・集中特訓) */}
      {weakestPatterns.length > 0 && (
        <div className="bg-gradient-to-br from-rose-950/40 via-slate-900/90 to-slate-900/90 border border-rose-500/30 rounded-3xl p-6 sm:p-8 shadow-xl space-y-5 animate-fadeIn">
          <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-rose-500/20">
            <div className="flex items-center space-x-2.5">
              <div className="w-10 h-10 rounded-2xl bg-rose-600/20 border border-rose-500/30 flex items-center justify-center text-rose-400">
                <Flame className="w-5 h-5 text-rose-400" />
              </div>
              <div>
                <h2 className="text-lg font-black text-white flex items-center gap-2">
                  弱点構文トップ {weakestPatterns.length}
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold">
                    要集中特訓
                  </span>
                </h2>
                <p className="text-xs text-slate-400">
                  ドリルやAnkiでミスが多かった構文です。AIコーチがこのデータを元に特訓してくれます
                </p>
              </div>
            </div>
          </div>

          {/* 文法分野別の弱点サマリー */}
          {weakestCategories.filter(c => c.mistakeCount > 0).length > 0 && (
            <div className="flex items-center space-x-2 flex-wrap gap-y-1.5 pb-2">
              <span className="text-xs font-bold text-slate-400">重点分野:</span>
              {weakestCategories.filter(c => c.mistakeCount > 0).slice(0, 4).map(c => (
                <span key={c.category} className="text-[11px] px-2.5 py-0.5 rounded-lg bg-rose-950/80 border border-rose-500/30 text-rose-300 font-semibold">
                  {c.categoryLabel} ({c.mistakeCount}ミス / 正答率 {c.accuracyRate}%)
                </span>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {weakestPatterns.map(({ pattern, mistakeCount, lastErrorReason }) => (
              <div
                key={pattern.id}
                className="p-4 bg-slate-950/80 border border-rose-500/20 rounded-2xl space-y-2 relative overflow-hidden"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5">
                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-300 font-bold">
                      {pattern.cefr}
                    </span>
                    <span className="text-xs font-bold text-white truncate max-w-[200px]">
                      {pattern.name}
                    </span>
                  </div>
                  <span className="text-xs font-extrabold text-rose-400 bg-rose-950 px-2.5 py-0.5 rounded-lg border border-rose-500/30">
                    ミス: {mistakeCount}回
                  </span>
                </div>

                <div className="text-xs text-slate-300 font-mono bg-slate-900/90 p-2 rounded-xl border border-slate-800">
                  🎯 {pattern.focus}
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                  <span>{pattern.meaning}</span>
                  {lastErrorReason && (
                    <span className="text-rose-300/90 text-[10px]">
                      傾向: {lastErrorReason}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. 🏆 マイ武器庫 (MY ARSENAL: 1-SENTENCE CARDS, DIFFICULT SENTENCES, ERRORS) */}
      <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-5 sm:p-7 shadow-2xl space-y-5">
        {/* Main Tab Switcher: Cards vs Sentences vs Errors */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-2 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
            <button
              onClick={() => setSavedTab('cards')}
              className={`flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                savedTab === 'cards'
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-600/30'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>1センテンス Ankiカード ({savedVocabs.length})</span>
            </button>

            <button
              onClick={() => setSavedTab('sentences')}
              className={`flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                savedTab === 'sentences'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>難解文ストック ({difficultSentences.length})</span>
            </button>

            <button
              onClick={() => setSavedTab('errors')}
              className={`flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                savedTab === 'errors'
                  ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200'
              }`}
            >
              <AlertCircle className="w-3.5 h-3.5" />
              <span>苦手表現 ({expressionErrors.length})</span>
            </button>
          </div>

          {/* Search Box */}
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="武器庫内を瞬時検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 shadow-inner"
            />
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* TAB 1: 1センテンス Ankiカード一覧 */}
        {/* ------------------------------------------------------------- */}
        {savedTab === 'cards' && (
          <div className="space-y-4">
            {/* Filter Pills */}
            <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 text-xs">
              <span className="text-[11px] text-slate-500 font-bold mr-1 flex items-center gap-1">
                <Filter className="w-3 h-3" /> 絞り込み:
              </span>
              {[
                { id: 'all', label: `すべて (${savedVocabs.length})` },
                { id: 'word', label: `🔤 単語重視 (${wordCardsCount})` },
                { id: 'pattern', label: `💡 構文重視 (${patternCardsCount})` },
                { id: 'mastered', label: `👑 定着済 (${masteredCardsCount})` },
                { id: 'learning', label: `🌱 育成中 (${learningCardsCount})` },
              ].map(f => (
                <button
                  key={f.id}
                  onClick={() => setCardFilter(f.id as CardFilterType)}
                  className={`px-3 py-1 rounded-xl font-bold transition-all whitespace-nowrap ${
                    cardFilter === f.id
                      ? 'bg-slate-800 text-cyan-300 border border-cyan-500/40 shadow-sm'
                      : 'bg-slate-950/70 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Cards List */}
            {filteredVocabCards.length === 0 ? (
              <div className="py-16 text-center text-slate-500 text-xs space-y-2">
                <p className="font-bold text-slate-400 text-sm">カードが見つかりませんでした</p>
                <p>ストーリー読書中に引っかかった英文をワンタップでカード化すると、ここに蓄積されます。</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {filteredVocabCards.map(card => {
                  const isMastered = card.intervalDays >= 21 || card.repetitionCount >= 4;
                  const displaySentence = card.sentence || card.exampleSentence || card.phrase;
                  const displayTranslation = card.translation || card.meaning;
                  const directionLabel = card.cardDirection === 'ja_to_en' ? 'JA ➔ EN 作文' : 'EN ➔ JA 読解';
                  const isJaToEn = card.cardDirection === 'ja_to_en';

                  return (
                    <div
                      key={card.id}
                      className="p-4 bg-slate-950/80 border border-slate-800 hover:border-slate-700 rounded-2xl space-y-3 transition-colors shadow-lg"
                    >
                      {/* Top Meta Line */}
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center space-x-2">
                          {/* Card Direction Pill */}
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-md border ${
                            isJaToEn
                              ? 'bg-indigo-950/60 text-indigo-300 border-indigo-500/40'
                              : 'bg-cyan-950/60 text-cyan-300 border-cyan-500/40'
                          }`}>
                            {directionLabel}
                          </span>

                          {/* Focus Type Tag */}
                          {card.focusType === 'pattern' || (card.corePatterns && card.corePatterns.length > 0) ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-950/50 text-amber-300 border border-amber-500/30">
                              💡 構文フォーカス
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-950/50 text-emerald-300 border border-emerald-500/30">
                              🔤 単語: {card.focusWord || card.phrase}
                            </span>
                          )}

                          {/* Mastered Badge */}
                          {isMastered ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-yellow-950/50 text-yellow-300 border border-yellow-500/40 flex items-center gap-1">
                              👑 定着済
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-900 text-slate-400 border border-slate-800">
                              🌱 復習間隔: {card.intervalDays}日 (正解: {card.repetitionCount}回)
                            </span>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center space-x-1">
                          <button
                            onClick={() => speakText(displaySentence)}
                            className="text-slate-400 hover:text-cyan-400 p-1.5 rounded-lg hover:bg-slate-900 transition-colors"
                            title="発音を聞く"
                          >
                            <Volume2 className="w-4 h-4" />
                          </button>
                          {onDeleteVocab && (
                            <button
                              onClick={() => onDeleteVocab(card.id)}
                              className="text-slate-600 hover:text-rose-400 p-1.5 rounded-lg hover:bg-slate-900 transition-colors"
                              title="削除"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Main Sentence Content */}
                      <div className="space-y-1">
                        <p className="text-sm sm:text-base font-bold text-white leading-relaxed">
                          {displaySentence}
                        </p>
                        <p className="text-xs sm:text-sm text-slate-300 font-medium">
                          {displayTranslation}
                        </p>
                      </div>

                      {/* AI Extracted Grammar Hypothesis Box (if pattern) */}
                      {card.corePatterns && card.corePatterns.length > 0 && (
                        <div className="pt-2 border-t border-slate-850 flex flex-wrap gap-2">
                          {card.corePatterns.map((pat, idx) => (
                            <div
                              key={idx}
                              className="text-[11px] px-2.5 py-1 bg-slate-900 border border-slate-800 rounded-xl space-y-0.5 text-slate-300"
                            >
                              <div className="font-mono text-cyan-300 font-bold">
                                {pat.formula}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                {pat.meaningTemplate} {pat.briefNote ? `・ ${pat.briefNote}` : ''}
                              </div>
                            </div>
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

        {/* ------------------------------------------------------------- */}
        {/* TAB 2: 難解文ストック */}
        {/* ------------------------------------------------------------- */}
        {savedTab === 'sentences' && (
          <div className="space-y-3">
            {filteredDifficultSentences.length === 0 ? (
              <div className="py-16 text-center text-slate-500 text-xs">
                難解文のストックはありません。
              </div>
            ) : (
              <div className="space-y-2.5">
                {filteredDifficultSentences.map(s => (
                  <div
                    key={s.id}
                    className="p-4 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-2 hover:border-slate-700 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1 flex-1">
                        <p className="text-xs sm:text-sm font-semibold text-white leading-relaxed">
                          {s.sentence}
                        </p>
                        <p className="text-xs text-slate-400">
                          {s.translation}
                        </p>
                      </div>
                      <div className="flex items-center space-x-1 flex-shrink-0">
                        <button
                          onClick={() => speakText(s.sentence)}
                          className="text-slate-400 hover:text-cyan-400 p-1.5"
                          title="発音を聞く"
                        >
                          <Volume2 className="w-4 h-4" />
                        </button>
                        {onDeleteSentence && (
                          <button
                            onClick={() => onDeleteSentence(s.id)}
                            className="text-slate-600 hover:text-rose-400 p-1.5"
                            title="削除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* TAB 3: 苦手表現ストック */}
        {/* ------------------------------------------------------------- */}
        {savedTab === 'errors' && (
          <div className="space-y-3">
            {filteredExpressionErrors.length === 0 ? (
              <div className="py-16 text-center text-slate-500 text-xs">
                苦手表現の記録はありません。
              </div>
            ) : (
              <div className="space-y-2.5">
                {filteredExpressionErrors.map(err => (
                  <div
                    key={err.id}
                    className="p-4 bg-slate-950/70 border border-rose-500/20 rounded-2xl space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1 flex-1">
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
                          className="text-slate-600 hover:text-rose-400 p-1.5 flex-shrink-0"
                          title="削除"
                        >
                          <Trash2 className="w-4 h-4" />
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
  );
};
