import React from 'react';
import { VocabItem, VocabLookupResult } from '../types/vocab';
import { Volume2, X, BookmarkCheck, Sparkles, RotateCcw } from 'lucide-react';
import { speakText } from '../utils/speech';

interface VocabModalProps {
  isOpen: boolean;
  onClose: () => void;
  lookup: VocabLookupResult | null;
  vocabItem?: VocabItem | null;
  isLoading?: boolean;
  onMaster?: (vocabId: string) => void;
}

export const VocabModal: React.FC<VocabModalProps> = ({
  isOpen,
  onClose,
  lookup,
  vocabItem,
  isLoading,
  onMaster,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
      <div 
        className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden p-6 sm:p-7 text-slate-100 transform transition-all animate-scaleUp"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-full transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {isLoading ? (
          <div className="py-12 flex flex-col items-center justify-center space-y-4">
            <div className="w-10 h-10 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
            <p className="text-sm text-slate-400 font-medium">Geminiが文脈に合わせた解説を生成中...</p>
          </div>
        ) : lookup ? (
          <div className="space-y-5">
            <div>
              <div className="flex items-center space-x-3">
                <h3 className="text-2xl font-bold text-emerald-400 tracking-tight">
                  {lookup.phrase}
                </h3>
                <button
                  onClick={() => speakText(lookup.phrase)}
                  className="p-1.5 text-emerald-400/80 hover:text-emerald-300 hover:bg-emerald-950/60 rounded-lg transition-colors border border-emerald-500/30"
                  title="発音を再生"
                >
                  <Volume2 className="w-4 h-4" />
                </button>
              </div>
              {lookup.part_of_speech && (
                <span className="inline-block mt-1 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                  {lookup.part_of_speech}
                </span>
              )}
            </div>

            <div className="bg-slate-850/80 border border-slate-800 rounded-xl p-4">
              <span className="text-xs uppercase font-bold text-slate-400 tracking-wider">文脈での意味</span>
              <p className="text-lg font-semibold text-white mt-0.5">
                {lookup.meaning}
              </p>
            </div>

            {lookup.explanation && (
              <div className="space-y-1.5">
                <div className="flex items-center space-x-1.5 text-xs font-semibold text-emerald-400">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>ニュアンス・使われ方解説</span>
                </div>
                <p className="text-sm text-slate-300 leading-relaxed bg-slate-850/40 p-3.5 rounded-xl border border-slate-800/80">
                  {lookup.explanation}
                </p>
              </div>
            )}

            {lookup.context_sentence && (
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-slate-400">出典の英文</span>
                <blockquote className="text-sm italic text-slate-300 bg-slate-950/60 border-l-2 border-emerald-500 pl-3.5 py-2 rounded-r-lg">
                  "{lookup.context_sentence}"
                </blockquote>
              </div>
            )}

            <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
              <div className="flex items-center space-x-1.5 text-amber-400/90">
                <RotateCcw className="w-3.5 h-3.5" />
                <span>弱点語彙に登録（明日再出題）</span>
              </div>
              {vocabItem && (
                <div className="flex items-center space-x-2 text-slate-400">
                  <span>忘れた回数: <strong className="text-white">{vocabItem.lapseCount}回</strong></span>
                  <span>•</span>
                  <span>次回期日: <strong className="text-white">{vocabItem.nextReviewDate}</strong></span>
                </div>
              )}
            </div>

            <div className="flex space-x-3 pt-2">
              {vocabItem && onMaster && (
                <button
                  onClick={() => {
                    onMaster(vocabItem.id);
                    onClose();
                  }}
                  className="flex-1 flex items-center justify-center space-x-2 px-4 py-2.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 rounded-xl text-sm font-medium transition-all"
                >
                  <BookmarkCheck className="w-4 h-4" />
                  <span>覚えた！（次回間隔を延長）</span>
                </button>
              )}
              <button
                onClick={onClose}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-750 text-slate-200 rounded-xl text-sm font-medium transition-colors"
              >
                閉じる
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};