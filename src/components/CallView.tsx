import { MarkdownRenderer } from './MarkdownRenderer';
import React, { useState, useEffect, useRef } from 'react';
import {
  Persona,
  CallSession,
  CallMessage,
  ExtractedCallVocab,
  DetectedCallError,
} from '../types/persona';
import { GeminiLiveSession, CallConnectionState } from '../services/geminiLive';
import {
  analyzeCallSessionAndExtractMemory,
  generateCustomPersona,
  chatWithPersona,
  chatWithRallyPartner,
  RallyPartnerFeedback,
  RallySuggestionChip,
  askCallReviewQuestion,
} from '../services/gemini';
import { ErrorCauseCategory } from '../types/expressionError';
import { speakText } from '../utils/speech';
import {
  loadRallyTopics,
  addCustomRallyTopic,
  deleteRallyTopic,
  DEFAULT_RALLY_TOPICS,
  SaveSentenceCardParams,
  updateCallSession,
  deleteCallSession,
} from '../services/storage';
import { playCorrectSound } from '../utils/audio';
import { enqueueMasteryScanTask } from '../services/cefrScanner';
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
  MessageSquare,
  Send,
  Volume2,
  ArrowLeft,
  Zap,
  Swords,
  Check,
  Flame,
  Bookmark,
  ShieldCheck,
  HelpCircle,
  ChevronRight,
  RotateCcw,
} from 'lucide-react';

interface CallViewProps {
  apiKey: string;
  model?: string;
  personas: Persona[];
  callSessions: CallSession[];
  onSavePersona: (persona: Persona) => void;
  onDeletePersona: (personaId: string) => void;
  onResetPersonas?: () => void;
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
  onUpdateCallSession?: (sessionId: string, updater: (s: CallSession) => CallSession) => CallSession | null;
  onDeleteCallSession?: (sessionId: string) => void;
  onAddToVocab: (phrase: string, meaning: string, sentence?: string, note?: string) => void;
  onSaveSentenceCard?: (params: SaveSentenceCardParams) => void;
  onSaveExpressionError?: (item: any) => any;
  onRecordTokenUsage?: (promptTokens: number, candidatesTokens: number) => void;
  savedVocabPhrases: Set<string>;
  onCallStateChange?: (isActive: boolean) => void;
}

interface RallyChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  reaction?: string;
  nextQuestion?: string;
  nextQuestionJa?: string;
  feedback?: RallyPartnerFeedback;
  suggestionChips?: RallySuggestionChip[];
}

