import React, { useState, useMemo } from 'react';
import {
  loadDailySnapshots,
  computeAllLevelProgress,
  loadReadingSessionLogs,
  deleteReadingSessionLog,
  loadSpeechPracticeLogs,
  deleteSpeechPracticeLog,
  loadMyGoal,
  getWeakestPatterns,
} from '../services/storage';
import { ReadingSessionLog, DailySnapshot, SpeechPracticeLog } from '../types/mastery';
import { calculateLabAnalytics } from '../services/listeningLabService';
import { VocabItem } from '../types/vocab';
import { ExpressionErrorItem } from '../types/expressionError';
import { Story } from '../types/story';
import {
  BarChart3, Mic, Trophy, BookOpen, PenTool, Headphones,
  Flame, Calendar, Trash2, ArrowUpRight, ArrowDownRight, Minus, Target
} from 'lucide-react';
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

export type CefrProgressMode = 'comprehension' | 'assembly';

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
      .filter(s => (s.wordsRead && s.wordsRead > 0) || (s.newMasteredVocabsCount && s.newMasteredVocabsCount > 0) || (s.speechUtterancesCount && s.speechUtterancesCount > 0))
      .map(s => s.date)
  );

  const today = new Date();
  const todayKey = formatDateKey(today);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = formatDateKey(yesterday);

  let checkDate = new Date(today);
  if (!activeDates.has(todayKey)) {
    if (activeDates.has(yesterdayKey)) {
      checkDate = yesterday;
    } else {
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

/**
 * 前日比（Delta）バッジコンポーネント
 */
const DeltaBadge: React.FC<{
  value: number;
  unit?: string;
  isPercentage?: boolean;
  prefix?: string;
  inverseColors?: boolean;
}> = ({ value, unit = '', isPercentage = false, prefix = '前日比', inverseColors = false }) => {
  if (value === 0 || isNaN(value)) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.2 rounded-md bg-slate-850 text-slate-400 border border-slate-750">
        <Minus className="w-2.5 h-2.5 text-slate-500" />
        <span>{prefix} ±0</span>
      </span>
    );
  }

  const isPositive = value > 0;
  const formattedVal = Math.abs(value);
  const sign = isPositive ? '+' : '-';
  const displayVal = `${sign}${formattedVal}${isPercentage ? '%' : ''}${unit ? ' ' + unit : ''}`;

  // 通常はプラスが良い (emerald), マイナスが悪い (rose)
  const isGood = inverseColors ? !isPositive : isPositive;

  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] font-mono font-bold px-1.5 py-0.2 rounded-md border ${
        isGood
          ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/30'
          : 'bg-rose-950/60 text-rose-300 border-rose-500/30'
      }`}
    >
      {isPositive ? (
        <ArrowUpRight className="w-2.5 h-2.5 shrink-0" />
      ) : (
        <ArrowDownRight className="w-2.5 h-2.5 shrink-0" />
      )}
      <span>{prefix} {displayVal}</span>
    </span>
  );
};

export const MasteryDashboardView: React.FC<MasteryDashboardViewProps> = ({
  savedVocabs = [],
  stories = [],
}) => {
  // Global States
  const [cefrMode, setCefrMode] = useState<CefrProgressMode>('comprehension');
  const [readingTab, setReadingTab] = useState<'chart' | 'logs'>('chart');
  const [listeningTab, setListeningTab] = useState<'lp_trend' | 'capacity' | 'bottlenecks' | 'recent_lab'>('lp_trend');
  const [speechTab, setSpeechTab] = useState<'chart' | 'logs'>('chart');
  const [cefrTab, setCefrTab] = useState<'levels' | 'timeline' | 'weak_patterns'>('levels');

  // Storage Data
  const [readingLogs, setReadingLogs] = useState<ReadingSessionLog[]>(() => loadReadingSessionLogs());
  const [speechLogs, setSpeechLogs] = useState<SpeechPracticeLog[]>(() => loadSpeechPracticeLogs());
  const dailySnapshots = useMemo(() => loadDailySnapshots(), [readingLogs]);
  const allCefrProgress = useMemo(() => computeAllLevelProgress(), [savedVocabs]);
  const labAnalytics = useMemo(() => calculateLabAnalytics(), []);
  const myGoal = useMemo(() => loadMyGoal(), []);
  const weakestPatterns = useMemo(() => getWeakestPatterns(6), []);

  const todayStr = getTodayDateString();
  const yesterday = new Date(Date.now() - 86400000);
  const yesterdayStr = formatDateKey(yesterday);

  // ---------------------------------------------------------------------------
  // 1. リーディング (Reading) 集計 & 前日比
  // ---------------------------------------------------------------------------
  const readingStats = useMemo(() => {
    const todayLogs = readingLogs.filter(l => l.dateString === todayStr);
    const yesterdayLogs = readingLogs.filter(l => l.dateString === yesterdayStr);

    const todayWords = todayLogs.reduce((acc, l) => acc + (l.wordsCount || 0), 0);
    const yesterdayWords = yesterdayLogs.reduce((acc, l) => acc + (l.wordsCount || 0), 0);
    const deltaWords = todayWords - yesterdayWords;

    const todayValidWpms = todayLogs.map(l => l.wpm).filter(w => w > 0);
    const todayAvgWpm = todayValidWpms.length > 0 ? Math.round(todayValidWpms.reduce((a, b) => a + b, 0) / todayValidWpms.length) : 0;

    const yesterdayValidWpms = yesterdayLogs.map(l => l.wpm).filter(w => w > 0);
    const yesterdayAvgWpm = yesterdayValidWpms.length > 0 ? Math.round(yesterdayValidWpms.reduce((a, b) => a + b, 0) / yesterdayValidWpms.length) : 0;
    const deltaWpm = (todayAvgWpm > 0 && yesterdayAvgWpm > 0) ? todayAvgWpm - yesterdayAvgWpm : (todayAvgWpm > 0 ? todayAvgWpm : 0);

    const last7DaysReading: { date: string; displayDate: string; words: number; wpm: number; isToday: boolean }[] = [];
    let weekTotalWords = 0;

    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = formatDateKey(d);
      const displayDate = `${d.getMonth() + 1}/${d.getDate()}`;
      const snap = dailySnapshots.find(s => s.date === dateStr);
      const dayLogs = readingLogs.filter(l => l.dateString === dateStr);
      const dayWords = dayLogs.reduce((acc, l) => acc + (l.wordsCount || 0), 0) || snap?.wordsRead || 0;
      const dayWpms = dayLogs.map(l => l.wpm).filter(w => w > 0);
      const dayWpm = dayWpms.length > 0 ? Math.round(dayWpms.reduce((a, b) => a + b, 0) / dayWpms.length) : (snap?.averageWpm || 0);

      weekTotalWords += dayWords;
      last7DaysReading.push({
        date: dateStr,
        displayDate,
        words: dayWords,
        wpm: dayWpm,
        isToday: dateStr === todayStr,
      });
    }

    const completedStories = (stories || []).filter(st => st.isRead === true || (st.readCount && st.readCount > 0));
    const totalStoriesCount = completedStories.length;
    const todayCompletedStoriesCount = todayLogs.length;
    const yesterdayCompletedStoriesCount = yesterdayLogs.length;
    const deltaStories = todayCompletedStoriesCount - yesterdayCompletedStoriesCount;

    const maxWords = Math.max(...last7DaysReading.map(d => d.words), 300);

    // 累積総読了語数
    const totalAllWords = readingLogs.reduce((acc, l) => acc + (l.wordsCount || 0), 0) || 
      completedStories.reduce((acc, st) => acc + (st.actualWordCount || st.targetWordCount || 500) * (st.readCount || 1), 0);

    return {
      todayWords,
      deltaWords,
      todayAvgWpm,
      deltaWpm,
      weekTotalWords,
      totalStoriesCount,
      deltaStories,
      totalAllWords,
      last7DaysReading,
      maxWords,
    };
  }, [readingLogs, stories, dailySnapshots, todayStr, yesterdayStr]);

  // ---------------------------------------------------------------------------
  // 2. リスニング (Listening & LP & Story Listening) 集計 & 前日比
  // ---------------------------------------------------------------------------
  const listeningStats = useMemo(() => {
    const todayLP = labAnalytics.todayAverageLP || 0;
    const yesterdayLP = labAnalytics.yesterdayAverageLP || 0;
    const deltaLP = labAnalytics.deltaVsYesterday || (todayLP > 0 && yesterdayLP > 0 ? Math.round((todayLP - yesterdayLP) * 10) / 10 : 0);

    const wordCapacity = labAnalytics.movingAverageWordCapacity || 0;
    const passRate = labAnalytics.perfectPassRate || 0;

    // 今日の問題数 vs 昨日の問題数
    const todayHistory = labAnalytics.dailyHistory.find(d => d.dateString === todayStr);
    const yesterdayHistory = labAnalytics.dailyHistory.find(d => d.dateString === yesterdayStr);
    const todayQuestionCount = todayHistory?.questionCount || 0;
    const yesterdayQuestionCount = yesterdayHistory?.questionCount || 0;
    const deltaQuestions = todayQuestionCount - yesterdayQuestionCount;

    // ストーリー初見リスニング集計
    const completedListeningStories = (stories || []).filter(s => s.listeningStatus === 'completed' && s.listeningMetrics);
    const totalListenedStories = completedListeningStories.length;
    
    let totalChunks = 0;
    let totalLatencyMs = 0;
    let sumFirstPassRates = 0;
    let sumEffectiveWpms = 0;
    let validWpmCount = 0;
    const allBottlenecks: Array<{
      storyTitle: string;
      unitIdx: number;
      textEn: string;
      translationJa: string;
      retryCount: number;
      revealedEnglish: boolean;
      elapsedMs: number;
    }> = [];

    completedListeningStories.forEach(s => {
      const m = s.listeningMetrics!;
      totalChunks += m.totalChunks || 0;
      totalLatencyMs += (m.avgChunkLatencyMs || 0) * (m.totalChunks || 1);
      
      if (typeof m.firstPassRate === 'number') {
        sumFirstPassRates += m.firstPassRate;
      }
      if (m.effectiveListeningWpm && m.effectiveListeningWpm > 0) {
        sumEffectiveWpms += m.effectiveListeningWpm;
        validWpmCount++;
      }
      if (m.unitLogs) {
        m.unitLogs
          .filter(l => l.retryCount >= 1 || l.revealedEnglish || (l.rating !== undefined && l.rating <= 2))
          .forEach(l => {
            allBottlenecks.push({
              storyTitle: s.title,
              unitIdx: l.unitIdx,
              textEn: l.textEn,
              translationJa: l.translationJa,
              retryCount: l.retryCount,
              revealedEnglish: l.revealedEnglish,
              elapsedMs: l.elapsedMs,
            });
          });
      }
    });

    const avgChunkLatencyMs = totalChunks > 0 ? Math.round(totalLatencyMs / totalChunks) : 0;
    const avgFirstPassRate = totalListenedStories > 0 ? Math.round(sumFirstPassRates / totalListenedStories) : 100;
    const avgEffectiveListeningWpm = validWpmCount > 0 ? Math.round(sumEffectiveWpms / validWpmCount) : 0;

    // 7日間LP推移
    const last7DaysLP: { date: string; displayDate: string; avgLP: number; count: number; isToday: boolean }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = formatDateKey(d);
      const displayDate = `${d.getMonth() + 1}/${d.getDate()}`;
      const hist = labAnalytics.dailyHistory.find(h => h.dateString === dateStr);
      last7DaysLP.push({
        date: dateStr,
        displayDate,
        avgLP: hist?.avgLP || 0,
        count: hist?.questionCount || 0,
        isToday: dateStr === todayStr,
      });
    }

    const maxDailyLP = Math.max(...last7DaysLP.map(d => d.avgLP), 60);

    return {
      todayLP,
      yesterdayLP,
      deltaLP,
      wordCapacity,
      passRate,
      todayQuestionCount,
      deltaQuestions,
      totalListenedStories,
      avgChunkLatencyMs,
      avgFirstPassRate,
      avgEffectiveListeningWpm,
      allBottlenecks,
      last7DaysLP,
      maxDailyLP,
      wordCountStats: labAnalytics.wordCountStats,
      recentRecords: labAnalytics.recentRecords,
    };
  }, [labAnalytics, stories, todayStr, yesterdayStr]);

  // ---------------------------------------------------------------------------
  // 3. 発話・シャドーイング (Speech) 集計 & 前日比
  // ---------------------------------------------------------------------------
  const speechStats = useMemo(() => {
    const todayLogs = speechLogs.filter(l => l.dateString === todayStr);
    const yesterdayLogs = speechLogs.filter(l => l.dateString === yesterdayStr);

    const todayUtterances = todayLogs.length;
    const yesterdayUtterances = yesterdayLogs.length;
    const deltaUtterances = todayUtterances - yesterdayUtterances;

    const todayShadowing = todayLogs.filter(l => l.subStep === 'shadowing').length;
    const yesterdayShadowing = yesterdayLogs.filter(l => l.subStep === 'shadowing').length;
    const deltaShadowing = todayShadowing - yesterdayShadowing;

    const todayOverlapping = todayLogs.filter(l => l.subStep === 'overlapping').length;
    const yesterdayOverlapping = yesterdayLogs.filter(l => l.subStep === 'overlapping').length;
    const deltaOverlapping = todayOverlapping - yesterdayOverlapping;

    const totalUtterances = speechLogs.length;
    const totalUniqueSentences = new Set(
      speechLogs.map(l => (l.sentenceText && l.sentenceText.trim().length > 0 ? l.sentenceText.trim().toLowerCase() : `${l.storyId}_${l.sentenceIdx}`))
    ).size;

    const last7DaysSpeech: { 
      date: string; 
      displayDate: string; 
      total: number; 
      shadowing: number; 
      overlapping: number; 
      isToday: boolean 
    }[] = [];

    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = formatDateKey(d);
      const displayDate = `${d.getMonth() + 1}/${d.getDate()}`;
      const dayLogs = speechLogs.filter(l => l.dateString === dateStr);
      const sCount = dayLogs.filter(l => l.subStep === 'shadowing').length;
      const oCount = dayLogs.filter(l => l.subStep === 'overlapping').length;
      const tCount = dayLogs.length;

      last7DaysSpeech.push({
        date: dateStr,
        displayDate,
        total: tCount,
        shadowing: sCount,
        overlapping: oCount,
        isToday: dateStr === todayStr,
      });
    }

    const maxUtterances = Math.max(...last7DaysSpeech.map(d => d.total), 20);

    return {
      todayUtterances,
      deltaUtterances,
      todayShadowing,
      deltaShadowing,
      todayOverlapping,
      deltaOverlapping,
      totalUtterances,
      totalUniqueSentences,
      last7DaysSpeech,
      maxUtterances,
    };
  }, [speechLogs, todayStr, yesterdayStr]);

  // ---------------------------------------------------------------------------
  // 4. CEFR 習得度 (CEFR Mastery) 集計 (理解 / 組立の完全連動 & 前日比)
  // ---------------------------------------------------------------------------
  const cefrStats = useMemo(() => {
    const isComprehension = cefrMode === 'comprehension';

    // 1. 今日のレベル別実績値
    const levels = (['A1', 'A2', 'B1', 'B2'] as const).map(lvl => {
      const data = allCefrProgress[lvl];
      const patternMastered = isComprehension ? (data.patternMastered || 0) : (data.patternAssemblyMastered || 0);
      const vocabMastered = isComprehension ? (data.vocabMastered || 0) : (data.vocabAssemblyMastered || 0);
      const totalMastered = patternMastered + vocabMastered;

      const patternTotal = data.patternTotal || 1;
      const vocabTotal = data.vocabTotal || 1;
      const totalItems = patternTotal + vocabTotal;

      const patternLapsed = data.patternLapsed || 0;
      const vocabLapsed = data.vocabLapsed || 0;
      const patternExposed = data.patternExposed || 0;
      const vocabExposed = data.vocabExposed || 0;
      const totalLearning = patternLapsed + vocabLapsed + patternExposed + vocabExposed;
      const totalUnseen = Math.max(0, totalItems - totalMastered - totalLearning);

      const masteredPct = Math.round((totalMastered / totalItems) * 100);
      const learningPct = Math.round((totalLearning / totalItems) * 100);
      const unseenPct = Math.max(0, 100 - masteredPct - learningPct);

      return {
        level: lvl,
        patternMastered,
        patternTotal,
        vocabMastered,
        vocabTotal,
        totalMastered,
        totalLearning,
        totalUnseen,
        totalItems,
        masteredPct,
        learningPct,
        unseenPct,
        overallPct: isComprehension ? data.overallPct : data.overallAssemblyPct,
      };
    });

    const totalMasteredItems = levels.reduce((acc, l) => acc + l.totalMastered, 0);
    const totalPatternMastered = levels.reduce((acc, l) => acc + l.patternMastered, 0);
    const totalVocabMastered = levels.reduce((acc, l) => acc + l.vocabMastered, 0);

    // 2. 昨日のスナップショットとの比較による前日比
    const yesterdaySnap = dailySnapshots.find(s => s.date === yesterdayStr);
    let yesterdayTotalMastered = 0;
    let yesterdayPatternMastered = 0;
    let yesterdayVocabMastered = 0;

    if (yesterdaySnap) {
      const yA1 = yesterdaySnap.a1Progress;
      const yA2 = yesterdaySnap.a2Progress;
      const yB1 = yesterdaySnap.b1Progress;
      const yB2 = yesterdaySnap.b2Progress;

      if (isComprehension) {
        yesterdayPatternMastered = (yA1?.patternMastered || 0) + (yA2?.patternMastered || 0) + (yB1?.patternMastered || 0) + (yB2?.patternMastered || 0);
        yesterdayVocabMastered = (yA1?.vocabMastered || 0) + (yA2?.vocabMastered || 0) + (yB1?.vocabMastered || 0) + (yB2?.vocabMastered || 0);
      } else {
        yesterdayPatternMastered = (yA1?.patternAssemblyMastered || 0) + (yA2?.patternAssemblyMastered || 0) + (yB1?.patternAssemblyMastered || 0) + (yB2?.patternAssemblyMastered || 0);
        yesterdayVocabMastered = (yA1?.vocabAssemblyMastered || 0) + (yA2?.vocabAssemblyMastered || 0) + (yB1?.vocabAssemblyMastered || 0) + (yB2?.vocabAssemblyMastered || 0);
      }
      yesterdayTotalMastered = yesterdayPatternMastered + yesterdayVocabMastered;
    }

    const deltaTotalMastered = yesterdayTotalMastered > 0 ? totalMasteredItems - yesterdayTotalMastered : 0;
    const deltaPatternMastered = yesterdayPatternMastered > 0 ? totalPatternMastered - yesterdayPatternMastered : 0;
    const deltaVocabMastered = yesterdayVocabMastered > 0 ? totalVocabMastered - yesterdayVocabMastered : 0;

    // 現在のターゲットCEFRレベル
    const targetLvl = (myGoal?.targetCefr || 'A2') as 'A1' | 'A2' | 'B1' | 'B2';
    const targetData = levels.find(l => l.level === targetLvl) || levels[1];
    const targetPct = targetData.masteredPct;

    let deltaTargetPct = 0;
    if (yesterdaySnap) {
      const yTarget = targetLvl === 'A1' ? yesterdaySnap.a1Progress : targetLvl === 'A2' ? yesterdaySnap.a2Progress : targetLvl === 'B1' ? yesterdaySnap.b1Progress : yesterdaySnap.b2Progress;
      const yTargetMastered = isComprehension
        ? (yTarget?.patternMastered || 0) + (yTarget?.vocabMastered || 0)
        : (yTarget?.patternAssemblyMastered || 0) + (yTarget?.vocabAssemblyMastered || 0);
      const yTargetTotal = (yTarget?.patternTotal || 1) + (yTarget?.vocabTotal || 1);
      const yPct = Math.round((yTargetMastered / yTargetTotal) * 100);
      deltaTargetPct = targetPct - yPct;
    }

    // 日次積み上げ推移
    const dailyBreakdowns = dailySnapshots.slice(-10).map(snap => {
      const p1 = snap.a1Progress;
      const p2 = snap.a2Progress;
      const p3 = snap.b1Progress;
      const p4 = snap.b2Progress;

      const mCount = isComprehension
        ? (p1?.patternMastered || 0) + (p1?.vocabMastered || 0) +
          (p2?.patternMastered || 0) + (p2?.vocabMastered || 0) +
          (p3?.patternMastered || 0) + (p3?.vocabMastered || 0) +
          (p4?.patternMastered || 0) + (p4?.vocabMastered || 0)
        : (p1?.patternAssemblyMastered || 0) + (p1?.vocabAssemblyMastered || 0) +
          (p2?.patternAssemblyMastered || 0) + (p2?.vocabAssemblyMastered || 0) +
          (p3?.patternAssemblyMastered || 0) + (p3?.vocabAssemblyMastered || 0) +
          (p4?.patternAssemblyMastered || 0) + (p4?.vocabAssemblyMastered || 0);

      const lCount = (p1?.patternLapsed || 0) + (p1?.vocabLapsed || 0) +
                     (p2?.patternLapsed || 0) + (p2?.vocabLapsed || 0) +
                     (p3?.patternLapsed || 0) + (p3?.vocabLapsed || 0) +
                     (p4?.patternLapsed || 0) + (p4?.vocabLapsed || 0);

      const tItems = ((p1?.patternTotal || 0) + (p1?.vocabTotal || 0) +
                      (p2?.patternTotal || 0) + (p2?.vocabTotal || 0) +
                      (p3?.patternTotal || 0) + (p3?.vocabTotal || 0) +
                      (p4?.patternTotal || 0) + (p4?.vocabTotal || 0)) || 1000;

      return {
        date: snap.date,
        displayDate: snap.date.slice(5),
        mastered: mCount,
        learning: lCount,
        unseen: Math.max(0, tItems - mCount - lCount),
        total: tItems,
        pct: Math.round((mCount / tItems) * 100),
      };
    });

    return {
      levels,
      totalMasteredItems,
      deltaTotalMastered,
      targetLvl,
      targetPct,
      deltaTargetPct,
      totalPatternMastered,
      deltaPatternMastered,
      totalVocabMastered,
      deltaVocabMastered,
      dailyBreakdowns,
    };
  }, [cefrMode, allCefrProgress, dailySnapshots, myGoal, yesterdayStr]);

  // 連続学習ストリーク
  const streakDays = useMemo(() => computeDailyStreak(dailySnapshots), [dailySnapshots]);

  // 読了ログ削除
  const handleDeleteReadingLog = (logId: string) => {
    if (window.confirm('この読了セッションログを削除しますか？')) {
      const updated = deleteReadingSessionLog(logId);
      setReadingLogs(updated.logs);
    }
  };

  // 発話ログ削除
  const handleDeleteSpeechLog = (logId: string) => {
    if (window.confirm('この発話ログを削除しますか？')) {
      const { logs } = deleteSpeechPracticeLog(logId);
      setSpeechLogs(logs);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-6 py-6 space-y-7 pb-24 animate-fadeIn text-slate-100 font-sans">
      
      {/* =========================================================================
          TOP GLOBAL HERO HUD: ストリーク & 総合情報処理パワー
         ========================================================================= */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-950/60 border border-slate-800 rounded-3xl p-4 sm:p-6 shadow-2xl flex items-center justify-between flex-wrap gap-4 relative overflow-hidden">
        <div className="flex items-center space-x-3 sm:space-x-4 min-w-0">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center text-white shadow-lg shadow-amber-500/25 shrink-0 animate-pulse">
            <Flame className="w-7 h-7" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-lg sm:text-xl font-black text-white tracking-tight truncate">
                学習アナリティクス & 認知負荷ダッシュボード
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                リアルタイム同期
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              リーディング・リスニング・発話・CEFR習得度の4大認知指標と前日比を追跡
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 sm:gap-4 shrink-0">
          {/* Streak Indicator */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-2xl px-4 py-2.5 flex items-center gap-2.5">
            <Flame className="w-5 h-5 text-amber-400" />
            <div>
              <span className="text-[10px] text-slate-400 block font-semibold">連続学習</span>
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-black text-amber-300 font-mono">{streakDays}</span>
                <span className="text-[11px] text-slate-400 font-bold">日</span>
              </div>
            </div>
          </div>

          {/* Goal Indicator */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-2xl px-4 py-2.5 flex items-center gap-2.5">
            <Target className="w-5 h-5 text-cyan-400" />
            <div>
              <span className="text-[10px] text-slate-400 block font-semibold">目標レベル</span>
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-black text-cyan-300 font-mono">{cefrStats.targetLvl}</span>
                <span className="text-[11px] text-emerald-400 font-bold font-mono">({cefrStats.targetPct}%)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* =========================================================================
          CARD 1: 📖 リーディング分析 (Reading Analysis)
         ========================================================================= */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-5 relative">
        {/* Card Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3.5 flex-wrap gap-2">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                <span>📖 リーディング分析</span>
              </h3>
              <span className="text-[11px] text-slate-400">頭から英語の語順で理解する直読直解スピード ＆ 読書量</span>
            </div>
          </div>

          {/* Sub-Tab Switcher */}
          <div className="flex items-center p-1 bg-slate-950 rounded-2xl border border-slate-800 text-xs">
            <button
              onClick={() => setReadingTab('chart')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                readingTab === 'chart'
                  ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>7日間推移 & WPM</span>
            </button>
            <button
              onClick={() => setReadingTab('logs')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                readingTab === 'logs'
                  ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>読了履歴 ({readingLogs.length})</span>
            </button>
          </div>
        </div>

        {/* 4 Quick Metrics Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Quick Metric 1 */}
          <div className="bg-slate-950/80 p-3.5 sm:p-4 rounded-2xl border border-slate-800/80 space-y-1">
            <span className="text-[11px] font-semibold text-slate-400 block">今日の読書語数</span>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl sm:text-3xl font-black text-white font-mono">{readingStats.todayWords.toLocaleString()}</span>
              <span className="text-xs font-bold text-cyan-400">語</span>
            </div>
            <DeltaBadge value={readingStats.deltaWords} unit="語" />
          </div>

          {/* Quick Metric 2 */}
          <div className="bg-slate-950/80 p-3.5 sm:p-4 rounded-2xl border border-slate-800/80 space-y-1">
            <span className="text-[11px] font-semibold text-slate-400 block">読書スピード (WPM)</span>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl sm:text-3xl font-black text-amber-300 font-mono">
                {readingStats.todayAvgWpm > 0 ? readingStats.todayAvgWpm : '-'}
              </span>
              <span className="text-xs font-bold text-amber-400">WPM</span>
            </div>
            <DeltaBadge value={readingStats.deltaWpm} />
          </div>

          {/* Quick Metric 3 */}
          <div className="bg-slate-950/80 p-3.5 sm:p-4 rounded-2xl border border-slate-800/80 space-y-1">
            <span className="text-[11px] font-semibold text-slate-400 block">直近7日間の総読書量</span>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl sm:text-3xl font-black text-white font-mono">{readingStats.weekTotalWords.toLocaleString()}</span>
              <span className="text-xs font-bold text-cyan-400">語</span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono block">累積: {readingStats.totalAllWords.toLocaleString()} 語</span>
          </div>

          {/* Quick Metric 4 */}
          <div className="bg-slate-950/80 p-3.5 sm:p-4 rounded-2xl border border-slate-800/80 space-y-1">
            <span className="text-[11px] font-semibold text-slate-400 block">読破ストーリー数</span>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl sm:text-3xl font-black text-white font-mono">{readingStats.totalStoriesCount}</span>
              <span className="text-xs font-bold text-cyan-400">冊</span>
            </div>
            <DeltaBadge value={readingStats.deltaStories} unit="冊" prefix="今日" />
          </div>
        </div>

        {/* Visual / Detail Content */}
        {readingTab === 'chart' ? (
          <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-850 space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-semibold">直近7日間の日次読書語数 ＆ WPM</span>
              <span className="text-[11px] text-slate-500 font-mono">最高 {readingStats.maxWords} 語/日</span>
            </div>

            <div className="grid grid-cols-7 gap-2 sm:gap-3 pt-2">
              {readingStats.last7DaysReading.map((d, i) => {
                const heightPct = Math.min(100, Math.round((d.words / readingStats.maxWords) * 100));
                return (
                  <div key={i} className="flex flex-col items-center space-y-2 group">
                    <span className="text-[10px] font-mono text-cyan-300 font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                      {d.words}
                    </span>
                    <div className="w-full bg-slate-900 rounded-xl h-28 flex flex-col justify-end p-1 relative overflow-hidden border border-slate-800 group-hover:border-cyan-500/40 transition-colors">
                      <div
                        className={`w-full rounded-lg transition-all duration-500 ${
                          d.isToday
                            ? 'bg-gradient-to-t from-cyan-600 to-blue-500 shadow-md shadow-cyan-500/30'
                            : d.words > 0
                            ? 'bg-slate-700 group-hover:bg-cyan-600/80'
                            : 'bg-transparent'
                        }`}
                        style={{ height: `${Math.max(4, heightPct)}%` }}
                      />
                    </div>
                    <div className="text-center">
                      <span className={`text-[11px] font-mono block ${d.isToday ? 'text-cyan-400 font-black' : 'text-slate-400'}`}>
                        {d.displayDate}
                      </span>
                      <span className="text-[10px] font-mono text-amber-400/80 block">
                        {d.wpm > 0 ? `${d.wpm}w` : '-'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-850 space-y-2 max-h-72 overflow-y-auto custom-scrollbar">
            {readingLogs.length === 0 ? (
              <p className="text-center py-6 text-xs text-slate-500">読了セッション履歴はまだありません。</p>
            ) : (
              readingLogs.map((log) => (
                <div key={log.id} className="flex items-center justify-between p-2.5 bg-slate-900/80 border border-slate-800 rounded-xl text-xs hover:border-slate-700 transition-colors">
                  <div className="min-w-0 flex-1 pr-2">
                    <span className="font-bold text-white block truncate">{log.storyTitle}</span>
                    <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono mt-0.5">
                      <span>{log.dateString || log.completedAt.slice(0, 10)}</span>
                      <span>•</span>
                      <span className="text-cyan-400 font-bold">{log.wordsCount} 語</span>
                      <span>•</span>
                      <span className="text-amber-300 font-bold">{log.wpm} WPM</span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteReadingLog(log.id)}
                    className="p-1 text-slate-500 hover:text-rose-400 rounded transition-colors cursor-pointer"
                    title="ログを削除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* =========================================================================
          CARD 2: 🎧 リスニング分析 (Listening & LP & Story Listening)
         ========================================================================= */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-5 relative">
        {/* Card Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3.5 flex-wrap gap-2">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <Headphones className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                <span>🎧 リスニング分析 (特訓ラボ & 初見聴解)</span>
              </h3>
              <span className="text-[11px] text-slate-400">聴覚ワーキングメモリ（文長バッファ）＆ 音声変化・実効情報処理能力</span>
            </div>
          </div>

          {/* Sub-Tab Switcher */}
          <div className="flex items-center p-1 bg-slate-950 rounded-2xl border border-slate-800 text-xs flex-wrap gap-1">
            <button
              onClick={() => setListeningTab('lp_trend')}
              className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                listeningTab === 'lp_trend'
                  ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              7日間LP推移
            </button>
            <button
              onClick={() => setListeningTab('capacity')}
              className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                listeningTab === 'capacity'
                  ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              文長別突破率
            </button>
            <button
              onClick={() => setListeningTab('bottlenecks')}
              className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                listeningTab === 'bottlenecks'
                  ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              初見聴解 & ボトルネック
            </button>
            <button
              onClick={() => setListeningTab('recent_lab')}
              className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                listeningTab === 'recent_lab'
                  ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              出題履歴
            </button>
          </div>
        </div>

        {/* 4 Quick Metrics Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Quick Metric 1: Listening Power (LP) */}
          <div className="bg-slate-950/80 p-3.5 sm:p-4 rounded-2xl border border-slate-800/80 space-y-1">
            <span className="text-[11px] font-semibold text-slate-400 block">今日平均 LP (聴覚パワー)</span>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl sm:text-3xl font-black text-purple-300 font-mono">
                {listeningStats.todayLP > 0 ? listeningStats.todayLP : '-'}
              </span>
              <span className="text-xs font-bold text-purple-400">LP</span>
            </div>
            <DeltaBadge value={listeningStats.deltaLP} unit="LP" />
          </div>

          {/* Quick Metric 2: Word Capacity Buffer */}
          <div className="bg-slate-950/80 p-3.5 sm:p-4 rounded-2xl border border-slate-800/80 space-y-1">
            <span className="text-[11px] font-semibold text-slate-400 block">単語処理バッファ能力</span>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl sm:text-3xl font-black text-cyan-300 font-mono">
                {listeningStats.wordCapacity > 0 ? listeningStats.wordCapacity : '-'}
              </span>
              <span className="text-xs font-bold text-cyan-400">語/文</span>
            </div>
            <span className="text-[10px] text-slate-500 block">リアルタイム脳内保持限界</span>
          </div>

          {/* Quick Metric 3: Perfect Pass Rate */}
          <div className="bg-slate-950/80 p-3.5 sm:p-4 rounded-2xl border border-slate-800/80 space-y-1">
            <span className="text-[11px] font-semibold text-slate-400 block">完全突破率 (1発聞き取り)</span>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono">
                {listeningStats.passRate}%
              </span>
            </div>
            <span className="text-[10px] text-slate-500 block">脱落・未知語なしパス</span>
          </div>

          {/* Quick Metric 4: Question Count */}
          <div className="bg-slate-950/80 p-3.5 sm:p-4 rounded-2xl border border-slate-800/80 space-y-1">
            <span className="text-[11px] font-semibold text-slate-400 block">今日のリスニング問題数</span>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl sm:text-3xl font-black text-white font-mono">{listeningStats.todayQuestionCount}</span>
              <span className="text-xs font-bold text-purple-400">問</span>
            </div>
            <DeltaBadge value={listeningStats.deltaQuestions} unit="問" />
          </div>
        </div>

        {/* Visual / Detail Content */}
        {listeningTab === 'lp_trend' && (
          <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-850 space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-semibold">直近7日間の平均LPスコア ＆ 出題数推移</span>
              <span className="text-[11px] text-slate-500 font-mono">最高 {listeningStats.maxDailyLP} LP</span>
            </div>

            <div className="grid grid-cols-7 gap-2 sm:gap-3 pt-2">
              {listeningStats.last7DaysLP.map((d, i) => {
                const heightPct = Math.min(100, Math.round((d.avgLP / listeningStats.maxDailyLP) * 100));
                return (
                  <div key={i} className="flex flex-col items-center space-y-2 group">
                    <span className="text-[10px] font-mono text-purple-300 font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                      {d.avgLP} LP
                    </span>
                    <div className="w-full bg-slate-900 rounded-xl h-28 flex flex-col justify-end p-1 relative overflow-hidden border border-slate-800 group-hover:border-purple-500/40 transition-colors">
                      <div
                        className={`w-full rounded-lg transition-all duration-500 ${
                          d.isToday
                            ? 'bg-gradient-to-t from-purple-600 to-indigo-500 shadow-md shadow-purple-500/30'
                            : d.avgLP > 0
                            ? 'bg-slate-700 group-hover:bg-purple-600/80'
                            : 'bg-transparent'
                        }`}
                        style={{ height: `${Math.max(4, heightPct)}%` }}
                      />
                    </div>
                    <div className="text-center">
                      <span className={`text-[11px] font-mono block ${d.isToday ? 'text-purple-400 font-black' : 'text-slate-400'}`}>
                        {d.displayDate}
                      </span>
                      <span className="text-[10px] font-mono text-slate-500 block">
                        {d.count > 0 ? `${d.count}問` : '-'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {listeningTab === 'capacity' && (
          <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-850 space-y-3">
            <span className="text-xs font-semibold text-slate-300 block">目標単語数（文長）ごとの完全突破率 ＆ 平均LP</span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {[4, 6, 8, 10, 12, 14, 16, 20].map(wc => {
                const stat = listeningStats.wordCountStats[wc] || { attempts: 0, perfectCount: 0, passRate: 0, avgLP: 0 };
                return (
                  <div key={wc} className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono font-bold text-white">{wc} 語文</span>
                      <span className={`font-bold font-mono ${stat.passRate >= 75 ? 'text-emerald-400' : stat.passRate >= 50 ? 'text-amber-400' : 'text-slate-400'}`}>
                        {stat.passRate}%
                      </span>
                    </div>
                    <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden">
                      <div className="bg-purple-500 h-full rounded-full transition-all" style={{ width: `${stat.passRate}%` }} />
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono pt-0.5">
                      <span>挑戦: {stat.attempts}回</span>
                      <span>平均 {stat.avgLP} LP</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {listeningTab === 'bottlenecks' && (
          <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-850 space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="p-2.5 bg-slate-900 rounded-xl border border-slate-800">
                <span className="text-slate-400 text-[10px] block">初見読破ストーリー</span>
                <span className="text-base font-bold text-white font-mono">{listeningStats.totalListenedStories} 冊</span>
              </div>
              <div className="p-2.5 bg-slate-900 rounded-xl border border-slate-800">
                <span className="text-slate-400 text-[10px] block">平均応答遅延</span>
                <span className="text-base font-bold text-cyan-300 font-mono">{listeningStats.avgChunkLatencyMs} ms</span>
              </div>
              <div className="p-2.5 bg-slate-900 rounded-xl border border-slate-800">
                <span className="text-slate-400 text-[10px] block">実効聴覚WPM</span>
                <span className="text-base font-bold text-purple-300 font-mono">{listeningStats.avgEffectiveListeningWpm || '-'} WPM</span>
              </div>
            </div>

            <div className="space-y-1.5 max-h-56 overflow-y-auto custom-scrollbar">
              <span className="text-[11px] font-bold text-slate-400 block pt-1">聞き逃し・リトライ発生箇所 ({listeningStats.allBottlenecks.length}件):</span>
              {listeningStats.allBottlenecks.length === 0 ? (
                <p className="text-center py-4 text-xs text-slate-500">聞き逃しやリトライの記録はありません。スムーズに聴解できています！</p>
              ) : (
                listeningStats.allBottlenecks.map((b, idx) => (
                  <div key={idx} className="p-2.5 bg-slate-900/90 border border-slate-800 rounded-xl text-xs flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <span className="font-serif font-bold text-slate-200 block truncate">{b.textEn}</span>
                      <span className="text-[10px] text-slate-400 truncate block">{b.translationJa}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 text-[10px] font-mono">
                      <span className="px-1.5 py-0.5 rounded bg-rose-950/80 text-rose-300 border border-rose-800">
                        {b.retryCount}回リトライ
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {listeningTab === 'recent_lab' && (
          <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-850 space-y-2 max-h-72 overflow-y-auto custom-scrollbar">
            {listeningStats.recentRecords.length === 0 ? (
              <p className="text-center py-6 text-xs text-slate-500">リスニング特訓ラボの履歴はまだありません。</p>
            ) : (
              listeningStats.recentRecords.map((rec) => (
                <div key={rec.id} className="p-2.5 bg-slate-900/80 border border-slate-800 rounded-xl text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold font-mono ${rec.isPerfect ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-rose-950 text-rose-300 border border-rose-800'}`}>
                        {rec.isPerfect ? '🟢 1発突破' : '🔴 音脱落'}
                      </span>
                      <span className="text-[10px] font-mono text-slate-500">{rec.wordCount}語 / {rec.speedRate}x</span>
                    </div>
                    <span className="text-[10px] font-mono text-purple-300 font-bold">
                      {rec.listeningPowerScore ? `${rec.listeningPowerScore} LP` : '-'}
                    </span>
                  </div>
                  <p className="font-serif font-bold text-white">{rec.sentenceEn}</p>
                  <p className="text-[10px] text-slate-400">{rec.translationJa}</p>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* =========================================================================
          CARD 3: 🗣️ 発話・シャドーイング分析 (Speech & Shadowing)
         ========================================================================= */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-5 relative">
        {/* Card Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3.5 flex-wrap gap-2">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Mic className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                <span>🗣️ 発話・シャドーイング分析</span>
              </h3>
              <span className="text-[11px] text-slate-400">ストーリー音読・シャドーイング ＆ Anki発話特訓の積算量</span>
            </div>
          </div>

          {/* Sub-Tab Switcher */}
          <div className="flex items-center p-1 bg-slate-950 rounded-2xl border border-slate-800 text-xs">
            <button
              onClick={() => setSpeechTab('chart')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                speechTab === 'chart'
                  ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>7日間発話推移</span>
            </button>
            <button
              onClick={() => setSpeechTab('logs')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                speechTab === 'logs'
                  ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>発話詳細ログ ({speechLogs.length})</span>
            </button>
          </div>
        </div>

        {/* 4 Quick Metrics Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Quick Metric 1: Today's Utterances */}
          <div className="bg-slate-950/80 p-3.5 sm:p-4 rounded-2xl border border-slate-800/80 space-y-1">
            <span className="text-[11px] font-semibold text-slate-400 block">今日の発話量</span>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl sm:text-3xl font-black text-indigo-300 font-mono">{speechStats.todayUtterances}</span>
              <span className="text-xs font-bold text-indigo-400">回</span>
            </div>
            <DeltaBadge value={speechStats.deltaUtterances} unit="回" />
          </div>

          {/* Quick Metric 2: Shadowing Count */}
          <div className="bg-slate-950/80 p-3.5 sm:p-4 rounded-2xl border border-slate-800/80 space-y-1">
            <span className="text-[11px] font-semibold text-slate-400 block">シャドーイング回数</span>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl sm:text-3xl font-black text-purple-300 font-mono">{speechStats.todayShadowing}</span>
              <span className="text-xs font-bold text-purple-400">回</span>
            </div>
            <DeltaBadge value={speechStats.deltaShadowing} unit="回" />
          </div>

          {/* Quick Metric 3: Overlapping Count */}
          <div className="bg-slate-950/80 p-3.5 sm:p-4 rounded-2xl border border-slate-800/80 space-y-1">
            <span className="text-[11px] font-semibold text-slate-400 block">オーバーラッピング回数</span>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl sm:text-3xl font-black text-cyan-300 font-mono">{speechStats.todayOverlapping}</span>
              <span className="text-xs font-bold text-cyan-400">回</span>
            </div>
            <DeltaBadge value={speechStats.deltaOverlapping} unit="回" />
          </div>

          {/* Quick Metric 4: Total Utterances */}
          <div className="bg-slate-950/80 p-3.5 sm:p-4 rounded-2xl border border-slate-800/80 space-y-1">
            <span className="text-[11px] font-semibold text-slate-400 block">累計総発話回数</span>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl sm:text-3xl font-black text-white font-mono">{speechStats.totalUtterances}</span>
              <span className="text-xs font-bold text-indigo-400">回</span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono block">文数: {speechStats.totalUniqueSentences} 文</span>
          </div>
        </div>

        {/* Visual / Detail Content */}
        {speechTab === 'chart' ? (
          <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-850 space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-semibold">直近7日間の日次発話量積み上げ推移</span>
              <div className="flex items-center gap-3 text-[10px]">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-purple-500" />
                  <span>シャドーイング</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-cyan-500" />
                  <span>オーバーラッピング</span>
                </span>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-2 sm:gap-3 pt-2">
              {speechStats.last7DaysSpeech.map((d, i) => {
                const heightPct = Math.min(100, Math.round((d.total / speechStats.maxUtterances) * 100));
                const shadPct = d.total > 0 ? Math.round((d.shadowing / d.total) * 100) : 0;
                const overPct = d.total > 0 ? Math.round((d.overlapping / d.total) * 100) : 0;

                return (
                  <div key={i} className="flex flex-col items-center space-y-2 group">
                    <span className="text-[10px] font-mono text-indigo-300 font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                      {d.total} 回
                    </span>
                    <div className="w-full bg-slate-900 rounded-xl h-28 flex flex-col justify-end p-1 relative overflow-hidden border border-slate-800 group-hover:border-indigo-500/40 transition-colors">
                      <div
                        className="w-full rounded-lg overflow-hidden flex flex-col justify-end transition-all duration-500"
                        style={{ height: `${Math.max(4, heightPct)}%` }}
                      >
                        {/* Shadowing part */}
                        <div className="bg-purple-500 w-full" style={{ height: `${shadPct}%` }} />
                        {/* Overlapping part */}
                        <div className="bg-cyan-500 w-full" style={{ height: `${overPct}%` }} />
                      </div>
                    </div>
                    <div className="text-center">
                      <span className={`text-[11px] font-mono block ${d.isToday ? 'text-indigo-400 font-black' : 'text-slate-400'}`}>
                        {d.displayDate}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-850 space-y-2 max-h-72 overflow-y-auto custom-scrollbar">
            {speechLogs.length === 0 ? (
              <p className="text-center py-6 text-xs text-slate-500">発話練習ログはまだありません。</p>
            ) : (
              speechLogs.map((log) => (
                <div key={log.id} className="flex items-center justify-between p-2.5 bg-slate-900/80 border border-slate-800 rounded-xl text-xs hover:border-slate-700 transition-colors">
                  <div className="min-w-0 flex-1 pr-2 space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${log.subStep === 'shadowing' ? 'bg-purple-950 text-purple-300 border border-purple-800' : 'bg-cyan-950 text-cyan-300 border border-cyan-800'}`}>
                        {log.subStep === 'shadowing' ? 'シャドーイング' : 'オーバーラッピング'}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">{log.dateString || log.timestamp.slice(0, 10)}</span>
                    </div>
                    <p className="font-serif font-bold text-white truncate">{log.sentenceText || `Sentence #${log.sentenceIdx + 1}`}</p>
                    <span className="text-[10px] text-slate-500 truncate block">{log.storyTitle}</span>
                  </div>
                  <button
                    onClick={() => handleDeleteSpeechLog(log.id)}
                    className="p-1 text-slate-500 hover:text-rose-400 rounded transition-colors cursor-pointer"
                    title="ログを削除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* =========================================================================
          CARD 4: 📊 CEFR 習得度分析 (CEFR Mastery Analysis)
         ========================================================================= */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-5 relative">
        {/* Card Header & Mode Switcher */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3.5 flex-wrap gap-2">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Trophy className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                <span>📊 CEFR 構文・語彙習得度</span>
              </h3>
              <span className="text-[11px] text-slate-400">
                {cefrMode === 'comprehension' ? '【理解モード】読解・リスニングでの直感処理マスター' : '【組立モード】瞬間英作文・発話での能動出力マスター'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Primary Toggle: 理解 vs 組立 */}
            <div className="flex items-center p-1 bg-slate-950 rounded-2xl border border-slate-800 text-xs">
              <button
                onClick={() => setCefrMode('comprehension')}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                  cefrMode === 'comprehension'
                    ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>📖 理解</span>
              </button>
              <button
                onClick={() => setCefrMode('assembly')}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                  cefrMode === 'assembly'
                    ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <PenTool className="w-3.5 h-3.5" />
                <span>✍️ 組立</span>
              </button>
            </div>

            {/* Sub-Tab Switcher */}
            <div className="flex items-center p-1 bg-slate-950 rounded-2xl border border-slate-800 text-xs">
              <button
                onClick={() => setCefrTab('levels')}
                className={`px-2.5 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                  cefrTab === 'levels'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                レベル別
              </button>
              <button
                onClick={() => setCefrTab('timeline')}
                className={`px-2.5 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                  cefrTab === 'timeline'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                推移
              </button>
              <button
                onClick={() => setCefrTab('weak_patterns')}
                className={`px-2.5 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                  cefrTab === 'weak_patterns'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                弱点構文 ({weakestPatterns.length})
              </button>
            </div>
          </div>
        </div>

        {/* 4 Quick Metrics Grid (Fully connected to Comprehension / Assembly) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Quick Metric 1: Total Mastered Items */}
          <div className="bg-slate-950/80 p-3.5 sm:p-4 rounded-2xl border border-slate-800/80 space-y-1">
            <span className="text-[11px] font-semibold text-slate-400 block">総マスター項目数 ({cefrMode === 'comprehension' ? '理解' : '組立'})</span>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl sm:text-3xl font-black text-emerald-300 font-mono">{cefrStats.totalMasteredItems}</span>
              <span className="text-xs font-bold text-emerald-400">項目</span>
            </div>
            <DeltaBadge value={cefrStats.deltaTotalMastered} unit="項目" />
          </div>

          {/* Quick Metric 2: Target Level Progress */}
          <div className="bg-slate-950/80 p-3.5 sm:p-4 rounded-2xl border border-slate-800/80 space-y-1">
            <span className="text-[11px] font-semibold text-slate-400 block">目標【{cefrStats.targetLvl}】習得率</span>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl sm:text-3xl font-black text-cyan-300 font-mono">{cefrStats.targetPct}%</span>
            </div>
            <DeltaBadge value={cefrStats.deltaTargetPct} isPercentage={true} />
          </div>

          {/* Quick Metric 3: Pattern Mastered */}
          <div className="bg-slate-950/80 p-3.5 sm:p-4 rounded-2xl border border-slate-800/80 space-y-1">
            <span className="text-[11px] font-semibold text-slate-400 block">構文パターンマスター</span>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl sm:text-3xl font-black text-white font-mono">{cefrStats.totalPatternMastered}</span>
              <span className="text-xs font-bold text-slate-400">型</span>
            </div>
            <DeltaBadge value={cefrStats.deltaPatternMastered} unit="型" />
          </div>

          {/* Quick Metric 4: Vocab Mastered */}
          <div className="bg-slate-950/80 p-3.5 sm:p-4 rounded-2xl border border-slate-800/80 space-y-1">
            <span className="text-[11px] font-semibold text-slate-400 block">重要語彙マスター</span>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl sm:text-3xl font-black text-white font-mono">{cefrStats.totalVocabMastered}</span>
              <span className="text-xs font-bold text-slate-400">語</span>
            </div>
            <DeltaBadge value={cefrStats.deltaVocabMastered} unit="語" />
          </div>
        </div>

        {/* Visual / Detail Content */}
        {cefrTab === 'levels' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <div className="flex items-center gap-3 text-[11px]">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                  <span className="text-emerald-300 font-bold">習得済 (Mastered)</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                  <span className="text-amber-300 font-bold">学習中 (In Progress)</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-600" />
                  <span className="text-slate-400 font-bold">未知 (Unseen)</span>
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {cefrStats.levels.map(lvlData => (
                <div
                  key={lvlData.level}
                  className="bg-slate-950/80 p-4 rounded-2xl border border-slate-800/80 space-y-3 relative overflow-hidden group hover:border-slate-700 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-black text-base text-white px-2.5 py-0.5 rounded-lg bg-slate-900 border border-slate-700">
                      {lvlData.level}
                    </span>
                    <span className="text-xs font-bold text-cyan-400 font-mono">
                      {lvlData.masteredPct}% {cefrMode === 'comprehension' ? '理解' : '組立'}
                    </span>
                  </div>

                  {/* Stacked Progress Bar */}
                  <div className="w-full bg-slate-900 h-3 rounded-full overflow-hidden flex shadow-inner">
                    <div
                      className="bg-gradient-to-r from-emerald-500 to-emerald-400 h-full transition-all duration-500"
                      style={{ width: `${lvlData.masteredPct}%` }}
                      title={`習得済: ${lvlData.totalMastered} (${lvlData.masteredPct}%)`}
                    />
                    <div
                      className="bg-gradient-to-r from-amber-500 to-amber-400 h-full transition-all duration-500"
                      style={{ width: `${lvlData.learningPct}%` }}
                      title={`学習中: ${lvlData.totalLearning} (${lvlData.learningPct}%)`}
                    />
                    <div
                      className="bg-slate-800 h-full transition-all duration-500"
                      style={{ width: `${lvlData.unseenPct}%` }}
                      title={`未知: ${lvlData.totalUnseen} (${lvlData.unseenPct}%)`}
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-1 text-[10px] text-center pt-1 font-mono">
                    <div className="bg-slate-900/80 p-1 rounded-lg border border-slate-850">
                      <span className="text-emerald-400 block font-bold">{lvlData.totalMastered}</span>
                      <span className="text-slate-500">習得</span>
                    </div>
                    <div className="bg-slate-900/80 p-1 rounded-lg border border-slate-850">
                      <span className="text-amber-400 block font-bold">{lvlData.totalLearning}</span>
                      <span className="text-slate-500">学習中</span>
                    </div>
                    <div className="bg-slate-900/80 p-1 rounded-lg border border-slate-850">
                      <span className="text-slate-400 block font-bold">{lvlData.totalUnseen}</span>
                      <span className="text-slate-500">未知</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {cefrTab === 'timeline' && (
          <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-850 space-y-3">
            <span className="text-xs font-semibold text-slate-300 block">日次CEFRマスター項目蓄積推移</span>
            {cefrStats.dailyBreakdowns.length === 0 ? (
              <p className="text-center py-6 text-xs text-slate-500">推移データはまだありません。</p>
            ) : (
              <div className="space-y-2">
                {cefrStats.dailyBreakdowns.map((d, idx) => (
                  <div key={idx} className="p-2.5 bg-slate-900/80 rounded-xl border border-slate-800 flex items-center justify-between text-xs gap-3">
                    <span className="font-mono font-bold text-slate-300 w-16">{d.displayDate}</span>
                    <div className="flex-1 bg-slate-950 h-2.5 rounded-full overflow-hidden flex">
                      <div className="bg-emerald-500 h-full" style={{ width: `${d.pct}%` }} />
                    </div>
                    <div className="font-mono text-right shrink-0">
                      <span className="text-emerald-400 font-bold">{d.mastered}</span>
                      <span className="text-slate-500"> / {d.total} ({d.pct}%)</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {cefrTab === 'weak_patterns' && (
          <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-850 space-y-2 max-h-72 overflow-y-auto custom-scrollbar">
            <span className="text-xs font-semibold text-slate-300 block">ドリル & Ankiでミスが多い弱点構文一覧:</span>
            {weakestPatterns.length === 0 ? (
              <p className="text-center py-6 text-xs text-slate-500">現在、目立った弱点構文はありません！素晴らしい精度です。</p>
            ) : (
              weakestPatterns.map((w) => (
                <div key={w.pattern.id} className="p-3 bg-slate-900/90 border border-slate-800 rounded-xl text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="px-1.5 py-0.2 rounded bg-amber-950 text-amber-300 border border-amber-800 font-mono font-bold text-[10px]">
                        {w.pattern.cefr}
                      </span>
                      <span className="font-bold text-white">{w.pattern.name}</span>
                    </div>
                    <span className="text-[10px] font-mono text-rose-400 font-bold">
                      ミス: {w.mistakeCount}回
                    </span>
                  </div>
                  <p className="text-cyan-300 font-mono text-[11px]">{w.pattern.focus}</p>
                  <p className="text-slate-400 text-[10px]">{w.pattern.meaning}</p>
                </div>
              ))
            )}
          </div>
        )}
      </div>

    </div>
  );
};
