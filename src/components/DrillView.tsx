import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Zap,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  RefreshCw,
  Volume2,
  Plus,
  BookOpen,
  PenTool,
  Flame,
  ChevronRight,
  Settings2,

  Check,

  Sparkles,
  Layers,
  Brain
} from 'lucide-react';
import { PatternMasterItem, VocabMasterItem } from '../types/mastery';
import { CefrLevel } from '../types/settings';
import { getPatternsByLevel } from '../data/cefrPatternsMaster';
import { getVocabMasterByLevel } from '../data/cefrVocabMaster';
import {
  loadMasteryState,
  recordDrillResult,
  saveSentenceCardWithSiblings,
  loadVocabs,
  saveVocabsBatch
} from '../services/storage';
import {
  evaluateDrillAnswerWithGemini,
  EvaluateDrillResult,
  generateDynamicDrillQuestion,
  DynamicDrillQuestion
} from '../services/gemini';
import { playCorrectSound, playWrongSound } from '../utils/audio';
import { LiveLogger } from '../services/liveLogger';

interface DrillViewProps {
  apiKey: string;
  selectedModel?: string;
  userLevel?: CefrLevel;
  onNavigateToAnki?: () => void;
}

export type DrillFilterMode = 'all' | 'unseen' | 'lapsed';
export type DrillTargetScope = 'all' | 'pattern' | 'vocab'; // 総合 (構文+単語), 構文のみ, 単語のみ

export interface DrillQueueItem {
  queueId: string;
  targetType: 'pattern' | 'vocab';
  item: PatternMasterItem | VocabMasterItem;
  question: DynamicDrillQuestion;
  generatedAt: number;
}

const QUEUE_TARGET_SIZE = 4; // 常時プールしておく先読み問題数

