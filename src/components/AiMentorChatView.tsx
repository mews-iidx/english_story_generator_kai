import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, ChatSuggestedVocab } from '../types/chat';
import { Bot, Send, User, Sparkles, Plus, Check, Trash2, HelpCircle, X, BookOpen } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { chatWithAiMentor } from '../services/gemini';
import { speakText } from '../utils/speech';
import { computeLevelProgress, loadDailySnapshots, loadMyGoal } from '../services/storage';

interface AiMentorChatViewProps {
  apiKey: string;
  model?: string;
  messages: ChatMessage[];
  onSendMessage: (userText: string, assistantReply: string, suggestedVocabs: ChatSuggestedVocab[]) => void;
  onAddToVocab: (phrase: string, meaning: string) => void;
  onClearChat: () => void;
  onRecordTokenUsage: (promptTokens: number, candidatesTokens: number) => void;
  savedVocabPhrases: Set<string>;
  initialInput?: string;
  onClose?: () => void;
  isOverlayMode?: boolean;
}

export const AiMentorChatView: React.FC<AiMentorChatViewProps> = ({
  apiKey,
  model = 'gemini-3.7-flash',
  messages,
  onSendMessage,
  onAddToVocab,
  onClearChat,
  onRecordTokenUsage,
  savedVocabPhrases,
  initialInput = '',
  onClose,
  isOverlayMode = false,
}) => {
  const [inputText, setInputText] = useState(initialInput);
  const [isLoading, setIsLoading] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialInput) {
      setInputText(initialInput);
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [initialInput]);

  const handleSend = async (textToSend?: string) => {
    const query = (textToSend || inputText).trim();
    if (!query || isLoading) return;

    if (!apiKey) {
      alert('Gemini APIキーが設定されていません。設定画面からAPIキーを入力してください。');
      return;
    }

    setInputText('');
    setIsLoading(true);

    // 質問送信時にスクロール位置を調整（AI回答生成後は勝手にスクロールしない）
    setTimeout(() => {
      if (messagesContainerRef.current) {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
      }
    }, 50);

    try {
      const historyContents = messages.slice(-6).map(m => ({
        role: (m.sender === 'user' ? 'user' : 'model') as 'user' | 'model',
        parts: [{ text: m.text }],
      }));

      // テレメトリ情報の収集
      const snapshots = loadDailySnapshots();
      const latestSnapshot = snapshots[snapshots.length - 1];
      const myGoal = loadMyGoal();
      const targetLevel = (myGoal?.targetCefr || 'B1') as 'A1' | 'A2' | 'B1' | 'B2';
      const progress = computeLevelProgress(targetLevel);
      const remaining = (progress.patternTotal - progress.patternMastered) + (progress.vocabTotal - progress.vocabMastered);
      const itemsPerDay = Math.max(1, Math.round(remaining / Math.max(1, myGoal?.targetDays || 60)));
      const estimatedDays = Math.ceil(remaining / itemsPerDay);

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

  const suggestionChips = [
    'この表現の日常会話での使い分けを教えて',
    '似た意味の言い換え表現はある？',
    '文法の構造をわかりやすく分解して',
    '発音やイントネーションのコツは？',
  ];

  return (
    <div className={`flex flex-col h-full ${isOverlayMode ? 'p-3 sm:p-4 space-y-3' : 'max-w-4xl mx-auto p-4 space-y-4 h-[calc(100vh-140px)]'}`}>
      {/* 1. Header Bar */}
      <div className="flex items-center justify-between bg-slate-900/90 border border-slate-800 p-3 sm:p-4 rounded-2xl shadow-lg flex-shrink-0">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-blue-600/30">
            <Bot className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-1.5">
              <span>AI English Mentor</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-medium border border-blue-500/30">
                {model}
              </span>
            </h2>
            <p className="text-[11px] text-slate-400">
              文脈ニュアンス・語法・文法構造をいつでも深掘り質問
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-1.5 flex-shrink-0">
          <button
            onClick={() => {
              if (confirm('チャット履歴を消去しますか？')) onClearChat();
            }}
            className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-xl transition-colors"
            title="チャット履歴をクリア"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          {isOverlayMode && onClose && (
            <button
              onClick={onClose}
              className="flex items-center space-x-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-blue-600/30"
              title="読書画面に戻る"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>読書に戻る</span>
              <X className="w-3.5 h-3.5 ml-0.5" />
            </button>
          )}
        </div>
      </div>

      {/* 2. Messages List */}
      <div 
        ref={messagesContainerRef}
        className="flex-1 bg-slate-900/40 border border-slate-800/60 rounded-2xl p-4 overflow-y-auto space-y-4"
      >
        {messages.map((msg) => {
          const isUser = msg.sender === 'user';

          return (
            <div
              key={msg.id}
              className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
            >
              {/* Avatar */}
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
                isUser
                  ? 'bg-blue-600 text-white'
                  : 'bg-indigo-950 border border-indigo-500/40 text-indigo-300'
              }`}>
                {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>

              {/* Bubble */}
              <div className={`max-w-[88%] sm:max-w-[80%] space-y-2.5 ${isUser ? 'items-end' : 'items-start'}`}>
                <div className={`p-3.5 sm:p-4 rounded-2xl text-xs sm:text-sm leading-relaxed ${
                  isUser
                    ? 'bg-blue-600 text-white rounded-tr-none shadow-md shadow-blue-600/20 whitespace-pre-wrap'
                    : 'bg-slate-900/95 text-slate-200 rounded-tl-none border border-slate-800 shadow-md'
                }`}>
                  {isUser ? (
                    msg.text
                  ) : (
                    <div className="prose prose-invert max-w-none text-xs sm:text-sm leading-relaxed space-y-2">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: ({ ...props }) => <p className="mb-2 leading-relaxed" {...props} />,
                          strong: ({ ...props }) => <strong className="font-bold text-sky-300" {...props} />,
                          em: ({ ...props }) => <em className="italic text-amber-300" {...props} />,
                          ul: ({ ...props }) => <ul className="list-disc list-inside space-y-1 my-1.5 ml-1" {...props} />,
                          ol: ({ ...props }) => <ol className="list-decimal list-inside space-y-1 my-1.5 ml-1" {...props} />,
                          li: ({ ...props }) => <li className="text-slate-200" {...props} />,
                          h1: ({ ...props }) => <h1 className="text-base font-bold text-white mt-3 mb-1.5 border-b border-slate-800 pb-1" {...props} />,
                          h2: ({ ...props }) => <h2 className="text-sm font-bold text-sky-400 mt-2.5 mb-1" {...props} />,
                          h3: ({ ...props }) => <h3 className="text-xs font-bold text-amber-300 mt-2 mb-1" {...props} />,
                          code: ({ inline, ...props }: any) =>
                            inline ? (
                              <code className="bg-slate-950 px-1.5 py-0.5 rounded text-sky-300 font-mono text-[11px] sm:text-xs border border-slate-800" {...props} />
                            ) : (
                              <pre className="bg-slate-950 p-2.5 rounded-xl text-[11px] sm:text-xs font-mono text-slate-300 border border-slate-800 overflow-x-auto my-2">
                                <code {...props} />
                              </pre>
                            ),
                          blockquote: ({ ...props }) => (
                            <blockquote className="border-l-2 border-indigo-500 pl-3 my-2 text-slate-400 italic bg-slate-950/40 py-1 rounded-r-lg" {...props} />
                          ),
                          table: ({ ...props }) => (
                            <div className="overflow-x-auto my-2">
                              <table className="min-w-full text-[11px] sm:text-xs border border-slate-800 divide-y divide-slate-800" {...props} />
                            </div>
                          ),
                          th: ({ ...props }) => <th className="px-2.5 py-1.5 bg-slate-950 text-left font-bold text-sky-400 border-r border-slate-800 last:border-r-0" {...props} />,
                          td: ({ ...props }) => <td className="px-2.5 py-1.5 border-r border-slate-800 last:border-r-0" {...props} />,
                        }}
                      >
                        {msg.text}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>

                {/* Suggested Vocabs from Assistant */}
                {!isUser && msg.suggestedVocabs && msg.suggestedVocabs.length > 0 && (
                  <div className="p-3 bg-slate-950/80 border border-blue-500/30 rounded-2xl space-y-2 animate-fadeIn">
                    <span className="text-[11px] font-bold text-blue-400 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                      おすすめの定着フレーズ（タップでAnki・語彙帳に追加）:
                    </span>

                    <div className="flex flex-wrap gap-2">
                      {msg.suggestedVocabs.map((vocab, idx) => {
                        const isAdded = savedVocabPhrases.has(vocab.phrase.toLowerCase());

                        return (
                          <div
                            key={idx}
                            className="bg-slate-900 border border-slate-800 p-2 rounded-xl flex items-center justify-between gap-3 text-xs flex-1 min-w-[200px]"
                          >
                            <div className="min-w-0 flex-1">
                              <span
                                onClick={() => speakText(vocab.phrase)}
                                className="font-bold text-white block truncate cursor-pointer hover:text-blue-400"
                                title="発音を再生"
                              >
                                {vocab.phrase} 🔊
                              </span>
                              <span className="text-[11px] text-slate-400 block truncate">
                                {vocab.meaning}
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => onAddToVocab(vocab.phrase, vocab.meaning)}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1 flex-shrink-0 ${
                                isAdded
                                  ? 'bg-blue-950/80 text-blue-300 border border-blue-500/40'
                                  : 'bg-blue-600 hover:bg-blue-500 text-white shadow-sm shadow-blue-600/30'
                              }`}
                            >
                              {isAdded ? (
                                <>
                                  <Check className="w-3 h-3 text-sky-400" />
                                  <span>登録済</span>
                                </>
                              ) : (
                                <>
                                  <Plus className="w-3 h-3" />
                                  <span>語彙帳に追加</span>
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
            </div>
          );
        })}

        {isLoading && (
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-indigo-950 border border-indigo-500/40 text-indigo-300 flex items-center justify-center flex-shrink-0">
              <Bot className="w-4 h-4 animate-bounce" />
            </div>
            <div className="p-3 bg-slate-900/90 border border-slate-800 rounded-2xl rounded-tl-none text-xs text-slate-400 flex items-center gap-2">
              <div className="w-3.5 h-3.5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
              <span>AIメンターが考え中...</span>
            </div>
          </div>
        )}
      </div>

      {/* 3. Suggestion Chips (if few messages) */}
      {messages.length <= 2 && (
        <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 flex-shrink-0 text-xs">
          <span className="text-slate-500 flex items-center gap-1 flex-shrink-0">
            <HelpCircle className="w-3.5 h-3.5" /> よくある質問:
          </span>
          {suggestionChips.map((chip, idx) => (
            <button
              key={idx}
              onClick={() => handleSend(chip)}
              className="px-2.5 py-1 bg-slate-900 hover:bg-slate-850 text-slate-300 border border-slate-800 rounded-xl whitespace-nowrap transition-colors"
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      {/* 4. Input Bar */}
      <div className="flex items-center gap-2 bg-slate-900/90 border border-slate-800 p-2 rounded-2xl flex-shrink-0">
        <input
          ref={inputRef}
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="質問を入力... (Enterで送信)"
          className="flex-1 bg-transparent px-3 py-1.5 text-xs sm:text-sm text-slate-100 placeholder-slate-500 outline-none"
        />

        <button
          onClick={() => handleSend()}
          disabled={!inputText.trim() || isLoading}
          className="p-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl shadow-md shadow-blue-600/25 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
