import React, { useState, useEffect, useRef } from 'react';
import { QuizMode, QuizQuestion, QuizMessage } from '../types/quiz';
import { CefrLevel } from '../types/settings';
import { VocabItem } from '../types/vocab';
import { generateQuizQuestion, evaluateQuizAnswer } from '../services/quizGemini';
import { Send, Volume2, Sparkles, Plus, Check, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import { speakText } from '../utils/speech';
import confetti from 'canvas-confetti';

interface QuizViewProps {
  apiKey: string;
  model: string;
  cefrLevel: CefrLevel;
  onLevelChange: (level: CefrLevel) => void;
  dueVocabs: string[];
  vocabs: VocabItem[];
  onAddToVocab: (phrase: string, meaning: string, sentence?: string, note?: string) => void;
  onRecordTokenUsage: (promptTokens: number, candidatesTokens: number) => void;
}

export const QuizView: React.FC<QuizViewProps> = ({
  apiKey,
  model,
  cefrLevel,
  onLevelChange,
  dueVocabs,
  vocabs,
  onAddToVocab,
  onRecordTokenUsage,
}) => {
  const [mode, setMode] = useState<QuizMode>('en_to_ja');
  const [messages, setMessages] = useState<QuizMessage[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<QuizQuestion | null>(null);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [savedVocabIds, setSavedVocabIds] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  useEffect(() => {
    if (messages.length === 0 && apiKey) {
      handleNextQuestion(mode);
    }
  }, [apiKey]);

  const handleModeChange = (newMode: QuizMode) => {
    if (newMode === mode) return;
    setMode(newMode);
    setMessages([]);
    setCurrentQuestion(null);
    handleNextQuestion(newMode);
  };

  const handleNextQuestion = async (selectedMode = mode) => {
    if (!apiKey) {
      alert('Gemini APIキーを設定してください。');
      return;
    }

    setIsLoading(true);
    try {
      const res = await generateQuizQuestion({
        apiKey,
        model,
        mode: selectedMode,
        cefrLevel,
        targetVocabs: dueVocabs,
      });

      if (res.tokenUsage) {
        onRecordTokenUsage(res.tokenUsage.promptTokens, res.tokenUsage.candidatesTokens);
      }

      const q = res.question;
      setCurrentQuestion(q);

      const qMessage: QuizMessage = {
        id: 'msg_' + Date.now(),
        sender: 'ai',
        type: 'question',
        content: q.promptText,
        questionData: q,
        timestamp: new Date().toISOString(),
      };

      setMessages(prev => [...prev, qMessage]);
    } catch (e: any) {
      console.error('Quiz question error', e);
      alert(`問題生成エラー: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitAnswer = async (e: React.FormEvent) => {
    e.preventDefault();
    const answer = inputText.trim();
    if (!answer || !currentQuestion || isLoading) return;

    setInputText('');

    const userMsg: QuizMessage = {
      id: 'msg_' + Date.now(),
      sender: 'user',
      type: 'answer',
      content: answer,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const res = await evaluateQuizAnswer({
        apiKey,
        model,
        question: currentQuestion,
        userAnswer: answer,
      });

      if (res.tokenUsage) {
        onRecordTokenUsage(res.tokenUsage.promptTokens, res.tokenUsage.candidatesTokens);
      }

      const evalData = res.evaluation;

      if (evalData.score >= 85) {
        confetti({
          particleCount: 60,
          spread: 60,
          origin: { y: 0.8 },
          colors: ['#3b82f6', '#60a5fa', '#38bdf8', '#fbbf24']
        });
      }

      if (!evalData.isCorrect || evalData.score < 70) {
        onAddToVocab(
          evalData.targetPhrase,
          evalData.targetPhraseMeaning,
          currentQuestion.promptText,
          evalData.nuanceExplanation
        );
        setSavedVocabIds(prev => new Set(prev).add(evalData.targetPhrase.toLowerCase()));
      }

      const aiEvalMsg: QuizMessage = {
        id: 'msg_' + (Date.now() + 1),
        sender: 'ai',
        type: 'evaluation',
        content: evalData.feedback,
        questionData: currentQuestion,
        evaluationData: evalData,
        timestamp: new Date().toISOString(),
      };

      setMessages(prev => [...prev, aiEvalMsg]);
      setCurrentQuestion(null);
    } catch (err: any) {
      console.error('Evaluation error', err);
      alert(`採点エラー: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleManualAddToVocab = (phrase: string, meaning: string, sentence?: string, note?: string) => {
    onAddToVocab(phrase, meaning, sentence, note);
    setSavedVocabIds(prev => new Set(prev).add(phrase.toLowerCase()));
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      {/* 1. Header Control Bar (Mode & Level selector) */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl space-y-3.5">
        <div className="flex items-center justify-between flex-wrap gap-2.5">
          {/* Mode Switcher */}
          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => handleModeChange('en_to_ja')}
              className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all ${
                mode === 'en_to_ja'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              英 ➔ 日 (読解・意味)
            </button>
            <button
              onClick={() => handleModeChange('ja_to_en')}
              className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all ${
                mode === 'ja_to_en'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              日 ➔ 英 (瞬間英作文)
            </button>
          </div>

          {/* Level Pills */}
          <div className="flex items-center space-x-1">
            {(['A1', 'A2', 'B1', 'B2', 'C1'] as const).map((lvl) => (
              <button
                key={lvl}
                onClick={() => onLevelChange(lvl)}
                className={`px-2 py-1 rounded-lg text-xs font-bold transition-all ${
                  cefrLevel === lvl
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/30'
                    : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                {lvl}
              </button>
            ))}
          </div>
        </div>

        <div className="text-xs text-slate-400 flex items-center justify-between border-t border-slate-800/80 pt-2.5">
          <span className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-blue-400" />
            {mode === 'en_to_ja'
              ? '英文の意味を日本語で答えてください。チャット感覚でサクサク進められます。'
              : '日本語の意味に合わせて、英語で文を作って答えてください（制約に注目！）。'}
          </span>
          {dueVocabs.length > 0 && (
            <span className="text-[11px] text-amber-400/90 font-medium">
              弱点語彙（{dueVocabs.length}件）優先出題中
            </span>
          )}
        </div>
      </div>

      {/* 2. Chat Conversation Stream */}
      <div className="space-y-4 min-h-[380px] pb-4">
        {messages.length === 0 && isLoading && (
          <div className="py-20 text-center space-y-3">
            <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto" />
            <p className="text-sm text-slate-400">クイズ問題を作成中...</p>
          </div>
        )}

        {messages.map((msg) => {
          if (msg.sender === 'user') {
            return (
              <div key={msg.id} className="flex justify-end animate-fadeIn">
                <div className="max-w-[85%] sm:max-w-[75%] bg-blue-600 text-white px-4 py-3 rounded-2xl rounded-tr-sm shadow-lg shadow-blue-600/20 text-base leading-relaxed">
                  <p>{msg.content}</p>
                </div>
              </div>
            );
          }

          if (msg.type === 'question' && msg.questionData) {
            const q = msg.questionData;
            return (
              <div key={msg.id} className="flex justify-start animate-fadeIn">
                <div className="max-w-[95%] sm:max-w-[85%] bg-slate-900/90 border border-slate-800 rounded-2xl rounded-tl-sm p-4 sm:p-5 shadow-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-blue-400 uppercase tracking-wider">
                      {q.mode === 'en_to_ja' ? 'Q. 以下の英文の意味は？' : 'Q. 以下の日本語を英語にしてください'}
                    </span>
                    {q.mode === 'en_to_ja' && (
                      <button
                        onClick={() => speakText(q.promptText)}
                        className="p-1 text-blue-400 hover:text-blue-300 hover:bg-blue-950/60 rounded-lg transition-colors"
                        title="発音を再生"
                      >
                        <Volume2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <p className="text-lg sm:text-xl font-bold text-white tracking-tight">
                    {q.promptText}
                  </p>

                  {q.constraint && (
                    <div className="inline-block bg-blue-950/60 border border-blue-500/30 text-blue-300 text-xs px-2.5 py-1 rounded-lg">
                      💡 <strong>条件:</strong> {q.constraint}
                    </div>
                  )}
                </div>
              </div>
            );
          }

          if (msg.type === 'evaluation' && msg.evaluationData) {
            const ev = msg.evaluationData;
            const isSaved = savedVocabIds.has(ev.targetPhrase.toLowerCase()) || vocabs.some(v => v.phrase.toLowerCase() === ev.targetPhrase.toLowerCase());

            return (
              <div key={msg.id} className="flex justify-start animate-fadeIn">
                <div className="max-w-[98%] sm:max-w-[90%] bg-slate-900 border border-slate-800 rounded-2xl rounded-tl-sm p-4 sm:p-5 shadow-2xl space-y-3.5">
                  {/* Evaluation Result Header */}
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div className="flex items-center space-x-2">
                      {ev.isCorrect ? (
                        <div className="flex items-center space-x-1.5 text-blue-400 font-bold text-base sm:text-lg">
                          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                          <span>正解！ (Score: {ev.score}点)</span>
                        </div>
                      ) : (
                        <div className="flex items-center space-x-1.5 text-amber-400 font-bold text-base sm:text-lg">
                          <XCircle className="w-5 h-5 text-amber-400" />
                          <span>要復習 (Score: {ev.score}点)</span>
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => handleManualAddToVocab(ev.targetPhrase, ev.targetPhraseMeaning, msg.questionData?.promptText, ev.nuanceExplanation)}
                      className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        isSaved
                          ? 'bg-blue-950/70 text-blue-300 border border-blue-500/40'
                          : 'bg-blue-600 hover:bg-blue-500 text-white shadow-sm'
                      }`}
                    >
                      {isSaved ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-blue-400" />
                          <span>弱点登録済み</span>
                        </>
                      ) : (
                        <>
                          <Plus className="w-3.5 h-3.5" />
                          <span>弱点リストに追加</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* AI Feedback */}
                  <p className="text-sm sm:text-base text-slate-200 leading-relaxed font-medium">
                    {ev.feedback}
                  </p>

                  {/* Model Answer */}
                  <div className="bg-slate-950/70 border border-slate-800 p-3 rounded-xl space-y-1">
                    <div className="flex items-center justify-between text-xs text-blue-400 font-bold">
                      <span>模範解答・より自然な表現:</span>
                      <button
                        onClick={() => speakText(ev.modelAnswer)}
                        className="p-1 text-slate-400 hover:text-blue-300 rounded"
                        title="発音を再生"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-sm font-semibold text-white">
                      {ev.modelAnswer}
                    </p>
                  </div>

                  {/* Nuance & Grammar explanation */}
                  {ev.nuanceExplanation && (
                    <div className="text-xs text-slate-300 bg-slate-950/50 p-3 rounded-xl border border-slate-800/80 space-y-1">
                      <span className="text-blue-400 font-bold">💡 ポイント構文・語彙: <strong>{ev.targetPhrase}</strong> ({ev.targetPhraseMeaning})</span>
                      <p className="leading-relaxed">{ev.nuanceExplanation}</p>
                    </div>
                  )}

                  {/* Next Question Action */}
                  <div className="pt-2 flex justify-end">
                    <button
                      onClick={() => handleNextQuestion()}
                      disabled={isLoading}
                      className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs sm:text-sm font-bold shadow-lg shadow-blue-600/20 transition-all active:scale-95"
                    >
                      <Sparkles className="w-4 h-4" />
                      <span>次の問題へ進む ➔</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          return null;
        })}

        {isLoading && currentQuestion && (
          <div className="flex justify-start animate-fadeIn">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl rounded-tl-sm p-4 text-xs text-slate-400 flex items-center space-x-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-400" />
              <span>採点中...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 3. Bottom Answer Input Bar */}
      <form
        onSubmit={handleSubmitAnswer}
        className="sticky bottom-4 z-20 bg-slate-900/95 border border-slate-800 rounded-2xl p-2 sm:p-2.5 shadow-2xl backdrop-blur-md flex items-center gap-2"
      >
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          disabled={isLoading || !currentQuestion}
          placeholder={
            !currentQuestion
              ? '「次の問題へ進む」を押してください'
              : mode === 'en_to_ja'
              ? '日本語で意味を入力（例: 私たちは明日出発する予定です）'
              : '英語で文を入力（例: We are going to leave tomorrow.）'
          }
          className="flex-1 bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition-all disabled:opacity-50"
        />

        <button
          type="submit"
          disabled={!inputText.trim() || isLoading || !currentQuestion}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center shadow-lg shadow-blue-600/30 transition-all active:scale-95 flex-shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};