export const DrillView: React.FC<DrillViewProps> = ({
  apiKey,
  selectedModel = 'gemini-3.7-flash',
  userLevel,
  onNavigateToAnki,
}) => {
  const [selectedCefr, setSelectedCefr] = useState<CefrLevel>(userLevel || 'A1');
  const [drillType, setDrillType] = useState<'assembly' | 'comprehension'>('assembly');
  const [filterMode, setFilterMode] = useState<DrillFilterMode>('unseen');
  const [targetScope, setTargetScope] = useState<DrillTargetScope>('all');
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  // Pre-generation Queue & Current Question State
  const [drillQueue, setDrillQueue] = useState<DrillQueueItem[]>([]);
  const [currentDrillItem, setCurrentDrillItem] = useState<DrillQueueItem | null>(null);
  const [isQueueLoading, setIsQueueLoading] = useState<boolean>(true);
  const isRefillingRef = useRef<boolean>(false);

  const [userAnswer, setUserAnswer] = useState<string>('');
  const [isEvaluating, setIsEvaluating] = useState<boolean>(false);
  const [evalResult, setEvalResult] = useState<EvaluateDrillResult | null>(null);
  const [isSavedToAnki, setIsSavedToAnki] = useState<boolean>(false);
  const [lastSavedCardIds, setLastSavedCardIds] = useState<{ id1: string; id2: string } | null>(null);

  const [sessionCorrectCount, setSessionCorrectCount] = useState<number>(0);
  const [sessionTotalCount, setSessionTotalCount] = useState<number>(0);
  const [currentStreak, setCurrentStreak] = useState<number>(0);
  const [levelCompletionNotice, setLevelCompletionNotice] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // 音声読み上げ
  const speakText = (text: string) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  };

  // 出題候補プールを取得する関数
  const getCandidatePool = useCallback(
    (cefr: CefrLevel, mode: DrillFilterMode, type: 'assembly' | 'comprehension', scope: DrillTargetScope) => {
      const state = loadMasteryState();
      const patternList = (scope === 'all' || scope === 'pattern') ? getPatternsByLevel(cefr) : [];
      const vocabList = (scope === 'all' || scope === 'vocab') ? getVocabMasterByLevel(cefr) : [];

      const filteredPatterns: PatternMasterItem[] = [];
      const filteredVocabs: VocabMasterItem[] = [];

      // 構文のフィルタリング
      patternList.forEach((p) => {
        const m = state.patterns[p.id];
        const status = type === 'assembly' ? m?.assemblyStatus : m?.comprehensionStatus;
        if (mode === 'unseen') {
          if (!m || !status || status === 'unseen') filteredPatterns.push(p);
        } else if (mode === 'lapsed') {
          if (m && (status === 'lapsed' || ((m.mistakeCount || 0) > 0 && status !== 'mastered'))) {
            filteredPatterns.push(p);
          }
        } else {
          filteredPatterns.push(p);
        }
      });

      // 単語のフィルタリング
      vocabList.forEach((v) => {
        const m = state.vocabs[v.id.toLowerCase()] || state.vocabs[v.phrase.toLowerCase()];
        const status = type === 'assembly' ? m?.assemblyStatus : m?.comprehensionStatus;
        if (mode === 'unseen') {
          if (!m || !status || status === 'unseen') filteredVocabs.push(v);
        } else if (mode === 'lapsed') {
          if (m && (status === 'lapsed' || ((m.mistakeCount || 0) > 0 && status !== 'mastered'))) {
            filteredVocabs.push(v);
          }
        } else {
          filteredVocabs.push(v);
        }
      });

      // 該当なしの場合は全体プールにフォールバック
      const finalPatterns = filteredPatterns.length > 0 ? filteredPatterns : patternList;
      const finalVocabs = filteredVocabs.length > 0 ? filteredVocabs : vocabList;

      return {
        patterns: finalPatterns,
        vocabs: finalVocabs,
        isLevelCompleted:
          mode === 'unseen' &&
          filteredPatterns.length === 0 &&
          filteredVocabs.length === 0 &&
          (patternList.length > 0 || vocabList.length > 0),
      };
    },
    []
  );

  // バックグラウンド先行生成キューの補充ワーカー
  const refillQueue = useCallback(async () => {
    if (isRefillingRef.current) return;
    isRefillingRef.current = true;

    try {
      let currentQueue = [...drillQueue];

      while (currentQueue.length < QUEUE_TARGET_SIZE) {
        const { patterns, vocabs, isLevelCompleted } = getCandidatePool(
          selectedCefr,
          filterMode,
          drillType,
          targetScope
        );

        if (isLevelCompleted) {
          setLevelCompletionNotice(`🎉 おめでとうございます！ ${selectedCefr} レベルの対象項目はすべて確認済みです！`);
        } else {
          setLevelCompletionNotice(null);
        }

        if (patterns.length === 0 && vocabs.length === 0) {
          break;
        }

        // キュー内・出題中にあるIDを除外して候補を抽出
        const activeIds = new Set<string>();
        if (currentDrillItem) activeIds.add(currentDrillItem.item.id);
        currentQueue.forEach((q) => activeIds.add(q.item.id));

        const availablePatterns = patterns.filter((p) => !activeIds.has(p.id));
        const availableVocabs = vocabs.filter((v) => !activeIds.has(v.id));

        const usePatterns = availablePatterns.length > 0 ? availablePatterns : patterns;
        const useVocabs = availableVocabs.length > 0 ? availableVocabs : vocabs;

        // 構文か単語かをランダムに選択
        let chooseType: 'pattern' | 'vocab' = 'pattern';
        if (targetScope === 'pattern') chooseType = 'pattern';
        else if (targetScope === 'vocab') chooseType = 'vocab';
        else {
          chooseType = usePatterns.length > 0 && useVocabs.length > 0
            ? Math.random() < 0.5 ? 'pattern' : 'vocab'
            : usePatterns.length > 0 ? 'pattern' : 'vocab';
        }

        const pickedItem = chooseType === 'pattern'
          ? usePatterns[Math.floor(Math.random() * usePatterns.length)]
          : useVocabs[Math.floor(Math.random() * useVocabs.length)];

        if (!pickedItem) break;

        // Gemini AIで動的生成
        try {
          const question = await generateDynamicDrillQuestion({
            targetType: chooseType,
            pattern: chooseType === 'pattern' ? (pickedItem as PatternMasterItem) : undefined,
            vocab: chooseType === 'vocab' ? (pickedItem as VocabMasterItem) : undefined,
            apiKey,
            model: selectedModel,
          });

          const queueItem: DrillQueueItem = {
            queueId: 'q_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            targetType: chooseType,
            item: pickedItem,
            question,
            generatedAt: Date.now(),
          };

          currentQueue = [...currentQueue, queueItem];
          setDrillQueue(currentQueue);

          // 画面に問題が表示されていない場合は即座にセット
          setCurrentDrillItem((prev) => {
            if (!prev) {
              setIsQueueLoading(false);
              return queueItem;
            }
            return prev;
          });
        } catch (genErr) {
          LiveLogger.warn('quiz_drill', 'QUEUE_REFILL_ERROR', '先読み生成中にエラーが発生しました', { error: String(genErr) });
          break;
        }
      }
    } finally {
      isRefillingRef.current = false;
      setIsQueueLoading(false);
    }
  }, [drillQueue, currentDrillItem, selectedCefr, filterMode, drillType, targetScope, apiKey, selectedModel, getCandidatePool]);

  // 設定やレベル変更時にキューをリセットして再構築
  useEffect(() => {
    setDrillQueue([]);
    setCurrentDrillItem(null);
    setIsQueueLoading(true);
    setUserAnswer('');
    setEvalResult(null);
    setIsSavedToAnki(false);
    setLastSavedCardIds(null);
  }, [selectedCefr, filterMode, drillType, targetScope]);

  // キューが少なくなった時に自動補充
  useEffect(() => {
    if (drillQueue.length < QUEUE_TARGET_SIZE) {
      refillQueue();
    }
  }, [drillQueue.length, refillQueue]);

  // 入力フォーカス
  useEffect(() => {
    if (!isEvaluating && !evalResult && currentDrillItem) {
      inputRef.current?.focus();
    }
  }, [currentDrillItem, isEvaluating, evalResult]);

  // 次の問題へ進む
  const handleNext = useCallback(() => {
    setUserAnswer('');
    setEvalResult(null);
    setIsSavedToAnki(false);
    setLastSavedCardIds(null);

    setDrillQueue((prevQueue) => {
      if (prevQueue.length > 0) {
        // 現在の問題を除去し、キューの先頭を次の問題に設定
        const remaining = prevQueue.filter((q) => q.queueId !== currentDrillItem?.queueId);
        if (remaining.length > 0) {
          const next = remaining[0];
          setCurrentDrillItem(next);
          setIsQueueLoading(false);
          return remaining.slice(1);
        }
      }
      // キューが空の場合はローディング
      setCurrentDrillItem(null);
      setIsQueueLoading(true);
      return [];
    });
  }, [currentDrillItem]);

  // 判定実行
  const handleSubmitAnswer = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!userAnswer.trim() || !currentDrillItem || isEvaluating) return;

    setIsEvaluating(true);
    const { item, targetType, question } = currentDrillItem;
    const isPattern = targetType === 'pattern';
    const pattern = isPattern ? (item as PatternMasterItem) : undefined;
    const vocab = !isPattern ? (item as VocabMasterItem) : undefined;

    try {
      const promptJa = question.translationJa;
      const modelSentence = question.sentenceEn;

      const result = await evaluateDrillAnswerWithGemini({
        promptJa,
        targetItem: {
          id: item.id,
          name: isPattern ? pattern!.name : vocab!.phrase,
          meaning: isPattern ? pattern!.meaning : vocab!.meaning,
          focus: isPattern ? pattern!.focus : (vocab!.partOfSpeech || '単語'),
          sampleSentences: [modelSentence],
        },
        drillType,
        userAnswer: userAnswer.trim(),
        apiKey,
        model: selectedModel,
      });

      setEvalResult(result);
      setSessionTotalCount((prev) => prev + 1);

      if (result.result === 'correct') {
        playCorrectSound();
        setSessionCorrectCount((prev) => prev + 1);
        setCurrentStreak((prev) => prev + 1);
        speakText(result.correctedSentence || question.sentenceEn);

        recordDrillResult({
          itemId: item.id,
          itemType: targetType,
          drillType,
          cefr: selectedCefr,
          result: 'correct',
          userResponse: userAnswer.trim(),
          feedback: result.feedback,
          correctedSentence: result.correctedSentence,
        });
      } else {
        // 不正解または惜しい場合
        playWrongSound();
        setCurrentStreak(0);
        speakText(result.correctedSentence || question.sentenceEn);

        recordDrillResult({
          itemId: item.id,
          itemType: targetType,
          drillType,
          cefr: selectedCefr,
          result: 'wrong',
          userResponse: userAnswer.trim(),
          feedback: result.feedback,
          correctedSentence: result.correctedSentence,
          errorReason: result.errorReason,
        });

        // 💡 間違えた場合は自動でAnki復習カード（1文）に登録！
        try {
          const cardPair = saveSentenceCardWithSiblings({
            sentence: result.correctedSentence || question.sentenceEn,
            translation: question.translationJa,
            focusType: isPattern ? 'pattern' : 'word',
            focusWord: isPattern ? pattern!.name : vocab!.phrase,
            focusMeaning: isPattern ? pattern!.meaning : vocab!.meaning,
            corePatterns: isPattern ? [{
              patternName: pattern!.name,
              formula: pattern!.focus,
              meaningTemplate: pattern!.meaning,
              highlightTokens: question.targetTokens,
              briefNote: pattern!.meaning,
            }] : [],
          });
          setIsSavedToAnki(true);
          setLastSavedCardIds({ id1: cardPair.card1.id, id2: cardPair.card2.id });
        } catch (saveErr) {
          console.error('Failed to auto-save to Anki', saveErr);
        }
      }
    } catch (err) {
      console.error('Drill evaluation failed', err);
    } finally {
      setIsEvaluating(false);
    }
  };

  // わからない（ギブアップ）
  const handleGiveUp = () => {
    if (!currentDrillItem || isEvaluating) return;

    setIsEvaluating(true);
    const { item, targetType, question } = currentDrillItem;
    const isPattern = targetType === 'pattern';
    const pattern = isPattern ? (item as PatternMasterItem) : undefined;
    const vocab = !isPattern ? (item as VocabMasterItem) : undefined;

    const modelSentence = question.sentenceEn;
    const result: EvaluateDrillResult = {
      result: 'wrong',
      feedback: isPattern
        ? `正解の構文は【${pattern!.name}】です。公式: ${pattern!.focus}。模範解答を確認してAnkiに登録しましょう！`
        : `ターゲット語彙は【${vocab!.phrase}】(${vocab!.meaning})です。模範解答を確認して復習しましょう！`,
      correctedSentence: modelSentence,
      errorReason: '未習得・ギブアップ',
    };

    setEvalResult(result);
    setSessionTotalCount((prev) => prev + 1);
    setCurrentStreak(0);
    playWrongSound();
    speakText(modelSentence);

    recordDrillResult({
      itemId: item.id,
      itemType: targetType,
      drillType,
      cefr: selectedCefr,
      result: 'wrong',
      userResponse: '（ギブアップ）',
      feedback: result.feedback,
      correctedSentence: modelSentence,
      errorReason: '未習得・ギブアップ',
    });

    // 自動でAnki復習カード（1文）に登録
    try {
      const cardPair = saveSentenceCardWithSiblings({
        sentence: modelSentence,
        translation: question.translationJa,
        focusType: isPattern ? 'pattern' : 'word',
        focusWord: isPattern ? pattern!.name : vocab!.phrase,
        focusMeaning: isPattern ? pattern!.meaning : vocab!.meaning,
        corePatterns: isPattern ? [{
          patternName: pattern!.name,
          formula: pattern!.focus,
          meaningTemplate: pattern!.meaning,
          highlightTokens: question.targetTokens,
          briefNote: pattern!.meaning,
        }] : [],
      });
      setIsSavedToAnki(true);
      setLastSavedCardIds({ id1: cardPair.card1.id, id2: cardPair.card2.id });
    } catch (saveErr) {
      console.error('Failed to auto-save to Anki on give up', saveErr);
    }

    setIsEvaluating(false);
  };

  // 自動保存の取り消し
  const handleUndoAnkiSave = () => {
    if (!lastSavedCardIds) return;
    try {
      const currentVocabs = loadVocabs();
      const filtered = currentVocabs.filter(
        (v) => v.id !== lastSavedCardIds.id1 && v.id !== lastSavedCardIds.id2
      );
      saveVocabsBatch(filtered);
      setIsSavedToAnki(false);
      setLastSavedCardIds(null);
    } catch (e) {
      console.error('Failed to undo Anki save', e);
    }
  };

  // キーボードショートカット (Enterで送信または次へ)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (evalResult && (evalResult.result === 'correct' || evalResult.result === 'wrong')) {
        handleNext();
      }
    }
  };

  // 全体進捗のサマリー計算
  const masteryProgress = useMemo(() => {
    const state = loadMasteryState();
    const patterns = getPatternsByLevel(selectedCefr);
    const vocabs = getVocabMasterByLevel(selectedCefr);
    const total = (targetScope === 'vocab' ? 0 : patterns.length) + (targetScope === 'pattern' ? 0 : vocabs.length);
    if (total === 0) return { mastered: 0, total: 0, percentage: 0 };

    let mastered = 0;
    if (targetScope === 'all' || targetScope === 'pattern') {
      mastered += patterns.filter((p) => {
        const m = state.patterns[p.id];
        const status = drillType === 'assembly' ? m?.assemblyStatus : m?.comprehensionStatus;
        return status === 'mastered' || m?.status === 'mastered';
      }).length;
    }

    if (targetScope === 'all' || targetScope === 'vocab') {
      mastered += vocabs.filter((v) => {
        const m = state.vocabs[v.id.toLowerCase()] || state.vocabs[v.phrase.toLowerCase()];
        const status = drillType === 'assembly' ? m?.assemblyStatus : m?.comprehensionStatus;
        return status === 'mastered' || m?.status === 'mastered';
      }).length;
    }

    return {
      mastered,
      total,
      percentage: Math.round((mastered / total) * 100),
    };
  }, [selectedCefr, drillType, targetScope, evalResult]);

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20 px-3 sm:px-4 animate-fadeIn">
      {/* 1. Header & Quick Controls */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-gradient-to-tr from-amber-500 to-orange-500 rounded-2xl shadow-lg shadow-orange-500/20 text-white">
              <Zap className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                  瞬間英作文・構文スピードドリル
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                  {selectedCefr}
                </span>
                {drillQueue.length > 0 && (
                  <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <Sparkles className="w-2.5 h-2.5" />
                    {drillQueue.length + 1}問待機中
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm text-slate-400 font-medium">
                {drillType === 'assembly' ? '日本語を見て瞬時に英語を組み立てる' : '英文を見て意味を即座に理解する'}
              </p>
            </div>
          </div>

          {/* Streak & Score */}
          <div className="flex items-center space-x-3">
            {sessionTotalCount > 0 && (
              <span className="text-xs text-slate-400 font-bold bg-slate-800 px-3 py-1 rounded-full border border-slate-700">
                {sessionCorrectCount} / {sessionTotalCount} 問正解
              </span>
            )}

            {currentStreak > 1 && (
              <div className="flex items-center space-x-1 px-3 py-1 bg-amber-500/10 border border-amber-500/30 rounded-full text-amber-400 text-xs font-bold animate-pulse">
                <Flame className="w-3.5 h-3.5" />
                <span>{currentStreak} 連問正解!</span>
              </div>
            )}

            <button
              type="button"
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-colors border border-slate-700"
              title="設定"
            >
              <Settings2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Collapsible Settings Drawer */}
        {isSettingsOpen && (
          <div className="pt-3 border-t border-slate-800 space-y-3 animate-fadeIn">
            <div className="flex flex-wrap items-center gap-3">
              {/* CEFR Level Tabs */}
              <div className="flex items-center space-x-1">
                {(['A1', 'A2', 'B1', 'B2', 'C1'] as CefrLevel[]).map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setSelectedCefr(lvl)}
                    className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${
                      selectedCefr === lvl
                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                        : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                    }`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>

              {/* Mode Toggle */}
              <div className="flex items-center space-x-1 border-l border-slate-800 pl-3">
                <button
                  type="button"
                  onClick={() => setDrillType('assembly')}
                  className={`flex items-center space-x-1 px-3 py-1 rounded-xl text-xs font-bold transition-all ${
                    drillType === 'assembly'
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                      : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                  }`}
                >
                  <PenTool className="w-3 h-3" />
                  <span>✍️ 組立</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDrillType('comprehension')}
                  className={`flex items-center space-x-1 px-3 py-1 rounded-xl text-xs font-bold transition-all ${
                    drillType === 'comprehension'
                      ? 'bg-cyan-600 text-white shadow-md shadow-cyan-600/30'
                      : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                  }`}
                >
                  <BookOpen className="w-3 h-3" />
                  <span>📖 理解</span>
                </button>
              </div>

              {/* Target Scope Toggle */}
              <div className="flex items-center space-x-1 border-l border-slate-800 pl-3">
                <span className="text-xs font-bold text-slate-400 mr-1">対象:</span>
                <select
                  value={targetScope}
                  onChange={(e) => setTargetScope(e.target.value as DrillTargetScope)}
                  className="bg-slate-950 border border-slate-800 text-slate-300 text-xs rounded-xl px-3 py-1 font-semibold focus:outline-none focus:border-indigo-500"
                >
                  <option value="all">⚡ 構文 ＋ 重要単語 (総合)</option>
                  <option value="pattern">📐 構文・文法ルールのみ</option>
                  <option value="vocab">📚 重要単語・表現のみ</option>
                </select>
              </div>

              {/* Filter */}
              <div className="flex items-center space-x-1.5 border-l border-slate-800 pl-3">
                <span className="text-xs font-bold text-slate-400 mr-1">出題:</span>
                <select
                  value={filterMode}
                  onChange={(e) => setFilterMode(e.target.value as DrillFilterMode)}
                  className="bg-slate-950 border border-slate-800 text-slate-300 text-xs rounded-xl px-3 py-1 font-semibold focus:outline-none focus:border-indigo-500"
                >
                  <option value="unseen">🚀 未着手を高速仕分け（推奨）</option>
                  <option value="lapsed">🔥 苦手・ミスを再挑戦</option>
                  <option value="all">🎲 おまかせ出題</option>
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Level Completion Notice */}
      {levelCompletionNotice && (
        <div className="bg-gradient-to-r from-emerald-950/60 to-slate-900 border border-emerald-500/30 rounded-2xl p-4 text-emerald-300 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{levelCompletionNotice}</span>
        </div>
      )}

      {/* 2. Main Question Card */}
      {isQueueLoading && !currentDrillItem ? (
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-12 shadow-2xl text-center space-y-4">
          <RefreshCw className="w-8 h-8 animate-spin text-indigo-400 mx-auto" />
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-white">AI先行出題キューを準備中...</h3>
            <p className="text-xs text-slate-400">
              未遭遇の{targetScope === 'vocab' ? '単語' : targetScope === 'pattern' ? '構文' : '構文・単語'}から自然な会話問題をバックグラウンド生成しています
            </p>
          </div>
        </div>
      ) : currentDrillItem ? (
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
          {/* Card Category Header */}
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-0.5 rounded-lg bg-indigo-950/80 text-indigo-300 text-xs font-bold border border-indigo-500/30 flex items-center gap-1">
                {currentDrillItem.targetType === 'pattern' ? (
                  <>
                    <Layers className="w-3 h-3 text-indigo-400" />
                    <span>{(currentDrillItem.item as PatternMasterItem).categoryLabel || '文法・構文'}</span>
                  </>
                ) : (
                  <>
                    <BookOpen className="w-3 h-3 text-emerald-400" />
                    <span>重要単語・イディオム</span>
                  </>
                )}
              </span>

              <span className="text-xs font-semibold text-slate-400">
                {currentDrillItem.targetType === 'pattern'
                  ? (currentDrillItem.item as PatternMasterItem).name
                  : (currentDrillItem.item as VocabMasterItem).phrase}
              </span>
            </div>

            <div className="text-xs text-slate-500 font-medium">
              {selectedCefr} レベル
            </div>
          </div>

          {/* Question Prompt */}
          <div className="space-y-3 text-center py-5">
            <span className="text-xs font-bold text-slate-400 tracking-wider block">
              {drillType === 'assembly'
                ? '【この日本語を英語で表現してください】'
                : '【この英文の意味を理解できますか？】'}
            </span>
            <div className="text-2xl sm:text-3xl font-extrabold text-white leading-snug tracking-tight min-h-[48px] flex items-center justify-center">
              `「${drillType === 'assembly' 
                ? currentDrillItem.question.translationJa 
                : currentDrillItem.question.sentenceEn}」`
            </div>
            {drillType === 'comprehension' && (
              <div className="flex justify-center pt-1">
                <button
                  type="button"
                  onClick={() => speakText(currentDrillItem.question.sentenceEn)}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-full text-xs font-semibold transition-all"
                >
                  <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
                  <span>発音を聴く</span>
                </button>
              </div>
            )}
          </div>

          {/* Input & Action Section */}
          {!evalResult ? (
            <form onSubmit={handleSubmitAnswer} className="space-y-4">
              <div className="relative">
                <input
                  ref={inputRef}
                  type="text"
                  value={userAnswer}
                  onChange={(e) => setUserAnswer(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    drillType === 'assembly'
                      ? '英語を入力（例: I used to live here...）'
                      : '日本語の意味を入力、または頭の中で理解できたら「正解確認」'
                  }
                  disabled={isEvaluating}
                  className="w-full bg-slate-950 border-2 border-slate-700 focus:border-indigo-500 rounded-2xl px-5 py-4 text-white placeholder-slate-500 text-base sm:text-lg font-medium outline-none transition-all shadow-inner"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleGiveUp}
                  disabled={isEvaluating}
                  className="px-4 py-3 bg-slate-800 hover:bg-slate-750 text-slate-400 hover:text-slate-200 rounded-2xl text-xs sm:text-sm font-bold transition-all border border-slate-700"
                >
                  わからない（模範解答・Anki登録）
                </button>

                <button
                  type="submit"
                  disabled={!userAnswer.trim() || isEvaluating}
                  className="flex items-center space-x-2 px-8 py-3.5 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-2xl text-sm sm:text-base font-extrabold shadow-lg shadow-indigo-600/30 transition-all active:scale-95"
                >
                  {isEvaluating ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>AI添削中...</span>
                    </>
                  ) : (
                    <>
                      <span>回答を判定</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </form>
          ) : (
            /* Result Feedback Card */
            <div
              className={`rounded-2xl p-5 sm:p-6 space-y-4 border animate-fadeIn ${
                evalResult.result === 'correct'
                  ? 'bg-emerald-950/20 border-emerald-500/40'
                  : 'bg-red-950/20 border-red-500/40'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center space-x-2.5">
                  {evalResult.result === 'correct' ? (
                    <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-xl border border-emerald-500/30">
                      <CheckCircle2 className="w-6 h-6" />
                    </div>
                  ) : (
                    <div className="p-2 bg-red-500/20 text-red-400 rounded-xl border border-red-500/30">
                      <AlertCircle className="w-6 h-6" />
                    </div>
                  )}
                  <div>
                    <h3
                      className={`text-lg font-black tracking-tight ${
                        evalResult.result === 'correct' ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {evalResult.result === 'correct' ? '🎉 完全正解！' : '惜しい！もう一歩'}
                    </h3>
                    {evalResult.errorReason && (
                      <span className="text-xs text-slate-400 font-semibold">
                        タグ: {evalResult.errorReason}
                      </span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => speakText(evalResult.correctedSentence || currentDrillItem.question.sentenceEn)}
                  className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-all border border-slate-700"
                  title="模範発音を聴く"
                >
                  <Volume2 className="w-4 h-4 text-cyan-400" />
                </button>
              </div>

              {/* Model Sentence & Breakdown */}
              <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-4 space-y-2">
                <div className="text-xs font-bold text-slate-400">模範解答:</div>
                <div className="text-base sm:text-lg font-extrabold text-white font-mono">
                  {evalResult.correctedSentence || currentDrillItem.question.sentenceEn}
                </div>
                <div className="text-xs text-slate-400">
                  訳: {currentDrillItem.question.translationJa}
                </div>
              </div>

              {/* Feedback text */}
              {evalResult.feedback && (
                <div className="text-xs sm:text-sm text-slate-300 leading-relaxed bg-slate-900/60 p-3.5 rounded-xl border border-slate-800">
                  <span className="font-bold text-indigo-300 mr-1.5">💡 AI解説:</span>
                  {evalResult.feedback}
                </div>
              )}

              {/* Auto Anki Registration Badge / Button */}
              {evalResult.result === 'wrong' && (
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                  {isSavedToAnki ? (
                    <div className="flex items-center gap-2 text-xs text-emerald-400 font-bold bg-emerald-950/40 border border-emerald-500/30 px-3 py-1.5 rounded-xl">
                      <Check className="w-3.5 h-3.5" />
                      <span>復習リスト（Anki）に自動登録しました</span>
                      <button
                        type="button"
                        onClick={handleUndoAnkiSave}
                        className="text-[11px] text-slate-400 hover:text-red-300 underline ml-2"
                      >
                        取り消す
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        const { item, targetType, question } = currentDrillItem;
                        const isPattern = targetType === 'pattern';
                        const p = isPattern ? (item as PatternMasterItem) : undefined;
                        const v = !isPattern ? (item as VocabMasterItem) : undefined;
                        const pair = saveSentenceCardWithSiblings({
                          sentence: evalResult.correctedSentence || question.sentenceEn,
                          translation: question.translationJa,
                          focusType: isPattern ? 'pattern' : 'word',
                          focusWord: isPattern ? p!.name : v!.phrase,
                          focusMeaning: isPattern ? p!.meaning : v!.meaning,
                        });
                        setIsSavedToAnki(true);
                        setLastSavedCardIds({ id1: pair.card1.id, id2: pair.card2.id });
                      }}
                      className="flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 border border-indigo-500/40 rounded-xl text-xs font-bold transition-all"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Anki復習カードに手動保存</span>
                    </button>
                  )}
                </div>
              )}

              {/* Next Action Bar */}
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={handleNext}
                  className="flex items-center space-x-2 px-8 py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl text-sm sm:text-base font-extrabold shadow-lg shadow-indigo-600/30 transition-all active:scale-95"
                >
                  <span>次の問題へ (Enter)</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* 3. Progress Stats Footer */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex items-center justify-between text-xs text-slate-400 font-semibold">
        <div className="flex items-center space-x-2">
          <Brain className="w-4 h-4 text-indigo-400" />
          <span>{selectedCefr} 習得進捗:</span>
          <span className="text-white font-mono">{masteryProgress.mastered} / {masteryProgress.total}</span>
          <span className="text-indigo-400 font-mono">({masteryProgress.percentage}%)</span>
        </div>

        {onNavigateToAnki && (
          <button
            type="button"
            onClick={onNavigateToAnki}
            className="text-indigo-400 hover:text-indigo-300 hover:underline flex items-center gap-1"
          >
            <span>Anki復習デッキを開く</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};