export const CallView: React.FC<CallViewProps> = ({
  apiKey,
  model = 'gemini-2.0-flash',
  personas,
  callSessions,
  onSavePersona,
  onDeletePersona,
  onResetPersonas,
  onUpdatePersonaMemory,
  onSaveCallSession,
  onUpdateCallSession,
  onDeleteCallSession,
  onAddToVocab,
  onSaveExpressionError,
  onRecordTokenUsage,
  savedVocabPhrases,
  onCallStateChange,
}) => {
  // 画面モード: lobby (一覧) | call (音声通話中) | chat (テキストチャット中) | rally_chat (ラリー特訓中) | review (振り返り・Q&Aスタジオ)
  const [viewState, setViewState] = useState<'lobby' | 'call' | 'chat' | 'rally_chat' | 'review'>('lobby');
  const [activeTab, setActiveTab] = useState<'rally' | 'friend'>('rally');

  // 瞬間ラリー特訓 State
  const [rallyTopics, setRallyTopics] = useState<string[]>(DEFAULT_RALLY_TOPICS);
  const [selectedRallyTopic, setSelectedRallyTopic] = useState<string>(DEFAULT_RALLY_TOPICS[0]);
  const [isCustomTopicModalOpen, setIsCustomTopicModalOpen] = useState(false);
  const [customTopicInput, setCustomTopicInput] = useState('');
  const [rallyMessages, setRallyMessages] = useState<RallyChatMessage[]>([]);
  const [_currentSuggestionChips, setCurrentSuggestionChips] = useState<RallySuggestionChip[]>([]);
  const [isRallyLoading, setIsRallyLoading] = useState(false);
  const [equippedFeedbackIds, setEquippedFeedbackIds] = useState<Set<string>>(new Set());
  const [activePersona, setActivePersona] = useState<Persona | null>(null);

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
  const reviewQaEndRef = useRef<HTMLDivElement | null>(null);

  // 新規パートナー作成モーダル
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [isCreatingPersona, setIsCreatingPersona] = useState(false);

  // ===================== 振り返り・武器化キュー State =====================
  const [selectedReviewSessionId, setSelectedReviewSessionId] = useState<string | null>(null);
  const [reviewTab, setReviewTab] = useState<'arsenal' | 'qa' | 'transcript'>('arsenal');
  const [reviewQueueFilter, setReviewQueueFilter] = useState<'pending' | 'all'>('pending');
  const [reviewQaInput, setReviewQaInput] = useState('');
  const [isAskingReviewQa, setIsAskingReviewQa] = useState(false);
  const [savedErrorKeys, setSavedErrorKeys] = useState<Set<string>>(new Set());
  const [toastMessage, setToastMessage] = useState<{ text: string; type?: 'info' | 'success' } | null>(null);

  // カスタム単語追加フォーム (振り返り画面内)
  const [isAddingCustomVocab, setIsAddingCustomVocab] = useState(false);
  const [customVocabForm, setCustomVocabForm] = useState({ phrase: '', meaning: '', context: '', note: '' });

  const [currentSessionType, setCurrentSessionType] = useState<'voice' | 'chat'>('voice');

  const liveSessionRef = useRef<GeminiLiveSession | null>(null);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  // 通知トースト表示ヘルパー
  const showToast = (text: string, type: 'info' | 'success' = 'info') => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage(prev => (prev?.text === text ? null : prev));
    }, 5000);
  };

  // 初回ロード: トピック一覧をlocalStorageから取得
  useEffect(() => {
    const loaded = loadRallyTopics();
    setRallyTopics(loaded);
    if (loaded.length > 0 && !loaded.includes(selectedRallyTopic)) {
      setSelectedRallyTopic(loaded[0]);
    }
  }, []);

  // 通話中ステート通知（ナビゲーションロック用）
  useEffect(() => {
    const isActive = viewState === 'call' || viewState === 'chat' || viewState === 'rally_chat';
    onCallStateChange?.(isActive);
  }, [viewState, onCallStateChange]);

  // 通話タイマー
  useEffect(() => {
    if ((viewState === 'call' && connectionState === 'connected') || viewState === 'chat' || viewState === 'rally_chat') {
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

  // 振り返りQ&Aスクロール
  useEffect(() => {
    if (viewState === 'review' && reviewTab === 'qa') {
      reviewQaEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [viewState, reviewTab, isAskingReviewQa]);

  // 現在選択されている振り返りセッション
  const activeReviewSession = callSessions.find(s => s.id === selectedReviewSessionId) || null;

  // ===================== 音声通話・チャット開始 =====================

  const handleStartCall = async (persona?: Persona | null, isRallyMode: boolean = false, customRallyTopic?: string) => {
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
      isRallyMode,
      customTopic: customRallyTopic || (isRallyMode ? selectedRallyTopic : undefined),
      callbacks: {
        onStateChange: (state, errorMsg) => {
          setConnectionState(state);
          if (errorMsg) setErrorMessage(errorMsg);
        },
        onUserTranscript: (text) => {
          const trimmed = text.trim();
          if (!trimmed || trimmed.startsWith('[') || trimmed.includes('Call connected')) {
            return;
          }
          setCallMessages((prev) => [
            ...prev,
            {
              id: 'user_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5),
              role: 'user',
              text: trimmed,
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
        onVolumeChange: (userVol: number, asstVol: number) => {
          setUserVolume(userVol);
          setAssistantVolume(asstVol);
        },
        onInterrupted: () => {
          setCurrentAssistantText('');
        },
      },
    });

    liveSessionRef.current = session;
    await session.start();
  };

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

      setCallMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      console.error('Chat error:', err);
      setCallMessages((prev) => [
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

  // ===================== セッション終了 ＆ バックグラウンド振り返りキューイング =====================

  const handleEndSession = () => {
    if (liveSessionRef.current) {
      liveSessionRef.current.disconnect();
      liveSessionRef.current = null;
    }

    setConnectionState('disconnected');

    let finalMessages = callMessages.filter(
      (m) => !m.text.trim().startsWith('[') && !m.text.includes('Call connected')
    );
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

    // 会話セッションのログをスキャンキューへ投入 (理解＆組立同期)
    try {
      const allText = finalMessages.map((m) => m.text).join(' ');
      const userUtterances = finalMessages.filter((m) => m.role === 'user').map((m) => m.text);

      enqueueMasteryScanTask({
        sourceType: 'call',
        title: `英会話: ${persona?.name || 'フリー会話'}`,
        text: allText,
        userUtterances,
      });
    } catch (e) {
      console.error('Failed to enqueue call session scan task', e);
    }

    const sessionId = 'session_' + Date.now();
    const sessionTitle = persona ? `👫 ${persona.name} との英会話` : '🎙️ フリー英会話セッション';

    // 初期セッションレコードを即時保存 (ステータス: analyzing)
    const initialSession: CallSession = {
      id: sessionId,
      personaId: persona?.id,
      personaName: persona?.name || 'フリー会話',
      personaEmoji: persona?.avatarEmoji || '🎙️',
      sessionType,
      title: sessionTitle,
      startedAt: new Date(Date.now() - duration * 1000).toISOString(),
      endedAt: new Date().toISOString(),
      durationSeconds: duration,
      messages: finalMessages,
      extractedVocabs: [],
      recapSummary: 'AIがバックグラウンドで会話を分析中です...',
      isReviewed: false,
      reviewAnalysis: {
        status: 'analyzing',
        qaMessages: [],
      },
    };

    onSaveCallSession(initialSession);

    // ノンブロッキング: 即座にロビーへ戻り、ナビゲーションを解放
    setViewState('lobby');
    showToast(`📝 『${sessionTitle}』を振り返りキューに追加しました（バックグラウンド分析中）`, 'info');

    // バックグラウンドでAI分析を実行
    (async () => {
      try {
        const analysis = await analyzeCallSessionAndExtractMemory({
          messages: finalMessages,
          personaName: persona?.name || 'AI Partner',
          persona: persona || undefined,
          apiKey,
          model,
        });

        if (analysis.tokenUsage && onRecordTokenUsage) {
          onRecordTokenUsage(analysis.tokenUsage.promptTokens, analysis.tokenUsage.candidatesTokens);
        }

        // ペルソナの動的記憶を更新
        if (persona) {
          onUpdatePersonaMemory(
            persona.id,
            {
              newLikes: analysis.newLikes,
              newDislikes: analysis.newDislikes,
              newTopic: analysis.newTopic
                ? { topic: analysis.newTopic, summary: analysis.recapSummary || analysis.newTopic }
                : undefined,
              newUserNotes: analysis.newUserNotes,
              newPromises: analysis.newPromises,
            },
            new Date().toISOString()
          );
        }

        const updater = (s: CallSession): CallSession => ({
          ...s,
          extractedVocabs: analysis.extractedVocabs || [],
          recapSummary: analysis.recapSummary,
          newLearnedFacts: [
            ...(analysis.newLikes || []).map((l) => `好きなもの: ${l}`),
            ...(analysis.newDislikes || []).map((d) => `苦手なもの: ${d}`),
            ...(analysis.newPromises || []),
          ],
          reviewAnalysis: {
            status: 'ready',
            recapSummary: analysis.recapSummary,
            extractedVocabs: analysis.extractedVocabs || [],
            detectedErrors: (analysis.detectedErrors as any) || [],
            newLikes: analysis.newLikes,
            newDislikes: analysis.newDislikes,
            newTopic: analysis.newTopic,
            newUserNotes: analysis.newUserNotes,
            newPromises: analysis.newPromises,
            analyzedAt: new Date().toISOString(),
            qaMessages: s.reviewAnalysis?.qaMessages || [],
          },
        });

        if (onUpdateCallSession) {
          onUpdateCallSession(sessionId, updater);
        } else {
          updateCallSession(sessionId, updater);
        }

        showToast(`🎉 『${sessionTitle}』の振り返り・武器化準備が完了しました！いつでも呼び出せます。`, 'success');
      } catch (err: any) {
        console.error('Background session analysis error:', err);
        const failUpdater = (s: CallSession): CallSession => ({
          ...s,
          reviewAnalysis: {
            status: 'failed',
            errorMessage: err.message || '分析に失敗しました',
            qaMessages: s.reviewAnalysis?.qaMessages || [],
          },
        });
        if (onUpdateCallSession) {
          onUpdateCallSession(sessionId, failUpdater);
        } else {
          updateCallSession(sessionId, failUpdater);
        }
      }
    })();
  };

  // ===================== 瞬間ラリー特訓 ハンドラー =====================

  const handleAddCustomTopic = () => {
    const trimmed = customTopicInput.trim();
    if (!trimmed) return;
    const updated = addCustomRallyTopic(trimmed);
    setRallyTopics(updated);
    setSelectedRallyTopic(trimmed);
    setCustomTopicInput('');
    setIsCustomTopicModalOpen(false);
  };

  const handleDeleteTopic = (e: React.MouseEvent, topic: string) => {
    e.stopPropagation();
    const updated = deleteRallyTopic(topic);
    setRallyTopics(updated);
    if (selectedRallyTopic === topic) {
      setSelectedRallyTopic(updated[0] || '日常英会話');
    }
  };

  const handleStartRally = async (targetTopic?: string) => {
    const topic = targetTopic || selectedRallyTopic;
    setViewState('rally_chat');
    setRallyMessages([]);
    setCurrentSuggestionChips([]);
    setChatInput('');
    setCallDuration(0);
    startTimeRef.current = Date.now();
    setIsRallyLoading(true);

    try {
      const result = await chatWithRallyPartner({
        userText: `Hello! I'm ready for our sparring session on: ${topic}`,
        topicPrompt: topic,
        history: [],
        apiKey,
        model,
      });

      if (result.tokenUsage && onRecordTokenUsage) {
        onRecordTokenUsage(result.tokenUsage.promptTokens, result.tokenUsage.candidatesTokens);
      }

      const initialAssistantMsg: RallyChatMessage = {
        id: 'rally_asst_' + Date.now(),
        role: 'assistant',
        text: `${result.reaction} ${result.nextQuestion}`,
        reaction: result.reaction,
        nextQuestion: result.nextQuestion,
        nextQuestionJa: result.nextQuestionJa,
        suggestionChips: result.suggestionChips,
        timestamp: new Date().toISOString(),
      };

      setRallyMessages([initialAssistantMsg]);
      setCurrentSuggestionChips(result.suggestionChips || []);
    } catch (err) {
      console.error('Failed to start rally:', err);
      setRallyMessages([
        {
          id: 'rally_err_' + Date.now(),
          role: 'assistant',
          text: "Let's begin! What would you like to share about this topic today?",
          reaction: "Let's begin!",
          nextQuestion: 'What would you like to share about this topic today?',
          nextQuestionJa: '今日のこのトピックについて、何を話したいですか？',
          suggestionChips: [
            { text: "I'd like to start with...", labelJa: '〜から始めたい' },
            { text: 'Actually, I have a quick question about...', labelJa: '〜について質問がある' },
            { text: "Let's dive right into it!", labelJa: '早速始めよう！' },
          ],
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsRallyLoading(false);
    }
  };

  const handleSendRallyMessage = async (overrideText?: string) => {
    const text = (overrideText || chatInput).trim();
    if (!text || isRallyLoading) return;

    const userMsg: RallyChatMessage = {
      id: 'rally_usr_' + Date.now(),
      role: 'user',
      text,
      timestamp: new Date().toISOString(),
    };

    const newHistory = [...rallyMessages, userMsg];
    setRallyMessages(newHistory);
    setChatInput('');
    setCurrentSuggestionChips([]);
    setIsRallyLoading(true);

    try {
      const historyForApi = newHistory.map((m) => ({
        role: m.role,
        text: m.text,
      }));

      const result = await chatWithRallyPartner({
        userText: text,
        topicPrompt: selectedRallyTopic,
        history: historyForApi,
        apiKey,
        model,
      });

      if (result.tokenUsage && onRecordTokenUsage) {
        onRecordTokenUsage(result.tokenUsage.promptTokens, result.tokenUsage.candidatesTokens);
      }

      const assistantMsg: RallyChatMessage = {
        id: 'rally_asst_' + Date.now(),
        role: 'assistant',
        text: `${result.reaction} ${result.nextQuestion}`,
        reaction: result.reaction,
        nextQuestion: result.nextQuestion,
        nextQuestionJa: result.nextQuestionJa,
        feedback: result.feedback,
        suggestionChips: result.suggestionChips,
        timestamp: new Date().toISOString(),
      };

      setRallyMessages((prev) => [...prev, assistantMsg]);
      setCurrentSuggestionChips(result.suggestionChips || []);
    } catch (err) {
      console.error('Failed to reply rally:', err);
    } finally {
      setIsRallyLoading(false);
    }
  };

  const handleEndRally = () => {
    const duration = callDuration;
    const topic = selectedRallyTopic;

    // 瞬間ラリーのメッセージを標準CallMessageに変換（システム制御プロンプト等は除外）
    const convertedMessages: CallMessage[] = rallyMessages
      .filter((m) => !m.text.trim().startsWith('[') && !m.text.includes('Call connected'))
      .map((m) => ({
        id: m.id,
        role: m.role,
        text: m.text,
        timestamp: m.timestamp,
      }));

    // 即座に得られているフィードバックから語彙とエラーを抽出
    const rallyExtractedVocabs: ExtractedCallVocab[] = [];
    const rallyDetectedErrors: DetectedCallError[] = [];

    rallyMessages.forEach((m) => {
      if (m.feedback && m.feedback.hasCorrection) {
        if (m.feedback.naturalExpression) {
          rallyExtractedVocabs.push({
            phrase: m.feedback.naturalExpression,
            meaning: m.feedback.explanation || '洗練された表現',
            contextSentence: m.text,
            nuanceNote: '瞬間ラリー特訓で習得した洗練表現',
          });
        }
        rallyDetectedErrors.push({
          userUtterance: m.text,
          naturalExpression: m.feedback.naturalExpression || m.feedback.grammarFix || '',
          corePattern: '瞬間英作文・即答スパーリング',
          explanation: m.feedback.explanation || '',
          suggestedCause: 'syntax_order',
        });
      }
    });

    const userTurns = rallyMessages.filter((m) => m.role === 'user').length;
    const sessionId = 'session_' + Date.now();
    const sessionTitle = `⚡ 瞬間ラリー: ${topic}`;

    // スキャンタスク投入
    try {
      const allText = rallyMessages.map((m) => m.text).join(' ');
      const userUtterances = rallyMessages.filter((m) => m.role === 'user').map((m) => m.text);

      enqueueMasteryScanTask({
        sourceType: 'call',
        title: sessionTitle,
        text: allText,
        userUtterances,
      });
    } catch (e) {
      console.error('Failed to enqueue rally scan task', e);
    }

    // 初期セッションレコード保存 (即座にready)
    const initialSession: CallSession = {
      id: sessionId,
      sessionType: 'rally',
      topic,
      title: sessionTitle,
      startedAt: new Date(Date.now() - duration * 1000).toISOString(),
      endedAt: new Date().toISOString(),
      durationSeconds: duration,
      messages: convertedMessages,
      extractedVocabs: rallyExtractedVocabs,
      recapSummary: `トピック「${topic}」での瞬間ラリー特訓（${userTurns}往復）`,
      isReviewed: false,
      reviewAnalysis: {
        status: 'ready',
        recapSummary: `トピック「${topic}」での瞬間ラリー特訓（${userTurns}往復・添削${rallyDetectedErrors.length}件）`,
        extractedVocabs: rallyExtractedVocabs,
        detectedErrors: rallyDetectedErrors,
        analyzedAt: new Date().toISOString(),
        qaMessages: [],
      },
    };

    onSaveCallSession(initialSession);

    // ノンブロッキング: ロビーへ戻る
    setViewState('lobby');
    showToast(`📝 『${sessionTitle}』を振り返りキューに追加しました（準備完了）`, 'success');

    // バックグラウンドでさらに深い分析・要約を実行してアップデート
    (async () => {
      try {
        const enriched = await analyzeCallSessionAndExtractMemory({
          messages: convertedMessages,
          personaName: 'Rally Partner',
          extractedVocabs: rallyExtractedVocabs,
          apiKey,
          model,
        });

        const updater = (s: CallSession): CallSession => ({
          ...s,
          extractedVocabs: enriched.extractedVocabs || s.extractedVocabs,
          recapSummary: enriched.recapSummary || s.recapSummary,
          reviewAnalysis: {
            status: 'ready',
            recapSummary: enriched.recapSummary || s.recapSummary,
            extractedVocabs: enriched.extractedVocabs || s.extractedVocabs,
            detectedErrors: [
              ...rallyDetectedErrors,
              ...((enriched.detectedErrors as any) || []).filter(
                (ne: any) => !rallyDetectedErrors.some((oe) => oe.userUtterance === ne.userUtterance)
              ),
            ],
            analyzedAt: new Date().toISOString(),
            qaMessages: s.reviewAnalysis?.qaMessages || [],
          },
        });

        if (onUpdateCallSession) {
          onUpdateCallSession(sessionId, updater);
        } else {
          updateCallSession(sessionId, updater);
        }
      } catch (e) {
        console.warn('Background rally enrichment skipped:', e);
      }
    })();
  };

  // ===================== 振り返り・武器化スタジオ ハンドラー =====================

  const handleOpenReview = (session: CallSession) => {
    setSelectedReviewSessionId(session.id);
    setReviewTab('arsenal');
    setViewState('review');
    setSavedErrorKeys(new Set());
  };

  const handleToggleReviewed = (sessionId: string) => {
    const updater = (s: CallSession): CallSession => ({
      ...s,
      isReviewed: !s.isReviewed,
    });
    if (onUpdateCallSession) {
      onUpdateCallSession(sessionId, updater);
    } else {
      updateCallSession(sessionId, updater);
    }
    showToast('振り返り状態を更新しました', 'info');
  };

  const handleDeleteSession = (sessionId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (window.confirm('この会話セッションを削除してもよろしいですか？')) {
      if (onDeleteCallSession) {
        onDeleteCallSession(sessionId);
      } else {
        deleteCallSession(sessionId);
      }
      if (selectedReviewSessionId === sessionId) {
        setSelectedReviewSessionId(null);
        setViewState('lobby');
      }
      showToast('セッションを削除しました', 'info');
    }
  };

  // ⚡ すべて一括武器化
  const handleBatchEquipAll = (session: CallSession) => {
    const vocabs = session.reviewAnalysis?.extractedVocabs || session.extractedVocabs || [];
    let count = 0;
    vocabs.forEach((v) => {
      if (v.phrase && !savedVocabPhrases.has(v.phrase.trim().toLowerCase())) {
        onAddToVocab(v.phrase, v.meaning, v.contextSentence, v.nuanceNote);
        count++;
      }
    });
    playCorrectSound();
    showToast(`⚡ ${count} 件のフレーズをすべてAnkiに一括武器化しました！`, 'success');
  };

  // 🛡️ すべてカルテに記録
  const handleBatchSaveErrors = (session: CallSession) => {
    const errors = session.reviewAnalysis?.detectedErrors || [];
    if (!onSaveExpressionError || errors.length === 0) return;

    let count = 0;
    errors.forEach((errItem, idx) => {
      const key = `${errItem.userUtterance}_${errItem.naturalExpression}_${idx}`;
      if (!savedErrorKeys.has(key)) {
        onSaveExpressionError({
          userUtterance: errItem.userUtterance,
          naturalExpression: errItem.naturalExpression,
          corePattern: errItem.corePattern,
          explanation: errItem.explanation,
          causeCategory: errItem.suggestedCause || 'syntax_order',
          personaName: session.personaName,
          sourceSessionId: session.id,
        });
        setSavedErrorKeys((prev) => new Set(prev).add(key));
        count++;
      }
    });

    playCorrectSound();
    showToast(`🛡️ ${count} 件の発話カルテをすべて記録しました！（次回ストーリーに応用出題されます）`, 'success');
  };

  // 💬 振り返り AI質問・深掘りチャット送信
  const handleSendReviewQa = async (questionOverride?: string) => {
    const questionText = (questionOverride || reviewQaInput).trim();
    if (!questionText || isAskingReviewQa || !activeReviewSession || !apiKey) return;

    setReviewQaInput('');
    setIsAskingReviewQa(true);

    const userMsg: CallMessage = {
      id: 'qa_user_' + Date.now(),
      role: 'user',
      text: questionText,
      timestamp: new Date().toISOString(),
    };

    const currentQaMessages = activeReviewSession.reviewAnalysis?.qaMessages || [];
    const nextQaHistory = [...currentQaMessages, userMsg];

    // 即時UI反映
    const optimisticUpdater = (s: CallSession): CallSession => ({
      ...s,
      reviewAnalysis: {
        ...(s.reviewAnalysis || { status: 'ready' }),
        qaMessages: nextQaHistory,
      },
    });
    if (onUpdateCallSession) {
      onUpdateCallSession(activeReviewSession.id, optimisticUpdater);
    } else {
      updateCallSession(activeReviewSession.id, optimisticUpdater);
    }

    try {
      const result = await askCallReviewQuestion({
        apiKey,
        model,
        sessionTitle: activeReviewSession.title,
        personaName: activeReviewSession.personaName,
        messages: activeReviewSession.messages,
        recapSummary: activeReviewSession.reviewAnalysis?.recapSummary || activeReviewSession.recapSummary,
        detectedErrors: (activeReviewSession.reviewAnalysis?.detectedErrors as any) || [],
        userQuestion: questionText,
        history: currentQaMessages,
      });

      if (result.tokenUsage && onRecordTokenUsage) {
        onRecordTokenUsage(result.tokenUsage.promptTokens, result.tokenUsage.candidatesTokens);
      }

      const asstMsg: CallMessage = {
        id: 'qa_asst_' + Date.now(),
        role: 'assistant',
        text: result.replyText,
        timestamp: new Date().toISOString(),
      };

      const finalQaMessages = [...nextQaHistory, asstMsg];

      // 推奨語彙があればセッション抽出語彙にも追加
      let updatedVocabs = activeReviewSession.reviewAnalysis?.extractedVocabs || activeReviewSession.extractedVocabs || [];
      if (result.suggestedVocab && result.suggestedVocab.length > 0) {
        const existingKeys = new Set(updatedVocabs.map((v) => v.phrase.trim().toLowerCase()));
        for (const sv of result.suggestedVocab) {
          if (!existingKeys.has(sv.phrase.trim().toLowerCase())) {
            updatedVocabs = [...updatedVocabs, sv];
            existingKeys.add(sv.phrase.trim().toLowerCase());
          }
        }
      }

      const completeUpdater = (s: CallSession): CallSession => ({
        ...s,
        extractedVocabs: updatedVocabs,
        reviewAnalysis: {
          ...(s.reviewAnalysis || { status: 'ready' }),
          extractedVocabs: updatedVocabs,
          qaMessages: finalQaMessages,
        },
      });

      if (onUpdateCallSession) {
        onUpdateCallSession(activeReviewSession.id, completeUpdater);
      } else {
        updateCallSession(activeReviewSession.id, completeUpdater);
      }
    } catch (err: any) {
      console.error('Review Q&A error:', err);
    } finally {
      setIsAskingReviewQa(false);
    }
  };

  // 手動で語彙を追加
  const handleAddCustomVocabToSession = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customVocabForm.phrase.trim() || !activeReviewSession) return;

    const newVocab: ExtractedCallVocab = {
      phrase: customVocabForm.phrase.trim(),
      meaning: customVocabForm.meaning.trim() || 'カスタム登録語彙',
      contextSentence: customVocabForm.context.trim() || undefined,
      nuanceNote: customVocabForm.note.trim() || undefined,
    };

    const currentVocabs = activeReviewSession.reviewAnalysis?.extractedVocabs || activeReviewSession.extractedVocabs || [];
    const nextVocabs = [...currentVocabs, newVocab];

    const updater = (s: CallSession): CallSession => ({
      ...s,
      extractedVocabs: nextVocabs,
      reviewAnalysis: {
        ...(s.reviewAnalysis || { status: 'ready' }),
        extractedVocabs: nextVocabs,
      },
    });

    if (onUpdateCallSession) {
      onUpdateCallSession(activeReviewSession.id, updater);
    } else {
      updateCallSession(activeReviewSession.id, updater);
    }

    // すぐにAnkiへ登録
    onAddToVocab(newVocab.phrase, newVocab.meaning, newVocab.contextSentence, newVocab.nuanceNote);
    playCorrectSound();
    showToast(`⚔️ 『${newVocab.phrase}』を武器化（Anki登録）しました！`, 'success');

    setCustomVocabForm({ phrase: '', meaning: '', context: '', note: '' });
    setIsAddingCustomVocab(false);
  };

  const handleToggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    if (liveSessionRef.current) {
      liveSessionRef.current.setMuted(next);
    }
  };

  const handleTogglePushToTalk = () => {
    const next = !isPushToTalk;
    setIsPushToTalk(next);
    if (liveSessionRef.current) {
      liveSessionRef.current.setPushToTalkMode(next);
    }
  };

  const handlePttDown = () => {
    setIsPushToTalkActive(true);
    if (liveSessionRef.current) {
      liveSessionRef.current.setPushToTalkActive(true);
    }
  };

  const handlePttUp = () => {
    setIsPushToTalkActive(false);
    if (liveSessionRef.current) {
      liveSessionRef.current.setPushToTalkActive(false);
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
      showToast(`🎉 新しいパートナー『${persona.name}』を作成しました！`, 'success');
    } catch (err: any) {
      alert('パートナーの生成に失敗しました: ' + (err.message || 'エラーが発生しました'));
    } finally {
      setIsCreatingPersona(false);
    }
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const formatRelativeTime = (isoString?: string) => {
    if (!isoString) return '';
    try {
      const diffMs = Date.now() - new Date(isoString).getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'たった今';
      if (diffMins < 60) return `${diffMins}分前`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}時間前`;
      const diffDays = Math.floor(diffHours / 24);
      return `${diffDays}日前`;
    } catch (e) {
      return '';
    }
  };

  // 振り返りキュー一覧のフィルタリング
  const pendingSessions = callSessions.filter((s) => !s.isReviewed);
  const displayedSessions = reviewQueueFilter === 'pending' ? pendingSessions : callSessions;

  // -------------------------------------------------------------
  // VIEW: ロビー（パートナー一覧 ＆ 瞬間ラリー ＆ 振り返りキュー）
  // -------------------------------------------------------------
  if (viewState === 'lobby') {
    return (
      <div className="space-y-6 max-w-5xl mx-auto animate-fadeIn pb-12">
        {/* Global Toast Notification */}
        {toastMessage && (
          <div
            className={`p-3.5 rounded-2xl border flex items-center justify-between gap-3 shadow-xl animate-fadeIn ${
              toastMessage.type === 'success'
                ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200'
                : 'bg-blue-950/90 border-blue-500/50 text-blue-200'
            }`}
          >
            <div className="flex items-center gap-2.5 text-xs sm:text-sm font-semibold">
              <Sparkles className="w-4 h-4 text-emerald-400 animate-pulse flex-shrink-0" />
              <span>{toastMessage.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setToastMessage(null)}
              className="p-1 hover:bg-slate-800/60 rounded-lg text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Mode Switcher Tabs */}
        <div className="flex items-center justify-center pt-2">
          <div className="bg-slate-900/90 border border-slate-800 p-1.5 rounded-2xl flex items-center gap-1 shadow-xl">
            <button
              type="button"
              onClick={() => setActiveTab('rally')}
              className={`flex items-center space-x-2 px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all ${
                activeTab === 'rally'
                  ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-lg shadow-amber-500/25 scale-[1.02]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Zap className="w-4 h-4 text-yellow-300 animate-bounce" />
              <span>⚡ 瞬間ラリー特訓（即答＆武器化）</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('friend')}
              className={`flex items-center space-x-2 px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all ${
                activeTab === 'friend'
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/25 scale-[1.02]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Smile className="w-4 h-4 text-cyan-300" />
              <span>👫 友達フリートーク（記憶＆雑談）</span>
            </button>
          </div>
        </div>

        {/* ==================== TAB 1: 瞬間ラリー特訓 ==================== */}
        {activeTab === 'rally' && (
          <div className="space-y-6 animate-fadeIn">
            {/* Rally Header Banner */}
            <div className="bg-gradient-to-r from-amber-950/60 via-slate-900 to-orange-950/50 border border-amber-500/30 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-80 h-80 bg-amber-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>

              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative z-10">
                <div className="space-y-1.5">
                  <div className="inline-flex items-center space-x-2 px-3 py-1 bg-amber-500/15 border border-amber-500/40 rounded-full text-amber-300 text-xs font-semibold">
                    <Flame className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                    <span>即答スパーリング ＆ 2段階添削武器化</span>
                  </div>
                  <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                    ⚡ 瞬間ラリー特訓（Rally & Arsenal）
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-300 max-w-2xl leading-relaxed">
                    AIがテンポよく質問を投げかけるので、あなたは<strong>「即答するだけ」</strong>に集中！
                    言えなかった表現や文法ミスは瞬時に<strong>【🔧文法修正 ＆ ✨洗練表現】</strong>で2段階添削され、ワンタップでAnkiに装備できます。
                  </p>
                </div>
              </div>
            </div>

            {/* Topic & Scenario Customization Bar */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 space-y-4 shadow-xl">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                    <Bookmark className="w-4 h-4 text-amber-400" />
                    🎯 特訓トピック・シチュエーションを選択
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    練習したい場面や語彙プロンプトを選んでください。いつでも新しく追加・保存できます。
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setIsCustomTopicModalOpen(true)}
                  className="inline-flex items-center space-x-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>カスタムトピックを追加</span>
                </button>
              </div>

              {/* Topic Chips Grid */}
              <div className="flex flex-wrap gap-2.5 pt-1">
                {rallyTopics.map((topic) => {
                  const isSelected = selectedRallyTopic === topic;
                  const isDefault = DEFAULT_RALLY_TOPICS.includes(topic);

                  return (
                    <div
                      key={topic}
                      onClick={() => setSelectedRallyTopic(topic)}
                      className={`group cursor-pointer inline-flex items-center space-x-2 px-3.5 py-2 rounded-2xl border text-xs sm:text-sm font-semibold transition-all duration-200 select-none ${
                        isSelected
                          ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-md shadow-amber-500/30 font-bold scale-[1.03]'
                          : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-amber-500/50 hover:bg-slate-900'
                      }`}
                    >
                      <span>{topic}</span>
                      {!isDefault && (
                        <button
                          type="button"
                          onClick={(e) => handleDeleteTopic(e, topic)}
                          className={`p-0.5 rounded hover:bg-black/20 ${isSelected ? 'text-slate-900' : 'text-slate-500 hover:text-red-400'}`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Launch Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Option 1: Fast Text Chat Rally */}
              <div className="bg-slate-900/90 border border-slate-800 hover:border-amber-500/40 rounded-3xl p-6 flex flex-col justify-between space-y-4 shadow-xl group transition-all">
                <div className="space-y-2">
                  <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 group-hover:scale-110 transition-transform">
                    <MessageSquare className="w-6 h-6" />
                  </div>
                  <h4 className="text-base font-bold text-white">高速テキスト・チャットラリー</h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    スマホやキーボードで高速タイピング。AIが即座に2段階添削と次の質問を返します。
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleStartRally()}
                  className="w-full py-3.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 rounded-2xl text-xs sm:text-sm font-extrabold shadow-lg shadow-amber-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  <Zap className="w-4 h-4" />
                  <span>「{selectedRallyTopic}」で特訓開始</span>
                </button>
              </div>

              {/* Option 2: Live Voice Sparring */}
              <div className="bg-slate-900/90 border border-slate-800 hover:border-emerald-500/40 rounded-3xl p-6 flex flex-col justify-between space-y-4 shadow-xl group transition-all">
                <div className="space-y-2">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 group-hover:scale-110 transition-transform">
                    <Phone className="w-6 h-6" />
                  </div>
                  <h4 className="text-base font-bold text-white">リアルタイム音声ラリー通話</h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Gemini Liveの超低遅延音声でネイティブと口頭即答スパーリング。耳と口を限界まで鍛えます。
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleStartCall(null, true, selectedRallyTopic)}
                  className="w-full py-3.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-2xl text-xs sm:text-sm font-extrabold shadow-lg shadow-emerald-600/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  <Phone className="w-4 h-4" />
                  <span>音声通話でスパーリング開始</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB 2: 友達フリートーク ==================== */}
        {activeTab === 'friend' && (
          <div className="space-y-6 animate-fadeIn">
            <div className="bg-gradient-to-r from-blue-950/60 via-slate-900 to-indigo-950/50 border border-blue-500/30 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative z-10">
                <div className="space-y-1.5">
                  <div className="inline-flex items-center space-x-2 px-3 py-1 bg-blue-500/15 border border-blue-500/40 rounded-full text-blue-300 text-xs font-semibold">
                    <Smile className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                    <span>長期記憶 ＆ ペルソナ英会話</span>
                  </div>
                  <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                    👫 友達フリートーク（Persona Talk）
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-300 max-w-2xl leading-relaxed">
                    世界各地のネイティブ友達と、好きな趣味や日々の出来事を自由にフリートーク。
                    会話するほど相手があなたを覚え、前回の続きから自然に話しかけてくれます。
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {onResetPersonas && (
                    <button
                      type="button"
                      onClick={onResetPersonas}
                      className="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-750 text-slate-300 border border-slate-700 rounded-2xl text-xs font-bold transition-all flex items-center gap-1.5"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>初期化</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setIsCreateModalOpen(true)}
                    className="inline-flex items-center space-x-2 px-4 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-2xl text-xs sm:text-sm font-bold shadow-lg shadow-cyan-600/30 transition-all"
                  >
                    <Plus className="w-4 h-4" />
                    <span>AIパートナーを作成</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Persona Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {personas.map((persona) => {
                const mem = persona.memory;
                const lastSpoken = formatRelativeTime(persona.lastSpokenAt);

                return (
                  <div
                    key={persona.id}
                    className="bg-slate-900/90 border border-slate-800 hover:border-cyan-500/40 rounded-3xl p-6 flex flex-col justify-between space-y-4 shadow-xl transition-all relative group"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center space-x-3">
                          <div className="w-14 h-14 rounded-2xl bg-slate-850 border border-slate-750 flex items-center justify-center text-3xl shadow-inner group-hover:scale-105 transition-transform">
                            {persona.avatarEmoji}
                          </div>
                          <div>
                            <div className="flex items-center space-x-2">
                              <h4 className="text-base font-bold text-white">{persona.name}</h4>
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800 font-semibold">
                                {persona.cefrLevel}
                              </span>
                            </div>
                            <p className="text-xs text-slate-400">
                              {persona.nationality} • {persona.occupation} ({persona.age}歳)
                            </p>
                          </div>
                        </div>

                        {!persona.isPreset && (
                          <button
                            type="button"
                            onClick={() => onDeletePersona(persona.id)}
                            className="text-slate-500 hover:text-red-400 p-1 rounded-lg"
                            title="削除"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed">
                        {persona.personality}
                      </p>

                      {/* Memory Snapshot */}
                      {mem && (mem.likes.length > 0 || mem.userNotes.length > 0) && (
                        <div className="bg-slate-950/70 rounded-2xl p-3 border border-slate-800/80 text-[11px] space-y-1.5">
                          <span className="text-[10px] uppercase font-bold text-cyan-400 block tracking-wider">
                            🧠 覚えている記憶
                          </span>
                          {mem.likes.length > 0 && (
                            <p className="text-slate-300">
                              ❤️ 好きなもの: <span className="text-slate-400">{mem.likes.slice(0, 3).join(', ')}</span>
                            </p>
                          )}
                          {mem.userNotes.length > 0 && (
                            <p className="text-slate-300">
                              📝 あなたについて: <span className="text-slate-400">{mem.userNotes[0]}</span>
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2 pt-2">
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>{lastSpoken ? `前回会話: ${lastSpoken}` : 'まだ会話していません'}</span>
                        <span>通話回数: {persona.totalConversations}回</span>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => handleStartChat(persona)}
                          className="py-2.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-1.5"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          <span>チャット</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleStartCall(persona)}
                          className="py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-xl text-xs font-bold shadow-md shadow-cyan-600/20 transition-all flex items-center justify-center space-x-1.5"
                        >
                          <Phone className="w-3.5 h-3.5" />
                          <span>音声通話</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ==================== 📝 振り返り・武器化キュー (Review & Arsenal Queue) ==================== */}
        <div className="bg-gradient-to-r from-slate-900/95 via-slate-900 to-indigo-950/40 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center text-cyan-300 text-lg shadow-inner">
                📝
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-extrabold text-white flex items-center gap-2">
                  <span>振り返り・武器化キュー</span>
                  {pendingSessions.length > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[11px] font-bold border border-amber-500/40 animate-pulse">
                      {pendingSessions.length} 件の振り返り待ち
                    </span>
                  )}
                </h3>
                <p className="text-[11px] text-slate-400">
                  通話やラリー終了後に自動キューイング。準備ができたらいつでも呼び出して質問・Anki登録できます。
                </p>
              </div>
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center gap-1 bg-slate-950/80 p-1 rounded-xl border border-slate-800 text-xs font-semibold self-start sm:self-auto">
              <button
                type="button"
                onClick={() => setReviewQueueFilter('pending')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  reviewQueueFilter === 'pending'
                    ? 'bg-cyan-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                未完了 ({pendingSessions.length})
              </button>
              <button
                type="button"
                onClick={() => setReviewQueueFilter('all')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  reviewQueueFilter === 'all'
                    ? 'bg-slate-800 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                すべて ({callSessions.length})
              </button>
            </div>
          </div>

          {/* Session Cards List */}
          {displayedSessions.length === 0 ? (
            <div className="p-6 text-center bg-slate-950/50 rounded-2xl border border-slate-800/80 space-y-2">
              <div className="text-2xl">☕</div>
              <p className="text-xs text-slate-400">
                {reviewQueueFilter === 'pending'
                  ? '現在、振り返り待ちのセッションはありません。'
                  : 'これまでの会話セッション履歴はありません。'}
              </p>
              <p className="text-[11px] text-slate-400">
                瞬間ラリーや友達通話を行うと、ここに自動でセッションがキューイングされます。
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-1">
              {displayedSessions.slice(0, 6).map((session) => {
                const isAnalyzingStatus = session.reviewAnalysis?.status === 'analyzing';
                const vocabCount = (session.reviewAnalysis?.extractedVocabs || session.extractedVocabs || []).length;
                const errorCount = (session.reviewAnalysis?.detectedErrors || []).length;
                const qaCount = (session.reviewAnalysis?.qaMessages || []).length;

                return (
                  <div
                    key={session.id}
                    onClick={() => handleOpenReview(session)}
                    className={`group p-4 rounded-2xl border transition-all cursor-pointer relative overflow-hidden flex flex-col justify-between space-y-3 ${
                      isAnalyzingStatus
                        ? 'bg-slate-950/80 border-amber-500/30 hover:border-amber-500/50'
                        : session.isReviewed
                        ? 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700'
                        : 'bg-slate-950/90 border-cyan-500/30 hover:border-cyan-500/60 shadow-lg shadow-cyan-950/20'
                    }`}
                  >
                    {/* Top Row: Title & Status Badge */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-base flex-shrink-0 shadow-inner">
                          {session.sessionType === 'rally' ? '⚡' : session.personaEmoji || '🎙️'}
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-xs sm:text-sm font-bold text-white truncate group-hover:text-cyan-300 transition-colors">
                            {session.title || session.topic || session.personaName || '英会話セッション'}
                          </h4>
                          <div className="flex items-center gap-2 text-[10px] text-slate-400">
                            <span>{formatRelativeTime(session.startedAt)}</span>
                            <span>•</span>
                            <span className="font-mono">{formatDuration(session.durationSeconds)}</span>
                            <span>•</span>
                            <span>{session.messages.filter((m) => m.role === 'user').length} 往復</span>
                          </div>
                        </div>
                      </div>

                      {/* Status Tag */}
                      <div className="flex-shrink-0">
                        {isAnalyzingStatus ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-950/80 border border-amber-500/40 text-amber-300 text-[10px] font-bold animate-pulse">
                            <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                            <span>AI分析中...</span>
                          </span>
                        ) : session.isReviewed ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-slate-400 text-[10px] font-medium">
                            <Check className="w-2.5 h-2.5" />
                            <span>完了</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold shadow-sm shadow-emerald-950">
                            <Sparkles className="w-2.5 h-2.5 text-emerald-400" />
                            <span>準備完了</span>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Middle Row: Content Highlights & Summary Preview */}
                    <div className="text-[11px] text-slate-300 line-clamp-2 leading-relaxed bg-slate-900/60 p-2 rounded-xl border border-slate-800/60">
                      {session.reviewAnalysis?.recapSummary || session.recapSummary || 'セッションの概要はありません。'}
                    </div>

                    {/* Bottom Row: Stats & Action CTA */}
                    <div className="flex items-center justify-between pt-1 text-[11px] border-t border-slate-800/80">
                      <div className="flex items-center gap-2 text-slate-400">
                        {vocabCount > 0 && (
                          <span className="text-cyan-300 font-semibold">⚔️ 武器 {vocabCount}件</span>
                        )}
                        {errorCount > 0 && (
                          <span className="text-amber-300 font-semibold">🛡️ カルテ {errorCount}件</span>
                        )}
                        {qaCount > 0 && (
                          <span className="text-indigo-300 font-semibold">💬 Q&A {qaCount}件</span>
                        )}
                      </div>

                      <div className="flex items-center gap-1 text-cyan-400 group-hover:text-cyan-300 font-bold text-xs">
                        <span>振り返る</span>
                        <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Custom Topic Modal */}
        {isCustomTopicModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4 animate-scaleUp">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Plus className="w-4 h-4 text-amber-400" />
                  <span>カスタムトピックの追加</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setIsCustomTopicModalOpen(false)}
                  className="text-slate-400 hover:text-white p-1 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-xs text-slate-300">
                練習したい状況・会話テーマ・使いたい語彙のシチュエーションを入力してください。
              </p>

              <div className="space-y-2">
                <input
                  type="text"
                  value={customTopicInput}
                  onChange={(e) => setCustomTopicInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddCustomTopic();
                  }}
                  placeholder="例: Techスタートアップのピッチ、病院での症状説明..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs sm:text-sm text-white focus:outline-none focus:border-amber-500"
                  autoFocus
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCustomTopicModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={handleAddCustomTopic}
                  disabled={!customTopicInput.trim()}
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 rounded-xl text-xs font-bold shadow-lg shadow-amber-500/20"
                >
                  保存して選択
                </button>
              </div>
            </div>
          </div>
        )}

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

  // =============================================================
  // VIEW: 瞬間ラリー特訓 チャット画面 (Rally Sparring Chat)
  // =============================================================
  if (viewState === 'rally_chat') {
    return (
      <div className="max-w-3xl mx-auto h-[82vh] flex flex-col space-y-3 animate-fadeIn">
        {/* Rally Header Bar */}
        <div className="bg-slate-900/90 border border-amber-500/30 rounded-3xl p-4 flex items-center justify-between shadow-xl flex-shrink-0">
          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={handleEndRally}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors border border-slate-800"
              title="ロビーへ戻る"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>

            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-xl shadow-inner">
              ⚡
            </div>

            <div>
              <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-1.5">
                <span>瞬間ラリー特訓</span>
                <span className="text-xs font-normal text-amber-300">({selectedRallyTopic})</span>
              </h3>
              <div className="flex items-center gap-2 text-[11px] text-amber-400">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                <span>特訓中 ({formatDuration(callDuration)})</span>
                <span className="text-slate-400">• 即答スパーリング</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleEndRally}
            className="flex items-center space-x-1 px-3.5 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold shadow-md shadow-red-600/20 transition-all"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>特訓終了 ＆ 振り返り</span>
          </button>
        </div>

        {/* Rally Messages Stream */}
        <div className="flex-1 bg-slate-950/80 border border-slate-800/80 rounded-3xl p-4 sm:p-6 overflow-y-auto space-y-4 shadow-inner">
          {rallyMessages.map((msg) => {
            const isUser = msg.role === 'user';
            const fb = msg.feedback;
            const isEquipped = fb && equippedFeedbackIds.has(msg.id + '_fb');

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} space-y-2 animate-fadeIn`}
              >
                {/* Message Bubble */}
                <div className="flex items-start gap-2.5 max-w-[85%] sm:max-w-[75%]">
                  {!isUser && (
                    <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-sm flex-shrink-0 mt-0.5">
                      ⚡
                    </div>
                  )}

                  <div
                    className={`rounded-2xl p-3.5 text-xs sm:text-sm leading-relaxed shadow-md ${
                      isUser
                        ? 'bg-amber-500 text-slate-950 font-bold rounded-tr-xs'
                        : 'bg-slate-900 border border-slate-800 text-slate-100 rounded-tl-xs'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.text}</p>

{/* msg.nextQuestionJa removed per user request */}
                  </div>
                </div>

                {/* 2-Stage Feedback Box */}
                {fb && fb.hasCorrection && (
                  <div className="max-w-[90%] sm:max-w-[80%] bg-gradient-to-br from-slate-900 to-slate-950 border border-amber-500/40 rounded-2xl p-3.5 space-y-2 text-xs shadow-xl animate-scaleUp">
                    <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5">
                      <span className="font-extrabold text-amber-300 flex items-center gap-1.5 text-[11px]">
                        <Flame className="w-3.5 h-3.5 text-amber-400" />
                        2段階添削 ＆ 武器化
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                        瞬間英作文・即答
                      </span>
                    </div>

                    {/* Step 1: Grammar Fix */}
                    {fb.grammarFix && (
                      <div className="space-y-0.5">
                        <span className="text-[10px] text-cyan-400 font-semibold block">🔧 文法修正:</span>
                        <p className="text-slate-200 font-mono text-[11px] bg-slate-950/60 p-1.5 rounded-lg border border-slate-800">
                          {fb.grammarFix}
                        </p>
                      </div>
                    )}

                    {/* Step 2: Native Polished Expression */}
                    {fb.naturalExpression && (
                      <div className="space-y-0.5">
                        <span className="text-[10px] text-emerald-400 font-semibold block">✨ 洗練された表現（武器）:</span>
                        <p className="text-emerald-300 font-bold text-[12px] bg-emerald-950/40 p-2 rounded-lg border border-emerald-500/30">
                          "{fb.naturalExpression}"
                        </p>
                      </div>
                    )}

                    {/* Explanation */}
                    {fb.explanation && (
                      <p className="text-[11px] text-slate-300 leading-relaxed pt-1">
                        {fb.explanation}
                      </p>
                    )}

                    {/* Weaponization CTA Button */}
                    <div className="pt-1 flex items-center justify-end">
                      <button
                        type="button"
                        disabled={isEquipped}
                        onClick={() => {
                          const phrase = fb.naturalExpression || fb.grammarFix || '';
                          onAddToVocab(
                            phrase,
                            fb.explanation || '瞬間ラリー特訓の洗練表現',
                            msg.text,
                            `トピック: ${selectedRallyTopic}`
                          );
                          setEquippedFeedbackIds((prev) => new Set(prev).add(msg.id + '_fb'));
                          playCorrectSound();
                        }}
                        className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                          isEquipped
                            ? 'bg-slate-800 text-slate-500 cursor-default'
                            : 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 shadow-md shadow-amber-500/30 active:scale-95'
                        }`}
                      >
                        {isEquipped ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span>武器化完了</span>
                          </>
                        ) : (
                          <>
                            <Swords className="w-3.5 h-3.5" />
                            <span>⚔️ この表現を武器化（Anki登録）</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {isRallyLoading && (
            <div className="flex items-center space-x-2 text-amber-400 text-xs p-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>AIパートナーが即座に返信・添削中...</span>
            </div>
          )}

          <div ref={chatMessagesEndRef} />
        </div>

        {/* Suggestion Chips (Disabled per user request for real sparring) */}
        {/*
        {_currentSuggestionChips.length > 0 && !isRallyLoading && (
          <div className="flex items-center gap-2 overflow-x-auto py-1 px-1 flex-shrink-0">
            <span className="text-[10px] text-slate-400 font-semibold flex-shrink-0 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-amber-400" />
              ヒント:
            </span>
            {_currentSuggestionChips.map((chip, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSendRallyMessage(chip.text)}
                className="flex-shrink-0 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 hover:border-amber-400 rounded-xl text-xs transition-all shadow-sm flex items-center gap-1.5"
              >
                <span>{chip.text}</span>
                {chip.labelJa && <span className="text-[10px] text-amber-300/80">({chip.labelJa})</span>}
              </button>
            ))}
          </div>
        )}
        */}

        {/* Input Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendRallyMessage();
          }}
          className="bg-slate-900 border border-slate-800 rounded-2xl p-2 flex items-center space-x-2 flex-shrink-0 shadow-lg"
        >
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="英語で即答してみよう...（Enterで送信）"
            disabled={isRallyLoading}
            className="flex-1 bg-transparent px-3 py-2 text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none"
            autoFocus
          />
          <button
            type="submit"
            disabled={!chatInput.trim() || isRallyLoading}
            className="p-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 rounded-xl transition-all shadow-md shadow-amber-500/20 flex-shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    );
  }

  // =============================================================
  // VIEW: 友達チャット画面 (Fast Text Chat)
  // =============================================================
  if (viewState === 'chat') {
    const persona = activePersona;

    return (
      <div className="max-w-3xl mx-auto h-[82vh] flex flex-col space-y-3 animate-fadeIn">
        {/* Chat Header */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 flex items-center justify-between shadow-xl flex-shrink-0">
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
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleStartCall(persona)}
              className="flex items-center space-x-1 px-3 py-2 bg-emerald-600/90 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 transition-all"
              title="音声通話に切り替え"
            >
              <Phone className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">音声通話へ</span>
            </button>

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

        {/* Chat Messages */}
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

                  {!isUser && (
                    <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                      <button
                        type="button"
                        onClick={() => {
                          setIsSpeakingMessageId(msg.id);
                          speakText(msg.text, 0.95);
                          setTimeout(() => setIsSpeakingMessageId(null), 3000);
                        }}
                        className="flex items-center space-x-1 hover:text-cyan-400 transition-colors"
                      >
                        <Volume2 className={`w-3.5 h-3.5 ${isSpeakingMessageId === msg.id ? 'text-cyan-400 animate-pulse' : ''}`} />
                        <span>音声を聞く</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {isSendingChat && (
            <div className="flex items-center space-x-2 text-cyan-400 text-xs p-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>{persona?.name || '相手'} が入力中...</span>
            </div>
          )}

          <div ref={chatMessagesEndRef} />
        </div>

        {/* Input Bar */}
        <form
          onSubmit={handleSendChatMessage}
          className="bg-slate-900 border border-slate-800 rounded-2xl p-2 flex items-center space-x-2 flex-shrink-0 shadow-lg"
        >
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="メッセージを入力...（Enterで送信）"
            disabled={isSendingChat}
            className="flex-1 bg-transparent px-3 py-2 text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none"
            autoFocus
          />
          <button
            type="submit"
            disabled={!chatInput.trim() || isSendingChat}
            className="p-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-xl transition-all shadow-md shadow-blue-600/20 flex-shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    );
  }

  // =============================================================
  // VIEW: 音声通話中画面 (Live Voice Call)
  // =============================================================
  if (viewState === 'call') {
    const persona = activePersona;

    return (
      <div className="max-w-2xl mx-auto space-y-6 animate-fadeIn pb-12">
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl flex flex-col items-center text-center space-y-6 relative overflow-hidden">
          {/* Header Info */}
          <div className="space-y-1">
            <span className="text-xs px-3 py-1 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800/60 font-semibold inline-block">
              {connectionState === 'connected'
                ? `通話中 • ${formatDuration(callDuration)}`
                : connectionState === 'connecting'
                ? '接続中...'
                : '待機中'}
            </span>
            <h3 className="text-xl sm:text-2xl font-bold text-white">
              {persona?.name || 'フリー英会話'}
            </h3>
            {persona && (
              <p className="text-xs text-slate-400">
                {persona.nationality} • {persona.occupation}
              </p>
            )}
          </div>

          {/* Error message */}
          {errorMessage && (
            <div className="p-3 bg-red-950/60 border border-red-500/40 rounded-xl text-red-300 text-xs">
              {errorMessage}
            </div>
          )}

          {/* Avatar Orb Visualizer */}
          <div className="relative flex items-center justify-center my-4">
            <div
              className="absolute w-44 h-44 rounded-full bg-cyan-500/20 blur-xl transition-transform duration-100"
              style={{ transform: `scale(${1 + assistantVolume * 2})` }}
            />
            <div
              className="absolute w-36 h-36 rounded-full bg-blue-600/30 blur-lg transition-transform duration-100"
              style={{ transform: `scale(${1 + userVolume * 2})` }}
            />
            <div className="w-28 h-28 rounded-3xl bg-slate-850 border-2 border-cyan-500/40 flex items-center justify-center text-5xl shadow-2xl relative z-10">
              {persona?.avatarEmoji || '🎙️'}
            </div>
          </div>

          {/* Real-time Subtitles */}
          {showSubtitles && (
            <div className="w-full bg-slate-950/80 rounded-2xl p-4 border border-slate-800/80 min-h-[90px] flex items-center justify-center text-xs sm:text-sm text-slate-200">
              {currentAssistantText ? (
                <p className="text-cyan-300 animate-fadeIn">{currentAssistantText}</p>
              ) : callMessages.length > 0 ? (
                <p className="text-slate-300">
                  <span className="text-slate-500 mr-2">
                    {callMessages[callMessages.length - 1].role === 'user' ? 'You:' : `${persona?.name || 'AI'}:`}
                  </span>
                  {callMessages[callMessages.length - 1].text}
                </p>
              ) : (
                <p className="text-slate-500 italic">声を発すると自動でリアルタイム認識されます...</p>
              )}
            </div>
          )}

          {/* Push to talk button if active */}
          {isPushToTalk && (
            <div className="w-full max-w-xs">
              <button
                type="button"
                onMouseDown={handlePttDown}
                onMouseUp={handlePttUp}
                onTouchStart={handlePttDown}
                onTouchEnd={handlePttUp}
                className={`w-full py-3.5 rounded-2xl font-bold text-xs sm:text-sm transition-all shadow-lg select-none ${
                  isPushToTalkActive
                    ? 'bg-amber-500 text-slate-950 scale-95 shadow-amber-500/40'
                    : 'bg-slate-800 hover:bg-slate-750 text-amber-300 border border-amber-500/30'
                }`}
              >
                {isPushToTalkActive ? '🎙️ 発話中（離すと送信）' : '押している間だけ話す (Push-to-Talk)'}
              </button>
            </div>
          )}

          {/* Controls Bar */}
          <div className="flex items-center justify-center space-x-4 pt-2">
            <button
              type="button"
              onClick={handleToggleMute}
              className={`p-4 rounded-full border transition-all ${
                isMuted ? 'bg-amber-950 border-amber-500/40 text-amber-400' : 'bg-slate-800 border-slate-700 text-white'
              }`}
              title={isMuted ? 'ミュート解除' : 'マイクミュート'}
            >
              {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>

            <button
              type="button"
              onClick={handleTogglePushToTalk}
              className={`p-4 rounded-full border transition-all ${
                isPushToTalk ? 'bg-amber-950/80 border-amber-500/40 text-amber-400' : 'bg-slate-800 border-slate-700 text-slate-400'
              }`}
              title="Push-to-talk モード切替"
            >
              <Zap className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={handleEndSession}
              className="p-5 bg-red-600 hover:bg-red-500 text-white rounded-full shadow-xl shadow-red-600/40 transition-all border-2 border-red-400"
              title="通話を終了して振り返りキューへ"
            >
              <PhoneOff className="w-6 h-6" />
            </button>

            <button
              type="button"
              onClick={() => setShowSubtitles(!showSubtitles)}
              className={`p-4 rounded-full border transition-all ${
                showSubtitles ? 'bg-cyan-950 border-cyan-500/40 text-cyan-400' : 'bg-slate-800 border-slate-700 text-slate-400'
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

  // =============================================================
  // VIEW: 振り返り・武器化 ＆ AI質問スタジオ (Interactive Review Studio)
  // =============================================================
  if (viewState === 'review' && activeReviewSession) {
    const session = activeReviewSession;
    const analysis = session.reviewAnalysis;
    const isAnalyzing = analysis?.status === 'analyzing';
    const vocabs = analysis?.extractedVocabs || session.extractedVocabs || [];
    const errors = analysis?.detectedErrors || [];
    const qaMessages = analysis?.qaMessages || [];

    const unaddedVocabCount = vocabs.filter((v) => !savedVocabPhrases.has(v.phrase.trim().toLowerCase())).length;

    return (
      <div className="max-w-4xl mx-auto space-y-6 animate-fadeIn pb-16">
        {/* Review Studio Header */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-3.5">
            <button
              type="button"
              onClick={() => setViewState('lobby')}
              className="p-2.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors border border-slate-800"
              title="ロビーへ戻る"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>

            <div className="w-12 h-12 rounded-2xl bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center text-2xl shadow-inner">
              {session.sessionType === 'rally' ? '⚡' : session.personaEmoji || '🎙️'}
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-extrabold text-white">
                  {session.title || session.personaName || '英会話セッション'}
                </h2>
                {session.isReviewed && (
                  <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-[10px] font-bold border border-slate-700">
                    ✅ 振り返り完了
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                <span>{new Date(session.startedAt).toLocaleString('ja-JP')}</span>
                <span>•</span>
                <span className="font-mono">{formatDuration(session.durationSeconds)}</span>
                <span>•</span>
                <span>{session.messages.filter((m) => m.role === 'user').length} 往復</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <button
              type="button"
              onClick={() => handleToggleReviewed(session.id)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all border flex items-center gap-1.5 ${
                session.isReviewed
                  ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-750'
                  : 'bg-emerald-600 border-emerald-500 text-white shadow-md shadow-emerald-600/30 hover:bg-emerald-500'
              }`}
            >
              <Check className="w-3.5 h-3.5" />
              <span>{session.isReviewed ? '未完了に戻す' : '振り返り完了にする'}</span>
            </button>

            <button
              type="button"
              onClick={(e) => handleDeleteSession(session.id, e)}
              className="p-2 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded-xl transition-colors"
              title="セッションを削除"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Status Alert if analyzing */}
        {isAnalyzing && (
          <div className="p-4 bg-amber-950/40 border border-amber-500/40 rounded-2xl flex items-center justify-between text-amber-300 text-xs">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
              <span>AIがバックグラウンドで会話の深層構文と重要表現を分析中です...</span>
            </div>
            <span className="text-[10px] text-amber-400/80">自動更新されます</span>
          </div>
        )}

        {/* Tab Switcher */}
        <div className="flex items-center border-b border-slate-800 gap-2 pb-1">
          <button
            type="button"
            onClick={() => setReviewTab('arsenal')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-bold transition-all ${
              reviewTab === 'arsenal'
                ? 'bg-cyan-600 text-white shadow-md shadow-cyan-600/25'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Swords className="w-4 h-4 text-cyan-300" />
            <span>⚔️ 武器化 ＆ 発話カルテ</span>
            <span className="px-1.5 py-0.2 rounded-full bg-black/20 text-[10px]">
              {vocabs.length + errors.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setReviewTab('qa')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-bold transition-all ${
              reviewTab === 'qa'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/25'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <HelpCircle className="w-4 h-4 text-indigo-300" />
            <span>💬 AI質問・深掘り相談</span>
            {qaMessages.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-black/20 text-[10px]">
                {qaMessages.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setReviewTab('transcript')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-bold transition-all ${
              reviewTab === 'transcript'
                ? 'bg-slate-800 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <MessageSquare className="w-4 h-4 text-slate-400" />
            <span>📜 全文対話ログ</span>
          </button>
        </div>

        {/* ==================== TAB 1: ⚔️ 武器化 ＆ 発話カルテ ==================== */}
        {reviewTab === 'arsenal' && (
          <div className="space-y-6 animate-fadeIn">
            {/* Batch Action Bar */}
            <div className="bg-gradient-to-r from-slate-900 to-indigo-950/50 border border-slate-800 rounded-3xl p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xl">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Flame className="w-4 h-4 text-amber-400" />
                  ワンタップ一括登録
                </h3>
                <p className="text-[11px] text-slate-400">
                  抽出された語彙・構文カルテをまとめて自分の武器庫・カルテDBに装備します。
                </p>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => handleBatchEquipAll(session)}
                  disabled={vocabs.length === 0 || unaddedVocabCount === 0}
                  className="flex-1 sm:flex-none flex items-center justify-center space-x-1.5 px-4 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold shadow-md shadow-cyan-600/30 transition-all active:scale-95"
                >
                  <Swords className="w-3.5 h-3.5" />
                  <span>⚡ すべて一括武器化 ({unaddedVocabCount})</span>
                </button>

                {errors.length > 0 && onSaveExpressionError && (
                  <button
                    type="button"
                    onClick={() => handleBatchSaveErrors(session)}
                    className="flex-1 sm:flex-none flex items-center justify-center space-x-1.5 px-4 py-2.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white rounded-xl text-xs font-bold shadow-md shadow-amber-600/30 transition-all active:scale-95"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>🛡️ すべてカルテに記録</span>
                  </button>
                )}
              </div>
            </div>

            {/* Recap Summary Box */}
            {session.recapSummary && (
              <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-5 space-y-2 text-xs shadow-lg">
                <span className="text-[10px] uppercase font-bold text-cyan-400 block tracking-wider">
                  📝 会話の要約 (Recap)
                </span>
                <p className="text-slate-200 leading-relaxed">{session.recapSummary}</p>
              </div>
            )}

            {/* Section A: 🎴 定型句・単語のAnki武器化 */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 space-y-4 shadow-xl">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                    <BookMarked className="w-4 h-4 text-cyan-400" />
                    1. 武器化フレーズ（Anki忘却曲線で自動復習）
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    会話で使われた実用的な単語・定型表現です。Ankiへ登録すると次回の復習デッキに並びます。
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setIsAddingCustomVocab(!isAddingCustomVocab)}
                  className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-semibold"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>手動追加</span>
                </button>
              </div>

              {/* Custom Add Vocab Form */}
              {isAddingCustomVocab && (
                <form
                  onSubmit={handleAddCustomVocabToSession}
                  className="p-4 bg-slate-950 border border-cyan-500/40 rounded-2xl space-y-3 animate-fadeIn"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      type="text"
                      value={customVocabForm.phrase}
                      onChange={(e) => setCustomVocabForm({ ...customVocabForm, phrase: e.target.value })}
                      placeholder="英語フレーズ（例: make ends meet）"
                      className="bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-400"
                      required
                    />
                    <input
                      type="text"
                      value={customVocabForm.meaning}
                      onChange={(e) => setCustomVocabForm({ ...customVocabForm, meaning: e.target.value })}
                      placeholder="日本語の意味（例: 生計を立てる、収支を合わせる）"
                      className="bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-400"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      type="text"
                      value={customVocabForm.context}
                      onChange={(e) => setCustomVocabForm({ ...customVocabForm, context: e.target.value })}
                      placeholder="例文（省略可）"
                      className="bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-400"
                    />
                    <input
                      type="text"
                      value={customVocabForm.note}
                      onChange={(e) => setCustomVocabForm({ ...customVocabForm, note: e.target.value })}
                      placeholder="ニュアンスメモ（省略可）"
                      className="bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-400"
                    />
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setIsAddingCustomVocab(false)}
                      className="px-3 py-1.5 bg-slate-800 text-slate-400 rounded-lg text-xs"
                    >
                      キャンセル
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-bold"
                    >
                      Ankiに武器化
                    </button>
                  </div>
                </form>
              )}

              {/* Vocabs Grid */}
              {vocabs.length === 0 ? (
                <div className="p-4 bg-slate-950/60 rounded-2xl text-center text-xs text-slate-500">
                  抽出された語彙はありません。「手動追加」から好きなフレーズを登録できます。
                </div>
              ) : (
                <div className="space-y-2.5">
                  {vocabs.map((vocab, idx) => {
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
                          onClick={() => {
                            onAddToVocab(vocab.phrase, vocab.meaning, vocab.contextSentence, vocab.nuanceNote);
                            playCorrectSound();
                            showToast(`⚔️ 『${vocab.phrase}』をAnkiに武器化しました！`, 'success');
                          }}
                          className={`flex-shrink-0 flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                            isSaved
                              ? 'bg-slate-800 text-slate-500 cursor-default'
                              : 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-md shadow-cyan-600/30 active:scale-95'
                          }`}
                        >
                          {isSaved ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>武器化済</span>
                            </>
                          ) : (
                            <>
                              <Plus className="w-3.5 h-3.5" />
                              <span>⚔️ 武器化 (Anki)</span>
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Section B: 📋 発話カルテ（偽英語・構文ミスの添削 ＆ カルテDB保存） */}
            {errors.length > 0 && (
              <div className="bg-slate-900/90 border border-amber-500/30 rounded-3xl p-6 space-y-4 shadow-xl">
                <div>
                  <h4 className="text-sm sm:text-base font-bold text-amber-300 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    2. 発話カルテ：偽英語・構文ミスの添削 ＆ 本質分析
                  </h4>
                  <p className="text-[11px] text-slate-300 mt-0.5">
                    カルテに記録すると、<strong>次回のストーリー生成でこの文法・語法パターンを自然に応用した文章</strong>が自動生成されます。
                  </p>
                </div>

                <div className="space-y-3">
                  {errors.map((errItem, idx) => {
                    const errorKey = `${errItem.userUtterance}_${errItem.naturalExpression}_${idx}`;
                    const isSaved = savedErrorKeys.has(errorKey);

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
                              {(causeLabels as any)[errItem.suggestedCause || 'syntax_order'] || '構文・語順'}
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
                                  causeCategory: errItem.suggestedCause || 'syntax_order',
                                  personaName: session.personaName,
                                  sourceSessionId: session.id,
                                });
                                setSavedErrorKeys((prev) => new Set(prev).add(errorKey));
                                playCorrectSound();
                                showToast('🛡️ カルテに記録しました！次回ストーリーに応用出題されます', 'success');
                              }
                            }}
                            className={`flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                              isSaved
                                ? 'bg-slate-800 text-slate-500 cursor-default'
                                : 'bg-amber-600 hover:bg-amber-500 text-white shadow-md shadow-amber-600/30 active:scale-95'
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
          </div>
        )}

        {/* ==================== TAB 2: 💬 AI質問・深掘り相談 ==================== */}
        {reviewTab === 'qa' && (
          <div className="space-y-4 animate-fadeIn">
            {/* Coach Banner */}
            <div className="bg-slate-900/90 border border-indigo-500/30 rounded-3xl p-5 shadow-xl flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-950 border border-indigo-500/40 flex items-center justify-center text-xl shadow-inner">
                  👨‍🏫
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white">
                    AIパーソナルコーチにセッションの疑問を質問
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    この会話ログの文脈を完璧に把握したAIコーチが、ニュアンスの差や自然な言い換えを徹底解説します。
                  </p>
                </div>
              </div>
            </div>

            {/* Quick Prompt Chips */}
            <div className="flex items-center gap-2 overflow-x-auto py-1">
              <span className="text-[10px] text-slate-400 font-semibold flex-shrink-0 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-indigo-400" />
                クイック質問:
              </span>
              {[
                '💡 もっと自然なネイティブ表現を教えて',
                '🔍 私の発言の文法ミスを詳しく解説して',
                '🎯 今回の会話で使えそうなスラング・慣用句は？',
                '💼 ビジネスで使えるフォーマルな言い換えは？',
              ].map((promptText, idx) => (
                <button
                  key={idx}
                  type="button"
                  disabled={isAskingReviewQa}
                  onClick={() => handleSendReviewQa(promptText)}
                  className="flex-shrink-0 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-indigo-300 border border-indigo-500/30 hover:border-indigo-400 rounded-xl text-xs transition-all shadow-sm"
                >
                  {promptText}
                </button>
              ))}
            </div>

            {/* Q&A Chat Area */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-3xl p-4 sm:p-6 min-h-[360px] max-h-[520px] overflow-y-auto space-y-4 shadow-inner">
              {qaMessages.length === 0 ? (
                <div className="h-48 flex flex-col items-center justify-center text-center space-y-2 text-slate-500">
                  <MessageSquare className="w-8 h-8 text-slate-600" />
                  <p className="text-xs">
                    まだ質問はありません。上のクイック質問を押すか、下の入力欄から自由に質問してください。
                  </p>
                </div>
              ) : (
                qaMessages.map((msg) => {
                  const isUser = msg.role === 'user';
                  return (
                    <div
                      key={msg.id}
                      className={`flex items-start gap-2.5 ${isUser ? 'justify-end' : 'justify-start'} animate-fadeIn`}
                    >
                      {!isUser && (
                        <div className="w-8 h-8 rounded-xl bg-indigo-950 border border-indigo-500/40 flex items-center justify-center text-sm flex-shrink-0 mt-0.5">
                          👨‍🏫
                        </div>
                      )}

                      <div
                        className={`max-w-[85%] sm:max-w-[78%] rounded-2xl p-4 text-xs sm:text-sm leading-relaxed shadow-md ${
                          isUser
                            ? 'bg-indigo-600 text-white rounded-tr-xs font-semibold'
                            : 'bg-slate-900 border border-slate-800 text-slate-100 rounded-tl-xs space-y-2'
                        }`}
                      >
                        {isUser ? (
                          <p className="whitespace-pre-wrap">{msg.text}</p>
                        ) : (
                          <MarkdownRenderer content={msg.text} />
                        )}
                      </div>
                    </div>
                  );
                })
              )}

              {isAskingReviewQa && (
                <div className="flex items-center space-x-2 text-indigo-400 text-xs p-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>AIコーチが回答を生成中...</span>
                </div>
              )}

              <div ref={reviewQaEndRef} />
            </div>

            {/* Input Bar */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendReviewQa();
              }}
              className="bg-slate-900 border border-slate-800 rounded-2xl p-2 flex items-center space-x-2 shadow-lg"
            >
              <input
                type="text"
                value={reviewQaInput}
                onChange={(e) => setReviewQaInput(e.target.value)}
                placeholder="この会話についてAIコーチに質問する...（例: なぜこの前置詞を使うの？ネイティブならどう言う？）"
                disabled={isAskingReviewQa}
                className="flex-1 bg-transparent px-3 py-2 text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!reviewQaInput.trim() || isAskingReviewQa}
                className="p-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl transition-all shadow-md shadow-indigo-600/20 flex-shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        )}

        {/* ==================== TAB 3: 📜 全文対話ログ ==================== */}
        {reviewTab === 'transcript' && (
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-6 space-y-4 shadow-xl animate-fadeIn">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-slate-400" />
                全文対話ログ ({session.messages.length} ターン)
              </h4>
            </div>

            <div className="space-y-3 max-h-[550px] overflow-y-auto p-1">
              {session.messages
                .filter((m) => !m.text.trim().startsWith('[') && !m.text.includes('Call connected'))
                .map((msg, idx) => {
                const isUser = msg.role === 'user';

                return (
                  <div
                    key={msg.id || idx}
                    className={`p-3.5 rounded-2xl border text-xs sm:text-sm leading-relaxed ${
                      isUser
                        ? 'bg-blue-950/30 border-blue-500/30 ml-8 text-slate-200'
                        : 'bg-slate-950/80 border-slate-800 mr-8 text-slate-100'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                      <span className="font-bold flex items-center gap-1">
                        {isUser ? '👤 あなた' : `🤖 ${session.personaName || 'AI Partner'}`}
                      </span>
                      {!isUser && (
                        <button
                          type="button"
                          onClick={() => speakText(msg.text, 0.95)}
                          className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300"
                        >
                          <Volume2 className="w-3 h-3" />
                          <span>音声再生</span>
                        </button>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap">{msg.text}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
};
