import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, ChatSuggestedVocab } from '../types/chat';
import { Bot, Send, User, Sparkles, Plus, Check, Trash2, HelpCircle, X, BookOpen } from 'lucide-react';
import { chatWithAiMentor } from '../services/gemini';
import { speakText } from '../utils/speech';

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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialInput) {
      setInputText(initialInput);
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [initialInput]);

  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const handleSend = async (textToSend?: string) => {
    const query = (textToSend || inputText).trim();
    if (!query || isLoading) return;

    if (!apiKey) {
      alert('Gemini APIキーが設定されていません。設定画面からAPIキーを入力してください。');
      return;
    }

    setInputText('');
    setIsLoading(true);

    try {
      const historyContents = messages.slice(-6).map(m => ({
        role: (m.sender === 'user' ? 'user' : 'model') as 'user' | 'model',
        parts: [{ text: m.text }],
      }));

      const res = await chatWithAiMentor({
        messages: historyContents,
        currentQuery: query,
        apiKey,
        model,
      });

      if (res.tokenUsage) {
        onRecordTokenUsage(res.tokenUsage.promptTokens, res.tokenUsage.candidatesTokens);
      }

      onSendMessage(query, res.replyText, res.suggestedVocabs);
    } catch (e: any) {
      console.error('Chat error', e);
      alert(`エラーが発生しました: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const suggestionChips = [
    '「恐縮ですが」って英語でなんて言う？',
    'look forward to と can\'t wait の違いは？',
    '「I was wondering if...」の自然な使い方は？',
    '日常会話でよく使う相槌のバリエーションを教えて！',
  ];

  const containerClasses = isOverlayMode
    ? 'w-full h-full flex flex-col p-3 sm:p-4 space-y-3 bg-slate-950/95 backdrop-blur-xl'
    : 'max-w-4xl mx-auto px-3 sm:px-4 py-4 sm:py-6 h-[calc(100vh-140px)] flex flex-col space-y-3';

  return (
    <div className={containerClasses}>
      {/* 1. Header */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5 sm:p-4 shadow-xl flex items-center justify-between flex-shrink-0">
        <div className="flex items-center space-x-3 min-w-0">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-md shadow-blue-500/20 flex-shrink-0">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base sm:text-lg font-bold text-white tracking-tight flex items-center gap-1.5 truncate">
              <span>AI英語メンター</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 font-bold border border-blue-500/30 flex-shrink-0">
                即時語彙回収
              </span>
            </h2>
            <p className="text-xs text-slate-400 truncate">
              {isOverlayMode ? '読書画面のまま質問・疑問を解消できます' : '質問からワンタップでAnki・語彙帳に追加できます'}
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
              <div className={`max-w-[85%] sm:max-w-[75%] space-y-2.5 ${isUser ? 'items-end' : 'items-start'}`}>
                <div className={`p-3.5 sm:p-4 rounded-2xl text-xs sm:text-sm leading-relaxed whitespace-pre-wrap ${
                  isUser
                    ? 'bg-blue-600 text-white rounded-tr-none shadow-md shadow-blue-600/20'
                    : 'bg-slate-900/90 text-slate-200 rounded-tl-none border border-slate-800 shadow-md'
                }`}>
                  {msg.text}
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

        <div ref={messagesEndRef} />
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
          placeholder="英語の表現、ニュアンスの違い、文法の質問を入力... (Enterで送信)"
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