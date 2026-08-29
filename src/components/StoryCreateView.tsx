import React, { useState } from 'react';
import { CefrLevel } from '../types/settings';
import { Sparkles, RefreshCw, Minus, Plus, FileJson, BookOpen, Layers, CheckCircle2, Clock } from 'lucide-react';

interface StoryCreateViewProps {
  currentLevel: CefrLevel;
  onLevelChange: (level: CefrLevel) => void;
  isGenerating: boolean;
  generatingTheme?: string;
  dueVocabs: string[];
  onGenerateStory: (prompt?: string, wordCount?: number) => void;
  onOpenImportModal: () => void;
  onNavigateToBookshelf: () => void;
}

export const StoryCreateView: React.FC<StoryCreateViewProps> = ({
  currentLevel,
  onLevelChange,
  isGenerating,
  generatingTheme,
  dueVocabs,
  onGenerateStory,
  onOpenImportModal,
  onNavigateToBookshelf,
}) => {
  const [promptInput, setPromptInput] = useState('');
  const [wordCount, setWordCount] = useState<number>(700);

  const changeWordCount = (delta: number) => {
    setWordCount(prev => Math.max(100, Math.min(2500, (prev || 700) + delta)));
  };

  const handleStartGeneration = () => {
    if (isGenerating) return;
    onGenerateStory(promptInput, wordCount);
  };

  const levelDescriptions: Record<CefrLevel, { name: string; desc: string }> = {
    A1: { name: '超初級 (A1)', desc: '中学1〜2年レベル。基本単語と短い文で読みやすい' },
    A2: { name: '初級 (A2)', desc: '中学3年〜日常会話基礎。身近な表現とシンプルな構文' },
    B1: { name: '中級 (B1)', desc: '高校〜日常英会話。標準的な語彙でスムーズな展開' },
    B2: { name: '中上級 (B2)', desc: '自然なイディオムや句動詞を含む豊かな表現' },
    C1: { name: '上級 (C1)', desc: '高度で洗練された語彙と多彩な表現' },
  };

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
                物語作成スタジオ ✨
              </h2>
              <p className="text-xs sm:text-sm text-slate-400">
                あなたの弱点語彙を自然に組み込んだ新しいショートストーリーを生成・追加します
              </p>
            </div>
          </div>

          <button
            onClick={onOpenImportModal}
            className="flex items-center space-x-1.5 px-3.5 py-2 bg-slate-950 hover:bg-slate-800 text-blue-400 border border-blue-500/30 rounded-xl text-xs font-semibold transition-colors"
          >
            <FileJson className="w-4 h-4" />
            <span>外部AIのJSONをインポート</span>
          </button>
        </div>
      </div>

      {/* Background Generating Banner (裏で生成中の場合) */}
      {isGenerating && (
        <div className="bg-gradient-to-r from-blue-950/80 to-indigo-950/80 border border-blue-500/40 rounded-3xl p-5 shadow-2xl space-y-3 animate-fadeIn">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-xl bg-blue-600/30 border border-blue-500/40 flex items-center justify-center">
                <RefreshCw className="w-4 h-4 text-sky-400 animate-spin" />
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-bold text-white">
                  AIがバックグラウンドで物語を執筆中...
                </h3>
                <p className="text-xs text-slate-300">
                  {generatingTheme ? `テーマ: 「${generatingTheme}」` : 'テーマ: おまかせ・弱点語彙注入'}（完成すると自動で本棚に追加されます）
                </p>
              </div>
            </div>

            <button
              onClick={onNavigateToBookshelf}
              className="flex items-center space-x-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-600/30 transition-all"
            >
              <BookOpen className="w-4 h-4" />
              <span>本棚で他の本を読む</span>
            </button>
          </div>
        </div>
      )}

      {/* 2. Generation Form */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-5 sm:p-7 shadow-xl space-y-6">
        {/* Step 1: CEFR Level */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs sm:text-sm font-bold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-400" />
              <span>1. 英語難易度レベルを選択:</span>
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

        {/* Step 2: Word Count Target */}
        <div className="space-y-3 pt-2 border-t border-slate-800/80">
          <label className="text-xs sm:text-sm font-bold text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-400" />
            <span>2. 目標単語数（ボリューム）:</span>
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
              <span className="text-xs font-semibold text-slate-400 pr-2">words (語)</span>
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

        {/* Step 3: Theme / Prompt & Target Vocabs */}
        <div className="space-y-3 pt-2 border-t border-slate-800/80">
          <label className="text-xs sm:text-sm font-bold text-white block">
            3. テーマ・シチュエーション（任意）:
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
            placeholder="例: 深夜のカフェでの偶然の再会, SF冒険, ミステリー（未指定でおまかせ）"
            className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-2xl px-4 py-3 text-sm text-slate-100 placeholder-slate-500 outline-none transition-all"
          />

          {dueVocabs && dueVocabs.length > 0 && (
            <div className="p-3 bg-slate-950/60 border border-blue-500/20 rounded-2xl space-y-1.5">
              <span className="text-[11px] font-bold text-blue-400 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> 今回の物語に優先注入される重要語彙 ({dueVocabs.length}個):
              </span>
              <div className="flex flex-wrap gap-1.5">
                {dueVocabs.map((v, i) => (
                  <span key={i} className="text-xs bg-slate-900 border border-slate-800 text-slate-200 px-2 py-0.5 rounded-lg">
                    {v.split(' ')[0]}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Action Button: Start generation in background */}
        <div className="pt-3 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-slate-400">
            ※生成開始後、すぐに本棚に戻って読書を続けても裏で自動追加されます
          </p>

          <button
            onClick={handleStartGeneration}
            disabled={isGenerating}
            className="w-full sm:w-auto flex items-center justify-center space-x-2 px-8 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 active:scale-[0.98] text-white rounded-2xl text-sm font-bold shadow-xl shadow-blue-600/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isGenerating ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>生成中（裏で執筆中...）</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>物語を生成する（バックグラウンド）</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};