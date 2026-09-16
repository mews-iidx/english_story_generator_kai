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
  HelpCircle
} from 'lucide-react';
import { PatternMasterItem } from '../types/mastery';
import { CefrLevel } from '../types/settings';
import { getPatternsByLevel } from '../data/cefrPatternsMaster';
import {
  loadMasteryState,
  recordDrillResult,
  saveSentenceCardWithSiblings
} from '../services/storage';
import { evaluateDrillAnswerWithGemini, EvaluateDrillResult } from '../services/gemini';
import { playCorrectSound, playWrongSound } from '../utils/audio';

interface DrillViewProps {
  apiKey: string;
  selectedModel?: string;
  userLevel?: CefrLevel;
  onNavigateToAnki?: () => void;
}

type DrillFilterMode = 'all' | 'unseen' | 'lapsed';

export const DrillView: React.FC<DrillViewProps> = ({
  apiKey,
  selectedModel = 'gemini-3.7-flash',
  userLevel,
  onNavigateToAnki,
}) => {
  // デフォルトでA1から未知を潰す
  const [selectedCefr, setSelectedCefr] = useState<CefrLevel>(userLevel || 'A1');

  const [drillType, setDrillType] = useState<'assembly' | 'comprehension'>('assembly');
  const [filterMode, setFilterMode] = useState<DrillFilterMode>('unseen');
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  
  const [currentPattern, setCurrentPattern] = useState<PatternMasterItem | null>(null);
  const [variationIndex, setVariationIndex] = useState<number>(0);
  const [userAnswer, setUserAnswer] = useState<string>('');
  
  const [isEvaluating, setIsEvaluating] = useState<boolean>(false);
  const [evalResult, setEvalResult] = useState<EvaluateDrillResult | null>(null);
  const [isSavedToAnki, setIsSavedToAnki] = useState<boolean>(false);

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

  // 出題候補リストの取得＆優先度ソート (A1から順次未知を潰す)
  const pickNextQuestion = useCallback((cefr: CefrLevel, mode: DrillFilterMode, type: 'assembly' | 'comprehension') => {
    const state = loadMasteryState();
    const patterns = getPatternsByLevel(cefr);

    if (!patterns || patterns.length === 0) {
      setCurrentPattern(null);
      return;
    }

    let candidatePool: PatternMasterItem[] = [];

    if (mode === 'unseen') {
      candidatePool = patterns.filter(p => {
        const m = state.patterns[p.id];
        const targetStatus = type === 'assembly' ? m?.assemblyStatus : m?.comprehensionStatus;
        return !m || !targetStatus || targetStatus === 'unseen';
      });
      if (candidatePool.length === 0) {
        setLevelCompletionNotice(`🎉 おめでとうございます！ ${cefr} レベルの構文はすべて確認済みです！`);
        candidatePool = patterns;
      } else {
        setLevelCompletionNotice(null);
      }
    } else if (mode === 'lapsed') {
      candidatePool = patterns.filter(p => {
        const m = state.patterns[p.id];
        const targetStatus = type === 'assembly' ? m?.assemblyStatus : m?.comprehensionStatus;
        return m && (targetStatus === 'lapsed' || ((m.mistakeCount || 0) > 0 && targetStatus !== 'mastered'));
      });
      if (candidatePool.length === 0) {
        setLevelCompletionNotice(`✨ 素晴らしい！ ${cefr} レベルに苦手・要復習の構文はありません！`);
        candidatePool = patterns;
      } else {
        setLevelCompletionNotice(null);
      }
    } else {
      candidatePool = [...patterns].sort((a, b) => {
        const mA = state.patterns[a.id];
        const mB = state.patterns[b.id];
        const statusA = type === 'assembly' ? mA?.assemblyStatus : mA?.comprehensionStatus;
        const statusB = type === 'assembly' ? mB?.assemblyStatus : mB?.comprehensionStatus;
        const rank = (s?: string) => (s === 'lapsed' ? 0 : !s || s === 'unseen' ? 1 : s === 'exposed' ? 2 : 3);
        return rank(statusA) - rank(statusB);
      });
      setLevelCompletionNotice(null);
    }

    const selected = candidatePool[Math.floor(Math.random() * candidatePool.length)];
    setCurrentPattern(selected);
    
    const varCount = selected.variations?.length || 3;
    setVariationIndex(Math.floor(Math.random() * varCount));

    setUserAnswer('');
    setEvalResult(null);
    setIsSavedToAnki(false);
  }, []);

  // レベルやモード変更時に次の問題をピック
  useEffect(() => {
    pickNextQuestion(selectedCefr, filterMode, drillType);
  }, [selectedCefr, filterMode, drillType, pickNextQuestion]);

  // 入力フォーカス
  useEffect(() => {
    if (!isEvaluating && !evalResult) {
      inputRef.current?.focus();
    }
  }, [currentPattern, isEvaluating, evalResult]);

  // 現在の例文データ
  const currentVariation = useMemo(() => {
    if (!currentPattern || !currentPattern.variations) {
      return null;
    }
    return currentPattern.variations[variationIndex] || currentPattern.variations[0];
  }, [currentPattern, variationIndex]);

  // 判定実行
  const handleSubmitAnswer = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!userAnswer.trim() || !currentPattern || !currentVariation || isEvaluating) return;

    setIsEvaluating(true);
    try {
      const promptJa = currentVariation.translation || currentPattern.meaning;
      
      const result = await evaluateDrillAnswerWithGemini({
        promptJa,
        targetItem: {
          id: currentPattern.id,
          name: currentPattern.name,
          meaning: currentPattern.meaning,
          focus: currentPattern.focus,
          sampleSentences: currentPattern.variations?.map(v => v.sentence) || [],
        },
        drillType,
        userAnswer: userAnswer.trim(),
        apiKey,
        model: selectedModel,
      });

      setEvalResult(result);
      setSessionTotalCount(prev => prev + 1);

      if (result.result === 'correct') {
        playCorrectSound();
        setSessionCorrectCount(prev => prev + 1);
        setCurrentStreak(prev => prev + 1);
        speakText(result.correctedSentence || currentVariation?.sentence || userAnswer);
        
        recordDrillResult({
          itemId: currentPattern.id,
          itemType: 'pattern',
          drillType,
          cefr: selectedCefr,
          result: 'correct',
          userResponse: userAnswer.trim(),
          feedback: result.feedback,
          correctedSentence: result.correctedSentence,
        });
      } else if (result.result === 'wrong') {
        playWrongSound();
        setCurrentStreak(0);
        speakText(result.correctedSentence || currentVariation?.sentence || '');
        
        recordDrillResult({
          itemId: currentPattern.id,
          itemType: 'pattern',
          drillType,
          cefr: selectedCefr,
          result: 'wrong',
          userResponse: userAnswer.trim(),
          feedback: result.feedback,
          correctedSentence: result.correctedSentence,
          errorReason: result.errorReason,
        });
      }
    } catch (err) {
      console.error('Drill evaluation failed', err);
    } finally {
      setIsEvaluating(false);
    }
  };

  // わからない（ギブアップ）ボタン
  const handleGiveUp = () => {
    if (!currentPattern || !currentVariation || isEvaluating) return;

    setIsEvaluating(true);
    const modelSentence = currentVariation.sentence;
    const result: EvaluateDrillResult = {
      result: 'wrong',
      feedback: `正解の構文は【${currentPattern.name}】です。公式: ${currentPattern.focus}。模範解答を確認してAnkiに登録しましょう！`,
      correctedSentence: modelSentence,
      errorReason: '未習得・ギブアップ',
    };

    setEvalResult(result);
    setSessionTotalCount(prev => prev + 1);
    setCurrentStreak(0);
    playWrongSound();
    speakText(modelSentence);

    recordDrillResult({
      itemId: currentPattern.id,
      itemType: 'pattern',
      drillType,
      cefr: selectedCefr,
      result: 'wrong',
      userResponse: '（ギブアップ）',
      feedback: result.feedback,
      correctedSentence: modelSentence,
      errorReason: '未習得・ギブアップ',
    });

    setIsEvaluating(false);
  };

  // Ankiへ3連バリエーション丸ごと武器化保存
  const handleSaveToAnki = () => {
    if (!currentPattern || !currentVariation || isSavedToAnki) return;

    saveSentenceCardWithSiblings({
      sentence: evalResult?.correctedSentence || currentVariation.sentence,
      translation: currentVariation.translation,
      focusType: 'pattern',
      focusWord: currentPattern.focus || currentPattern.name,
      focusMeaning: currentPattern.meaning,
      corePatterns: [{
        patternName: currentPattern.name,
        formula: currentPattern.focus,
        meaningTemplate: currentPattern.meaning,
        highlightTokens: currentVariation.targetTokens || [],
        briefNote: currentPattern.meaning,
      }],
    });

    setIsSavedToAnki(true);
  };

  // 次の問題へ
  const handleNext = () => {
    pickNextQuestion(selectedCefr, filterMode, drillType);
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
    const total = patterns.length;
    if (total === 0) return { mastered: 0, total: 0, percentage: 0 };

    const mastered = patterns.filter(p => {
      const m = state.patterns[p.id];
      const targetStatus = drillType === 'assembly' ? m?.assemblyStatus : m?.comprehensionStatus;
      return targetStatus === 'mastered' || m?.status === 'mastered';
    }).length;

    return {
      mastered,
      total,
      percentage: Math.round((mastered / total) * 100),
    };
  }, [selectedCefr, drillType, evalResult]);

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
                  構文スピード仕分けドリル
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-blue-500/20 text-blue-400 border border-blue-500/30">
                  {selectedCefr}
                </span>
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
                    onClick={() => setSelectedCefr(lvl)}
                    className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${
                      selectedCefr === lvl
                        ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
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
                  onClick={() => setDrillType('assembly')}
                  className={`flex items-center space-x-1 px-3 py-1 rounded-xl text-xs font-bold transition-all ${
                    drillType === 'assembly'
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                      : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                  }`}
                >
                  <PenTool className="w-3 h-3" />
                  <span>✍️ 組立</span>
                </button>
                <button
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

              {/* Filter */}
              <div className="flex items-center space-x-1.5">
                <span className="text-xs font-bold text-slate-400 mr-1">出題:</span>
                <select
                  value={filterMode}
                  onChange={(e) => setFilterMode(e.target.value as DrillFilterMode)}
                  className="bg-slate-950 border border-slate-800 text-slate-300 text-xs rounded-xl px-3 py-1 font-semibold focus:outline-none focus:border-blue-500"
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

      {/* 2. Main Question Card */}
      {currentPattern && currentVariation ? (
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
          {/* Card Category Header */}
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-0.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-bold border border-slate-700">
                {currentPattern.categoryLabel || '文法・構文'}
              </span>
              <span className="text-xs text-slate-500 font-medium">
                {selectedCefr} レベル
              </span>
            </div>
          </div>

          {/* Question Prompt */}
          <div className="space-y-3 text-center py-5">
            <span className="text-xs font-bold text-slate-400 tracking-wider block">
              {drillType === 'assembly'
                ? '【この日本語を英語で表現してください】'
                : '【この英文の意味を理解できますか？】'}
            </span>
            <div className="text-2xl sm:text-3xl font-extrabold text-white leading-snug tracking-tight">
              「{drillType === 'assembly' ? currentVariation.translation : currentVariation.sentence}」
            </div>
            {drillType === 'comprehension' && (
              <div className="flex justify-center pt-1">
                <button
                  type="button"
                  onClick={() => speakText(currentVariation.sentence)}
                  className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded-xl text-xs font-semibold transition-all"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>音声を聞く</span>
                </button>
              </div>
            )}
          </div>

          {/* User Input & Form */}
          <form onSubmit={handleSubmitAnswer} className="space-y-4">
            <div className="relative">
              <input
                ref={inputRef}
                type="text"
                value={userAnswer}
                onChange={(e) => setUserAnswer(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isEvaluating || (evalResult !== null && evalResult.result !== 'alternative_hint')}
                placeholder={drillType === 'assembly' ? '英語全文を入力 (例: I used to live here.)' : '日本語の意味を入力（または「わからない」で模範解答確認）'}
                className="w-full bg-slate-950/90 border-2 border-slate-700 focus:border-blue-500 rounded-2xl px-5 py-4 text-base sm:text-lg text-white font-medium placeholder-slate-500 shadow-inner focus:outline-none transition-all disabled:opacity-60"
              />

              {/* Enter badge */}
              <div className="absolute right-4 top-1/2 -translate-y-1/2 hidden sm:flex items-center space-x-1 text-slate-500 text-xs font-mono pointer-events-none">
                <kbd className="px-2 py-1 bg-slate-800 rounded-md border border-slate-700">Enter</kbd>
              </div>
            </div>

            {/* Action Buttons */}
            {!evalResult && (
              <div className="flex items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleGiveUp}
                  disabled={isEvaluating}
                  className="flex items-center space-x-1 px-4 py-3 bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white rounded-2xl text-xs font-bold transition-all disabled:opacity-50"
                >
                  <HelpCircle className="w-4 h-4 text-slate-400" />
                  <span>わからない (答えを見る)</span>
                </button>

                <button
                  type="submit"
                  disabled={isEvaluating || !userAnswer.trim()}
                  className="flex-1 sm:flex-initial flex items-center justify-center space-x-2 px-8 py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold rounded-2xl shadow-lg shadow-blue-600/30 transition-all disabled:opacity-50 disabled:shadow-none"
                >
                  {isEvaluating ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>AI採点中...</span>
                    </>
                  ) : (
                    <>
                      <span>回答する</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            )}
          </form>

          {/* AI Feedback & Results (回答後にターゲット構文と英日ペアを明かす) */}
          {evalResult && (
            <div className="space-y-4 animate-fadeIn pt-2">
              {evalResult.result === 'correct' && (
                <div className="p-5 bg-emerald-950/40 border-2 border-emerald-500/40 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 text-emerald-400 font-extrabold text-base">
                      <CheckCircle2 className="w-5 h-5" />
                      <span>正解！お見事です 🎉</span>
                    </div>
                    <span className="text-xs font-bold text-emerald-300 bg-emerald-900/60 px-2.5 py-0.5 rounded-lg border border-emerald-500/30">
                      🎯 {currentPattern.name}
                    </span>
                  </div>

                  <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                    {evalResult.feedback}
                  </p>

                  <div className="p-3.5 bg-slate-950/80 border border-emerald-500/20 rounded-xl space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-emerald-400 block">構文公式: {currentPattern.focus}</span>
                      <button
                        onClick={() => speakText(evalResult.correctedSentence || currentVariation.sentence)}
                        className="p-1.5 text-emerald-400 hover:bg-emerald-950 rounded-lg transition-colors"
                        title="発音を再生"
                      >
                        <Volume2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="text-sm font-bold text-white font-serif">
                      {evalResult.correctedSentence || currentVariation.sentence}
                    </div>
                    <div className="text-xs text-slate-300">
                      {currentVariation.translation}
                    </div>
                  </div>

                  <button
                    onClick={handleNext}
                    className="w-full flex items-center justify-center space-x-2 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-lg shadow-emerald-600/30 transition-all text-sm mt-2"
                  >
                    <span>次へ進む (Enter)</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              )}

              {evalResult.result === 'wrong' && (
                <div className="p-5 bg-rose-950/40 border-2 border-rose-500/40 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 text-rose-400 font-extrabold text-base">
                      <AlertCircle className="w-5 h-5" />
                      <span>要復習 ❌</span>
                    </div>
                    <span className="text-xs font-bold text-rose-300 bg-rose-900/60 px-2.5 py-0.5 rounded-lg border border-rose-500/30">
                      🎯 {currentPattern.name}
                    </span>
                  </div>

                  <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                    {evalResult.feedback}
                  </p>

                  <div className="p-3.5 bg-slate-950/80 border border-rose-500/20 rounded-xl space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-rose-400 block mb-0.5">
                        構文公式: {currentPattern.focus}
                      </span>
                      <button
                        onClick={() => speakText(evalResult.correctedSentence || currentVariation.sentence)}
                        className="p-1.5 text-rose-400 hover:bg-rose-950 rounded-lg transition-colors"
                        title="発音を再生"
                      >
                        <Volume2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="text-base font-bold text-white font-serif">
                      {evalResult.correctedSentence || currentVariation.sentence}
                    </div>
                    <div className="text-xs text-slate-300">
                      {currentVariation.translation}
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center gap-2 pt-1">
                    <button
                      onClick={handleSaveToAnki}
                      disabled={isSavedToAnki}
                      className={`flex-1 w-full flex items-center justify-center space-x-2 py-3 rounded-xl font-bold text-xs transition-all ${
                        isSavedToAnki
                          ? 'bg-slate-800 text-emerald-400 border border-emerald-500/30'
                          : 'bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white shadow-lg shadow-orange-600/30'
                      }`}
                    >
                      {isSavedToAnki ? (
                        <>
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Ankiに3連バリエーション登録済み</span>
                        </>
                      ) : (
                        <>
                          <Plus className="w-4 h-4" />
                          <span>Ankiに3連バリエーションを武器化登録</span>
                        </>
                      )}
                    </button>

                    <button
                      onClick={handleNext}
                      className="flex-1 w-full flex items-center justify-center space-x-2 py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl transition-all text-xs border border-slate-700"
                    >
                      <span>次の問題へ (Enter)</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {evalResult.result === 'alternative_hint' && (
                <div className="p-4 bg-amber-950/40 border border-amber-500/40 rounded-2xl space-y-2">
                  <div className="flex items-center space-x-2 text-amber-400 font-bold text-sm">
                    <HelpCircle className="w-4 h-4" />
                    <span>惜しい！別の表現・構文で再挑戦</span>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-300">
                    {evalResult.feedback}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-12 text-center space-y-4">
          <Zap className="w-12 h-12 text-blue-400 mx-auto animate-bounce" />
          <h3 className="text-xl font-bold text-white">
            {levelCompletionNotice || '該当する問題が見つかりません'}
          </h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto">
            フィルターを変更するか、別のCEFRレベルを選択してください。
          </p>
          <div className="pt-2 flex justify-center gap-3">
            <button
              onClick={() => setFilterMode('all')}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs transition-all"
            >
              おまかせ出題で復習する
            </button>
            {onNavigateToAnki && (
              <button
                onClick={onNavigateToAnki}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-xl text-xs transition-all border border-slate-700"
              >
                Ankiカードで復習する
              </button>
            )}
          </div>
        </div>
      )}

      {/* 3. Bottom Mastery Status Card */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-blue-500/10 rounded-xl text-blue-400 border border-blue-500/20">
            <Zap className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-400">
              {selectedCefr} 構文マスター率
            </div>
            <div className="text-sm font-extrabold text-white">
              {masteryProgress.mastered} / {masteryProgress.total} 構文習得 ({masteryProgress.percentage}%)
            </div>
          </div>
        </div>

        {onNavigateToAnki && (
          <button
            onClick={onNavigateToAnki}
            className="flex items-center space-x-1 text-xs font-bold text-blue-400 hover:text-blue-300 transition-colors"
          >
            <span>Ankiカード一覧へ</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};
