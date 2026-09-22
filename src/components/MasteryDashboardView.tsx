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
  Zap, Volume2, Search, Trash2, ShieldCheck, BarChart3, Globe,
  ChevronDown, ChevronUp, BookOpen, PenTool, Sparkles, Headphones, Activity,
  Flame, AlertTriangle
} from 'lucide-react';
import { speakText } from '../utils/speech';
import { getTodayDateString } from '../utils/srs';
import { calculateLabAnalytics } from '../services/listeningLabService';

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

export const MasteryDashboardView: React.FC<MasteryDashboardViewProps> = ({
  savedVocabs = [],
  expressionErrors = [],
  stories = [],
  onDeleteVocab,
  onDeleteExpressionError,
}) => {
  const [activeTab, setActiveTab] = useState<SavedStockTab>('cards');
  const [cardFilter, setCardFilter] = useState<CardFilterType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [progressMode, setProgressMode] = useState<CefrProgressMode>('comprehension');
  const [isReadingLogOpen, setIsReadingLogOpen] = useState<boolean>(false);
  const [readingLogs, setReadingLogs] = useState<ReadingSessionLog[]>(() => loadReadingSessionLogs());

  // 日次スナップショット & CEFRリアル進捗
  const dailySnapshots = useMemo(() => loadDailySnapshots(), [readingLogs]);
  const allCefrProgress = useMemo(() => computeAllLevelProgress(), [savedVocabs]);

  // 1. 厳格な総読了語数 ＆ 読破ストーリー数（読了フラグ isRead === true のもののみ計上）
  const completedStories = useMemo(() => {
    return (stories || []).filter(st => st.isRead === true || (st.readCount && st.readCount > 0));
  }, [stories]);

  const totalWordsRead = useMemo(() => {
    const fromSnapshots = dailySnapshots.reduce((acc, s) => acc + (s.wordsRead || 0), 0);
    if (fromSnapshots > 0) return fromSnapshots;
    return completedStories.reduce((acc, st) => {
      const count = st.actualWordCount || st.targetWordCount || (st.storyContent ? st.storyContent.split(/\s+/).filter(Boolean).length : 0);
      return acc + count * (st.readCount || 1);
    }, 0);
  }, [dailySnapshots, completedStories]);

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

  // 4. 初見リスニング & 実効バンド幅・ボトルネック集計
  const labAnalytics = useMemo(() => calculateLabAnalytics(), []);

  const storyListeningStats = useMemo(() => {
    const storyList = stories || [];
    const completedListeningStories = storyList.filter(s => s.listeningStatus === 'completed' && s.listeningMetrics);
    const totalListened = completedListeningStories.length;
    
    let totalChunks = 0;
    let totalLatencyMs = 0;
    let sumFirstPassRates = 0;
    let sumEffectiveWpms = 0;
    let validWpmCount = 0;
    const allBottlenecks: {
      storyTitle: string;
      unitIdx: number;
      textEn: string;
      translationJa: string;
      retryCount: number;
      revealedEnglish: boolean;
      elapsedMs: number;
    }[] = [];

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
          .filter(l => l.retryCount >= 1 || l.revealedEnglish)
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
    const avgFirstPassRate = totalListened > 0 ? Math.round(sumFirstPassRates / totalListened) : 100;
    const avgEffectiveListeningWpm = validWpmCount > 0 ? Math.round(sumEffectiveWpms / validWpmCount) : 0;

    return {
      totalListened,
      totalChunks,
      avgChunkLatencyMs,
      avgFirstPassRate,
      avgEffectiveListeningWpm,
      allBottlenecks,
      listenedStories: completedListeningStories,
    };
  }, [stories]);

  // 5. センテンス武器庫のステータス集計
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

  // 6. 直近7日間の日次データ
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

  // 7. 読了ログ削除ハンドラー
  const handleDeleteReadingLog = (logId: string) => {
    if (confirm('この読了ログを削除しますか？（日次統計が自動再計算されます）')) {
      const res = deleteReadingSessionLog(logId);
      setReadingLogs(res.logs);
    }
  };

  // 8. 1センテンス Ankiカードのフィルタリング & 検索
  const filteredCards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return savedVocabs.filter(v => {
      const isMastered = (v.intervalDays && v.intervalDays >= 21) || (v.repetitionCount && v.repetitionCount >= 4);
      const isPattern = v.focusType === 'pattern' || (v.corePatterns && v.corePatterns.length > 0);

      if (cardFilter === 'mastered' && !isMastered) return false;
      if (cardFilter === 'learning' && isMastered) return false;
      if (cardFilter === 'word' && isPattern) return false;
      if (cardFilter === 'pattern' && !isPattern) return false;

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

  // 9. 偽英語・発話カルテのフィルタリング
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
        {/* Card 1: 厳格な総読了語数 */}
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
          <p className="text-[11px] text-slate-400 truncate">
            読了: {completedStories.length} 冊 / 全 {stories.length} 冊
          </p>
        </div>

        {/* Card 2: 実効情報処理バンド幅 (WPM) */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xl space-y-1.5 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-semibold">実効バンド幅 (WPM)</span>
            <Zap className="w-4 h-4 text-amber-400" />
          </div>
          <div className="flex items-baseline space-x-3">
            <div>
              <span className="text-[10px] text-slate-400 block">📖 読書</span>
              <span className="text-xl sm:text-2xl font-black text-amber-300 font-mono">
                {averageWpm > 0 ? averageWpm : '-'}
              </span>
            </div>
            <div className="text-slate-600 font-light">|</div>
            <div>
              <span className="text-[10px] text-slate-400 block">🎧 聴覚</span>
              <span className="text-xl sm:text-2xl font-black text-cyan-300 font-mono">
                {storyListeningStats.avgEffectiveListeningWpm > 0 ? storyListeningStats.avgEffectiveListeningWpm : '-'}
              </span>
            </div>
          </div>
          <p className="text-[11px] text-slate-400 truncate">
            {wpmTier.label}
          </p>
        </div>

        {/* Card 3: 聴覚一発パス率 */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xl space-y-1.5 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-semibold">聴覚一発パス率</span>
            <Flame className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex items-baseline space-x-1.5">
            <span className={`text-2xl sm:text-3xl font-black font-mono ${
              storyListeningStats.totalListened > 0
                ? storyListeningStats.avgFirstPassRate >= 80
                  ? 'text-emerald-400'
                  : storyListeningStats.avgFirstPassRate >= 50
                  ? 'text-cyan-400'
                  : 'text-amber-400'
                : 'text-slate-400'
            }`}>
              {storyListeningStats.totalListened > 0 ? `${storyListeningStats.avgFirstPassRate}%` : '未測定'}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 truncate">
            0リトライ・即時圧縮
          </p>
        </div>

        {/* Card 4: 連続学習ストリーク */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xl space-y-1.5 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-semibold">学習ストリーク</span>
            <Sparkles className="w-4 h-4 text-purple-400" />
          </div>
          <div className="flex items-baseline space-x-1.5">
            <span className="text-2xl sm:text-3xl font-black text-purple-300 tracking-tight font-mono">
              {streakDays}
            </span>
            <span className="text-xs font-bold text-purple-400">日連続</span>
          </div>
          <p className="text-[11px] text-slate-400 truncate">
            英語脳コンパイル習慣
          </p>
        </div>
      </div>

      {/* 2. 7-DAY ACTIVITY & WPM TREND CHART */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-5">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3 flex-wrap gap-2">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                <span>直近7日間の学習実績 ＆ WPM推移</span>
              </h3>
              <span className="text-[11px] text-slate-400">日次読了語数 ＆ WPM（読了完了時のみ厳格集計）</span>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setIsReadingLogOpen(!isReadingLogOpen)}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-850 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
            >
              <span>読了ログ詳細 ({readingLogs.length}件)</span>
              {isReadingLogOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* 7-Day Bar & Indicator Chart */}
        <div className="grid grid-cols-7 gap-2 sm:gap-3 pt-2">
          {last7DaysData.map((d, i) => {
            const heightPct = Math.min(100, Math.round((d.words / maxWordsIn7Days) * 100));
            return (
              <div key={i} className="flex flex-col items-center space-y-2 group">
                <div className="text-[10px] font-mono text-slate-400 group-hover:text-cyan-300 transition-colors">
                  {d.wpm > 0 ? `${d.wpm}w` : '-'}
                </div>

                <div className="w-full bg-slate-950 h-28 sm:h-32 rounded-2xl p-1 flex flex-col justify-end border border-slate-800/80 relative overflow-hidden">
                  <div
                    className={`w-full rounded-xl transition-all duration-500 ${
                      d.words > 0
                        ? d.isToday
                          ? 'bg-gradient-to-t from-cyan-600 to-indigo-500 shadow-lg shadow-cyan-500/20'
                          : 'bg-gradient-to-t from-slate-700 to-slate-500 group-hover:from-cyan-700 group-hover:to-indigo-600'
                        : 'bg-transparent'
                    }`}
                    style={{ height: `${d.words > 0 ? Math.max(12, heightPct) : 0}%` }}
                  />
                  {d.words > 0 && (
                    <div className="absolute inset-x-0 bottom-1 text-center text-[9px] font-bold font-mono text-white/90">
                      {d.words}
                    </div>
                  )}
                </div>

                <div className={`text-[11px] font-medium font-mono ${d.isToday ? 'text-cyan-400 font-bold' : 'text-slate-400'}`}>
                  {d.displayDate}
                </div>
              </div>
            );
          })}
        </div>

        {/* Collapsible Reading Session Logs Table */}
        {isReadingLogOpen && (
          <div className="mt-4 pt-4 border-t border-slate-800 space-y-3 animate-fadeIn">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>読了ログ（誤タップ等のノイズはここから個別削除できます）</span>
              <span className="font-mono">最新 {readingLogs.length} 件</span>
            </div>

            {readingLogs.length === 0 ? (
              <div className="text-center py-6 text-xs text-slate-500">
                まだ読了ログがありません。ストーリーを読了するとここに記録されます。
              </div>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {readingLogs.map(log => (
                  <div
                    key={log.id}
                    className="flex items-center justify-between p-3 bg-slate-950/80 border border-slate-800/80 rounded-2xl text-xs hover:border-slate-700 transition-colors"
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
                      className="p-2 text-slate-500 hover:text-rose-400 hover:bg-rose-950/50 rounded-xl transition-colors shrink-0 cursor-pointer"
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

      {/* 3. 🎧 初見リスニング・実効バンド幅 ＆ 要復習ボトルネック */}
      <div className="bg-slate-900/90 border border-indigo-500/30 rounded-3xl p-5 sm:p-6 shadow-xl space-y-5">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3 flex-wrap gap-2">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
              <Headphones className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                <span>初見リスニング ＆ 聴覚実効バンド幅</span>
                <span className="text-[10px] uppercase px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 font-mono">
                  Auditory Bandwidth
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                ブラインド反復リスニングにおける0リトライ圧縮率と実効処理速度
              </p>
            </div>
          </div>
        </div>

        {/* Listening Summary KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-1">
            <span className="text-[11px] text-slate-400 font-bold">初見完走ストーリー</span>
            <div className="text-2xl font-black text-indigo-300 font-mono">
              {storyListeningStats.totalListened} <span className="text-xs font-normal text-slate-400">本</span>
            </div>
          </div>

          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-1">
            <span className="text-[11px] text-slate-400 font-bold">実効リスニング速度</span>
            <div className="text-2xl font-black text-cyan-300 font-mono">
              {storyListeningStats.avgEffectiveListeningWpm > 0
                ? `${storyListeningStats.avgEffectiveListeningWpm}`
                : storyListeningStats.avgChunkLatencyMs > 0
                ? `${(storyListeningStats.avgChunkLatencyMs / 1000).toFixed(1)}s`
                : '-'}
              <span className="text-xs font-normal text-slate-400 ml-1">
                {storyListeningStats.avgEffectiveListeningWpm > 0 ? 'wpm' : '/ 塊'}
              </span>
            </div>
          </div>

          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-1">
            <span className="text-[11px] text-slate-400 font-bold">平均一発パス率</span>
            <div className="text-2xl font-black text-emerald-400 font-mono">
              {storyListeningStats.totalListened > 0 ? `${storyListeningStats.avgFirstPassRate}%` : '-'}
            </div>
          </div>

          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-1">
            <span className="text-[11px] text-slate-400 font-bold">要復習ボトルネック</span>
            <div className="text-2xl font-black text-amber-400 font-mono">
              {storyListeningStats.allBottlenecks.length} <span className="text-xs font-normal text-slate-400">件</span>
            </div>
          </div>
        </div>

        {/* Bottleneck Review Stream */}
        {storyListeningStats.allBottlenecks.length > 0 ? (
          <div className="bg-slate-950/80 border border-slate-800/80 rounded-2xl p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-amber-400 font-bold text-xs sm:text-sm">
                <AlertTriangle className="w-4 h-4" />
                <span>🚨 リスニングで詰まった要復習文（直近ストーリー横断）</span>
              </div>
              <span className="text-xs text-slate-400 font-mono">
                {storyListeningStats.allBottlenecks.length} 件蓄積中
              </span>
            </div>

            <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
              {storyListeningStats.allBottlenecks.slice(0, 15).map((item, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-1.5 hover:border-slate-700 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[10px] text-indigo-400 font-bold block mb-0.5">
                        📖 {item.storyTitle} (文 {item.unitIdx + 1})
                      </span>
                      <p className="text-xs sm:text-sm font-bold text-white leading-relaxed font-serif">
                        {item.textEn}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => speakText(item.textEn, 1.0, 'en-US')}
                      className="p-1.5 bg-slate-800 hover:bg-slate-750 text-indigo-300 hover:text-white rounded-lg border border-slate-700 transition-all shrink-0 cursor-pointer"
                      title="音声を再生"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <p className="text-[11px] text-slate-400 leading-snug">
                    {item.translationJa}
                  </p>

                  <div className="flex items-center gap-2 pt-1 text-[10px]">
                    {item.retryCount > 0 && (
                      <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono">
                        🔄 リトライ {item.retryCount} 回
                      </span>
                    )}
                    {item.revealedEnglish && (
                      <span className="px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30">
                        👁️ 英文確認
                      </span>
                    )}
                    <span className="text-slate-500 font-mono ml-auto">
                      所要: {(item.elapsedMs / 1000).toFixed(1)}s
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : storyListeningStats.totalListened > 0 ? (
          <div className="p-4 bg-emerald-950/40 border border-emerald-500/30 rounded-2xl text-emerald-300 text-xs font-bold flex items-center justify-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <span>完璧です！直近のストーリーはすべて一発で聞き取れています！</span>
          </div>
        ) : null}

        {/* Bandwidth Matrix Grid from Lab */}
        {labAnalytics.totalQuestions > 0 && (
          <div className="bg-slate-950/80 border border-slate-800/80 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-300 font-bold">
              <span className="flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-cyan-400" />
                <span>リスニング・キャパシティ行列（語数 × WPM）</span>
              </span>
              <span className="text-[11px] text-slate-500 font-normal">
                快適: 90%+ / 成長負荷: 70-89% / パンク: &lt;70%
              </span>
            </div>

            <div className="overflow-x-auto pb-1">
              <table className="w-full text-center text-[11px] border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="p-1.5 text-left font-bold">語数 ＼ 速度</th>
                    {[60, 80, 100, 120, 150, 180, 200].map(wpm => (
                      <th key={wpm} className="p-1 font-mono font-bold">{wpm} WPM</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {[4, 6, 8, 12, 16, 20].map(wc => (
                    <tr key={wc}>
                      <td className="p-1.5 text-left font-bold text-slate-300 whitespace-nowrap">{wc} 語</td>
                      {[60, 80, 100, 120, 150, 180, 200].map(wpm => {
                        const cell = labAnalytics.matrix[wc]?.[wpm];
                        const cellClass = !cell || cell.attempts === 0
                          ? 'bg-slate-900/40 text-slate-600 border-slate-850'
                          : cell.avgScore >= 90
                          ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40 font-bold'
                          : cell.avgScore >= 70
                          ? 'bg-amber-950/80 text-amber-300 border-amber-500/40 font-bold'
                          : 'bg-red-950/80 text-red-300 border-red-500/40 font-bold';
                        return (
                          <td key={wpm} className="p-1">
                            <div className={`p-1.5 rounded-lg border text-center ${cellClass}`}>
                              {cell && cell.attempts > 0 ? `${cell.avgScore}%` : '-'}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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

          {/* Mode Switcher: 理解 vs 組立 */}
          <div className="flex items-center p-1 bg-slate-950 rounded-2xl border border-slate-800 self-start sm:self-auto">
            <button
              onClick={() => setProgressMode('comprehension')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                progressMode === 'comprehension'
                  ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>理解 (インプット)</span>
            </button>
            <button
              onClick={() => setProgressMode('assembly')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                progressMode === 'assembly'
                  ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <PenTool className="w-3.5 h-3.5" />
              <span>組立 (アウトプット)</span>
            </button>
          </div>
        </div>

        {/* Level Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {(['A1', 'A2', 'B1', 'B2'] as const).map(lvl => {
            const data = allCefrProgress[lvl];
            const masteredPct = progressMode === 'comprehension' ? data.overallPct : (data.overallAssemblyPct || 0);
            const totalItems = (data.patternTotal || 0) + (data.vocabTotal || 0);

            return (
              <div
                key={lvl}
                className="bg-slate-950/80 p-4 rounded-2xl border border-slate-800/80 space-y-3 relative overflow-hidden"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-black text-base text-white px-2.5 py-0.5 rounded-lg bg-slate-900 border border-slate-700">
                    {lvl}
                  </span>
                  <span className="text-xs font-bold text-cyan-400 font-mono">
                    {masteredPct}% 習得
                  </span>
                </div>

                <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden flex">
                  <div
                    className="bg-gradient-to-r from-emerald-500 to-cyan-400 h-full transition-all duration-500"
                    style={{ width: `${masteredPct}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>対象項目数</span>
                  <span className="font-mono text-slate-300">{totalItems} 項目</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 5. センテンス武器庫 (Ankiカード一覧) ＆ 偽英語・発話カルテ */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-purple-500/20 text-purple-400 border border-purple-500/30">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white">
                センテンス武器庫 ＆ 発話カルテ
              </h3>
              <p className="text-xs text-slate-400">
                ストーリーから抽出・蓄積されたAnkiカードと発話修正ログ
              </p>
            </div>
          </div>

          <div className="flex items-center p-1 bg-slate-950 rounded-2xl border border-slate-800">
            <button
              onClick={() => setActiveTab('cards')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'cards'
                  ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Ankiカード ({savedVocabs.length})
            </button>
            <button
              onClick={() => setActiveTab('errors')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'errors'
                  ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              発話カルテ ({expressionErrors.length})
            </button>
          </div>
        </div>

        {/* Search & Filter Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="単語・構文・例文を検索..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 transition-colors"
            />
          </div>

          {activeTab === 'cards' && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {(['all', 'pattern', 'word', 'mastered', 'learning'] as CardFilterType[]).map(f => (
                <button
                  key={f}
                  onClick={() => setCardFilter(f)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    cardFilter === f
                      ? 'bg-purple-600 text-white'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  {f === 'all' && 'すべて'}
                  {f === 'pattern' && `構文 (${patternCardsCount})`}
                  {f === 'word' && `単語 (${wordCardsCount})`}
                  {f === 'mastered' && `マスター済 (${masteredCardsCount})`}
                  {f === 'learning' && `学習中 (${learningCardsCount})`}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Content List */}
        {activeTab === 'cards' ? (
          filteredCards.length === 0 ? (
            <div className="text-center py-10 text-xs text-slate-500">
              該当するカードが見つかりませんでした。
            </div>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
              {filteredCards.map(card => {
                const isMastered = (card.intervalDays && card.intervalDays >= 21) || (card.repetitionCount && card.repetitionCount >= 4);
                return (
                  <div
                    key={card.id}
                    className="p-4 bg-slate-950/80 border border-slate-800/80 rounded-2xl space-y-2 hover:border-slate-700 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-white">
                            {card.phrase || card.focusWord}
                          </span>
                          <span className="text-xs text-slate-400">
                            {card.meaning || card.focusMeaning}
                          </span>
                        </div>
                        {card.sentence && (
                          <p className="text-xs text-slate-300 font-serif mt-1">
                            {card.sentence}
                          </p>
                        )}
                        {card.translation && (
                          <p className="text-[11px] text-slate-500">
                            {card.translation}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center space-x-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => speakText(card.sentence || card.phrase || card.focusWord || '', 1.0, 'en-US')}
                          className="p-1.5 bg-slate-900 hover:bg-slate-850 text-indigo-300 hover:text-white rounded-lg border border-slate-800 transition-colors cursor-pointer"
                          title="発音を再生"
                        >
                          <Volume2 className="w-3.5 h-3.5" />
                        </button>
                        {onDeleteVocab && (
                          <button
                            type="button"
                            onClick={() => onDeleteVocab(card.id)}
                            className="p-1.5 bg-slate-900 hover:bg-rose-950 text-slate-500 hover:text-rose-400 rounded-lg border border-slate-800 transition-colors cursor-pointer"
                            title="カードを削除"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        isMastered
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      }`}>
                        {isMastered ? 'マスター済み' : '学習中'}
                      </span>
                      {card.level && (
                        <span className="px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800 text-[10px] font-mono">
                          {card.level}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          filteredErrors.length === 0 ? (
            <div className="text-center py-10 text-xs text-slate-500">
              まだ発話カルテのログがありません。AI英会話やドリルを行うと自動記録されます。
            </div>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
              {filteredErrors.map(err => (
                <div
                  key={err.id}
                  className="p-4 bg-slate-950/80 border border-slate-800/80 rounded-2xl space-y-2 hover:border-slate-700 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="text-xs text-rose-300 font-mono">
                        ❌ あなたの発話: "{err.userUtterance}"
                      </div>
                      <div className="text-xs font-bold text-emerald-300 font-mono">
                        ✨ 自然な表現: "{err.naturalExpression}"
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">
                        💡 {err.explanation}
                      </p>
                    </div>

                    <div className="flex items-center space-x-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => speakText(err.naturalExpression, 1.0, 'en-US')}
                        className="p-1.5 bg-slate-900 hover:bg-slate-850 text-indigo-300 hover:text-white rounded-lg border border-slate-800 transition-colors cursor-pointer"
                        title="発音を再生"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                      </button>
                      {onDeleteExpressionError && (
                        <button
                          type="button"
                          onClick={() => onDeleteExpressionError(err.id)}
                          className="p-1.5 bg-slate-900 hover:bg-rose-950 text-slate-500 hover:text-rose-400 rounded-lg border border-slate-800 transition-colors cursor-pointer"
                          title="ログを削除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
};
