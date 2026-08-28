import React, { useState } from 'react';
import { Volume2, Sparkles, Plus, Check, BookmarkPlus, BookmarkCheck } from 'lucide-react';
import { speakText } from '../utils/speech';

interface TranslationBottomSheetProps {
  isOpen: boolean;
  onClose?: () => void;
  originalText: string;
  translatedText: string;
  contextSentence?: string;
  isLoading?: boolean;
  isSavedAsVocab?: boolean;
  isSavedAsSentence?: boolean;
  onAddToVocab: (phrase: string, meaning: string, contextSentence?: string, note?: string) => void;
  onSaveDifficultSentence?: (sentence: string, translation: string, phrase: string) => void;
  onFetchDetailedNuance?: () => Promise<string>;
}

export const TranslationBottomSheet: React.FC<TranslationBottomSheetProps> = ({
  isOpen,
  originalText,
  translatedText,
  contextSentence,
  isLoading,
  isSavedAsVocab,
  isSavedAsSentence,
  onAddToVocab,
  onSaveDifficultSentence,
  onFetchDetailedNuance,
}) => {
  const [nuanceNote, setNuanceNote] = useState<string | null>(null);
  const [isFetchingNuance, setIsFetchingNuance] = useState(false);

  if (!isOpen || !originalText) return null;

  const handleFetchNuance = async () => {
    if (!onFetchDetailedNuance || isFetchingNuance) return;
    setIsFetchingNuance(true);
    try {
      const note = await onFetchDetailedNuance();
      setNuanceNote(note);
      if (isSavedAsVocab) {
        onAddToVocab(originalText, translatedText, contextSentence, note);
      }
    } finally {
      setIsFetchingNuance(false);
    }
  };

  const handleSaveSentence = () => {
    if (!onSaveDifficultSentence) return;
    // 選択されたテキストが文そのものか、コンテキスト文を保存
    const sentenceToSave = (originalText.split(' ').length > 4 || !contextSentence) ? originalText : contextSentence;
    onSaveDifficultSentence(sentenceToSave, translatedText, originalText);
  };

  return (
    <div 
      className="fixed inset-x-0 bottom-0 z-50 p-3 sm:p-4 animate-slideUp pointer-events-none"
    >
      <div 
        className="max-w-2xl mx-auto bg-slate-900/95 border border-slate-700/80 rounded-2xl shadow-2xl backdrop-blur-xl p-4 sm:p-5 text-slate-100 pointer-events-auto transition-all space-y-3"
        onClick={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        {/* Header: English Text & Speech */}
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
          <span className="text-[11px] text-slate-500">
            外側をタップで閉じる
          </span>
        </div>

        {/* Translation Body */}
        <div className="space-y-2">
          {isLoading ? (
            <div className="flex items-center space-x-2 text-slate-400 text-sm py-1">
              <div className="w-4 h-4 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
              <span>翻訳中...</span>
            </div>
          ) : (
            <p className="text-base sm:text-lg font-semibold text-white">
              {translatedText || '（翻訳なし）'}
            </p>
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

        {/* Action Buttons */}
        <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center space-x-2 flex-wrap gap-y-1.5">
            {/* 1. 弱点単語帳に追加 */}
            <button
              onClick={() => onAddToVocab(originalText, translatedText, contextSentence, nuanceNote || undefined)}
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

            {/* 2. 訳せなかった文を保存（自己分析用） */}
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
                    <BookmarkCheck className="w-3.5 h-3.5 text-indigo-400" />
                    <span>訳せなかった文に保存済み</span>
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

          {/* AIニュアンスボタン */}
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
  );
};