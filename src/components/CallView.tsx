import React, { useState, useEffect, useRef } from 'react';
import { Persona, CallSession, CallMessage } from '../types/persona';
import { GeminiLiveSession, CallConnectionState } from '../services/geminiLive';
import { analyzeCallSessionAndExtractMemory, generateCustomPersona, chatWithPersona, DetectedExpressionError } from '../services/gemini';
import { ErrorCauseCategory } from '../types/expressionError';
import { speakText } from '../utils/speech';
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  Sparkles,
  Plus,
  Trash2,
  CheckCircle2,
  RefreshCw,
  X,
  Languages,
  BookMarked,
  Smile,
  Globe,
  Radio,
  MessageSquare,
  Send,
  Volume2,
  ArrowLeft,
  User,
} from 'lucide-react';

interface CallViewProps {
  apiKey: string;
  model?: string;
  personas: Persona[];
  callSessions: CallSession[];
  onSavePersona: (persona: Persona) => void;
  onDeletePersona: (personaId: string) => void;
  onResetPersonas: () => void;
  onUpdatePersonaMemory: (
    personaId: string,
    memoryUpdates: {
      newLikes?: string[];
      newDislikes?: string[];
      newTopic?: { topic: string; summary: string };
      newUserNotes?: string[];
      newPromises?: string[];
    },
    lastSpokenAt?: string
  ) => void;
  onSaveCallSession: (session: CallSession) => void;
  onAddToVocab: (phrase: string, meaning: string, sentence?: string, note?: string) => void;
  onSaveExpressionError?: (item: any) => any;
  onRecordTokenUsage?: (promptTokens: number, candidatesTokens: number) => void;
  savedVocabPhrases: Set<string>;
}

