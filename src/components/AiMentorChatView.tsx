import React, { useState, useRef, useEffect } from 'react';
import { 
  Send, Bot, User, Sparkles, X, Plus, Check, Loader2, Trash2, 
  BookOpen, PenTool, Repeat, MessageSquare, History, Edit3, ChevronDown 
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChatMessage, ChatSession, ChatSuggestedVocab, SuggestedSentence } from '../types/chat';
import { chatWithAiMentor } from '../services/gemini';
import { 
  loadVocabs, loadDailySnapshots, loadMyGoal, computeLevelProgress, 
  getWeakestPatterns, saveSentenceCardWithSiblings, SaveSentenceCardParams,
  loadChatSessions, loadActiveChatSessionId, saveActiveChatSessionId,
  createNewChatSession, deleteChatSession, updateChatSessionTitle, saveMessagesToSession,
  clearChatMessages
} from '../services/storage';

interface AiMentorChatViewProps {
  apiKey: string;
  model?: string;
  onAddToVocab: (phrase: string, meaning: string, sentence?: string) => void;
  onSaveSentenceCard: (params: SaveSentenceCardParams) => void;
  onRecordTokenUsage?: (promptTokens: number, candidatesTokens: number) => void;
  savedVocabPhrases?: Set<string>;
  initialInput?: string;
  isOverlayMode?: boolean;
  onClose?: () => void;
  // Legacy / optional props
  messages?: ChatMessage[];
  onSendMessage?: (
    userText: string,
    assistantReply: string,
    suggestedVocabs: ChatSuggestedVocab[],
    suggestedSentences?: SuggestedSentence[]
  ) => void;
  onClearChat?: () => void;
}

/**
 * ユーザーの質問文から、和英（瞬間英作文）か英和（読解）かの意図を自動判定
 */
