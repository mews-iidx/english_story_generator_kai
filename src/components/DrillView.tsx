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
  ChevronDown,
  ChevronUp,
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
  const pickNextQuestion = useCallback((cefr: CefrLevel, mode: DrillFilterMode) => {
    const state = loadMasteryState();
    const patterns = getPatternsByLevel(cefr);
    if (!patterns || patterns.length === 0) return;

    let candidatePool: { pattern: PatternMasterItem; priority: number }[] = [];

    patterns.forEach(p => {
      const prog = state.patterns[p.id];
      const compStatus = prog?.comprehensionStatus || prog?.status || 'unseen';
      const assemStatus = prog?.assemblyStatus || 'unseen';
      const mistakeCount = prog?.mistakeCount || 0;

      const targetStatus = drillType === 'assembly' ? assemStatus : compStatus;

      // フィルター条件
      if (mode === 'unseen' && targetStatus !== 'unseen') return;
      if (mode === 'lapsed' && targetStatus !== 'lapsed' && mistakeCount === 0) return;

      // 優先度スコア計算
      let priority = 10;
      if (targetStatus === 'unseen') priority = 100;
      else if (targetStatus === 'lapsed') priority = 80 + mistakeCount * 2;
      else if (targetStatus === 'exposed') priority = 50;
      else if (targetStatus === 'mastered') priority = 10;

      candidatePool.push({ pattern: p, priority });
    });

    if (candidatePool.length === 0) {
      if (mode === 'unseen') {
        // 現在のレベルの未着手が全滅した時、自動で次のレベルを提案/移行
        const nextLevels: Record<CefrLevel, CefrLevel | null> = {
          A1: 'A2',
          A2: 'B1',
          B1: 'B2',
          B2: 'C1',
          C1: null,
        };
        const next = nextLevels[cefr];
        if (next) {
          setLevelCompletionNotice(`🎉 ${cefr}レベルの未着手構文をすべてクリアしました！次の【${next}】に進みます。`);
          setSelectedCefr(next);
          return;
        }
      }

      // 該当なしの場合は全件からランダム
      const randomP = patterns[Math.floor(Math.random() * patterns.length)];
      setCurrentPattern(randomP);
      setVariationIndex(Math.floor(Math.random() * (randomP.variations?.length || 1)));
      setUserAnswer('');
      setEvalResult(null);
      setIsSavedToAnki(false);
      return;
    }

    setLevelCompletionNotice(null);

    // 優先度上位からピック
    candidatePool.sort((a, b) => b.priority - a.priority);
    const topCandidates = candidatePool.slice(0, Math.min(6, candidatePool.length));
    const chosen = topCandidates[Math.floor(Math.random() * topCandidates.length)].pattern;

    setCurrentPattern(chosen);
    setVariationIndex(Math.floor(Math.random() * (chosen.variations?.length || 1)));
    setUserAnswer('');
    setEvalResult(null);
    setIsSavedToAnki(false);
  }, [drillType]);

  // 初回およびレベル/モード変更時の問題選定
  useEffect(() => {
    pickNextQuestion(selectedCefr, filterMode);
  }, [selectedCefr, filterMode, drillType, pickNextQuestion]);

  // フォーカス
  useEffect(() => {
    if (!isEvaluating && !evalResult) {
      inputRef.current?.focus();
    }
  }, [isEvaluating, evalResult, currentPattern]);

  const currentVariation = useMemo(() => {
    if (!currentPattern || !currentPattern.variations) return null;
    return currentPattern.variations[variationIndex] || currentPattern.variations[0];
  }, [currentPattern, variationIndex]);

  // 回答送信＆AI添削
  const handleSubmitAnswer = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!userAnswer.trim() || !currentPattern || isEvaluating) return;

    setIsEvaluating(true);
    const promptJa = currentVariation?.translation || currentPattern.meaning;

    try {
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
        // 一撃100%マスター記録
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
        // ミス記録 & 0%リセット
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

  // ワンタップ Anki 登録
  const handleSendToAnki = () => {
    if (!currentPattern || !currentVariation || isSavedToAnki) return;

    const targetSentence = evalResult?.correctedSentence || currentVariation.sentence;
    const targetTranslation = currentVariation.translation;

    saveSentenceCardWithSiblings({
      sentence: targetSentence,
      translation: targetTranslation,
      focusType: 'pattern',
      corePatterns: [{
        patternName: currentPattern.name,
        formula: currentPattern.focus,
        meaningTemplate: currentPattern.meaning,
        highlightTokens: currentVariation.targetTokens || [],
        briefNote: currentPattern.focus,
      }],
      importance: 5,
    });

    setIsSavedToAnki(true);
  };

  // 次の問題へ
  const handleNext = () => {
    pickNextQuestion(selectedCefr, filterMode);
  };

  // キーボードショートカット (Enter で送信 / 次へ)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (evalResult && evalResult.result !== 'alternative_hint') {
        handleNext();
      } else {
        handleSubmitAnswer();
      }
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5 animate-fadeIn">
      {/* Level Completion Toast */}
      {levelCompletionNotice && (
        <div className="p-4 bg-emerald-950/80 border border-emerald-500/40 rounded-2xl text-emerald-300 text-xs font-bold shadow-lg animate-slideDown flex items-center justify-between">
          <span>{levelCompletionNotice}</span>
          <button
            onClick={() => setLevelCompletionNotice(null)}
            className="text-emerald-400 hover:text-white px-2 py-0.5 rounded-lg"
          >
            ✕
          </button>
        </div>
      )}

      {/* 1. Compact Collapsible Header */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xl transition-all">
        <div className="flex items-center justify-between flex-wrap gap-2.5">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center shadow-md shadow-orange-500/20">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-sm sm:text-base font-extrabold text-white">
                瞬間ドリル
              </span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-600/20 text-blue-300 border border-blue-500/30 font-bold">
                {selectedCefr}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 font-semibold">
                {drillType === 'assembly' ? '✍️ 組立' : '📖 理解'}
              </span>
              <span className="text-[11px] text-slate-400 hidden sm:inline">
                ({filterMode === 'unseen' ? '未知優先' : filterMode === 'lapsed' ? '苦手優先' : 'おまかせ'})
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* Streak & Score */}
            {currentStreak > 1 && (
              <div className="flex items-center space-x-1 px-2.5 py-1 bg-amber-500/20 border border-amber-500/30 rounded-xl text-amber-300 font-bold text-xs animate-bounce">
                <Flame className="w-3.5 h-3.5 text-orange-400" />
                <span>{currentStreak}連正解!</span>
              </div>
            )}
            <div className="px-2.5 py-1 bg-slate-950/80 border border-slate-800 rounded-xl text-slate-300 font-semibold text-xs">
              正答: <strong className="text-emerald-400">{sessionCorrectCount}</strong> / {sessionTotalCount}
            </div>

            {/* Accordion Toggle */}
            <button
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              className="flex items-center space-x-1 p-2 bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 rounded-xl text-xs transition-colors"
              title="設定・レベル変更"
            >
              <Settings2 className="w-3.5 h-3.5" />
              {isSettingsOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          </div>
        </div>

        {/* Collapsed Setting Controls */}
        {isSettingsOpen && (
          <div className="pt-4 mt-3 border-t border-slate-800 space-y-3 animate-fadeIn">
            <div className="flex items-center justify-between flex-wrap gap-3">
              {/* CEFR Level Selector */}
              <div className="flex items-center space-x-1.5">
                <span className="text-xs font-bold text-slate-400 mr-1">レベル:</span>
                {(['A1', 'A2', 'B1', 'B2'] as CefrLevel[]).map(lvl => (
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
              <div className="flex items-center space-x-1.5">
                <span className="text-xs font-bold text-slate-400 mr-1">モード:</span>
                <button
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

      {/* 2. Main Question Card (ネタバレ・狙い非表示) */}
      {currentPattern && currentVariation ? (
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
          {/* Card Category Header (構文名や狙いは隠す) */}
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

          {/* Question Prompt (お題の日本語のみを堂々と表示) */}
          <div className="space-y-3 text-center py-5">
            <span className="text-xs font-bold text-slate-400 tracking-wider block">
              {drillType === 'assembly'
                ? '【この日本語を英語で表現してください】'
                : '【この英文の意味を理解できますか？】'}
            </span>
            <div className="text-2xl sm:text-3xl font-extrabold text-white leading-snug tracking-tight">
              「{currentVariation.translation}」
            </div>
          </div>

          {/* User Input & Form */}
          <form onSubmit={handleSubmitAnswer} className="space-y-3">
            <div className="relative">
              <input
                ref={inputRef}
                type="text"
                value={userAnswer}
                onChange={(e) => setUserAnswer(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isEvaluating || (evalResult !== null && evalResult.result !== 'alternative_hint')}
                placeholder={drillType === 'assembly' ? '英語全文を入力 (例: I used to live here.)' : '日本語の意味を入力'}
                className="w-full bg-slate-950/90 border-2 border-slate-700 focus:border-blue-500 rounded-2xl px-5 py-4 text-base sm:text-lg text-white font-medium placeholder-slate-500 shadow-inner focus:outline-none transition-all disabled:opacity-60"
              />

              <button
                type="submit"
                disabled={!userAnswer.trim() || isEvaluating || (evalResult !== null && evalResult.result !== 'alternative_hint')}
                className="absolute right-2 top-2 bottom-2 px-5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white rounded-xl font-bold text-sm flex items-center space-x-1.5 shadow-lg shadow-blue-600/25 transition-all disabled:opacity-50"
              >
                {isEvaluating ? (
                  <RefreshCw className="w-4 h-4 animate-spin text-white" />
                ) : (
                  <>
                    <span>判定</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>

            {/* わからない（ギブアップ）ボタン (判定前のみ表示) */}
            {!evalResult && (
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={handleGiveUp}
                  disabled={isEvaluating}
                  className="flex items-center space-x-1 text-xs text-slate-500 hover:text-slate-300 transition-colors py-1 px-2 rounded-lg hover:bg-slate-800/60"
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                  <span>わからない (模範解答を見る)</span>
                </button>
              </div>
            )}
          </form>

          {/* AI Feedback & Results (回答後に初めてターゲット構文を明かす) */}
          {evalResult && (
            <div className="space-y-4 animate-fadeIn pt-2">
              {evalResult.result === 'correct' && (
                <div className="p-5 bg-emerald-950/50 border border-emerald-500/40 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 text-emerald-400 font-extrabold text-base">
                      <CheckCircle2 className="w-5 h-5" />
                      <span>完全正解！一撃マスター達成 🎉</span>
                    </div>
                    <span className="text-xs font-bold text-emerald-300 bg-emerald-900/60 px-2.5 py-0.5 rounded-lg border border-emerald-500/30">
                      🎯 {currentPattern.name}
                    </span>
                  </div>

                  <p className="text-sm text-emerald-200/90 leading-relaxed">
                    {evalResult.feedback}
                  </p>

                  <div className="flex items-center justify-between p-3 bg-slate-950/80 border border-emerald-500/20 rounded-xl">
                    <div>
                      <span className="text-[10px] font-bold text-emerald-400 block">構文公式: {currentPattern.focus}</span>
                      <div className="text-sm font-bold text-white font-serif pt-0.5">
                        {evalResult.correctedSentence || currentVariation.sentence}
                      </div>
                    </div>
                    <button
                      onClick={() => speakText(evalResult.correctedSentence || currentVariation.sentence)}
                      className="p-1.5 text-emerald-400 hover:bg-emerald-950 rounded-lg transition-colors"
                      title="発音を再生"
                    >
                      <Volume2 className="w-4 h-4" />
                    </button>
                  </div>

                  <button
                    onClick={handleNext}
                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-lg shadow-emerald-600/30 flex items-center justify-center space-x-2 transition-all"
                  >
                    <span>次の問題へ (Enter)</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}

              {evalResult.result === 'alternative_hint' && (
                <div className="p-5 bg-amber-950/50 border border-amber-500/40 rounded-2xl space-y-3">
                  <div className="flex items-center space-x-2 text-amber-400 font-extrabold text-base">
                    <AlertCircle className="w-5 h-5" />
                    <span>意味は通じますが、指定構文を使ってみましょう！ 💡</span>
                  </div>
                  <p className="text-sm text-amber-200/90 leading-relaxed">
                    {evalResult.feedback}
                  </p>
                  <div className="text-xs text-amber-300/80 bg-slate-950/60 p-2.5 rounded-xl border border-amber-500/20">
                    🎯 今回使ってほしい構文: <strong>{currentPattern.focus}</strong>
                  </div>
                </div>
              )}

              {evalResult.result === 'wrong' && (
                <div className="p-5 bg-rose-950/50 border border-rose-500/40 rounded-2xl space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 text-rose-400 font-extrabold text-base">
                      <AlertCircle className="w-5 h-5" />
                      <span>不正解・要復習 ❌</span>
                    </div>
                    <span className="text-xs font-bold text-rose-300 bg-rose-900/60 px-2.5 py-0.5 rounded-lg border border-rose-500/30">
                      🎯 {currentPattern.name}
                    </span>
                  </div>

                  <p className="text-sm text-rose-200/90 leading-relaxed">
                    {evalResult.feedback}
                  </p>

                  <div className="flex items-center justify-between p-3 bg-slate-950/80 border border-rose-500/20 rounded-xl">
                    <div>
                      <span className="text-[10px] font-bold text-rose-400 block mb-0.5">
                        構文公式: {currentPattern.focus}
                      </span>
                      <div className="text-base font-bold text-white font-serif">
                        {evalResult.correctedSentence || currentVariation.sentence}
                      </div>
                    </div>
                    <button
                      onClick={() => speakText(evalResult.correctedSentence || currentVariation.sentence)}
                      className="p-1.5 text-rose-400 hover:bg-rose-950 rounded-lg transition-colors"
                      title="発音を再生"
                    >
                      <Volume2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center gap-2 pt-1">
                    <button
                      onClick={handleSendToAnki}
                      disabled={isSavedToAnki}
                      className={`w-full sm:w-1/2 py-3 rounded-xl font-bold text-xs flex items-center justify-center space-x-1.5 transition-all ${
                        isSavedToAnki
                          ? 'bg-slate-800 text-slate-400 border border-slate-700'
                          : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30'
                      }`}
                    >
                      <Plus className="w-4 h-4" />
                      <span>{isSavedToAnki ? '✅ Ankiにペアカード登録済み' : '🃏 1文ペアカードをAnkiに送る'}</span>
                    </button>

                    {onNavigateToAnki && isSavedToAnki && (
                      <button
                        onClick={onNavigateToAnki}
                        className="w-full sm:w-auto px-3 py-3 bg-indigo-950 hover:bg-indigo-900 border border-indigo-500/40 text-indigo-300 font-bold text-xs rounded-xl transition-all"
                      >
                        Ankiを開く ➔
                      </button>
                    )}

                    <button
                      onClick={handleNext}
                      className="w-full sm:w-1/2 py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl flex items-center justify-center space-x-1 transition-all border border-slate-700"
                    >
                      <span>次の問題へ (Enter)</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="p-8 text-center text-slate-400 bg-slate-900/50 rounded-3xl border border-slate-800 space-y-3">
          <p className="text-sm">該当する問題が見つかりませんでした。</p>
          <button
            onClick={() => {
              setSelectedCefr('A1');
              setFilterMode('all');
            }}
            className="px-4 py-2 bg-blue-600 text-white text-xs font-bold rounded-xl"
          >
            A1の全問から再開する
          </button>
        </div>
      )}
    </div>
  );
};
