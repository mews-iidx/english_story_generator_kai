import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, ChatSuggestedVocab } from '../types/chat';
import { Bot, User, Send, Sparkles, RefreshCw, Trash2, Plus, Check, X } from 'lucide-react';
import { chatWithAiMentor } from '../services/gemini';
import { loadDailySnapshots, loadMyGoal, computeLevelProgress, getWeakestPatterns } from '../services/storage';

interface AiMentorChatViewProps {
  apiKey: string;
  model?: string;
  messages: ChatMessage[];
  onSendMessage: (userText: string, replyText: string, suggestedVocabs: ChatSuggestedVocab[]) => void;
  onAddToVocab: (phrase: string, meaning: string, contextSentence?: string) => void;
  onClearChat: () => void;
  onRecordTokenUsage: (promptTokens: number, candidatesTokens: number) => void;
  savedVocabPhrases?: Set<string>;
  initialInput?: string;
  isOverlayMode?: boolean;
  onClose?: () => void;
}

export const AiMentorChatView: React.FC<AiMentorChatViewProps> = ({
  apiKey,
  model = 'gemini-3.7-flash',
  messages,
  onSendMessage,
  onAddToVocab,
  onClearChat,
  onRecordTokenUsage,
  savedVocabPhrases = new Set(),
  initialInput = '',
  isOverlayMode = false,
  onClose,
}) => {
  const [inputText, setInputText] = useState(initialInput);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (initialInput) {
      setInputText(initialInput);
      inputRef.current?.focus();
    }
  }, [initialInput]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || isLoading) return;

    if (!apiKey) {
      alert('Gemini APIキーが設定されていません。右上の「設定」からAPIキーを入力してください。');
      return;
    }

    const query = inputText.trim();
    setInputText('');
    setIsLoading(true);

    try {
      const historyContents = messages.slice(-10).map(m => ({
        role: (m.sender === 'user' ? 'user' : 'model') as 'user' | 'model',
        parts: [{ text: m.text }],
      }));

      const snapshots = loadDailySnapshots();
      const latestSnapshot = snapshots[snapshots.length - 1];
      const myGoal = loadMyGoal();
      const targetLevel = (myGoal?.targetCefr || 'B1') as 'A1' | 'A2' | 'B1' | 'B2';
      const progress = computeLevelProgress(targetLevel);
      const remaining = (progress.patternTotal - progress.patternMastered) + (progress.vocabTotal - progress.vocabMastered);
      const itemsPerDay = Math.max(1, Math.round(remaining / Math.max(1, myGoal?.targetDays || 60)));
      const estimatedDays = Math.ceil(remaining / itemsPerDay);

      const weakList = getWeakestPatterns(5);

      const res = await chatWithAiMentor({
        messages: historyContents,
        currentQuery: query,
        contextInfo: {
          cefrLevel: targetLevel,
          levelProgressSummary: `構文: ${Math.round(progress.patternPct)}%, 語彙: ${Math.round(progress.vocabPct)}%`,
          masteryStats: {
            level: targetLevel,
            patternProgress: progress.patternPct / 100,
            vocabProgress: progress.vocabPct / 100,
            totalMastered: progress.patternMastered + progress.vocabMastered,
            dailyReadingWords: latestSnapshot?.wordsRead || 0,
            estimatedDaysToTarget: estimatedDays,
          },
          weakestPatterns: weakList.map(w => ({
            patternName: w.pattern.name,
            formula: w.pattern.focus,
            focus: w.pattern.meaning,
            mistakeCount: w.mistakeCount,
            lastErrorReason: w.lastErrorReason,
          })),
        },
        apiKey,
        model,
      });

      if (res.tokenUsage) {
        onRecordTokenUsage(res.tokenUsage.promptTokens, res.tokenUsage.candidatesTokens);
      }

      onSendMessage(query, res.replyText, res.suggestedVocabs || []);
    } catch (e: any) {
      alert(`AIメンターエラー: ${e.message || e}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className={`flex flex-col h-full ${isOverlayMode ? 'bg-slate-950' : 'max-w-4xl mx-auto px-2 sm:px-4 py-4 sm:py-6 h-[calc(100vh-4rem)]'}`}>
      {/* Header */}
      <div className={`flex items-center justify-between pb-3 sm:pb-4 border-b border-slate-800 ${isOverlayMode ? 'p-4 bg-slate-900/60' : ''}`}>
        <div className="flex items-center space-x-2.5">
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-bold text-white flex items-center gap-1.5">
              CompileEng AIメンター
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-normal border border-blue-500/30">
                パーソナル指導
              </span>
            </h1>
            <p className="text-xs text-slate-400">文法・ニュアンス相談、苦手構文の特訓、学習ペースの相談</p>
          </div>
        </div>

        <div className="flex items-center space-x-1">
          {messages.length > 0 && (
            <button
              onClick={onClearChat}
              className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-xl transition-colors"
              title="チャット履歴をクリア"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          {isOverlayMode && onClose && (
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors"
              title="閉じる"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Message List */}
      <div className="flex-1 overflow-y-auto py-4 space-y-4 px-2 sm:px-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500 space-y-4">
            <div className="w-14 h-14 rounded-3xl bg-slate-900 border border-slate-800 flex items-center justify-center text-blue-400 shadow-inner">
              <Sparkles className="w-7 h-7" />
            </div>
            <div className="space-y-1 max-w-sm">
              <h3 className="text-sm font-semibold text-slate-300">英語の疑問を何でも質問してください</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                「この構文のニュアンスの違いは？」「俺の苦手な構文って何？」「英語で〜ってどう言う？」など、AIメンターが親身に回答します。
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 pt-2 max-w-md">
              {[
                '俺の苦手な構文って何だっけ？',
                '「used to」と「be used to」の違いを教えて',
                '英語を頭から瞬時に読むコツは？',
              ].map((suggestion, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    setInputText(suggestion);
                    inputRef.current?.focus();
                  }}
                  className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs rounded-xl transition-colors text-left"
                >
                  💡 {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`flex items-start gap-3 ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {m.sender === 'assistant' && (
                <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center text-white shrink-0 mt-0.5">
                  <Bot className="w-4 h-4" />
                </div>
              )}

              <div
                className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed space-y-2 ${
                  m.sender === 'user'
                    ? 'bg-blue-600 text-white rounded-tr-none shadow-md shadow-blue-600/20'
                    : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-none shadow-md'
                }`}
              >
                <div className="whitespace-pre-wrap">{m.text}</div>

                {/* AI回答から抽出された重要表現カード */}
                {m.suggestedVocabs && m.suggestedVocabs.length > 0 && (
                  <div className="pt-2 border-t border-slate-800 space-y-1.5">
                    <span className="text-[11px] font-bold text-amber-300 flex items-center gap-1">
                      <Sparkles className="w-3 h-3" />
                      Anki・単語帳に登録推奨:
                    </span>
                    <div className="space-y-1">
                      {m.suggestedVocabs.map((sv, idx) => {
                        const isSaved = savedVocabPhrases.has(sv.phrase.trim().toLowerCase());
                        return (
                          <div
                            key={idx}
                            className="flex items-center justify-between p-2 bg-slate-950/80 border border-slate-800 rounded-xl text-xs"
                          >
                            <div>
                              <span className="font-bold text-white font-mono">{sv.phrase}</span>
                              <span className="text-slate-400 ml-2">{sv.meaning}</span>
                            </div>
                            <button
                              onClick={() => onAddToVocab(sv.phrase, sv.meaning, m.text)}
                              disabled={isSaved}
                              className={`px-2 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-colors ${
                                isSaved
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  : 'bg-blue-600 hover:bg-blue-500 text-white shadow-sm'
                              }`}
                            >
                              {isSaved ? (
                                <>
                                  <Check className="w-3 h-3" />
                                  <span>登録済</span>
                                </>
                              ) : (
                                <>
                                  <Plus className="w-3 h-3" />
                                  <span>登録</span>
                                </>
                              )}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {m.sender === 'user' && (
                <div className="w-8 h-8 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 shrink-0 mt-0.5">
                  <User className="w-4 h-4" />
                </div>
              )}
            </div>
          ))
        )}

        {isLoading && (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center text-white shrink-0">
              <Bot className="w-4 h-4" />
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl rounded-tl-none px-4 py-3 text-xs text-slate-400 flex items-center space-x-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-400" />
              <span>AIメンターが回答を考えています...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Box */}
      <div className={`pt-2 sm:pt-3 border-t border-slate-800 ${isOverlayMode ? 'p-3 bg-slate-900/60' : ''}`}>
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <div className="relative flex-1">
            <textarea
              ref={inputRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="質問を入力 (Ctrl+Enterで送信)..."
              rows={2}
              className="w-full bg-slate-900 border border-slate-800 focus:border-blue-500 rounded-2xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none resize-none"
            />
          </div>
          <button
            type="submit"
            disabled={!inputText.trim() || isLoading}
            className="p-3 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white rounded-2xl font-bold shadow-lg shadow-blue-600/20 disabled:opacity-50 transition-all flex items-center justify-center shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
