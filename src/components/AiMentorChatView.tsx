import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Bot, User, Sparkles, X, Plus, Check, Loader2, Trash2, Puzzle } from 'lucide-react';
import confetti from 'canvas-confetti';
import { ChatMessage, ChatSuggestedVocab, SuggestedSentence } from '../types/chat';
import { SaveSentenceCardParams } from '../services/storage';
import { chatWithAiMentor } from '../services/gemini';
import { enqueueMasteryScanTask } from '../services/cefrScanner';
import {
  loadDailySnapshots,
  loadMyGoal,
  computeLevelProgress,
  getWeakestPatterns
} from '../services/storage';

interface AiMentorChatViewProps {
  apiKey: string;
  model?: string;
  messages: ChatMessage[];
  onSendMessage: (userText: string, replyText: string, suggestedVocabs: ChatSuggestedVocab[], suggestedSentences?: SuggestedSentence[]) => void;
  onAddToVocab: (phrase: string, meaning: string, sentence?: string) => void;
  onSaveSentenceCard?: (params: SaveSentenceCardParams) => void;
  onClearChat?: () => void;
  onRecordTokenUsage?: (promptTokens: number, candidatesTokens: number) => void;
  savedVocabPhrases?: Set<string>;
  initialInput?: string;
  isOverlayMode?: boolean;
  onClose?: () => void;
}

/**
 * 英語センテンスとしての妥当性を厳格にチェック
 * - 3単語以上
 * - 8文字以上のラテン文字を含み、日本語文字を含まない
 */
function isValidEnglishSentence(s: string): boolean {
  const trimmed = s.trim();
  const words = trimmed.split(/\s+/);
  if (words.length < 3) return false;

  const latinMatches = trimmed.match(/[a-zA-Z]/g);
  if (!latinMatches || latinMatches.length < 8) return false;

  const jaMatches = trimmed.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/g);
  if (jaMatches && jaMatches.length > 0) return false;

  return true;
}

/**
 * AIの回答本文から英語の推奨例文・フレーズを正規表現で高精度に抽出
 */
