import React, { useState, useEffect } from 'react';
import { TargetEmbedding } from '../types/story';
import { ExtractedCorePattern } from '../types/vocab';
import { SaveSentenceCardParams, extractSingleSentence } from '../services/storage';
import { Volume2, Plus, Check, Sparkles, Lightbulb, CheckCircle, AlertCircle, Bot, Layers } from 'lucide-react';
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
  onAddToVocab: (phrase: string, meaning: string, sentence?: string) => void;
  onSaveSentenceCard?: (params: SaveSentenceCardParams) => void;
  onFetchContextualMeaning?: () => Promise<{ meaning: string; partOfSpeech?: string }>;
  onExtractCorePatterns?: () => Promise<ExtractedCorePattern[]>;
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
  onAddToVocab,
  onSaveSentenceCard,
  onFetchContextualMeaning,
  onExtractCorePatterns,
  onOpenChatMentor,
  onRecordPatternFeedback,
}) => {
  const [contextualMeaning, setContextualMeaning] = useState<string | null>(null);
  const [isFetchingContext, setIsFetchingContext] = useState(false);
  const [activeTab, setActiveTab] = useState<'word' | 'syntax'>('word');
  const [feedbackStatus, setFeedbackStatus] = useState<'lapsed' | 'mastered' | null>(null);

  // 抽出された2〜3個の構造化構文パターン
  const [extractedPatterns, setExtractedPatterns] = useState<ExtractedCorePattern[]>([]);
  const [isExtractingPatterns, setIsExtractingPatterns] = useState(false);
  const [isSavedLocally, setIsSavedLocally] = useState(false);

  useEffect(() => {
    setContextualMeaning(null);
    setIsFetchingContext(false);
    setFeedbackStatus(null);
    setExtractedPatterns([]);
    setIsExtractingPatterns(false);
    setIsSavedLocally(false);

    if (targetEmbedding) {
      setActiveTab('syntax');
    } else {
      setActiveTab('word');
    }
  }, [originalText, targetEmbedding]);

  if (!isOpen) return null;

  const currentDisplayMeaning = contextualMeaning || translatedText;
  const isSingleWord = originalText.trim().split(/\s+/).length <= 2;
  const fullSentenceText = contextSentence || originalText;

  const handleFetchContextual = async () => {
    if (!onFetchContextualMeaning) return;
    setIsFetchingContext(true);
    try {
      const res = await onFetchContextualMeaning();
      if (res.meaning) {
        setContextualMeaning(res.meaning);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsFetchingContext(false);
    }
  };

  const handleExtractPatterns = async () => {
    if (!onExtractCorePatterns) return;
    setIsExtractingPatterns(true);
    try {
      const patterns = await onExtractCorePatterns();
      setExtractedPatterns(patterns);
    } catch (e) {
      console.error('Failed to extract core patterns', e);
    } finally {
      setIsExtractingPatterns(false);
    }
  };

  const handleSaveCard = () => {
    if (onSaveSentenceCard) {
      const cleanSentence = extractSingleSentence(fullSentenceText, originalText);
      if (isSingleWord) {
        onSaveSentenceCard({
          sentence: cleanSentence,
          translation: currentDisplayMeaning,
          focusType: 'word',
          focusWord: originalText.trim(),
          focusMeaning: currentDisplayMeaning,
        });
      } else {
        onSaveSentenceCard({
          sentence: cleanSentence,
          translation: currentDisplayMeaning,
          focusType: targetEmbedding ? 'pattern' : 'sentence',
          corePatterns: extractedPatterns.length > 0 ? extractedPatterns : (targetEmbedding ? [{
            patternName: targetEmbedding.targetName || 'ターゲット構文',
            formula: targetEmbedding.focusPoint || '',
            meaningTemplate: targetEmbedding.translation || currentDisplayMeaning,
            highlightTokens: [],
            briefNote: targetEmbedding.focusPoint || '',
          }] : []),
        });
      }
      setIsSavedLocally(true);
    } else {
      onAddToVocab(originalText, currentDisplayMeaning, contextSentence);
      setIsSavedLocally(true);
    }
  };

  const handlePatternFeedback = (status: 'lapsed' | 'mastered') => {
    if (!targetEmbedding?.targetId || !onRecordPatternFeedback) return;
    onRecordPatternFeedback(targetEmbedding.targetId, status);
    setFeedbackStatus(status);
  };

  const isSaved = isSavedAsVocab || isSavedLocally;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 animate-slide-up flex justify-center pointer-events-none px-2 pb-2 sm:pb-4">
      <div className="w-full max-w-lg bg-slate-900/95 backdrop-blur-xl border border-slate-700/80 rounded-3xl p-4 sm:p-5 shadow-2xl space-y-3.5 pointer-events-auto text-white">
        {/* Header Tabs */}
        {targetEmbedding ? (
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <div className="flex items-center space-x-1 p-0.5 bg-slate-950/80 rounded-xl border border-slate-800">
              <button
                onClick={() => setActiveTab('syntax')}
                className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                  activeTab === 'syntax'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Lightbulb className="w-3.5 h-3.5" />
                <span>🎯 出題構文</span>
              </button>
              <button
                onClick={() => setActiveTab('word')}
                className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                  activeTab === 'word'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>和訳</span>
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
              <h3 className="text-base sm:text-lg font-bold text-sky-400 tracking-tight">
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
            <div className="p-3 bg-purple-950/40 border border-purple-500/30 rounded-2xl space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-purple-300 font-bold">
                <span>🎯 出題ターゲット構文</span>
                <span className="text-[10px] bg-purple-950 px-2 py-0.5 rounded border border-purple-500/40">
                  {targetEmbedding.targetName}
                </span>
              </div>
              {targetEmbedding.focusPoint && (
                <div className="text-slate-300 font-medium">
                  {targetEmbedding.focusPoint}
                </div>
              )}
              {targetEmbedding.translation && (
                <div className="text-purple-200/90 text-[11px] pt-0.5 border-t border-purple-500/20">
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
                <span>{feedbackStatus === 'lapsed' ? '🔴 要復習に記録済み' : '🔴 構文が分からなかった'}</span>
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
                <h3 className="text-base sm:text-lg font-bold text-sky-400 tracking-tight">
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

            {/* Translation Output Area */}
            {isLoading ? (
              <div className="flex items-center space-x-2 text-slate-400 text-sm py-1">
                <div className="w-4 h-4 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                <span>翻訳中...</span>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                    <p className="text-base font-semibold text-white">
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

                {/* 構文骨格の自動抽出ボタン（文選択時） */}
                {!isSingleWord && onExtractCorePatterns && extractedPatterns.length === 0 && (
                  <button
                    type="button"
                    onClick={handleExtractPatterns}
                    disabled={isExtractingPatterns}
                    className="w-full flex items-center justify-center space-x-1.5 py-1.5 px-3 bg-purple-950/60 hover:bg-purple-900/70 border border-purple-500/30 rounded-xl text-xs font-bold text-purple-300 transition-all active:scale-95"
                  >
                    <Layers className={`w-3.5 h-3.5 ${isExtractingPatterns ? 'animate-spin' : ''}`} />
                    <span>{isExtractingPatterns ? 'AIが構文骨格を解析中...' : '💡 文の構文骨格・仮説（S+V）を抽出'}</span>
                  </button>
                )}

                {/* 抽出された構造化構文パターンの表示 */}
                {extractedPatterns.length > 0 && (
                  <div className="p-2.5 bg-purple-950/40 border border-purple-500/30 rounded-2xl space-y-2 text-xs">
                    <div className="text-[11px] font-bold text-purple-300 flex items-center space-x-1">
                      <Lightbulb className="w-3.5 h-3.5" />
                      <span>抽出された構文骨格 ({extractedPatterns.length}件):</span>
                    </div>
                    <div className="space-y-1.5">
                      {extractedPatterns.map((pat, idx) => (
                        <div key={idx} className="p-2 bg-slate-950/80 border border-purple-500/20 rounded-xl space-y-0.5">
                          <div className="flex items-center justify-between text-[11px] font-bold text-purple-200">
                            <span>{pat.patternName}</span>
                            <span className="text-[10px] text-slate-400 font-mono">{pat.formula}</span>
                          </div>
                          <div className="text-[10px] text-slate-300">{pat.meaningTemplate}</div>
                          {pat.briefNote && (
                            <div className="text-[9px] text-purple-300/80 pt-0.5 border-t border-purple-500/10">
                              💡 {pat.briefNote}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Action Buttons: ＋ 1文保存 / 💬 AIに質問 */}
        <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2">
          <button
            onClick={handleSaveCard}
            className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              isSaved
                ? 'bg-blue-950/70 text-blue-300 border border-blue-500/40'
                : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-md shadow-blue-600/25 active:scale-95'
            }`}
          >
            {isSaved ? (
              <>
                <Check className="w-3.5 h-3.5 text-sky-400" />
                <span>1文カード保存済み (英和・和英)</span>
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" />
                <span>{isSingleWord ? '＋ 1文として単語帳に追加' : '＋ 1文カードとして保存'}</span>
              </>
            )}
          </button>

          {onOpenChatMentor && (
            <button
              onClick={() => onOpenChatMentor(originalText)}
              className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition-all"
              title="AIメンターに詳しく質問する"
            >
              <Bot className="w-3.5 h-3.5" />
              <span>AIに質問</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
