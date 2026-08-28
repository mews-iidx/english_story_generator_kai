import React, { useState } from 'react';
import { Volume2, Sparkles, Plus, Check } from 'lucide-react';
import { speakText } from '../utils/speech';

interface TranslationBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  originalText: string;
  translatedText: string;
  contextSentence?: string;
  isLoading?: boolean;
  isSavedAsVocab?: boolean;
  onAddToVocab: (phrase: string, meaning: string, contextSentence?: string, note?: string) => void;
  onFetchDetailedNuance?: () => Promise<string>;
}

export const TranslationBottomSheet: React.FC<TranslationBottomSheetProps> = ({
  isOpen,
  onClose,
  originalText,
  translatedText,
  contextSentence,
  isLoading,
  isSavedAsVocab,
  onAddToVocab,
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

  return (
    <>
      {/* 画面全体のタップ検知オーバーレイ（何もないところを押したら閉じる） */}
      <div 
        className="fixed inset-0 z-40 bg-transparent"
        onClick={onClose}
      />

      {/* ボトムシート本体 */}
      <div 
        className="fixed inset-x-0 bottom-0 z-50 p-3 sm:p-4 animate-slideUp pointer-events-none"
      >
        <div 
          className="max-w-2xl mx-auto bg-slate-900/95 border border-slate-700/80 rounded-2xl shadow-2xl backdrop-blur-xl p-4 sm:p-5 text-slate-100 pointer-events-auto transition-all"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header: English Text & Speech */}
          <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div className="flex items-center space-x-2.5 flex-wrap">
              <h3 className="text-xl sm:text-2xl font-bold text-emerald-400 tracking-tight">
                {originalText}
              </h3>
              <button
                onClick={() => speakText(originalText)}
                className="p-1.5 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/70 rounded-lg transition-colors border border-emerald-500/30"
                title="発音を再生"
              >
                <Volume2 className="w-4 h-4" />
              </button>
            </div>
            <span className="text-[11px] text-slate-500">
              画面をタップして閉じる
            </span>
          </div>

          {/* Translation Body */}
          <div className="py-3 space-y-2.5">
            {isLoading ? (
              <div className="flex items-center space-x-2 text-slate-400 text-sm py-1">
                <div className="w-4 h-4 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
                <span>翻訳中...</span>
              </div>
            ) : (
              <p className="text-lg font-semibold text-white">
                {translatedText || '（翻訳なし）'}
              </p>
            )}

            {nuanceNote && (
              <div className="text-xs text-slate-300 bg-slate-950/60 p-3 rounded-xl border border-slate-800 space-y-1 animate-fadeIn">
                <div className="flex items-center space-x-1.5 text-emerald-400 font-semibold">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>AI解説:</span>
                </div>
                <p className="leading-relaxed">{nuanceNote}</p>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <button
              onClick={() => onAddToVocab(originalText, translatedText, contextSentence, nuanceNote || undefined)}
              className={`flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                isSavedAsVocab
                  ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-500/40'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/20'
              }`}
            >
              {isSavedAsVocab ? (
                <>
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span>弱点に追加済み（明日再出題）</span>
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  <span>弱点単語帳に追加</span>
                </>
              )}
            </button>

            {onFetchDetailedNuance && !nuanceNote && (
              <button
                onClick={handleFetchNuance}
                disabled={isFetchingNuance}
                className="flex items-center space-x-1.5 px-3 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-xl transition-colors border border-slate-700/60"
              >
                <Sparkles className={`w-3.5 h-3.5 text-amber-400 ${isFetchingNuance ? 'animate-spin' : ''}`} />
                <span>{isFetchingNuance ? '解説取得中...' : 'AIで詳しいニュアンスを聞く'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
};