export function detectQueryDirection(query?: string): 'ja_to_en' | 'en_to_ja' {
  if (!query) return 'ja_to_en';
  const q = query.toLowerCase().trim();

  // 英和・読解パターンの検出 (英語の意味・ニュアンス・解説を尋ねる)
  if (
    /意味|ニュアンス|どういうこと|使い方|訳し|訳|違い|とは|explain|mean/.test(q) ||
    /^[a-zA-Z\s,.'!?-]{4,}/.test(q)
  ) {
    return 'en_to_ja';
  }

  // デフォルトは和英・瞬間英作文 (「〜はどう言う？」「〜を英語で」)
  return 'ja_to_en';
}

/**
 * 英語センテンスとしての妥当性を厳格にチェック
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
  onAddToVocab,
  onSaveSentenceCard,
  onRecordTokenUsage,
  savedVocabPhrases = new Set(),
  initialInput = '',
  isOverlayMode = false,
  onClose,
  onSendMessage,
  onClearChat,
}) => {
  // Session State
  const [sessions, setSessions] = useState<ChatSession[]>(() => loadChatSessions());
  const [activeSessionId, setActiveSessionId] = useState<string>(() => loadActiveChatSessionId());
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  const [inputText, setInputText] = useState(initialInput);
  const [isLoading, setIsLoading] = useState(false);

  // Current active session & messages
  const currentSession = sessions.find(s => s.id === activeSessionId) || sessions[0] || {
    id: 'session_default',
    title: '新規チャット',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
  };
  const currentMessages = currentSession.messages || [];

  // Track saved cards per sentence text and direction
  const [savedDirectionsMap, setSavedDirectionsMap] = useState<Map<string, Set<'en_to_ja' | 'ja_to_en'>>>(() => {
    const map = new Map<string, Set<'en_to_ja' | 'ja_to_en'>>();
    try {
      const vocabs = loadVocabs();
      vocabs.forEach(v => {
        const text = (v.sentence || v.phrase || '').trim().toLowerCase();
        if (text) {
          if (!map.has(text)) map.set(text, new Set());
          const dir = v.cardDirection || 'en_to_ja';
          map.get(text)!.add(dir);
        }
      });
    } catch (_) {}
    return map;
  });

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
  }, [currentMessages, isLoading]);

  // Session Handlers
  const handleNewChat = () => {
    const newSession = createNewChatSession();
    const updated = loadChatSessions();
    setSessions(updated);
    setActiveSessionId(newSession.id);
    setIsHistoryOpen(false);
    setInputText('');
    setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
  };

  const handleSelectSession = (sessionId: string) => {
    saveActiveChatSessionId(sessionId);
    setActiveSessionId(sessionId);
    setIsHistoryOpen(false);
  };

  const handleDeleteSession = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (sessions.length === 1) {
      if (window.confirm('この会話をクリアして新しく開始しますか？')) {
        const updated = deleteChatSession(sessionId);
        setSessions(updated);
        setActiveSessionId(loadActiveChatSessionId());
      }
      return;
    }
    const updated = deleteChatSession(sessionId);
    setSessions(updated);
    setActiveSessionId(loadActiveChatSessionId());
  };

  const handleStartRename = (session: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSessionId(session.id);
    setEditingTitle(session.title);
  };

  const handleSaveRename = (sessionId: string, e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (editingTitle.trim()) {
      updateChatSessionTitle(sessionId, editingTitle.trim());
      setSessions(loadChatSessions());
    }
    setEditingSessionId(null);
  };

  const handleClearCurrentSession = () => {
    if (window.confirm('現在の会話履歴をクリアしますか？')) {
      clearChatMessages();
      setSessions(loadChatSessions());
      if (onClearChat) onClearChat();
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || isLoading) return;

    const query = inputText.trim();
    setInputText('');
    setIsLoading(true);

    const userMsg: ChatMessage = {
      id: 'msg_u_' + Date.now(),
      sender: 'user',
      text: query,
      createdAt: new Date().toISOString(),
    };

    // Optimistically update current session
    const updatedWithUser = [...currentMessages, userMsg];
    saveMessagesToSession(currentSession.id, updatedWithUser);
    setSessions(loadChatSessions());

    try {
      const historyContents = updatedWithUser.map(m => ({
        role: m.sender === 'user' ? ('user' as const) : ('model' as const),
        parts: [{ text: m.text }],
      }));

      // SLA Telemetry context
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

      // 重複除外
      const pastSentences = new Set<string>();
      const pastVocabs = new Set<string>();
      updatedWithUser.forEach(m => {
        if (m.suggestedSentences) {
          m.suggestedSentences.forEach(s => pastSentences.add(s.english.trim().toLowerCase()));
        }
        if (m.suggestedVocabs) {
          m.suggestedVocabs.forEach(v => pastVocabs.add(v.phrase.trim().toLowerCase()));
        }
      });

      const freshSentences = (res.suggestedSentences || []).filter(
        s => !pastSentences.has(s.english.trim().toLowerCase())
      );
      const freshVocabs = (res.suggestedVocabs || []).filter(
        v => !pastVocabs.has(v.phrase.trim().toLowerCase())
      );

      const botMsg: ChatMessage = {
        id: 'msg_b_' + Date.now(),
        sender: 'assistant',
        text: res.replyText,
        suggestedVocabs: freshVocabs,
        suggestedSentences: freshSentences,
        createdAt: new Date().toISOString(),
      };

      const finalMessages = [...updatedWithUser, botMsg];
      saveMessagesToSession(currentSession.id, finalMessages);
      setSessions(loadChatSessions());

      if (onSendMessage) {
        onSendMessage(query, res.replyText, freshVocabs, freshSentences);
      }
    } catch (e: any) {
      console.error('AI Mentor chat error:', e);
      const errorMsg: ChatMessage = {
        id: 'msg_err_' + Date.now(),
        sender: 'assistant',
        text: `申し訳ありません。回答の生成中にエラーが発生しました: ${e?.message || '通信エラー'}\n\nAPIキーの設定やネットワーク状態をご確認ください。`,
        createdAt: new Date().toISOString(),
      };
      const finalMessages = [...updatedWithUser, errorMsg];
      saveMessagesToSession(currentSession.id, finalMessages);
      setSessions(loadChatSessions());
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

  const handleSaveDirectionalCard = (
    sentence: string,
    translation: string,
    direction: 'ja_to_en' | 'en_to_ja'
  ) => {
    onSaveSentenceCard({
      sentence,
      translation,
      focusType: 'sentence',
      cardDirection: direction,
    });

    const key = sentence.trim().toLowerCase();
    setSavedDirectionsMap(prev => {
      const next = new Map(prev);
      if (!next.has(key)) next.set(key, new Set());
      next.get(key)!.add(direction);
      return next;
    });
  };

  const handleSaveBidirectionalCards = (
    sentence: string,
    translation: string
  ) => {
    saveSentenceCardWithSiblings({
      sentence,
      translation,
      focusType: 'sentence',
    });

    const key = sentence.trim().toLowerCase();
    setSavedDirectionsMap(prev => {
      const next = new Map(prev);
      if (!next.has(key)) next.set(key, new Set());
      next.get(key)!.add('ja_to_en');
      next.get(key)!.add('en_to_ja');
      return next;
    });
  };

  const formatSessionDate = (isoString?: string) => {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      if (isToday) {
        return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
      }
      return `${d.getMonth() + 1}/${d.getDate()}`;
    } catch (_) {
      return '';
    }
  };

  return (
    <div className={`flex flex-col h-full bg-slate-950 text-slate-100 ${isOverlayMode ? 'p-3 sm:p-4' : 'max-w-4xl mx-auto p-3 sm:p-6 w-full'}`}>
      {/* Top Header Bar */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800 shrink-0 gap-2">
        {/* Left: Thread Title / Selector */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            onClick={() => setIsHistoryOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-850 border border-slate-800 text-xs font-semibold text-slate-200 transition-colors cursor-pointer max-w-[220px] sm:max-w-xs truncate group"
            title="会話履歴・スレッド切り替え"
          >
            <MessageSquare className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span className="truncate">{currentSession.title || '新規チャット'}</span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-200 shrink-0 ml-0.5" />
          </button>

          <button
            onClick={handleNewChat}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-sm shadow-blue-500/20 active:scale-95 transition-all cursor-pointer shrink-0"
            title="新しいチャットを開始（メモリリフレッシュ）"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">新規チャット</span>
          </button>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setIsHistoryOpen(true)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer flex items-center gap-1 text-xs px-2"
            title="会話スレッド一覧"
          >
            <History className="w-3.5 h-3.5 text-slate-400" />
            <span className="hidden md:inline">履歴 ({sessions.length})</span>
          </button>

          <button
            onClick={handleClearCurrentSession}
            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 border border-transparent hover:border-rose-900/40 transition-colors cursor-pointer"
            title="現在のチャットをクリア"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          {isOverlayMode && onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer ml-1"
              title="閉じる"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* History Drawer / Modal */}
      {isHistoryOpen && (
        <div 
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex justify-start animate-fadeIn"
          onClick={() => setIsHistoryOpen(false)}
        >
          <div 
            className="w-full max-w-xs sm:max-w-sm h-full bg-slate-950 border-r border-slate-800 shadow-2xl animate-slideRight flex flex-col p-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-blue-400" />
                <h3 className="font-bold text-sm text-white">会話スレッド履歴</h3>
              </div>
              <button
                onClick={() => setIsHistoryOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* + New Chat Button inside Drawer */}
            <button
              onClick={handleNewChat}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md shadow-blue-500/20 active:scale-95 transition-all cursor-pointer mb-3"
            >
              <Plus className="w-4 h-4" />
              <span>＋ 新しい会話を作成</span>
            </button>

            {/* Thread List */}
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
              {sessions.map((session) => {
                const isActive = session.id === activeSessionId;
                const isEditing = editingSessionId === session.id;
                const msgCount = session.messages?.length || 0;

                return (
                  <div
                    key={session.id}
                    onClick={() => !isEditing && handleSelectSession(session.id)}
                    className={`group relative flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer text-xs ${
                      isActive
                        ? 'bg-blue-950/40 border-blue-500/50 text-white shadow-sm'
                        : 'bg-slate-900/60 border-slate-800/80 hover:bg-slate-850 hover:border-slate-700 text-slate-300'
                    }`}
                  >
                    <div className="flex items-start gap-2 min-w-0 flex-1 pr-2">
                      <MessageSquare className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${isActive ? 'text-blue-400' : 'text-slate-500'}`} />
                      
                      {isEditing ? (
                        <form 
                          onSubmit={(e) => handleSaveRename(session.id, e)}
                          className="flex-1 flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="text"
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onBlur={() => handleSaveRename(session.id)}
                            autoFocus
                            className="w-full bg-slate-950 border border-blue-500 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none"
                          />
                          <button type="submit" className="p-1 text-emerald-400 hover:text-emerald-300">
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        </form>
                      ) : (
                        <div className="min-w-0 flex-1">
                          <p className={`font-semibold truncate ${isActive ? 'text-white' : 'text-slate-200'}`}>
                            {session.title}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-500">
                            <span>{formatSessionDate(session.updatedAt || session.createdAt)}</span>
                            <span>•</span>
                            <span>{msgCount}件</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {!isEditing && (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => handleStartRename(session, e)}
                          className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                          title="タイトル編集"
                        >
                          <Edit3 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => handleDeleteSession(session.id, e)}
                          className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-950/40"
                          title="削除"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto py-4 space-y-4 pr-1 sm:pr-2 custom-scrollbar">
        {currentMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500 space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <h4 className="font-bold text-slate-200 text-sm">AI英語メンターに何でも質問</h4>
              <p className="text-xs text-slate-400 mt-1 max-w-xs">
                「〜は英語で何と言う？」「このニュアンスの違いは？」など気軽に送信してください。
              </p>
            </div>
          </div>
        ) : (
          currentMessages.map((m) => {
            const hasCandidates = (m.suggestedSentences && m.suggestedSentences.length > 0) ||
                                  (m.suggestedVocabs && m.suggestedVocabs.length > 0);

            return (
              <div
                key={m.id}
                className={`flex items-start gap-2.5 sm:gap-3 ${
                  m.sender === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                {m.sender === 'assistant' && (
                  <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-blue-600/90 border border-blue-400/30 flex items-center justify-center text-white shrink-0 mt-0.5 shadow-sm">
                    <Bot className="w-4 h-4" />
                  </div>
                )}

                <div
                  className={`max-w-[88%] sm:max-w-[82%] rounded-2xl px-3.5 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm shadow-sm ${
                    m.sender === 'user'
                      ? 'bg-blue-600 text-white rounded-tr-none font-sans leading-relaxed'
                      : 'bg-slate-900 border border-slate-800/90 text-slate-200 rounded-tl-none space-y-3'
                  }`}
                >
                  {/* Markdown Renderer for AI responses or user text */}
                  {m.sender === 'assistant' ? (
                    <div className="prose-dark leading-relaxed">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed text-slate-200 text-xs sm:text-sm">{children}</p>,
                          strong: ({ children }) => <strong className="font-bold text-white bg-slate-800/80 px-1 py-0.5 rounded text-[13px] border border-slate-700/50">{children}</strong>,
                          em: ({ children }) => <em className="text-cyan-300 not-italic font-medium">{children}</em>,
                          h1: ({ children }) => <h1 className="text-base font-bold text-white mt-3 mb-1.5 pb-1 border-b border-slate-800 flex items-center gap-1.5">{children}</h1>,
                          h2: ({ children }) => <h2 className="text-sm font-bold text-blue-300 mt-2.5 mb-1 flex items-center gap-1">{children}</h2>,
                          h3: ({ children }) => <h3 className="text-xs font-bold text-slate-300 mt-2 mb-1">{children}</h3>,
                          ul: ({ children }) => <ul className="list-disc list-inside space-y-1 my-2 text-slate-200 pl-1">{children}</ul>,
                          ol: ({ children }) => <ol className="list-decimal list-inside space-y-1 my-2 text-slate-200 pl-1">{children}</ol>,
                          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                          blockquote: ({ children }) => (
                            <blockquote className="border-l-2 border-blue-500 bg-blue-950/20 pl-3 py-1 my-2 rounded-r text-slate-300 text-xs italic">
                              {children}
                            </blockquote>
                          ),
                          code: ({ node, inline, className, children, ...props }: any) => {
                            if (inline) {
                              return (
                                <code className="bg-slate-950 text-cyan-300 px-1.5 py-0.5 rounded font-mono text-xs border border-slate-800" {...props}>
                                  {children}
                                </code>
                              );
                            }
                            return (
                              <pre className="bg-slate-950 p-3 rounded-xl font-mono text-xs text-slate-200 overflow-x-auto border border-slate-800 my-2 shadow-inner">
                                <code {...props}>{children}</code>
                              </pre>
                            );
                          },
                          table: ({ children }) => (
                            <div className="overflow-x-auto my-2 rounded-lg border border-slate-800">
                              <table className="min-w-full text-xs divide-y divide-slate-800">{children}</table>
                            </div>
                          ),
                          thead: ({ children }) => <thead className="bg-slate-900/90">{children}</thead>,
                          th: ({ children }) => <th className="px-3 py-1.5 text-left font-semibold text-slate-300 text-[11px] uppercase tracking-wider">{children}</th>,
                          td: ({ children }) => <td className="px-3 py-1.5 border-t border-slate-800/60 text-slate-300 text-xs">{children}</td>,
                          hr: () => <hr className="border-slate-800 my-3" />,
                        }}
                      >
                        {m.text}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{m.text}</p>
                  )}

                  {/* AI Recommended Candidate Cards */}
                  {hasCandidates && (
                    <div className="space-y-3 pt-2.5 border-t border-slate-800/80">
                      {/* 1. 英文カード登録推奨 */}
                      {m.suggestedSentences && m.suggestedSentences.length > 0 && (
                        <div className="space-y-1.5">
                          <span className="text-[10px] font-bold text-cyan-300 flex items-center gap-1">
                            <Sparkles className="w-3 h-3" />
                            瞬間英作文・Anki登録推奨:
                          </span>
                          <div className="space-y-2">
                            {m.suggestedSentences.map((s, idx) => {
                              const sKey = s.english.trim().toLowerCase();
                              const savedDirs = savedDirectionsMap.get(sKey) || new Set();
                              const isJaToEnSaved = savedDirs.has('ja_to_en');
                              const isEnToJaSaved = savedDirs.has('en_to_ja');
                              const isBothSaved = isJaToEnSaved && isEnToJaSaved;

                              return (
                                <div
                                  key={idx}
                                  className="p-2.5 bg-slate-950/90 border border-slate-800 rounded-xl space-y-2 text-xs"
                                >
                                  <div>
                                    <div className="font-bold text-white font-serif text-sm tracking-wide">
                                      {s.english}
                                    </div>
                                    <div className="text-slate-400 text-xs mt-0.5">
                                      {s.japanese}
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-1.5 pt-1 border-t border-slate-800/60 flex-wrap">
                                    <button
                                      onClick={() => handleSaveDirectionalCard(s.english, s.japanese, 'ja_to_en')}
                                      disabled={isJaToEnSaved}
                                      className={`px-2 py-1 rounded-lg text-[10px] font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                                        isJaToEnSaved
                                          ? 'bg-emerald-900/30 text-emerald-300 border border-emerald-500/30 cursor-default'
                                          : 'bg-slate-800 hover:bg-slate-750 text-slate-300 border border-slate-700 hover:border-slate-600 active:scale-95'
                                      }`}
                                      title="日本語を見て英語を瞬時に発話する練習カード"
                                    >
                                      {isJaToEnSaved ? <Check className="w-3 h-3 text-emerald-400" /> : <PenTool className="w-3 h-3 text-blue-400" />}
                                      <span>{isJaToEnSaved ? '和英済' : '📝 和英 (作文)'}</span>
                                    </button>

                                    <button
                                      onClick={() => handleSaveDirectionalCard(s.english, s.japanese, 'en_to_ja')}
                                      disabled={isEnToJaSaved}
                                      className={`px-2 py-1 rounded-lg text-[10px] font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                                        isEnToJaSaved
                                          ? 'bg-emerald-900/30 text-emerald-300 border border-emerald-500/30 cursor-default'
                                          : 'bg-slate-800 hover:bg-slate-750 text-slate-300 border border-slate-700 hover:border-slate-600 active:scale-95'
                                      }`}
                                      title="英語を見て頭から瞬時に意味を掴む読解カード"
                                    >
                                      {isEnToJaSaved ? <Check className="w-3 h-3 text-emerald-400" /> : <BookOpen className="w-3 h-3 text-cyan-400" />}
                                      <span>{isEnToJaSaved ? '英和済' : '📖 英和 (読解)'}</span>
                                    </button>

                                    <button
                                      onClick={() => handleSaveBidirectionalCards(s.english, s.japanese)}
                                      disabled={isBothSaved}
                                      className={`px-2 py-1 rounded-lg text-[10px] font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                                        isBothSaved
                                          ? 'bg-emerald-900/30 text-emerald-300 border border-emerald-500/30 cursor-default'
                                          : 'bg-slate-800 hover:bg-slate-750 text-slate-300 border border-slate-700 hover:border-slate-600 active:scale-95'
                                      }`}
                                      title="和英（作文）と英和（読解）の2枚を兄弟カードとして同時作成"
                                    >
                                      {isBothSaved ? <Check className="w-3 h-3 text-emerald-400" /> : <Repeat className="w-3 h-3 text-emerald-400" />}
                                      <span>{isBothSaved ? '双方向済' : '🔄 双方向 (2枚)'}</span>
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* 2. 単語帳登録推奨 */}
                      {m.suggestedVocabs && m.suggestedVocabs.length > 0 && (
                        <div className="space-y-1.5 pt-2 border-t border-slate-800/60">
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
                  <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-slate-800 flex items-center justify-center text-slate-300 shrink-0 mt-0.5 shadow-sm">
                    <User className="w-4 h-4" />
                  </div>
                )}
              </div>
            );
          })
        )}
        {isLoading && (
          <div className="flex items-start gap-2.5 sm:gap-3 animate-fadeIn">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-blue-600 flex items-center justify-center text-white shrink-0 mt-0.5 animate-pulse">
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
      <form onSubmit={handleSubmit} className="pt-3 border-t border-slate-800 shrink-0">
        <div className="relative flex items-center">
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="「〜って英語でどう言う？」「このニュアンスの違いは？」と質問... (Ctrl+Enterで送信)"
            rows={2}
            className="w-full bg-slate-900 border border-slate-700 rounded-2xl pl-4 pr-12 py-2.5 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none shadow-inner"
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