export const CallView: React.FC<CallViewProps> = ({
  apiKey,
  model = 'gemini-2.0-flash',
  personas,
  onSavePersona,
  onDeletePersona,
  onResetPersonas,
  onUpdatePersonaMemory,
  onSaveCallSession,
  onAddToVocab,
  onSaveExpressionError,
  onRecordTokenUsage,
  savedVocabPhrases,
}) => {
  // 画面モード: lobby (一覧) | call (音声通話中) | chat (テキストチャット中) | summary (通話後サマリー)
  const [viewState, setViewState] = useState<'lobby' | 'call' | 'chat' | 'summary'>('lobby');
  const [activePersona, setActivePersona] = useState<Persona | null>(null); // null の場合はフリー会話

  // 通話状態
  const [connectionState, setConnectionState] = useState<CallConnectionState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [isPushToTalk, setIsPushToTalk] = useState(false);
  const [isPushToTalkActive, setIsPushToTalkActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showSubtitles, setShowSubtitles] = useState(true);

  // 音量波形
  const [userVolume, setUserVolume] = useState(0);
  const [assistantVolume, setAssistantVolume] = useState(0);

  // 会話メッセージ履歴
  const [callMessages, setCallMessages] = useState<CallMessage[]>([]);
  const [currentAssistantText, setCurrentAssistantText] = useState('');

  // テキストチャット用状態
  const [chatInput, setChatInput] = useState('');
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [isSpeakingMessageId, setIsSpeakingMessageId] = useState<string | null>(null);
  const chatMessagesEndRef = useRef<HTMLDivElement | null>(null);

  // 通話後分析状態
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [latestSummarySession, setLatestSummarySession] = useState<CallSession | null>(null);
  const [detectedErrors, setDetectedErrors] = useState<DetectedExpressionError[]>([]);
  const [savedErrorIndices, setSavedErrorIndices] = useState<Set<number>>(new Set());
  const [currentSessionType, setCurrentSessionType] = useState<'voice' | 'chat'>('voice');

  // 新規パートナー作成モーダル
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [isCreatingPersona, setIsCreatingPersona] = useState(false);

  const liveSessionRef = useRef<GeminiLiveSession | null>(null);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  // 通話タイマー
  useEffect(() => {
    if ((viewState === 'call' && connectionState === 'connected') || viewState === 'chat') {
      if (!startTimeRef.current) startTimeRef.current = Date.now();
      timerRef.current = window.setInterval(() => {
        setCallDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [viewState, connectionState]);

  // チャットスクロール
  useEffect(() => {
    if (viewState === 'chat') {
      chatMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [callMessages, isSendingChat, viewState]);

  // 音声通話開始ハンドラー
  const handleStartCall = async (persona?: Persona | null) => {
    if (!apiKey) {
      alert('Gemini APIキーを設定してください（設定画面から登録可能です）');
      return;
    }

    const selectedPersona = persona !== undefined ? persona : activePersona;
    setActivePersona(selectedPersona || null);
    setCurrentSessionType('voice');
    setViewState('call');
    setConnectionState('connecting');
    setErrorMessage(null);
    setCallMessages([]);
    setCurrentAssistantText('');
    setCallDuration(0);
    startTimeRef.current = Date.now();

    const session = new GeminiLiveSession({
      apiKey,
      voiceName: selectedPersona?.voiceName || 'Aoede',
      persona: selectedPersona || undefined,
      isPushToTalk,
      callbacks: {
        onStateChange: (state, error) => {
          setConnectionState(state);
          if (error) setErrorMessage(error);
        },
        onUserTranscript: (text) => {
          setCallMessages((prev) => [
            ...prev,
            {
              id: 'user_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5),
              role: 'user',
              text,
              timestamp: new Date().toISOString(),
            },
          ]);
        },
        onAssistantTranscript: (textChunk) => {
          setCurrentAssistantText((prev) => prev + textChunk);
        },
        onTurnComplete: () => {
          setCurrentAssistantText((current) => {
            if (current.trim()) {
              setCallMessages((prev) => [
                ...prev,
                {
                  id: 'asst_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5),
                  role: 'assistant',
                  text: current.trim(),
                  timestamp: new Date().toISOString(),
                },
              ]);
            }
            return '';
          });
        },
        onVolumeChange: (uVol, aVol) => {
          setUserVolume(uVol);
          setAssistantVolume(aVol);
        },
        onInterrupted: () => {
          setCurrentAssistantText('');
        },
      },
    });

    liveSessionRef.current = session;
    await session.start();
  };

  // テキストチャット開始ハンドラー
  const handleStartChat = (persona?: Persona | null) => {
    if (!apiKey) {
      alert('Gemini APIキーを設定してください（設定画面から登録可能です）');
      return;
    }

    const selectedPersona = persona !== undefined ? persona : activePersona;
    setActivePersona(selectedPersona || null);
    setCurrentSessionType('chat');
    setViewState('chat');
    setCallMessages([]);
    setCallDuration(0);
    startTimeRef.current = Date.now();

    // 初回挨拶メッセージの追加
    const greetingText = selectedPersona
      ? `Hi there! I'm ${selectedPersona.name}. How's everything going with you today?`
      : `Hey! I'm your AI language exchange partner. What would you like to chat about today?`;

    setCallMessages([
      {
        id: 'asst_init',
        role: 'assistant',
        text: greetingText,
        timestamp: new Date().toISOString(),
      },
    ]);
  };

  // チャットメッセージ送信
  const handleSendChatMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim() || isSendingChat || !apiKey) return;

    const userText = chatInput.trim();
    setChatInput('');

    const userMsg: CallMessage = {
      id: 'user_' + Date.now(),
      role: 'user',
      text: userText,
      timestamp: new Date().toISOString(),
    };

    const nextHistory = [...callMessages, userMsg];
    setCallMessages(nextHistory);
    setIsSendingChat(true);

    try {
      const response = await chatWithPersona({
        apiKey,
        model,
        persona: activePersona,
        history: nextHistory,
        userText,
      });

      if (response.tokenUsage && onRecordTokenUsage) {
        onRecordTokenUsage(response.tokenUsage.promptTokens, response.tokenUsage.candidatesTokens);
      }

      const assistantMsg: CallMessage = {
        id: 'asst_' + Date.now(),
        role: 'assistant',
        text: response.text,
        timestamp: new Date().toISOString(),
      };

      setCallMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      console.error('Chat error:', err);
      setCallMessages(prev => [
        ...prev,
        {
          id: 'asst_err_' + Date.now(),
          role: 'assistant',
          text: '（メッセージの取得に失敗しました。もう一度試してください。）',
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsSendingChat(false);
    }
  };

  // 会話セッション終了ハンドラー（音声・チャット共通）
  const handleEndSession = async () => {
    if (liveSessionRef.current) {
      liveSessionRef.current.disconnect();
      liveSessionRef.current = null;
    }

    setConnectionState('disconnected');

    // 直近のアシスタント発話が残っていればメッセージに追加
    let finalMessages = [...callMessages];
    if (currentAssistantText.trim()) {
      finalMessages.push({
        id: 'asst_' + Date.now(),
        role: 'assistant',
        text: currentAssistantText.trim(),
        timestamp: new Date().toISOString(),
      });
    }

    const duration = callDuration;
    const persona = activePersona;
    const sessionType = currentSessionType;

    if (finalMessages.length === 0 || (finalMessages.length === 1 && finalMessages[0].id === 'asst_init')) {
      setViewState('lobby');
      return;
    }

    // 分析サマリー画面へ移行
    setViewState('summary');
    setIsAnalyzing(true);

    try {
      const analysis = await analyzeCallSessionAndExtractMemory({
        messages: finalMessages,
        personaName: persona?.name || 'AI Partner',
        apiKey,
        model,
      });

      if (analysis.tokenUsage && onRecordTokenUsage) {
        onRecordTokenUsage(analysis.tokenUsage.promptTokens, analysis.tokenUsage.candidatesTokens);
      }

      // ペルソナの動的記憶を更新（音声・チャット両方の会話内容が蓄積される）
      if (persona) {
        onUpdatePersonaMemory(
          persona.id,
          {
            newLikes: analysis.newLikes,
            newDislikes: analysis.newDislikes,
            newTopic: analysis.newTopic,
            newUserNotes: analysis.newUserNotes,
            newPromises: analysis.newPromises,
          },
          new Date().toISOString()
        );
      }

      const sessionRecord: CallSession = {
        id: 'session_' + Date.now(),
        personaId: persona?.id,
        personaName: persona?.name || 'フリー会話',
        sessionType,
        startedAt: new Date(Date.now() - duration * 1000).toISOString(),
        endedAt: new Date().toISOString(),
        durationSeconds: duration,
        messages: finalMessages,
        extractedVocabs: analysis.extractedVocabs,
        recapSummary: analysis.recapSummary,
        newLearnedFacts: [
          ...analysis.newLikes.map((l) => `好きなもの: ${l}`),
          ...analysis.newDislikes.map((d) => `苦手なもの: ${d}`),
          ...(analysis.newPromises || []),
        ],
      };

      setDetectedErrors(analysis.detectedErrors || []);
      setSavedErrorIndices(new Set());
      onSaveCallSession(sessionRecord);
      setLatestSummarySession(sessionRecord);
    } catch (e) {
      console.error('Failed to analyze session:', e);
      const fallbackSession: CallSession = {
        id: 'session_' + Date.now(),
        personaId: persona?.id,
        personaName: persona?.name || 'フリー会話',
        sessionType,
        startedAt: new Date(Date.now() - duration * 1000).toISOString(),
        endedAt: new Date().toISOString(),
        durationSeconds: duration,
        messages: finalMessages,
        extractedVocabs: [],
        recapSummary: '英会話セッションが完了しました。',
      };
      onSaveCallSession(fallbackSession);
      setLatestSummarySession(fallbackSession);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Push-to-Talk トグル
  const handleTogglePushToTalkMode = () => {
    const next = !isPushToTalk;
    setIsPushToTalk(next);
    if (liveSessionRef.current) {
      liveSessionRef.current.setPushToTalkMode(next);
    }
  };

  // Push-to-Talk 押下・離脱
  const handlePushToTalkStart = () => {
    setIsPushToTalkActive(true);
    if (liveSessionRef.current) {
      liveSessionRef.current.setPushToTalkActive(true);
    }
  };

  const handlePushToTalkEnd = () => {
    setIsPushToTalkActive(false);
    if (liveSessionRef.current) {
      liveSessionRef.current.setPushToTalkActive(false);
    }
  };

  // マイクミュートトグル
  const handleToggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    if (liveSessionRef.current) {
      liveSessionRef.current.setMuted(next);
    }
  };

  // 新規パートナー生成
  const handleCreateCustomPersona = async () => {
    if (!customPrompt.trim() || !apiKey) return;
    setIsCreatingPersona(true);
    try {
      const { persona, tokenUsage } = await generateCustomPersona({
        apiKey,
        userPrompt: customPrompt,
        model,
      });

      if (tokenUsage && onRecordTokenUsage) {
        onRecordTokenUsage(tokenUsage.promptTokens, tokenUsage.candidatesTokens);
      }

      onSavePersona(persona);
      setIsCreateModalOpen(false);
      setCustomPrompt('');
    } catch (err: any) {
      alert('パートナーの生成に失敗しました: ' + (err.message || 'エラーが発生しました'));
    } finally {
      setIsCreatingPersona(false);
    }
  };

  // 時間フォーマット
  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // -------------------------------------------------------------
  // VIEW: ロビー（パートナー一覧 ＆ フリー会話選択）
  // -------------------------------------------------------------
  if (viewState === 'lobby') {
    return (
      <div className="space-y-6 max-w-5xl mx-auto animate-fadeIn">
        {/* Header Banner */}
        <div className="bg-gradient-to-r from-blue-950/60 via-slate-900 to-indigo-950/50 border border-blue-500/20 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative z-10">
            <div className="space-y-1.5">
              <div className="inline-flex items-center space-x-2 px-3 py-1 bg-blue-500/10 border border-blue-500/30 rounded-full text-cyan-400 text-xs font-semibold">
                <Radio className="w-3.5 h-3.5 animate-pulse text-cyan-400" />
                <span>AI Language Exchange（音声通話 ＆ チャット）</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                AI 英会話 ＆ チャットパートナー
              </h2>
              <p className="text-xs sm:text-sm text-slate-300 max-w-xl">
                通話でもチャットでも、話した内容・好み・約束は<strong>パートナーの記憶として完全に共有・保存</strong>されます。
                日本語で質問しても親身に教えてくれます。
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(true)}
                className="flex items-center space-x-1.5 px-4 py-2.5 bg-cyan-600 hover:bg-cyan-500 active:scale-95 text-white rounded-xl text-xs sm:text-sm font-bold shadow-lg shadow-cyan-600/30 transition-all"
              >
                <Plus className="w-4 h-4" />
                <span>新しい相手を作る</span>
              </button>
            </div>
          </div>
        </div>

        {/* Free Talk Quick Start Banner */}
        <div className="bg-slate-900/80 border border-slate-800 hover:border-slate-700 rounded-2xl p-5 shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-all">
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-2xl shadow-lg shadow-blue-500/20">
              🎙️
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                フリー英会話（設定なしで即スタート）
              </h3>
              <p className="text-xs text-slate-400">
                キャラクター設定なしで、日常雑談や英語の質問を気軽にしたい時に。
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => handleStartCall(null)}
              className="flex-1 sm:flex-none flex items-center justify-center space-x-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs sm:text-sm font-bold shadow-lg shadow-emerald-600/30 transition-all"
            >
              <Phone className="w-4 h-4" />
              <span>通話を開始</span>
            </button>
            <button
              type="button"
              onClick={() => handleStartChat(null)}
              className="flex-1 sm:flex-none flex items-center justify-center space-x-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs sm:text-sm font-bold shadow-lg shadow-blue-600/30 transition-all"
            >
              <MessageSquare className="w-4 h-4" />
              <span>チャットを開始</span>
            </button>
          </div>
        </div>

        {/* Persona Cards Grid */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-300 flex items-center gap-2">
              <Smile className="w-4 h-4 text-cyan-400" />
              マイ・パートナー一覧（記憶保持）
            </h3>
            <button
              type="button"
              onClick={onResetPersonas}
              className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
            >
              プリセットに戻す
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {personas.map((persona) => {
              const memory = persona.memory || { likes: [], dislikes: [], recentTopics: [], userNotes: [] };
              const recentTopic = memory.recentTopics?.[0];

              return (
                <div
                  key={persona.id}
                  className="bg-slate-900/90 border border-slate-800 hover:border-cyan-500/40 rounded-2xl p-5 shadow-xl transition-all duration-200 flex flex-col justify-between space-y-4 group relative"
                >
                  {/* Card Header */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="w-12 h-12 rounded-2xl bg-slate-850 border border-slate-750 flex items-center justify-center text-2xl shadow-inner group-hover:scale-105 transition-transform">
                        {persona.avatarEmoji}
                      </div>
                      <div>
                        <h4 className="text-base font-bold text-white flex items-center gap-1.5">
                          {persona.name}
                          <span className="text-xs font-normal text-slate-400">({persona.age})</span>
                        </h4>
                        <p className="text-xs text-cyan-400 flex items-center gap-1 font-medium">
                          <Globe className="w-3 h-3" />
                          {persona.nationality} • {persona.occupation}
                        </p>
                      </div>
                    </div>

                    {!persona.isPreset && (
                      <button
                        type="button"
                        onClick={() => onDeletePersona(persona.id)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-all"
                        title="削除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Personality & Interests */}
                  <div className="space-y-2">
                    <p className="text-xs text-slate-300 leading-relaxed line-clamp-2">
                      💡 {persona.personality}
                    </p>

                    <div className="flex flex-wrap gap-1">
                      {persona.interests.slice(0, 3).map((item, idx) => (
                        <span
                          key={idx}
                          className="text-[10px] px-2 py-0.5 bg-slate-950 text-slate-400 rounded-md border border-slate-800"
                        >
                          #{item}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Shared Memory Snapshot */}
                  <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-2.5 text-[11px] space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-semibold">
                      <span>🧠 パートナーの記憶</span>
                      <span>会話: {persona.totalConversations || 0}回</span>
                    </div>

                    {recentTopic ? (
                      <p className="text-slate-300 line-clamp-1">
                        💬 <strong className="text-cyan-300">{recentTopic.topic}</strong>: {recentTopic.summary}
                      </p>
                    ) : (
                      <p className="text-slate-500 italic">まだ会話の記録がありません</p>
                    )}
                  </div>

                  {/* Action Buttons: 音声通話 ＆ テキストチャット */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleStartCall(persona)}
                      className="flex items-center justify-center space-x-1.5 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 transition-all"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      <span>通話する</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleStartChat(persona)}
                      className="flex items-center justify-center space-x-1.5 py-2.5 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-600/20 transition-all"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>チャット</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Custom Persona Modal */}
        {isCreateModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 max-w-lg w-full space-y-5 shadow-2xl">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-cyan-400" />
                  AI パートナーを自由作成
                </h3>
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="p-1 text-slate-400 hover:text-white rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-slate-300 font-medium">
                  どんなパートナーと話したいですか？（日本語で自由に入力）
                </label>
                <textarea
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="例: ロンドン在住のカフェ店員で、映画やインディーロックが好きな20代の女性。少し皮肉屋だけど親しみやすい性格。"
                  rows={4}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-cyan-500 resize-none placeholder:text-slate-600"
                />
              </div>

              <div className="flex items-center justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  disabled={!customPrompt.trim() || isCreatingPersona}
                  onClick={handleCreateCustomPersona}
                  className="flex items-center space-x-2 px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-xl text-xs sm:text-sm font-bold shadow-lg shadow-cyan-600/30 transition-all"
                >
                  {isCreatingPersona ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>AIが設定を生成中...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>パートナーを生成</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------
  // VIEW: テキストチャット画面（共通記憶保持）
  // -------------------------------------------------------------
  if (viewState === 'chat') {
    const persona = activePersona;
    const memory = persona?.memory;

    return (
      <div className="max-w-4xl mx-auto space-y-4 animate-fadeIn flex flex-col h-[calc(100vh-140px)] min-h-[500px]">
        {/* Chat Top Bar */}
        <div className="bg-slate-900/95 border border-slate-800 rounded-2xl p-4 shadow-xl flex items-center justify-between flex-shrink-0">
          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={handleEndSession}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors border border-slate-800"
              title="ロビーへ戻る"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>

            <div className="w-10 h-10 rounded-2xl bg-slate-850 border border-slate-750 flex items-center justify-center text-xl shadow-inner">
              {persona?.avatarEmoji || '🎙️'}
            </div>

            <div>
              <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-1.5">
                {persona?.name || 'フリー英会話'}
                {persona && (
                  <span className="text-xs font-normal text-slate-400">
                    ({persona.nationality} • {persona.occupation})
                  </span>
                )}
              </h3>
              <div className="flex items-center gap-2 text-[11px] text-cyan-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>チャット対話中 ({formatDuration(callDuration)})</span>
                {memory?.likes && memory.likes.length > 0 && (
                  <span className="hidden sm:inline text-slate-400">
                    • 好き: {memory.likes.slice(0, 2).join(', ')}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* 音声通話へ即時切り替えボタン */}
            <button
              type="button"
              onClick={() => handleStartCall(persona)}
              className="flex items-center space-x-1 px-3 py-2 bg-emerald-600/90 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 transition-all"
              title="音声通話に切り替え"
            >
              <Phone className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">通話に切替</span>
            </button>

            {/* 会話を終了してサマリー保存 */}
            <button
              type="button"
              onClick={handleEndSession}
              className="flex items-center space-x-1 px-3.5 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold shadow-md shadow-red-600/20 transition-all"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>終了 ＆ 記録</span>
            </button>
          </div>
        </div>

        {/* Chat Messages List Area */}
        <div className="flex-1 bg-slate-950/70 border border-slate-800/80 rounded-3xl p-4 sm:p-6 overflow-y-auto space-y-4 shadow-inner">
          {callMessages.map((msg) => {
            const isUser = msg.role === 'user';
            return (
              <div
                key={msg.id}
                className={`flex items-start gap-2.5 ${isUser ? 'justify-end' : 'justify-start'} animate-fadeIn`}
              >
                {!isUser && (
                  <div className="w-8 h-8 rounded-xl bg-slate-850 border border-slate-750 flex items-center justify-center text-sm flex-shrink-0 mt-0.5">
                    {persona?.avatarEmoji || '🤖'}
                  </div>
                )}

                <div
                  className={`max-w-[82%] sm:max-w-[70%] rounded-2xl p-3.5 text-xs sm:text-sm leading-relaxed shadow-md relative group ${
                    isUser
                      ? 'bg-blue-600 text-white rounded-tr-xs font-medium'
                      : 'bg-slate-900 border border-slate-800 text-slate-100 rounded-tl-xs'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.text}</p>

                  {/* Assistant Message Extra Action: 発音再生 & 単語登録 */}
                  {!isUser && (
                    <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                      <button
                        type="button"
                        onClick={() => {
                          setIsSpeakingMessageId(msg.id);
                          speakText(msg.text, 0.95);
                          setTimeout(() => setIsSpeakingMessageId(null), 3000);
                        }}
                        className="inline-flex items-center space-x-1 text-slate-400 hover:text-cyan-300 transition-colors"
                      >
                        <Volume2 className={`w-3.5 h-3.5 ${isSpeakingMessageId === msg.id ? 'text-cyan-400 animate-pulse' : ''}`} />
                        <span>発音を聞く</span>
                      </button>

                      <span className="text-[10px] text-slate-500">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  )}
                </div>

                {isUser && (
                  <div className="w-8 h-8 rounded-xl bg-blue-700 border border-blue-600 flex items-center justify-center text-white text-xs flex-shrink-0 mt-0.5">
                    <User className="w-4 h-4" />
                  </div>
                )}
              </div>
            );
          })}

          {isSendingChat && (
            <div className="flex items-start gap-2.5 justify-start animate-fadeIn">
              <div className="w-8 h-8 rounded-xl bg-slate-850 border border-slate-750 flex items-center justify-center text-sm flex-shrink-0">
                {persona?.avatarEmoji || '🤖'}
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-2xl rounded-tl-xs p-3.5 text-xs text-slate-400 flex items-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                <span>{persona?.name || 'AI'}が入力中...</span>
              </div>
            </div>
          )}

          <div ref={chatMessagesEndRef} />
        </div>

        {/* Chat Input Form */}
        <form
          onSubmit={handleSendChatMessage}
          className="bg-slate-900 border border-slate-800 rounded-2xl p-2.5 shadow-xl flex items-center gap-2 flex-shrink-0"
        >
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder={`${persona?.name || '相手'}に英語で話しかける（日本語で質問もOK）...`}
            disabled={isSendingChat}
            className="flex-1 bg-transparent px-3 py-2 text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none"
          />

          <button
            type="submit"
            disabled={!chatInput.trim() || isSendingChat}
            className="p-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600 text-white rounded-xl transition-all shadow-md shadow-blue-600/20 active:scale-95 flex items-center justify-center"
            title="送信"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    );
  }

  // -------------------------------------------------------------
  // VIEW: 音声通話中画面（Gemini Live WebSocket）
  // -------------------------------------------------------------
  if (viewState === 'call') {
    const persona = activePersona;

    return (
      <div className="max-w-xl mx-auto space-y-6 animate-fadeIn">
        {/* Call Container Box */}
        <div className="bg-gradient-to-b from-slate-900 via-slate-900/95 to-slate-950 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden flex flex-col items-center text-center space-y-6">
          {/* Subtle Ambient Glow */}
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none"></div>

          {/* Top Status & Controls */}
          <div className="w-full flex items-center justify-between text-xs text-slate-400">
            <div className="flex items-center space-x-2">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  connectionState === 'connected'
                    ? 'bg-emerald-400 animate-pulse'
                    : connectionState === 'connecting'
                    ? 'bg-amber-400 animate-ping'
                    : 'bg-red-400'
                }`}
              />
              <span className="font-semibold text-slate-200 uppercase tracking-wider text-[10px]">
                {connectionState === 'connected'
                  ? 'LIVE CALL'
                  : connectionState === 'connecting'
                  ? 'CONNECTING...'
                  : 'DISCONNECTED'}
              </span>
            </div>

            <div className="flex items-center space-x-2">
              <span className="font-mono text-xs px-2.5 py-0.5 bg-slate-950 rounded-full border border-slate-800 text-cyan-300">
                {formatDuration(callDuration)}
              </span>

              {/* チャットへ即時切り替えボタン */}
              <button
                type="button"
                onClick={() => {
                  if (liveSessionRef.current) liveSessionRef.current.disconnect();
                  handleStartChat(persona);
                }}
                className="p-1.5 text-slate-400 hover:text-white bg-slate-950 hover:bg-slate-800 rounded-lg border border-slate-800 transition-colors"
                title="チャットに切り替え"
              >
                <MessageSquare className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Avatar & Voice Ripple Waves */}
          <div className="relative py-2">
            {/* Pulsing Ripple circles based on volume */}
            <div
              className="absolute inset-0 rounded-full bg-cyan-500/20 blur-xl transition-all duration-100 -z-10"
              style={{
                transform: `scale(${1 + assistantVolume * 2})`,
                opacity: assistantVolume > 0.05 ? 0.8 : 0.2,
              }}
            />
            <div
              className="absolute inset-0 rounded-full bg-blue-500/20 blur-2xl transition-all duration-100 -z-10"
              style={{
                transform: `scale(${1 + userVolume * 2.5})`,
                opacity: userVolume > 0.05 ? 0.8 : 0.1,
              }}
            />

            <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-3xl bg-slate-850 border-2 border-slate-750 flex items-center justify-center text-5xl sm:text-6xl shadow-2xl relative">
              {persona?.avatarEmoji || '🎙️'}

              {/* Status mini badge */}
              <div className="absolute -bottom-2 -right-2 px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-full text-[10px] font-bold text-cyan-400 shadow-md">
                {persona?.cefrLevel || 'Live'}
              </div>
            </div>
          </div>

          {/* Persona Info */}
          <div className="space-y-1">
            <h3 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
              {persona?.name || 'フリー英会話パートナー'}
            </h3>
            <p className="text-xs text-slate-400 font-medium">
              {persona ? `${persona.nationality} • ${persona.occupation}` : '自由な雑談 ＆ 英語質問'}
            </p>
          </div>

          {/* Real-time Subtitles / Transcription Box */}
          {showSubtitles && (
            <div className="w-full bg-slate-950/80 border border-slate-800/80 rounded-2xl p-4 min-h-[90px] max-h-[140px] overflow-y-auto text-left space-y-2 text-xs leading-relaxed shadow-inner">
              {currentAssistantText ? (
                <div className="space-y-1 animate-fadeIn">
                  <span className="text-[10px] text-cyan-400 font-bold block">
                    {persona?.name || 'AI'}:
                  </span>
                  <p className="text-slate-100 font-medium">{currentAssistantText}</p>
                </div>
              ) : callMessages.length > 0 ? (
                <div className="space-y-1">
                  <span className="text-[10px] text-slate-500 font-bold block">
                    {callMessages[callMessages.length - 1].role === 'user' ? 'You' : persona?.name || 'AI'}:
                  </span>
                  <p className="text-slate-300">
                    {callMessages[callMessages.length - 1].text}
                  </p>
                </div>
              ) : (
                <p className="text-slate-500 text-center pt-5 italic">
                  マイクに向かって話しかけてください…
                </p>
              )}
            </div>
          )}

          {/* Error display */}
          {errorMessage && (
            <div className="w-full p-3 bg-red-950/80 border border-red-500/40 rounded-xl text-red-300 text-xs text-center">
              ⚠️ {errorMessage}
            </div>
          )}

          {/* Push-to-Talk Toggle Bar */}
          <div className="w-full flex items-center justify-between px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs">
            <span className="text-slate-300 font-medium">
              🎙️ じっくり考えるモード (Push-to-Talk)
            </span>
            <button
              type="button"
              onClick={handleTogglePushToTalkMode}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                isPushToTalk
                  ? 'bg-cyan-600 text-white shadow-md shadow-cyan-600/30'
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              {isPushToTalk ? 'ON（長押し時のみ発言）' : 'OFF（自動割り込み）'}
            </button>
          </div>

          {/* Push-to-Talk Button (when enabled) */}
          {isPushToTalk && (
            <div className="w-full">
              <button
                type="button"
                onMouseDown={handlePushToTalkStart}
                onMouseUp={handlePushToTalkEnd}
                onTouchStart={handlePushToTalkStart}
                onTouchEnd={handlePushToTalkEnd}
                className={`w-full py-4 rounded-2xl font-bold text-sm transition-all shadow-xl select-none ${
                  isPushToTalkActive
                    ? 'bg-cyan-500 text-slate-950 scale-95 ring-4 ring-cyan-400/50 shadow-cyan-500/40'
                    : 'bg-slate-850 hover:bg-slate-800 text-cyan-300 border border-cyan-500/40'
                }`}
              >
                {isPushToTalkActive ? '🗣️ 話しています（離すと送信）' : '👆 押している間だけ話す'}
              </button>
            </div>
          )}

          {/* Action Control Buttons */}
          <div className="flex items-center justify-center space-x-4 pt-2">
            {/* Mute Button */}
            <button
              type="button"
              onClick={handleToggleMute}
              className={`p-4 rounded-full border transition-all ${
                isMuted
                  ? 'bg-amber-950/80 border-amber-500/40 text-amber-400'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
              }`}
              title={isMuted ? 'ミュート解除' : 'ミュート'}
            >
              {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>

            {/* End Call Button (Big Red) */}
            <button
              type="button"
              onClick={handleEndSession}
              className="p-5 bg-red-600 hover:bg-red-500 active:scale-95 text-white rounded-full shadow-xl shadow-red-600/40 transition-all border-2 border-red-400"
              title="通話を終了してサマリーを生成"
            >
              <PhoneOff className="w-6 h-6" />
            </button>

            {/* Subtitles Toggle */}
            <button
              type="button"
              onClick={() => setShowSubtitles(!showSubtitles)}
              className={`p-4 rounded-full border transition-all ${
                showSubtitles
                  ? 'bg-cyan-950/80 border-cyan-500/40 text-cyan-400'
                  : 'bg-slate-800 border-slate-700 text-slate-400'
              }`}
              title={showSubtitles ? '字幕を非表示' : '字幕を表示'}
            >
              <Languages className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // VIEW: 通話後サマリー ＆ 抽出語彙登録画面 (音声・チャット共通)
  // -------------------------------------------------------------
  if (viewState === 'summary') {
    const session = latestSummarySession;
    const persona = activePersona;

    return (
      <div className="max-w-2xl mx-auto space-y-6 animate-fadeIn">
        {/* Summary Header */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-3xl bg-emerald-950/80 border border-emerald-500/40 flex items-center justify-center text-3xl shadow-lg shadow-emerald-950/50">
            🎉
          </div>

          <div className="space-y-1">
            <h3 className="text-xl sm:text-2xl font-bold text-white">
              {currentSessionType === 'chat' ? 'チャットセッション完了！' : '英会話通話セッション完了！'}
            </h3>
            <p className="text-xs sm:text-sm text-slate-300">
              {persona?.name || 'パートナー'} との会話内容を分析し、新しい記憶と語彙を抽出しました。
            </p>
          </div>

          {/* Loading Indicator */}
          {isAnalyzing && (
            <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 flex items-center justify-center space-x-2 text-cyan-400 text-xs">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>AIが会話のサマリーと重要語彙を抽出中...</span>
            </div>
          )}

          {/* Recap Summary Box */}
          {session?.recapSummary && (
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 text-left space-y-2 text-xs leading-relaxed">
              <span className="text-[10px] uppercase font-bold text-cyan-400 block tracking-wider">
                📝 会話の要約 (Recap)
              </span>
              <p className="text-slate-200">{session.recapSummary}</p>
            </div>
          )}

          {/* New Learned Facts Snapshot */}
          {session?.newLearnedFacts && session.newLearnedFacts.length > 0 && (
            <div className="bg-blue-950/40 border border-blue-500/30 rounded-2xl p-4 text-left space-y-2 text-xs">
              <span className="text-[10px] uppercase font-bold text-blue-400 block tracking-wider">
                🧠 パートナーについて新しく覚えたこと
              </span>
              <ul className="list-disc list-inside space-y-1 text-slate-300">
                {session.newLearnedFacts.map((fact, idx) => (
                  <li key={idx}>{fact}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Section 1: 🎴 定型句・単語のAnki登録 */}
        {session?.extractedVocabs && session.extractedVocabs.length > 0 && (
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <BookMarked className="w-4 h-4 text-cyan-400" />
                  1. 定型句・単語（Ankiで覚えるもの）
                </h4>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  会話に出てきた定型表現や単語です。Ankiの忘却曲線で自動復習されます。
                </p>
              </div>
            </div>

            <div className="space-y-2.5">
              {session.extractedVocabs.map((vocab, idx) => {
                const isSaved = savedVocabPhrases.has(vocab.phrase.trim().toLowerCase());

                return (
                  <div
                    key={idx}
                    className="p-3.5 bg-slate-950 border border-slate-800 hover:border-cyan-500/40 rounded-2xl flex items-start justify-between gap-3 transition-all"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-bold text-white">{vocab.phrase}</span>
                        <span className="text-xs font-semibold text-cyan-400">{vocab.meaning}</span>
                      </div>

                      {vocab.contextSentence && (
                        <p className="text-[11px] font-serif text-slate-300 italic">
                          "{vocab.contextSentence}"
                        </p>
                      )}

                      {vocab.nuanceNote && (
                        <p className="text-[10px] text-slate-400">💡 {vocab.nuanceNote}</p>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={isSaved}
                      onClick={() =>
                        onAddToVocab(
                          vocab.phrase,
                          vocab.meaning,
                          vocab.contextSentence,
                          vocab.nuanceNote
                        )
                      }
                      className={`flex-shrink-0 flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        isSaved
                          ? 'bg-slate-800 text-slate-500 cursor-default'
                          : 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-md shadow-cyan-600/30'
                      }`}
                    >
                      {isSaved ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Anki登録済</span>
                        </>
                      ) : (
                        <>
                          <Plus className="w-3.5 h-3.5" />
                          <span>Ankiへ登録</span>
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Section 2: 📋 発話カルテ（偽英語・組立ミスの本質分析 ＆ カルテDB保存） */}
        {detectedErrors && detectedErrors.length > 0 && (
          <div className="bg-slate-900/90 border border-amber-500/30 rounded-3xl p-6 space-y-4 shadow-xl">
            <div>
              <h4 className="text-sm font-bold text-amber-300 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                2. 発話カルテ：偽英語・構文ミスの添削 ＆ 本質分析
              </h4>
              <p className="text-[11px] text-slate-300 mt-0.5">
                カルテに記録すると、<strong>次回のストーリー生成でこの文法・語法パターンを自然に応用した文章</strong>が自動生成されます。
              </p>
            </div>

            <div className="space-y-3">
              {detectedErrors.map((errItem, idx) => {
                const isSaved = savedErrorIndices.has(idx);

                const causeLabels: Record<ErrorCauseCategory, string> = {
                  vocabulary: '単語・表現不足',
                  syntax_order: '語順・文の組立',
                  direct_translation: '日本語の直訳',
                  tense_modals: '時制・助動詞ミス',
                  preposition_colloc: '前置詞・コロケーション',
                  other: 'その他',
                };

                return (
                  <div
                    key={idx}
                    className="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-3 transition-all hover:border-amber-500/40"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="px-2 py-0.5 rounded bg-red-950/80 text-red-400 font-bold border border-red-500/30 text-[10px]">
                          あなたの発話
                        </span>
                        <span className="text-slate-300 line-through decoration-red-500/60 font-medium">
                          "{errItem.userUtterance}"
                        </span>
                      </div>

                      <div className="flex items-center gap-2 text-xs">
                        <span className="px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-400 font-bold border border-emerald-500/30 text-[10px]">
                          自然な英語
                        </span>
                        <span className="text-emerald-300 font-bold">
                          "{errItem.naturalExpression}"
                        </span>
                      </div>
                    </div>

                    <div className="bg-slate-900/90 rounded-xl p-3 text-xs space-y-1.5 border border-slate-800/80">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold text-cyan-300">
                          💡 本質パターン: {errItem.corePattern}
                        </span>
                        <span className="text-[10px] text-amber-400 bg-amber-950/50 px-2 py-0.5 rounded border border-amber-500/20">
                          {(causeLabels as any)[errItem.suggestedCause] || '構文・語順'}
                        </span>
                      </div>
                      <p className="text-slate-300 text-[11px] leading-relaxed">
                        {errItem.explanation}
                      </p>
                    </div>

                    <div className="flex items-center justify-end">
                      <button
                        type="button"
                        disabled={isSaved}
                        onClick={() => {
                          if (onSaveExpressionError) {
                            onSaveExpressionError({
                              userUtterance: errItem.userUtterance,
                              naturalExpression: errItem.naturalExpression,
                              corePattern: errItem.corePattern,
                              explanation: errItem.explanation,
                              causeCategory: errItem.suggestedCause,
                              personaName: persona?.name,
                              sourceSessionId: session?.id,
                            });
                            setSavedErrorIndices(prev => new Set(prev).add(idx));
                          }
                        }}
                        className={`flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                          isSaved
                            ? 'bg-slate-800 text-slate-500 cursor-default'
                            : 'bg-amber-600 hover:bg-amber-500 text-white shadow-md shadow-amber-600/30'
                        }`}
                      >
                        {isSaved ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>カルテに記録済</span>
                          </>
                        ) : (
                          <>
                            <Plus className="w-3.5 h-3.5" />
                            <span>カルテに記録（次回ストーリーで克服）</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Back to Lobby Button */}
        <div className="text-center pt-2">
          <button
            type="button"
            onClick={() => setViewState('lobby')}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl text-xs sm:text-sm font-bold shadow-lg shadow-blue-600/30 transition-all"
          >
            パートナー一覧へ戻る
          </button>
        </div>
      </div>
    );
  }

  return null;
};
