import React, { useState, useEffect } from 'react';
import { TargetEmbedding } from '../types/story';
import { Volume2, Plus, BookmarkPlus, Check, Sparkles, Lightbulb, CheckCircle, AlertCircle, Bot } from 'lucide-react';
import { speakText } from '../utils/speech';

interface TranslationBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  originalText: string;
  translatedText: string;
  contextSentence?: string;
  targetEmbedding?: TargetEmbedding | null;
  isLoading?: boolean;
  isSavedAsVocab?: boolean;
  isSavedAsSentence?: boolean;
  onAddToVocab: (phrase: string, meaning: string, sentence?: string, note?: string) => void;
  onSaveDifficultSentence?: (sentence: string, translation: string, phrase: string) => void;
  onFetchDetailedNuance?: () => Promise<string>;
  onFetchContextualMeaning?: () => Promise<{ meaning: string; partOfSpeech?: string }>;
  onOpenChatMentor?: (text: string) => void;
  onRecordPatternFeedback?: (patternId: string, status: 'lapsed' | 'mastered') => void;
}

export const TranslationBottomSheet: React.FC<TranslationBottomSheetProps> = ({
  isOpen,
  onClose,
  originalText,
  translatedText,
  contextSentence,
  targetEmbedding,
  isLoading = false,
  isSavedAsVocab = false,
  isSavedAsSentence = false,
  onAddToVocab,
  onSaveDifficultSentence,
  onFetchDetailedNuance,
  onFetchContextualMeaning,
  onOpenChatMentor,
  onRecordPatternFeedback,
}) => {
  const [nuanceNote, setNuanceNote] = useState<string | null>(null);
  const [isFetchingNuance, setIsFetchingNuance] = useState(false);
  const [contextualMeaning, setContextualMeaning] = useState<string | null>(null);
  const [isFetchingContext, setIsFetchingContext] = useState(false);
  const [activeTab, setActiveTab] = useState<'word' | 'syntax'>('word');
  const [feedbackStatus, setFeedbackStatus] = useState<'lapsed' | 'mastered' | null>(null);

  useEffect(() => {
    setNuanceNote(null);
    setContextualMeaning(null);
    setFeedbackStatus(null);
    setActiveTab(targetEmbedding ? 'syntax' : 'word');
  }, [originalText, targetEmbedding]);

  if (!isOpen || !originalText) return null;

  const currentDisplayMeaning = contextualMeaning || translatedText || '';

  const handleFetchNuance = async () => {
    if (!onFetchDetailedNuance || isFetchingNuance) return;
    setIsFetchingNuance(true);
    try {
      const note = await onFetchDetailedNuance();
      setNuanceNote(note);
      if (isSavedAsVocab) {
        onAddToVocab(originalText, currentDisplayMeaning, contextSentence, note);
      }
    } finally {
      setIsFetchingNuance(false);
    }
  };

  const handleFetchContextual = async () => {
    if (!onFetchContextualMeaning || isFetchingContext) return;
    setIsFetchingContext(true);
    try {
      const res = await onFetchContextualMeaning();
      if (res?.meaning) {
        setContextualMeaning(res.meaning);
      }
    } finally {
      setIsFetchingContext(false);
    }
  };

  const handleSaveSentence = () => {
    if (!onSaveDifficultSentence) return;
    const sentenceToSave = (originalText.split(' ').length > 4 || !contextSentence) ? originalText : contextSentence;
    onSaveDifficultSentence(sentenceToSave, currentDisplayMeaning, originalText);
  };

  const handlePatternFeedback = (status: 'lapsed' | 'mastered') => {
    if (!targetEmbedding?.targetId || !onRecordPatternFeedback) return;
    onRecordPatternFeedback(targetEmbedding.targetId, status);
    setFeedbackStatus(status);
  };

  return (
    <div 
      className="fixed inset-x-0 bottom-0 z-50 p-3 sm:p-4 animate-slideUp pointer-events-none"
    >
      <div 
        className="pointer-events-auto max-w-xl mx-auto bg-slate-900/95 border border-slate-750 backdrop-blur-xl rounded-3xl shadow-2xl p-4 sm:p-5 space-y-3.5 text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar: Tabs & Close */}
        {targetEmbedding ? (
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setActiveTab('word')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                  activeTab === 'word'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 bg-slate-950'
                }`}
              >
                単語・フレーズ訳
              </button>
              <button
                onClick={() => setActiveTab('syntax')}
                className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                  activeTab === 'syntax'
                    ? 'bg-amber-600 text-white shadow-sm ring-1 ring-amber-400'
                    : 'text-amber-300 hover:text-amber-200 bg-amber-950/40 border border-amber-500/30'
                }`}
              >
                <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
                <span>💡 構文: {targetEmbedding.targetName}</span>
              </button>
            </div>
            <button
              onClick={onClose}
              className="text-[11px] text-slate-400 hover:text-white px-2 py-1 rounded-lg bg-slate-950/80 hover:bg-slate-800 transition-colors"
            >
              閉じる
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-2.5">
            <div className="flex items-center space-x-2.5 flex-wrap">
              <h3 className="text-lg sm:text-xl font-bold text-sky-400 tracking-tight">
                {originalText}
              </h3>
              <button
                onClick={() => speakText(originalText)}
                className="p-1.5 text-sky-400 hover:text-sky-300 hover:bg-sky-950/70 rounded-lg transition-colors border border-sky-500/30"
                title="発音を再生"
              >
                <Volume2 className="w-4 h-4" />
              </button>
            </div>
            <button
              onClick={onClose}
              className="text-[11px] text-slate-400 hover:text-white px-2.5 py-1 rounded-lg bg-slate-950/80 hover:bg-slate-800 transition-colors"
            >
              閉じる
            </button>
          </div>
        )}

        {/* Content Body */}
        {activeTab === 'syntax' && targetEmbedding ? (
          <div className="space-y-3">
            <div className="p-3 bg-amber-950/30 border border-amber-500/30 rounded-2xl space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-amber-300 font-bold">
                <span>🎯 出題ターゲット構文</span>
                <span className="text-[10px] bg-amber-950 px-2 py-0.5 rounded border border-amber-500/40">
                  {targetEmbedding.targetName}
                </span>
              </div>
              {targetEmbedding.focusPoint && (
                <div className="text-slate-300 font-medium">
                  {targetEmbedding.focusPoint}
                </div>
              )}
              {targetEmbedding.translation && (
                <div className="text-amber-200/90 text-[11px] pt-0.5 border-t border-amber-500/20">
                  訳: {targetEmbedding.translation}
                </div>
              )}
            </div>

            {/* Quick Feedback Buttons */}
            <div className="flex items-center space-x-2 pt-1">
              <button
                onClick={() => handlePatternFeedback('lapsed')}
                className={`flex-1 flex items-center justify-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  feedbackStatus === 'lapsed'
                    ? 'bg-rose-600 text-white shadow-md'
                    : 'bg-rose-950/50 hover:bg-rose-900/60 text-rose-300 border border-rose-500/30'
                }`}
              >
                <AlertCircle className="w-3.5 h-3.5" />
                <span>{feedbackStatus === 'lapsed' ? '🔴 要復習に記録済み' : '🔴 構文が分からなかった (要復習)'}</span>
              </button>

              <button
                onClick={() => handlePatternFeedback('mastered')}
                className={`flex-1 flex items-center justify-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  feedbackStatus === 'mastered'
                    ? 'bg-emerald-600 text-white shadow-md'
                    : 'bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-500/30'
                }`}
              >
                <CheckCircle className="w-3.5 h-3.5" />
                <span>{feedbackStatus === 'mastered' ? '🟢 習得済みに記録！' : '🟢 この構文は理解できた'}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {targetEmbedding && (
              <div className="flex items-center space-x-2">
                <h3 className="text-lg sm:text-xl font-bold text-sky-400 tracking-tight">
                  {originalText}
                </h3>
                <button
                  onClick={() => speakText(originalText)}
                  className="p-1.5 text-sky-400 hover:text-sky-300 hover:bg-sky-950/70 rounded-lg transition-colors border border-sky-500/30"
                  title="発音を再生"
                >
                  <Volume2 className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Translation Output Area + On-demand AI Context Button */}
            {isLoading ? (
              <div className="flex items-center space-x-2 text-slate-400 text-sm py-1">
                <div className="w-4 h-4 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                <span>翻訳中...</span>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                  <p className="text-base sm:text-lg font-semibold text-white">
                    {currentDisplayMeaning || '（翻訳なし）'}
                  </p>
                  {contextualMeaning && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-bold border border-blue-500/30">
                      AI文脈一致
                    </span>
                  )}
                </div>

                {/* オンデマンドAI文脈取得ボタン */}
                {onFetchContextualMeaning && !contextualMeaning && (
                  <button
                    type="button"
                    onClick={handleFetchContextual}
                    disabled={isFetchingContext}
                    className="flex items-center space-x-1.5 px-2.5 py-1 text-xs font-semibold text-amber-300 bg-amber-950/50 hover:bg-amber-900/60 border border-amber-500/40 rounded-xl transition-all shadow-sm active:scale-95"
                    title="文脈に沿った正確な日本語訳をAIで取得"
                  >
                    <Sparkles className={`w-3.5 h-3.5 text-amber-400 ${isFetchingContext ? 'animate-spin' : ''}`} />
                    <span>{isFetchingContext ? 'AI解釈中...' : '🤖 AI文脈訳'}</span>
                  </button>
                )}
              </div>
            )}

            {nuanceNote && (
              <div className="text-xs text-slate-300 bg-slate-950/60 p-3 rounded-xl border border-slate-800 space-y-1 animate-fadeIn">
                <div className="flex items-center space-x-1.5 text-sky-400 font-semibold">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>AI解説:</span>
                </div>
                <p className="leading-relaxed">{nuanceNote}</p>
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center space-x-2 flex-wrap gap-y-1.5">
            {/* 1. 弱点単語帳に追加 */}
            <button
              onClick={() => onAddToVocab(originalText, currentDisplayMeaning, contextSentence, nuanceNote || undefined)}
              className={`flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                isSavedAsVocab
                  ? 'bg-blue-950/70 text-blue-300 border border-blue-500/40'
                  : 'bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/25'
              }`}
            >
              {isSavedAsVocab ? (
                <>
                  <Check className="w-3.5 h-3.5 text-sky-400" />
                  <span>単語帳に追加済み</span>
                </>
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5" />
                  <span>単語帳に追加</span>
                </>
              )}
            </button>

            {/* 2. 訳せなかった文を保存 */}
            {onSaveDifficultSentence && (
              <button
                onClick={handleSaveSentence}
                className={`flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  isSavedAsSentence
                    ? 'bg-indigo-950/80 text-indigo-300 border border-indigo-500/40'
                    : 'bg-slate-800 hover:bg-slate-750 text-indigo-300 border border-indigo-500/30'
                }`}
                title="単語は分かるが文構造・訳脈が難しかった文を記録"
              >
                {isSavedAsSentence ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-indigo-300" />
                    <span>文を保存済み</span>
                  </>
                ) : (
                  <>
                    <BookmarkPlus className="w-3.5 h-3.5 text-indigo-400" />
                    <span>訳せなかった文として保存</span>
                  </>
                )}
              </button>
            )}
          </div>

          <div className="flex items-center space-x-2">
            {/* 3. AIメンターに質問ボタン */}
            {onOpenChatMentor && (
              <button
                onClick={() => onOpenChatMentor(originalText)}
                className="flex items-center space-x-1 px-3 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-600/20 transition-all"
                title="AIメンターに詳しく質問する"
              >
                <Bot className="w-3.5 h-3.5" />
                <span>AIに質問</span>
              </button>
            )}

            {/* AI簡易ニュアンスボタン */}
            {onFetchDetailedNuance && !nuanceNote && (
              <button
                onClick={handleFetchNuance}
                disabled={isFetchingNuance}
                className="flex items-center space-x-1 px-2.5 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-xl transition-colors border border-slate-700/60"
              >
                <Sparkles className={`w-3.5 h-3.5 text-amber-400 ${isFetchingNuance ? 'animate-spin' : ''}`} />
                <span>{isFetchingNuance ? '取得中...' : 'AI解説'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