export function extractEnglishSentenceCandidates(text: string, userQueryText: string = ''): SuggestedSentence[] {
  if (!text) return [];

  const results: SuggestedSentence[] = [];
  const seen = new Set<string>();

  const cleanQuery = userQueryText
    ? userQueryText.replace(/^[\s「『]*(.*?)[\s」』]*(?:って|は)?(?:英語で)?(?:なん|どう)(?:と|言う|いう|いうの)?.*$/i, '$1').trim()
    : 'この表現を英語で組み立てる';

  // 1. "English sentence" (日本語訳) または "English sentence"（日本語訳）
  const patternQuotesWithJa = /["“]([A-Za-z0-9\s,.'!?\-_/]{10,})["”](?:\s*[:：\-=➔]?\s*[（(]([^）)]+)[）)])?/g;
  let match: RegExpExecArray | null;
  while ((match = patternQuotesWithJa.exec(text)) !== null) {
    const en = match[1].trim();
    const ja = (match[2] || '').trim();
    if (isValidEnglishSentence(en) && !seen.has(en.toLowerCase())) {
      seen.add(en.toLowerCase());
      results.push({
        english: en,
        japanese: ja || cleanQuery || 'AIメンター相談フレーズ',
      });
    }
  }

  // 2. 箇条書き番号付き: 1. "English" または 1. English
  const patternNumbered = /(?:^|\n)\s*\d+[.)]\s*(?:["“]([^"”\n]+)["”]|([A-Z][^(\n]+))(?:\s*[（(]([^）)]+)[）)])?/g;
  while ((match = patternNumbered.exec(text)) !== null) {
    const rawEn = (match[1] || match[2] || '').replace(/[*_`]/g, '').trim();
    const ja = (match[3] || '').trim();
    if (isValidEnglishSentence(rawEn) && !seen.has(rawEn.toLowerCase())) {
      seen.add(rawEn.toLowerCase());
      results.push({
        english: rawEn,
        japanese: ja || cleanQuery || 'AIメンター相談フレーズ',
      });
    }
  }

  // 3. 太字英語: **"English"** または **English**
  const patternBold = /\*\*["“]?([A-Za-z0-9\s,.'!?\-_/]{10,})["”]?\*\*(?:\s*[（(]([^）)]+)[）)])?/g;
  while ((match = patternBold.exec(text)) !== null) {
    const en = match[1].trim();
    const ja = (match[2] || '').trim();
    if (isValidEnglishSentence(en) && !seen.has(en.toLowerCase())) {
      seen.add(en.toLowerCase());
      results.push({
        english: en,
        japanese: ja || cleanQuery || 'AIメンター相談フレーズ',
      });
    }
  }

  return results;
}

export const AiMentorChatView: React.FC<AiMentorChatViewProps> = ({
  apiKey,
  model = 'gemini-3.7-flash',
  messages,
  onSendMessage,
  onAddToVocab,
  onSaveSentenceCard,
  onClearChat,
  onRecordTokenUsage,
  savedVocabPhrases = new Set(),
  initialInput = '',
  isOverlayMode = false,
  onClose,
}) => {
  const [inputText, setInputText] = useState(initialInput);
  const [isLoading, setIsLoading] = useState(false);
  const [savedSentenceKeys, setSavedSentenceKeys] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (initialInput) {
      setInputText(initialInput);
      inputRef.current?.focus();
    }
  }, [initialInput]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || isLoading) return;

    const query = inputText.trim();
    setInputText('');
    setIsLoading(true);

    try {
      const historyContents = messages.map(m => ({
        role: m.sender === 'user' ? ('user' as const) : ('model' as const),
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

      if (res.tokenUsage && onRecordTokenUsage) {
        onRecordTokenUsage(res.tokenUsage.promptTokens, res.tokenUsage.candidatesTokens);
      }

      onSendMessage(query, res.replyText, res.suggestedVocabs || [], res.suggestedSentences || []);

      try {
        enqueueMasteryScanTask({
          sourceType: 'mentor',
          title: 'AIメンター対話',
          text: `${query} ${res.replyText}`,
          userUtterances: [query],
        });
      } catch (_) {}
    } catch (err) {
      console.error('Chat error:', err);
      alert('AIとの通信中にエラーが発生しました。');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Quick save as Assembly Card (瞬間英作文・和英カード)
  const handleSaveAssemblyCard = useCallback((sentenceItem: SuggestedSentence) => {
    if (!onSaveSentenceCard) return;
    const cleanEn = sentenceItem.english.trim();
    const cleanJa = sentenceItem.japanese.trim() || '瞬間英作文';

    if (!isValidEnglishSentence(cleanEn)) {
      alert('英語のセンテンスとして認識できませんでした。');
      return;
    }

    onSaveSentenceCard({
      sentence: cleanEn,
      translation: cleanJa,
      focusType: 'sentence',
      importance: 5,
    });

    confetti({ particleCount: 25, spread: 50, origin: { y: 0.8 } });
    setSavedSentenceKeys(prev => new Set([...prev, cleanEn.toLowerCase()]));
  }, [onSaveSentenceCard]);

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
            <p className="text-xs text-slate-400">「〜ってどう言う？」相談 ➔ 瞬間英作文カードに即時登録</p>
          </div>
        </div>

        <div className="flex items-center space-x-1">
          {messages.length > 0 && onClearChat && (
            <button
              onClick={onClearChat}
              className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
              title="チャット履歴をクリア"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          {isOverlayMode && onClose && (
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
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
                「〜って言いたい時どう言う？」「このニュアンスの違いは？」と相談すると、AIが回答し、ワンタップでAnkiの瞬間英作文カードに登録できます。
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 pt-2 max-w-md">
              {[
                '「〜の予約を取りたいのですが」って英語でどう言う？',
                '「used to」と「be used to」の違いを教えて',
                '「念のため確認させてください」を自然に言いたい',
              ].map((suggestion, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    setInputText(suggestion);
                    inputRef.current?.focus();
                  }}
                  className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs rounded-xl transition-colors text-left cursor-pointer"
                >
                  💡 {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, mIdx) => {
            const prevUserMessage = mIdx > 0 && messages[mIdx - 1]?.sender === 'user' ? messages[mIdx - 1]?.text : undefined;
            
            // Extract sentences from structured payload or fallback parser
            const candidateSentences = m.suggestedSentences && m.suggestedSentences.length > 0
              ? m.suggestedSentences
              : extractEnglishSentenceCandidates(m.text, prevUserMessage);

            return (
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
                  className={`max-w-[90%] sm:max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed space-y-3 ${
                    m.sender === 'user'
                      ? 'bg-blue-600 text-white rounded-tr-none shadow-md shadow-blue-600/20'
                      : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-none shadow-md'
                  }`}
                >
                  {m.sender === 'user' ? (
                    <div className="whitespace-pre-wrap">{m.text}</div>
                  ) : (
                    <MarkdownRenderer content={m.text} />
                  )}

                  {/* Assistant Action Buttons: Assembly Cards & Vocab Suggestions */}
                  {m.sender === 'assistant' && (
                    <div className="pt-2 border-t border-slate-800 space-y-2.5">
                      {/* 1. 🧩 瞬間英作文（和英・組立カード）登録ボックス群 */}
                      {onSaveSentenceCard && candidateSentences.length > 0 && (
                        <div className="space-y-2">
                          <span className="text-[10px] font-bold text-purple-300 flex items-center gap-1">
                            <Puzzle className="w-3.5 h-3.5 text-purple-400" />
                            瞬間英作文（和英カード）に登録:
                          </span>
                          <div className="space-y-1.5">
                            {candidateSentences.map((sent, sIdx) => {
                              const isSaved = savedSentenceKeys.has(sent.english.trim().toLowerCase());
                              return (
                                <div
                                  key={sIdx}
                                  className="p-2.5 rounded-xl bg-gradient-to-r from-purple-950/60 to-indigo-950/60 border border-purple-500/30 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-sm"
                                >
                                  <div className="space-y-0.5 min-w-0 pr-1">
                                    <p className="font-serif font-bold text-white leading-snug">
                                      "{sent.english}"
                                    </p>
                                    <p className="text-[11px] text-purple-200/80">
                                      {sent.japanese}
                                    </p>
                                  </div>

                                  <button
                                    onClick={() => handleSaveAssemblyCard(sent)}
                                    disabled={isSaved}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all shrink-0 cursor-pointer ${
                                      isSaved
                                        ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 cursor-default'
                                        : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-md active:scale-95'
                                    }`}
                                  >
                                    {isSaved ? (
                                      <>
                                        <Check className="w-3.5 h-3.5" />
                                        <span>Anki登録済</span>
                                      </>
                                    ) : (
                                      <>
                                        <Plus className="w-3.5 h-3.5" />
                                        <span>Anki（和英）に登録</span>
                                      </>
                                    )}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* 2. 単語帳登録推奨 */}
                      {m.suggestedVocabs && m.suggestedVocabs.length > 0 && (
                        <div className="space-y-1 pt-1 border-t border-slate-800/60">
                          <span className="text-[10px] font-bold text-amber-300 flex items-center gap-1">
                            <Sparkles className="w-3 h-3" />
                            重要単語・表現:
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
                                    className={`px-2 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                                      isSaved
                                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                        : 'bg-blue-600 hover:bg-blue-500 text-white shadow-sm'
                                    }`}
                                  >
                                    {isSaved ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                                    <span>{isSaved ? '登録済' : '単語帳に追加'}</span>
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {m.sender === 'user' && (
                  <div className="w-8 h-8 rounded-xl bg-slate-800 flex items-center justify-center text-slate-300 shrink-0 mt-0.5">
                    <User className="w-4 h-4" />
                  </div>
                )}
              </div>
            );
          })
        )}
        {isLoading && (
          <div className="flex items-start gap-3 animate-fadeIn">
            <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center text-white shrink-0 mt-0.5 animate-pulse">
              <Bot className="w-4 h-4" />
            </div>
            <div className="bg-slate-900 border border-slate-800 text-slate-400 rounded-2xl rounded-tl-none px-4 py-3 text-xs flex items-center space-x-2">
              <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
              <span>AIメンターが回答を生成中...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Form */}
      <form onSubmit={handleSubmit} className="pt-3 border-t border-slate-800">
        <div className="relative flex items-center">
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="「〜って英語でどう言う？」「このニュアンスの違いは？」と質問... (Ctrl+Enterで送信)"
            rows={2}
            className="w-full bg-slate-900 border border-slate-700 rounded-2xl pl-4 pr-12 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none"
          />
          <button
            type="submit"
            disabled={!inputText.trim() || isLoading}
            className={`absolute right-2.5 p-2 rounded-xl text-white transition-all cursor-pointer ${
              inputText.trim() && !isLoading
                ? 'bg-blue-600 hover:bg-blue-500 shadow-md shadow-blue-500/20 active:scale-95'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>
    </div>
  );
};

function MarkdownRenderer({ content }: { content: string }) {
  // Simple markdown renderer for AI responses
  const lines = content.split('\n');
  return (
    <div className="space-y-1.5 text-xs sm:text-sm">
      {lines.map((line, idx) => {
        if (line.startsWith('### ')) {
          return <h3 key={idx} className="font-bold text-white text-sm pt-2">{line.replace('### ', '')}</h3>;
        }
        if (line.startsWith('## ')) {
          return <h2 key={idx} className="font-bold text-white text-base pt-2">{line.replace('## ', '')}</h2>;
        }
        if (line.startsWith('# ')) {
          return <h1 key={idx} className="font-black text-white text-base pt-2">{line.replace('# ', '')}</h1>;
        }
        if (line.startsWith('- ') || line.startsWith('* ')) {
          return (
            <div key={idx} className="flex items-start space-x-2 pl-1">
              <span className="text-blue-400 text-sm leading-tight">•</span>
              <span className="flex-1">{renderFormattedText(line.replace(/^[-*]\s*/, ''))}</span>
            </div>
          );
        }
        if (/^\d+\.\s/.test(line)) {
          const num = line.match(/^(\d+)\./)?.[1];
          return (
            <div key={idx} className="flex items-start space-x-2 pl-1">
              <span className="font-bold text-blue-400 text-xs font-mono">{num}.</span>
              <span className="flex-1">{renderFormattedText(line.replace(/^\d+\.\s*/, ''))}</span>
            </div>
          );
        }
        if (!line.trim()) {
          return <div key={idx} className="h-1" />;
        }
        return <p key={idx}>{renderFormattedText(line)}</p>;
      })}
    </div>
  );
}

function renderFormattedText(text: string) {
  // Bold **text**
  const parts = text.split(/(\*[^*]+\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="text-white font-bold">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="bg-slate-950 px-1.5 py-0.5 rounded font-mono text-cyan-300 text-xs border border-slate-800">{part.slice(1, -1)}</code>;
    }
    return part;
  });
}
