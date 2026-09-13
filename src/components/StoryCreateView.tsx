import React, { useState } from 'react';
import { CefrLevel } from '../types/settings';
import { ContentType } from '../types/story';
import { Sparkles, RefreshCw, Minus, Plus, Layers, Clock, Mic, MessageSquare, BookOpen, Link, FileText, Compass } from 'lucide-react';
import { getUnmasteredTargetPatterns, getUnmasteredTargetVocabs } from '../services/storage';

interface StoryCreateViewProps {
  currentLevel: CefrLevel;
  onLevelChange: (level: CefrLevel) => void;
  isGenerating: boolean;
  generatingTheme?: string;
  generatingProgress?: { current: number; total: number; message: string };
  onGenerateStory: (prompt?: string, wordCount?: number, contentType?: ContentType, storyCount?: number, isContinuous?: boolean) => void;
  onOpenImportModal: () => void;
  onNavigateToBookshelf: () => void;
}

export const StoryCreateView: React.FC<StoryCreateViewProps> = ({
  currentLevel,
  onLevelChange,
  isGenerating,
  generatingTheme,
  generatingProgress,
  onGenerateStory,
  onOpenImportModal,
  onNavigateToBookshelf,
}) => {
  const [contentType, setContentType] = useState<ContentType>('podcast');
  const [storyCount, setStoryCount] = useState<number>(1);
  const [isContinuous, setIsContinuous] = useState<boolean>(true);
  const [promptInput, setPromptInput] = useState('');
  const [wordCount, setWordCount] = useState<number>(700);

  // 未習得構文・単語のプレビュー数
  const levelKey = (currentLevel === 'C1' ? 'B2' : currentLevel) as 'A1' | 'A2' | 'B1' | 'B2';
  const targetPatterns = getUnmasteredTargetPatterns(levelKey, 3);
  const targetVocabs = getUnmasteredTargetVocabs(levelKey, 4);

  const changeWordCount = (delta: number) => {
    setWordCount(prev => Math.max(100, Math.min(2500, (prev || 700) + delta)));
  };

  const changeStoryCount = (delta: number) => {
    setStoryCount(prev => Math.max(1, Math.min(5, (prev || 1) + delta)));
  };

  const handleStartGeneration = () => {
    if (isGenerating) return;
    onGenerateStory(promptInput, wordCount, contentType, storyCount, isContinuous);
  };

  const quickTopics = [
    { label: '☕ 日常・カフェ', text: 'カフェでの朝のひとときと日常のささやかな発見' },
    { label: '✈️ 旅行・空港', text: '初めての海外旅行でのハプニングと温かい出会い' },
    { label: '💼 仕事・キャリア', text: '新しいプロジェクトへの挑戦とチームとの対話' },
    { label: '🤖 テクノロジー', text: 'AIと未来のライフスタイルについての考察' },
    { label: '🍳 料理・食事', text: '祖母直伝の秘伝レシピと家族の思い出' },
    { label: '🌲 自然・冒険', text: '週末の森のハイキングと静寂の中の気付き' },
  ];

  const levelDescriptions: Record<CefrLevel, { name: string; desc: string }> = {
    A1: { name: '超初級 (A1)', desc: '中学1〜2年レベル。基本単語と短い文で読みやすい' },
    A2: { name: '初級 (A2)', desc: '中学3年〜日常会話基礎。身近な表現とシンプルな構文' },
    B1: { name: '中級 (B1)', desc: '高校〜日常英会話。標準的な語彙でスムーズな展開' },
    B2: { name: '中上級 (B2)', desc: '自然なイディオムや句動詞を含む豊かな表現' },
    C1: { name: '上級 (C1)', desc: '高度で洗練された語彙と多彩な表現' },
  };

  const contentTypes: { id: ContentType; label: string; icon: React.ComponentType<{ className?: string }>; desc: string }[] = [
    {
      id: 'podcast',
      label: '🎙️ ポッドキャスト風エッセイ',
      icon: Mic,
      desc: '『Listening Time』風の親しみやすい1人語りエッセイ',
    },
    {
      id: 'story',
      label: '📖 ショートストーリー',
      icon: BookOpen,
      desc: '情景が浮かび上がる起承転結のある短編小説',
    },
    {
      id: 'dialogue',
      label: '💬 日常会話劇 (Dialogue)',
      icon: MessageSquare,
      desc: '2人の登場人物によるテンポの良いリアルな対話',
    },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      {/* 1. Header */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-7 shadow-2xl space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/25">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                物語・スクリプト作成スタジオ ✨
              </h2>
              <p className="text-xs sm:text-sm text-slate-400">
                CEFR未習得構文・重要語彙をAIが自動選定し、あなたのレベルに合わせたストーリーを執筆します
              </p>
            </div>
          </div>

          <button
            onClick={onOpenImportModal}
            className="flex items-center space-x-1.5 px-3.5 py-2 bg-slate-950 hover:bg-slate-800 text-blue-400 border border-blue-500/30 rounded-xl text-xs font-semibold transition-colors"
          >
            <FileText className="w-4 h-4" />
            <span>テキスト直接インポート</span>
          </button>
        </div>
      </div>

      {/* Generation Status Indicator (if currently running) */}
      {isGenerating && (
        <div className="p-4 bg-blue-950/60 border border-blue-500/40 rounded-3xl flex items-center justify-between gap-4 animate-pulse">
          <div className="flex items-center space-x-3">
            <RefreshCw className="w-5 h-5 text-blue-400 animate-spin" />
            <div>
              <div className="text-sm font-bold text-white">
                バックグラウンドでストーリーを執筆中...
                {generatingProgress && ` [${generatingProgress.current}/${generatingProgress.total} 話]`}
              </div>
              <div className="text-xs text-blue-300">
                {generatingTheme ? `テーマ: 「${generatingTheme}」 | ` : ''}{generatingProgress?.message || 'AIが構成・英文・翻訳・重要語彙を精査しています'}
              </div>
            </div>
          </div>

          <button
            onClick={onNavigateToBookshelf}
            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-colors whitespace-nowrap"
          >
            本棚を見る
          </button>
        </div>
      )}

      {/* Main Studio Settings Panel */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-7 shadow-2xl space-y-6">
        
        {/* Step 1: Content Format */}
        <div className="space-y-3">
          <label className="text-xs sm:text-sm font-bold text-white flex items-center gap-2">
            <Mic className="w-4 h-4 text-blue-400" />
            <span>1. フォーマット形式を選択:</span>
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {contentTypes.map((opt) => {
              const isSelected = contentType === opt.id;
              const Icon = opt.icon;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setContentType(opt.id)}
                  className={`p-4 rounded-2xl border text-left transition-all relative flex flex-col justify-between ${
                    isSelected
                      ? 'bg-blue-600/15 border-blue-500 text-white shadow-lg shadow-blue-500/10 ring-1 ring-blue-500'
                      : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-900/80'
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center space-x-2">
                      <Icon className={`w-4 h-4 ${isSelected ? 'text-blue-400' : 'text-slate-400'}`} />
                      <span className="font-bold text-sm sm:text-base">{opt.label}</span>
                    </div>
                    <p className={`text-xs leading-relaxed ${isSelected ? 'text-slate-300' : 'text-slate-400'}`}>
                      {opt.desc}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Step 2: Story Count & Continuity */}
        <div className="space-y-4 pt-2 border-t border-slate-800/80">
          <div className="flex items-center justify-between">
            <label className="text-xs sm:text-sm font-bold text-white flex items-center gap-2">
              <Compass className="w-4 h-4 text-blue-400" />
              <span>2. 連続生成数（話数）と連続性:</span>
            </label>
            <span className="text-xs font-bold text-blue-400">
              {storyCount === 1 ? '単発 1話' : `${storyCount}話 ${isContinuous ? '連載' : 'オムニバス'}`}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            {/* Story count spinner */}
            <div className="flex items-center bg-slate-950 border border-slate-800 rounded-2xl p-1">
              <button
                type="button"
                onClick={() => changeStoryCount(-1)}
                disabled={storyCount <= 1}
                className="px-3 py-2 text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent rounded-xl transition-colors font-bold text-sm"
                title="1話減らす"
              >
                <Minus className="w-4 h-4" />
              </button>
              <div className="w-16 text-center text-base sm:text-lg font-bold text-blue-400 select-none">
                {storyCount} 話
              </div>
              <button
                type="button"
                onClick={() => changeStoryCount(1)}
                disabled={storyCount >= 5}
                className="px-3 py-2 text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent rounded-xl transition-colors font-bold text-sm"
                title="1話増やす"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            {/* Quick Count Preset Chips */}
            <div className="flex items-center space-x-1.5 text-xs">
              {[1, 2, 3, 5].map((count) => (
                <button
                  key={count}
                  type="button"
                  onClick={() => setStoryCount(count)}
                  className={`px-3 py-2 rounded-xl font-semibold transition-colors ${
                    storyCount === count
                      ? 'bg-blue-600/30 text-blue-300 border border-blue-500/50'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  {count === 1 ? '1話（単発）' : `${count}話`}
                </button>
              ))}
            </div>
          </div>

          {/* Continuity Toggle (shown when storyCount > 1) */}
          {storyCount > 1 && (
            <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-2 animate-fadeIn">
              <div className="text-xs font-bold text-slate-300">ストーリーの連続性:</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setIsContinuous(true)}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    isContinuous
                      ? 'bg-blue-600/20 border-blue-500 text-white ring-1 ring-blue-500'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center space-x-2 font-bold text-xs sm:text-sm">
                    <Link className="w-3.5 h-3.5 text-blue-400" />
                    <span>🔗 連続ストーリー（連載）</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 leading-tight">
                    前話のあらすじを引き継ぐ連続ストーリー（前編・中編・完結編など）
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setIsContinuous(false)}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    !isContinuous
                      ? 'bg-blue-600/20 border-blue-500 text-white ring-1 ring-blue-500'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center space-x-2 font-bold text-xs sm:text-sm">
                    <FileText className="w-3.5 h-3.5 text-emerald-400" />
                    <span>📄 独立ストーリー（オムニバス）</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 leading-tight">
                    同じ学習ターゲット構文を異なるシチュエーションで味わう短編集
                  </p>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Step 3: CEFR Level */}
        <div className="space-y-3 pt-2 border-t border-slate-800/80">
          <div className="flex items-center justify-between">
            <label className="text-xs sm:text-sm font-bold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-400" />
              <span>3. 英語難易度レベルを選択:</span>
            </label>
            <span className="text-xs text-blue-400 font-bold">
              {levelDescriptions[currentLevel]?.name}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {(['A1', 'A2', 'B1', 'B2', 'C1'] as const).map((lvl) => {
              const isSelected = currentLevel === lvl;
              return (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => onLevelChange(lvl)}
                  className={`p-3 rounded-2xl border text-left transition-all ${
                    isSelected
                      ? 'bg-blue-600 text-white border-blue-400 shadow-lg shadow-blue-600/30 ring-2 ring-blue-400/40'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-900'
                  }`}
                >
                  <div className="font-extrabold text-base sm:text-lg">{lvl}</div>
                  <div className={`text-[10px] sm:text-[11px] font-medium leading-tight mt-1 ${isSelected ? 'text-blue-100' : 'text-slate-400'}`}>
                    {levelDescriptions[lvl]?.name.split(' ')[0]}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Step 4: Word Count Target */}
        <div className="space-y-3 pt-2 border-t border-slate-800/80">
          <label className="text-xs sm:text-sm font-bold text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-400" />
            <span>4. 1話あたりの目標単語数（ボリューム）:</span>
          </label>

          <div className="flex items-center flex-wrap gap-3">
            <div className="flex items-center bg-slate-950 border border-slate-800 rounded-2xl p-1">
              <button
                type="button"
                onClick={() => changeWordCount(-100)}
                className="px-3 py-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition-colors font-bold text-sm"
                title="100語減らす"
              >
                <Minus className="w-4 h-4" />
              </button>
              <input
                type="number"
                step="100"
                min="100"
                max="2500"
                value={wordCount}
                onChange={(e) => setWordCount(Number(e.target.value) || 700)}
                className="w-20 bg-transparent text-center text-base sm:text-lg font-bold text-blue-400 outline-none"
              />
              <span className="text-xs font-semibold text-slate-400 pr-2">words / 話</span>
              <button
                type="button"
                onClick={() => changeWordCount(100)}
                className="px-3 py-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition-colors font-bold text-sm"
                title="100語増やす"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center space-x-1.5 text-xs">
              {[300, 500, 700, 1000, 1500].map((count) => (
                <button
                  key={count}
                  type="button"
                  onClick={() => setWordCount(count)}
                  className={`px-2.5 py-1.5 rounded-xl font-semibold transition-colors ${
                    wordCount === count
                      ? 'bg-blue-600/30 text-blue-300 border border-blue-500/50'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  {count}語
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Step 5: Theme / Prompt & Target Preview */}
        <div className="space-y-3 pt-2 border-t border-slate-800/80">
          <label className="text-xs sm:text-sm font-bold text-white block">
            5. テーマ・シチュエーション（任意）:
          </label>

          <input
            type="text"
            value={promptInput}
            onChange={(e) => setPromptInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isGenerating) {
                handleStartGeneration();
              }
            }}
            placeholder="例: 朝のルーティン, カフェでの雑談, タイムマネジメント, SF冒険（未指定でおまかせ）"
            className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-2xl px-4 py-3 text-sm text-slate-100 placeholder-slate-500 outline-none transition-all"
          />

          {/* Quick topic chips */}
          <div className="flex items-center gap-1.5 flex-wrap pt-1">
            <span className="text-[11px] text-slate-500 font-medium mr-1">クイック指定:</span>
            {quickTopics.map((topic, tIdx) => (
              <button
                key={tIdx}
                type="button"
                onClick={() => setPromptInput(topic.text)}
                className="px-2.5 py-1 bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 rounded-lg text-xs transition-colors"
              >
                {topic.label}
              </button>
            ))}
          </div>

          {/* Target Binding Preview */}
          <div className="p-3.5 bg-slate-950/70 border border-blue-500/20 rounded-2xl space-y-1.5 text-xs">
            <div className="flex items-center justify-between text-slate-300">
              <div className="flex items-center space-x-2">
                <Sparkles className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                <span className="font-bold text-slate-200">AIターゲット自動バインディング</span>
              </div>
              <span className="text-[10px] uppercase font-bold text-cyan-300 bg-cyan-950/80 border border-cyan-500/30 px-2 py-0.5 rounded-md flex-shrink-0">
                マスターDB連動 ({currentLevel})
              </span>
            </div>
            <p className="text-slate-400 leading-relaxed text-[11px]">
              未習得構文（{targetPatterns.map(p => p.name).slice(0, 2).join(', ')}...）と重要語彙（{targetVocabs.map(v => v.phrase).slice(0, 3).join(', ')}...）を文脈に自然に溶け込ませて出題します。
            </p>
          </div>
        </div>

        {/* Action Button: Start generation in background */}
        <div className="pt-3 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-slate-400">
            ※生成開始後、すぐに本棚に戻って読書を続けられます（バックグラウンド生成）
          </p>

          <button
            onClick={handleStartGeneration}
            disabled={isGenerating}
            className="w-full sm:w-auto flex items-center justify-center space-x-2 px-8 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 active:scale-[0.98] text-white rounded-2xl text-sm font-bold shadow-xl shadow-blue-600/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isGenerating ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>生成中（{generatingProgress ? `[${generatingProgress.current}/${generatingProgress.total}]` : '執筆中...'}）</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>
                  {storyCount === 1
                    ? 'スクリプトを生成する'
                    : isContinuous
                    ? `${storyCount}話の連続ストーリーを一括生成する`
                    : `${storyCount}編の独立ストーリーを一括生成する`}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
