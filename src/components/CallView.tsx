import React, { useState, useEffect, useRef } from 'react';
import { Persona, CallSession, CallMessage } from '../types/persona';
import { GeminiLiveSession, CallConnectionState } from '../services/geminiLive';
import { analyzeCallSessionAndExtractMemory, generateCustomPersona } from '../services/gemini';
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  Sparkles,
  Plus,
  Trash2,
  Clock,
  CheckCircle2,
  RefreshCw,
  X,
  Languages,
  BookMarked,
  Smile,
  Globe,
  Radio,
  PauseCircle,
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
  onRecordTokenUsage?: (promptTokens: number, candidatesTokens: number) => void;
  savedVocabPhrases: Set<string>;
}

export const CallView: React.FC<CallViewProps> = ({
  apiKey,
  model = 'gemini-3.7-flash',
  personas,
  callSessions,
  onSavePersona,
  onDeletePersona,
  onResetPersonas,
  onUpdatePersonaMemory,
  onSaveCallSession,
  onAddToVocab,
  onRecordTokenUsage,
  savedVocabPhrases,
}) => {
  // 画面モード: lobby (一覧) | call (通話中) | summary (通話後サマリー)
  const [viewState, setViewState] = useState<'lobby' | 'call' | 'summary'>('lobby');
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

  // 会話トランスクリプト
  const [callMessages, setCallMessages] = useState<CallMessage[]>([]);
  const [currentAssistantText, setCurrentAssistantText] = useState('');

  // 通話後分析状態
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [latestSummarySession, setLatestSummarySession] = useState<CallSession | null>(null);

  // 新規パートナー作成モーダル
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [isCreatingPersona, setIsCreatingPersona] = useState(false);

  const liveSessionRef = useRef<GeminiLiveSession | null>(null);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  // 通話タイマー
  useEffect(() => {
    if (viewState === 'call' && connectionState === 'connected') {
      startTimeRef.current = Date.now();
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

  // 通話開始ハンドラー
  const handleStartCall = async (persona?: Persona | null) => {
    if (!apiKey) {
      alert('Gemini APIキーを設定してください（設定画面から登録可能です）');
      return;
    }

    setActivePersona(persona || null);
    setCallMessages([]);
    setCurrentAssistantText('');
    setCallDuration(0);
    setErrorMessage(null);
    setViewState('call');

    const session = new GeminiLiveSession({
      apiKey,
      persona: persona || null,
      isPushToTalk,
      callbacks: {
        onStateChange: (state, errorMsg) => {
          setConnectionState(state);
          if (errorMsg) setErrorMessage(errorMsg);
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

  // 通話終了ハンドラー
  const handleEndCall = async () => {
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

    if (finalMessages.length === 0) {
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

      // ペルソナの動的記憶を更新
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
        id: 'call_' + Date.now(),
        personaId: persona?.id,
        personaName: persona?.name || 'フリー会話',
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

      onSaveCallSession(sessionRecord);
      setLatestSummarySession(sessionRecord);
    } catch (e) {
      console.error('Failed to analyze call session:', e);
      const fallbackSession: CallSession = {
        id: 'call_' + Date.now(),
        personaId: persona?.id,
        personaName: persona?.name || 'フリー会話',
        startedAt: new Date(Date.now() - duration * 1000).toISOString(),
        endedAt: new Date().toISOString(),
        durationSeconds: duration,
        messages: finalMessages,
        extractedVocabs: [],
        recapSummary: '英会話通話が完了しました。',
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

  // ミュート切り替え
  const handleToggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    if (liveSessionRef.current) {
      liveSessionRef.current.setMuted(next);
    }
  };

  // 「💭 考え中（Umm...）」クイック合図
  const handleSendThinkingSignal = () => {
    if (liveSessionRef.current) {
      liveSessionRef.current.sendTextPrompt('Ummm, let me see... give me a second to think!');
    }
  };

  // AIペルソナ自動生成
  const handleCreateCustomPersona = async () => {
    if (!apiKey) {
      alert('Gemini APIキーを設定してください');
      return;
    }

    setIsCreatingPersona(true);
    try {
      const res = await generateCustomPersona({
        apiKey,
        userPrompt: customPrompt.trim() || undefined,
        model,
      });

      if (res.tokenUsage && onRecordTokenUsage) {
        onRecordTokenUsage(res.tokenUsage.promptTokens, res.tokenUsage.candidatesTokens);
      }

      onSavePersona(res.persona);
      setIsCreateModalOpen(false);
      setCustomPrompt('');
      alert(`✨ 新しいパートナー「${res.persona.name} (${res.persona.nationality})」を追加しました！`);
    } catch (e: any) {
      console.error('Failed to create persona:', e);
      alert(`パートナーの作成に失敗しました: ${e.message}`);
    } finally {
      setIsCreatingPersona(false);
    }
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const formatTimeAgo = (isoString?: string) => {
    if (!isoString) return 'まだ通話していません';
    const diffDays = Math.floor((Date.now() - new Date(isoString).getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return '今日通話しました';
    if (diffDays === 1) return '昨日通話しました';
    return `${diffDays}日前に通話`;
  };

  // =========================================================================
  // VIEW 1: ACTIVE CALL SCREEN
  // =========================================================================
  if (viewState === 'call') {
    const partnerName = activePersona?.name || 'CompileEng AI';
    const partnerAvatar = activePersona?.avatarEmoji || '🤖';
    const partnerSubtitle = activePersona
      ? `${activePersona.nationality} • ${activePersona.occupation}`
      : 'リアルタイム英会話コーチ';

    return (
      <div className="max-w-xl mx-auto px-4 py-4 sm:py-6 space-y-4 animate-fadeIn">
        {/* Main Phone Call Card */}
        <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl flex flex-col items-center justify-between min-h-[500px] relative overflow-hidden">
          {/* Top Status & Timer */}
          <div className="w-full flex items-center justify-between text-xs text-slate-400">
            <div className="flex items-center space-x-2">
              <span className={`w-2.5 h-2.5 rounded-full ${
                connectionState === 'connected'
                  ? 'bg-emerald-500 animate-pulse'
                  : connectionState === 'connecting'
                  ? 'bg-amber-500 animate-ping'
                  : 'bg-red-500'
              }`} />
              <span className="font-semibold text-slate-300">
                {connectionState === 'connected' ? 'LIVE 通話中' : connectionState === 'connecting' ? '接続中...' : '切断'}
              </span>
            </div>

            <div className="flex items-center space-x-1.5 font-mono text-sm font-bold text-cyan-400 bg-slate-950 px-3 py-1 rounded-full border border-slate-800">
              <Clock className="w-3.5 h-3.5" />
              <span>{formatDuration(callDuration)}</span>
            </div>
          </div>

          {/* Center: Avatar with Pulsing Audio Visualizer Ring */}
          <div className="flex flex-col items-center text-center space-y-4 my-auto py-6">
            <div className="relative">
              {/* Voice Volume Aura */}
              <div
                className="absolute inset-0 rounded-full bg-cyan-500/30 blur-xl transition-all duration-100 pointer-events-none"
                style={{
                  transform: `scale(${1 + assistantVolume * 1.5})`,
                  opacity: assistantVolume > 0.05 ? 0.8 : 0.2,
                }}
              />

              <div
                className={`w-28 h-28 sm:w-32 sm:h-32 rounded-full flex items-center justify-center text-5xl sm:text-6xl border-4 transition-all duration-150 ${
                  assistantVolume > 0.05
                    ? 'border-cyan-400 bg-cyan-950/60 shadow-lg shadow-cyan-500/30 scale-105'
                    : 'border-slate-800 bg-slate-950 shadow-inner'
                }`}
              >
                {partnerAvatar}
              </div>

              {/* Push-to-Talk speaking indicator */}
              {isPushToTalk && (
                <div className={`absolute -bottom-2 inset-x-0 mx-auto w-max px-2.5 py-0.5 rounded-full text-[10px] font-bold border transition-all ${
                  isPushToTalkActive
                    ? 'bg-emerald-600 text-white border-emerald-400 animate-pulse'
                    : 'bg-slate-950 text-slate-400 border-slate-800'
                }`}>
                  {isPushToTalkActive ? '🎙️ 音声送信中' : 'ミュート中'}
                </div>
              )}
            </div>

            <div className="space-y-1">
              <h2 className="text-2xl font-bold text-white tracking-tight">{partnerName}</h2>
              <p className="text-xs text-slate-400">{partnerSubtitle}</p>
            </div>

            {/* User Speech Waveform (When User Speaks) */}
            {userVolume > 0.02 && (
              <div className="flex items-center space-x-1 h-5 animate-fadeIn">
                <span className="text-[10px] text-emerald-400 font-bold mr-1">あなた:</span>
                {[0.4, 0.8, 1.2, 0.6, 1.0, 0.5].map((factor, i) => (
                  <span
                    key={i}
                    className="w-1 bg-emerald-400 rounded-full transition-all duration-75"
                    style={{
                      height: `${Math.min(20, Math.max(4, userVolume * 30 * factor))}px`,
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Subtitles (Realtime Stream Transcript) */}
          {showSubtitles && (
            <div className="w-full bg-slate-950/80 border border-slate-800 rounded-2xl p-3.5 text-xs text-slate-200 max-h-28 overflow-y-auto space-y-1.5 mb-4 animate-fadeIn">
              {currentAssistantText ? (
                <div className="text-cyan-300 font-medium">
                  <span className="font-bold text-cyan-400 mr-1.5">{partnerName}:</span>
                  {currentAssistantText}
                </div>
              ) : callMessages.length > 0 ? (
                <div className="text-slate-300">
                  <span className="font-bold text-slate-400 mr-1.5">
                    {callMessages[callMessages.length - 1].role === 'user' ? 'あなた:' : `${partnerName}:`}
                  </span>
                  {callMessages[callMessages.length - 1].text}
                </div>
              ) : (
                <div className="text-slate-500 italic text-center text-[11px]">
                  マイクに向かって英語または日本語で話しかけてください
                </div>
              )}
            </div>
          )}

          {/* Error Notice */}
          {errorMessage && (
            <div className="w-full bg-red-950/60 border border-red-500/40 text-red-300 p-2.5 rounded-xl text-xs text-center mb-3">
              {errorMessage}
            </div>
          )}

          {/* Bottom Action Controls */}
          <div className="w-full space-y-3">
            {/* Mode Switcher Bar */}
            <div className="flex items-center justify-between bg-slate-950/90 border border-slate-800 p-1 rounded-2xl text-xs">
              <button
                type="button"
                onClick={handleTogglePushToTalkMode}
                className={`flex-1 py-1.5 rounded-xl font-bold transition-all flex items-center justify-center gap-1.5 ${
                  !isPushToTalk
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Radio className="w-3.5 h-3.5" />
                <span>ハンズフリー (自動相槌)</span>
              </button>

              <button
                type="button"
                onClick={handleTogglePushToTalkMode}
                className={`flex-1 py-1.5 rounded-xl font-bold transition-all flex items-center justify-center gap-1.5 ${
                  isPushToTalk
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Mic className="w-3.5 h-3.5" />
                <span>プッシュ・トゥ・トーク</span>
              </button>
            </div>

            {/* Push-to-Talk Big Button (Only shown in Push-to-Talk Mode) */}
            {isPushToTalk && (
              <button
                type="button"
                onMouseDown={handlePushToTalkStart}
                onMouseUp={handlePushToTalkEnd}
                onTouchStart={handlePushToTalkStart}
                onTouchEnd={handlePushToTalkEnd}
                className={`w-full py-4 rounded-2xl font-bold text-base transition-all select-none shadow-xl flex items-center justify-center gap-2 ${
                  isPushToTalkActive
                    ? 'bg-emerald-600 text-white shadow-emerald-600/40 scale-95 border border-emerald-400'
                    : 'bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white shadow-indigo-600/30 border border-indigo-400/40'
                }`}
              >
                <Mic className="w-5 h-5" />
                <span>{isPushToTalkActive ? '🎙️ 送信中...（離すと送信完了）' : '🎙️ 押しながら話す'}</span>
              </button>
            )}

            {/* Quick Actions Row */}
            <div className="flex items-center justify-center space-x-2 sm:space-x-3 pt-1">
              {/* Thinking Button */}
              <button
                type="button"
                onClick={handleSendThinkingSignal}
                className="p-3 bg-slate-950 hover:bg-slate-800 text-amber-300 hover:text-amber-200 border border-slate-800 hover:border-amber-500/40 rounded-2xl transition-all flex items-center gap-1.5 text-xs font-semibold"
                title="AIに「ちょっと待って」と伝えます"
              >
                <PauseCircle className="w-4 h-4 text-amber-400" />
                <span>💭 考え中</span>
              </button>

              {/* Subtitles Toggle */}
              <button
                type="button"
                onClick={() => setShowSubtitles(!showSubtitles)}
                className={`p-3 rounded-2xl border transition-all text-xs font-semibold flex items-center gap-1.5 ${
                  showSubtitles
                    ? 'bg-cyan-950/60 text-cyan-300 border-cyan-500/40'
                    : 'bg-slate-950 hover:bg-slate-800 text-slate-400 border-slate-800'
                }`}
                title="字幕の表示/非表示"
              >
                <Languages className="w-4 h-4 text-cyan-400" />
                <span>{showSubtitles ? '字幕ON' : '字幕OFF'}</span>
              </button>

              {/* Mute Button */}
              <button
                type="button"
                onClick={handleToggleMute}
                className={`p-3 rounded-2xl border transition-all text-xs font-semibold flex items-center gap-1.5 ${
                  isMuted
                    ? 'bg-red-950/60 text-red-300 border-red-500/40'
                    : 'bg-slate-950 hover:bg-slate-800 text-slate-300 border-slate-800'
                }`}
              >
                {isMuted ? <MicOff className="w-4 h-4 text-red-400" /> : <Mic className="w-4 h-4 text-slate-400" />}
                <span>{isMuted ? 'ミュート' : 'マイク'}</span>
              </button>

              {/* Hang up button */}
              <button
                type="button"
                onClick={handleEndCall}
                className="px-5 py-3 bg-red-600 hover:bg-red-500 active:scale-95 text-white rounded-2xl font-bold text-xs sm:text-sm shadow-lg shadow-red-600/40 transition-all flex items-center gap-2"
              >
                <PhoneOff className="w-4 h-4" />
                <span>終了</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // VIEW 2: POST-CALL SUMMARY MODAL
  // =========================================================================
  if (viewState === 'summary') {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5 animate-fadeIn">
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-950/80 border border-emerald-500/40 flex items-center justify-center text-2xl">
                {activePersona?.avatarEmoji || '🎉'}
              </div>
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">
                  通話セッション完了！
                </h2>
                <p className="text-xs text-slate-400">
                  {latestSummarySession?.personaName || 'AI Partner'} との英会話（通話時間: {formatDuration(latestSummarySession?.durationSeconds || 0)}）
                </p>
              </div>
            </div>

            <button
              onClick={() => setViewState('lobby')}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {isAnalyzing ? (
            <div className="py-12 flex flex-col items-center justify-center space-y-3">
              <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin" />
              <p className="text-sm font-semibold text-slate-300">Geminiが会話ログを分析中...</p>
              <p className="text-xs text-slate-500">新出フレーズとペルソナの記憶を抽出しています</p>
            </div>
          ) : (
            <div className="space-y-6 animate-fadeIn">
              {/* 1. Summary Recap */}
              {latestSummarySession?.recapSummary && (
                <div className="bg-slate-950/80 border border-slate-800 p-4 rounded-2xl space-y-1.5">
                  <span className="text-[10px] uppercase font-bold text-cyan-400 tracking-wider flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5" /> 今回の会話ハイライト
                  </span>
                  <p className="text-sm text-slate-200 leading-relaxed">
                    {latestSummarySession.recapSummary}
                  </p>
                </div>
              )}

              {/* 2. Newly Learned Facts (Persona Memory Evolution) */}
              {latestSummarySession?.newLearnedFacts && latestSummarySession.newLearnedFacts.length > 0 && (
                <div className="bg-indigo-950/30 border border-indigo-500/30 p-4 rounded-2xl space-y-2">
                  <span className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                    <Smile className="w-4 h-4 text-indigo-400" />
                    <span>相手について新しく知ったこと（動的記憶に保存）:</span>
                  </span>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {latestSummarySession.newLearnedFacts.map((fact, idx) => (
                      <span key={idx} className="text-xs px-2.5 py-1 rounded-xl bg-indigo-900/40 text-indigo-200 border border-indigo-500/20 font-medium">
                        ✨ {fact}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 3. Extracted Vocabularies with One-Click Anki Add */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <BookMarked className="w-4 h-4 text-cyan-400" />
                    <span>会話に出てきた実用フレーズ（語彙帳・Ankiに保存）</span>
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {latestSummarySession?.extractedVocabs.length || 0} 件抽出
                  </span>
                </div>

                {latestSummarySession?.extractedVocabs && latestSummarySession.extractedVocabs.length > 0 ? (
                  <div className="grid grid-cols-1 gap-2.5">
                    {latestSummarySession.extractedVocabs.map((v, idx) => {
                      const isSaved = savedVocabPhrases.has(v.phrase.toLowerCase().trim());
                      return (
                        <div
                          key={idx}
                          className="bg-slate-950 border border-slate-800 p-3.5 rounded-2xl flex items-center justify-between gap-3 text-xs"
                        >
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="flex items-center space-x-2">
                              <strong className="text-sm text-white">{v.phrase}</strong>
                              <span className="text-xs font-semibold text-cyan-300">{v.meaning}</span>
                            </div>
                            {v.contextSentence && (
                              <p className="text-[11px] text-slate-400 italic truncate">
                                "{v.contextSentence}"
                              </p>
                            )}
                            {v.nuanceNote && (
                              <p className="text-[10px] text-amber-300/80">
                                💡 {v.nuanceNote}
                              </p>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => onAddToVocab(v.phrase, v.meaning, v.contextSentence, v.nuanceNote)}
                            disabled={isSaved}
                            className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1 transition-all flex-shrink-0 ${
                              isSaved
                                ? 'bg-slate-800 text-slate-400 border border-slate-700 cursor-default'
                                : 'bg-blue-600 hover:bg-blue-500 active:scale-95 text-white shadow-md shadow-blue-600/30'
                            }`}
                          >
                            {isSaved ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Plus className="w-3.5 h-3.5" />}
                            <span>{isSaved ? '登録済' : '語彙帳に追加'}</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 italic text-center py-4 bg-slate-950/40 rounded-2xl border border-slate-800/60">
                    今回の会話では新出フレーズは検出されませんでした
                  </p>
                )}
              </div>

              {/* Done button */}
              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setViewState('lobby')}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-blue-600/30 transition-all"
                >
                  パートナー一覧に戻る
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // =========================================================================
  // VIEW 3: LOBBY (PERSONAS & FREE TALK SELECTION)
  // =========================================================================
  return (
    <div className="max-w-4xl mx-auto px-4 py-4 sm:py-6 space-y-6 animate-fadeIn">
      {/* 1. Header Banner */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-7 shadow-2xl space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-11 h-11 rounded-2xl bg-cyan-600/20 border border-cyan-500/30 flex items-center justify-center">
              <Phone className="w-6 h-6 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                AI 英会話・Language Exchange 🎙️
              </h2>
              <p className="text-xs sm:text-sm text-slate-400">
                超低遅延のリアルタイム肉声英会話。日本語での質問もいつでもOK！
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="flex items-center space-x-1.5 px-3.5 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-cyan-600/20 transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>友達を作成 / 自動生成</span>
            </button>
          </div>
        </div>

        {/* Call Session Stats Tracker */}
        {callSessions.length > 0 && (
          <div className="pt-2 border-t border-slate-800/80 flex items-center space-x-4 text-xs text-slate-400">
            <span>累計通話: <strong className="text-cyan-400">{callSessions.length}</strong> 回</span>
            <span>総通話時間: <strong className="text-white">{Math.floor(callSessions.reduce((a, c) => a + (c.durationSeconds || 0), 0) / 60)}</strong> 分</span>
          </div>
        )}
      </div>

      {/* 2. Free Talk Mode Card */}
      <div
        onClick={() => handleStartCall(null)}
        className="bg-gradient-to-r from-blue-900/40 via-indigo-950/40 to-slate-900 border border-blue-500/30 hover:border-blue-400/60 rounded-3xl p-5 sm:p-6 shadow-xl cursor-pointer group transition-all duration-200"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center space-x-4 min-w-0">
            <div className="w-14 h-14 rounded-2xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-3xl group-hover:scale-105 transition-transform flex-shrink-0">
              🤖
            </div>
            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <h3 className="text-lg sm:text-xl font-bold text-white group-hover:text-cyan-300 transition-colors">
                  フリー会話モード (Free Talk)
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 text-[10px] font-bold border border-blue-500/30">
                  初心者おすすめ
                </span>
              </div>
              <p className="text-xs text-slate-300">
                ペルソナなしで気軽に雑談やスピーキング練習。わからない単語は日本語で質問できます。
              </p>
            </div>
          </div>

          <button
            type="button"
            className="px-4 py-2 bg-blue-600 group-hover:bg-blue-500 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-blue-600/30 transition-all flex items-center gap-1.5 flex-shrink-0"
          >
            <Phone className="w-4 h-4" />
            <span>通話開始</span>
          </button>
        </div>
      </div>

      {/* 3. Language Exchange Partners Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
            <Globe className="w-4 h-4 text-cyan-400" />
            <span>Language Exchange パートナー一覧 ({personas.length}人)</span>
          </h3>
          <button
            onClick={onResetPersonas}
            className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" />
            <span>初期パートナーにリセット</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {personas.map((persona) => {
            const memoryCount = (persona.memory?.likes?.length || 0) + (persona.memory?.dislikes?.length || 0);
            return (
              <div
                key={persona.id}
                className="bg-slate-900/80 border border-slate-800 hover:border-cyan-500/40 rounded-3xl p-5 shadow-xl flex flex-col justify-between space-y-4 transition-all duration-200 group"
              >
                {/* Card Header */}
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="w-12 h-12 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-center text-3xl group-hover:scale-105 transition-transform flex-shrink-0">
                        {persona.avatarEmoji}
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <h4 className="text-base font-bold text-white group-hover:text-cyan-300 transition-colors">
                            {persona.name}
                          </h4>
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                            {persona.cefrLevel || 'A2'}
                          </span>
                        </div>
                        <span className="text-xs text-slate-400 block">
                          {persona.nationality} • {persona.age}歳 ({persona.occupation})
                        </span>
                      </div>
                    </div>

                    {!persona.isPreset && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`パートナー「${persona.name}」を削除しますか？`)) {
                            onDeletePersona(persona.id);
                          }
                        }}
                        className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors"
                        title="削除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed">
                    {persona.personality}
                  </p>

                  {/* Interests & Memory Tags */}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {persona.interests?.slice(0, 3).map((item, i) => (
                      <span key={i} className="text-[10px] px-2 py-0.5 rounded-md bg-slate-950 text-slate-400 border border-slate-800">
                        #{item}
                      </span>
                    ))}
                    {memoryCount > 0 && (
                      <span className="text-[10px] px-2 py-0.5 rounded-md bg-cyan-950/60 text-cyan-300 border border-cyan-500/30 font-semibold">
                        🧠 記憶 {memoryCount}件
                      </span>
                    )}
                  </div>
                </div>

                {/* Card Footer: Call Action */}
                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                  <span className="text-[11px] text-slate-400">
                    {formatTimeAgo(persona.lastSpokenAt)}
                  </span>

                  <button
                    type="button"
                    onClick={() => handleStartCall(persona)}
                    className="px-3.5 py-1.5 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white rounded-xl font-bold shadow-md shadow-blue-600/20 transition-all flex items-center gap-1.5"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    <span>通話する</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. Create Custom Persona Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-7 max-w-lg w-full shadow-2xl space-y-5 animate-scaleUp">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-cyan-400" />
                <span>新しいパートナーを作成</span>
              </h3>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <label className="text-xs font-semibold text-slate-300 block">
                希望するパートナーの特徴・性格（自由に入力、または空欄でAIおまかせ生成）:
              </label>
              <textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="例: オーストラリア出身でサーフィンが大好きな20代、明るくてスラングも教えてくれる友達"
                rows={3}
                className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-xl p-3 text-xs sm:text-sm text-slate-100 placeholder-slate-500 outline-none resize-none"
              />
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleCreateCustomPersona}
                disabled={isCreatingPersona}
                className="px-5 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-cyan-600/30 disabled:opacity-50 transition-all flex items-center gap-1.5"
              >
                {isCreatingPersona ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-yellow-300" />}
                <span>{isCreatingPersona ? 'AIが生成中...' : 'パートナーを生成'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
