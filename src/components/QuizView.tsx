import React, { useState, useRef, useEffect } from 'react';
import { QuizMode, QuizQuestion, QuizMessage } from '../types/quiz';
import { CefrLevel } from '../types/settings';
import { VocabItem } from '../types/vocab';
import { generateQuizQuestion, evaluateQuizAnswer } from '../services/quizGemini';
import { Send, Volume2, Sparkles, RefreshCw, CheckCircle2, XCircle, Play, PlusCircle, Edit3, Bot } from 'lucide-react';
import { speakText } from '../utils/speech';
import confetti from 'canvas-confetti';
import { AnkiFlashcardView } from './AnkiFlashcardView';
import { AnkiCardEditorView } from './AnkiCardEditorView';
import { getTodayDateString } from '../utils/srs';

interface QuizViewProps {
  apiKey: string;
  model: string;
  cefrLevel: CefrLevel;
  onLevelChange?: (level: CefrLevel) => void;
  dueVocabs: string[];
  vocabs: VocabItem[];
  onAddToVocab: (phrase: string, meaning: string, sentence?: string, note?: string, level?: CefrLevel) => void;
  onUpdateVocab?: (updatedCard: VocabItem) => void;
  onDeleteVocab?: (vocabId: string) => void;
  onRecordTokenUsage?: (promptTokens: number, candidatesTokens: number) => void;
  onRateAnkiCard?: (vocabId: string, rating: 'again' | 'hard' | 'good' | 'easy') => void;
  onRevertAnkiCard?: (previousCard: VocabItem) => void;
}

export const QuizView: React.FC<QuizViewProps> = ({
  apiKey,
  model,
  cefrLevel,
  dueVocabs,
  vocabs,
  onAddToVocab,
  onUpdateVocab,
  onDeleteVocab,
  onRecordTokenUsage,
  onRateAnkiCard,
  onRevertAnkiCard,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'anki' | 'editor' | 'ai_quiz'>('anki');
  const [mode, setMode] = useState<QuizMode>('en_to_ja');
  const [isStarted, setIsStarted] = useState(false);
  const [messages, setMessages] = useState<QuizMessage[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<QuizQuestion | null>(null);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const today = getTodayDateString();
  const dueCount = React.useMemo(() => {
    return vocabs.filter(v => v.nextReviewDate <= today || v.cardState === 'learning' || v.cardState === 'relearning').length;
  }, [vocabs, today]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isStarted && activeSubTab === 'ai_quiz') {
      scrollToBottom();
    }
  }, [messages, isLoading, isStarted, activeSubTab]);

  const handleModeChange = (newMode: QuizMode) => {
    setMode(newMode);
    setIsStarted(false);
    setMessages([]);
    setCurrentQuestion(null);
  };

  const handleStartQuiz = async () => {
    if (!apiKey) {
      alert('Gemini APIキーを設定してください。');
      return;
    }
    setIsStarted(true);
    setMessages([]);
    await handleFetchNextQuestion();
  };

  const handleFetchNextQuestion = async () => {
    setIsLoading(true);
    try {
      const res = await generateQuizQuestion({
        apiKey,
        model,
        mode,
        cefrLevel,
        targetVocabs: dueVocabs,
      });

      if (res.tokenUsage && onRecordTokenUsage) {
        onRecordTokenUsage(res.tokenUsage.promptTokens, res.tokenUsage.candidatesTokens);
      }

      setCurrentQuestion(res.question);
      const questionMsg: QuizMessage = {
        id: Date.now().toString(),
        sender: 'ai',
        type: 'question',
        content: res.question.promptText,
        questionData: res.question,
        timestamp: new Date().toLocaleTimeString(),
      };
      setMessages((prev) => [...prev, questionMsg]);
    } catch (e: any) {
      console.error(e);
      alert('クイズの出題に失敗しました: ' + (e.message || String(e)));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendAnswer = async () => {
    if (!inputText.trim() || !currentQuestion || isLoading) return;
    const answerText = inputText.trim();
    setInputText('');

    const answerMsg: QuizMessage = {
      id: Date.now().toString(),
      sender: 'user',
      type: 'answer',
      content: answerText,
      timestamp: new Date().toLocaleTimeString(),
    };
    setMessages((prev) => [...prev, answerMsg]);

    setIsLoading(true);
    try {
      const res = await evaluateQuizAnswer({
        apiKey,
        model,
        question: currentQuestion,
        userAnswer: answerText,
      });

      if (res.tokenUsage && onRecordTokenUsage) {
        onRecordTokenUsage(res.tokenUsage.promptTokens, res.tokenUsage.candidatesTokens);
      }

      const evalMsg: QuizMessage = {
        id: (Date.now() + 1).toString(),
        sender: 'ai',
        type: 'evaluation',
        content: res.evaluation.feedback,
        evaluationData: res.evaluation,
        timestamp: new Date().toLocaleTimeString(),
      };
      setMessages((prev) => [...prev, evalMsg]);

      if (res.evaluation.isCorrect) {
        confetti({ particleCount: 50, spread: 60, origin: { y: 0.8 } });
      }

      if (currentQuestion.targetPhrase && !res.evaluation.isCorrect) {
        onAddToVocab(
          currentQuestion.targetPhrase,
          res.evaluation.modelAnswer,
          currentQuestion.promptText,
          'AIクイズでの復習対象'
        );
      }
    } catch (e: any) {
      console.error(e);
      alert('回答の判定に失敗しました: ' + (e.message || String(e)));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20 px-3 sm:px-4 animate-fadeIn">
      {/* 1. Sub-Tab Switcher */}
      <div className="flex items-center justify-center">
        <div className="bg-slate-900/90 border border-slate-800 p-1.5 rounded-2xl flex items-center gap-1 shadow-xl">
          <button
            type="button"
            onClick={() => setActiveSubTab('anki')}
            className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all ${
              activeSubTab === 'anki'
                ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-lg shadow-amber-500/25 scale-[1.02]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <PlusCircle className="w-4 h-4" />
            <span>🃏 Anki学習</span>
            {dueCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-extrabold bg-white text-slate-950">
                {dueCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('editor')}
            className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all ${
              activeSubTab === 'editor'
                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/25 scale-[1.02]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Edit3 className="w-4 h-4" />
            <span>📝 カードエディタ・一覧</span>
            <span className="text-[10px] opacity-70 font-mono">({vocabs.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('ai_quiz')}
            className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all ${
              activeSubTab === 'ai_quiz'
                ? 'bg-gradient-to-r from-purple-600 to-cyan-600 text-white shadow-lg shadow-purple-600/25 scale-[1.02]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Bot className="w-4 h-4" />
            <span>🤖 AIクイズ</span>
          </button>
        </div>
      </div>

      {/* 2. Sub-Tab Content */}
      {activeSubTab === 'anki' ? (
        <AnkiFlashcardView
          vocabs={vocabs}
          onRateCard={onRateAnkiCard || (() => {})}
          onRevertCard={onRevertAnkiCard}
        />
      ) : activeSubTab === 'editor' ? (
        <AnkiCardEditorView
          vocabs={vocabs}
          onUpdateCard={onUpdateVocab || (() => {})}
          onDeleteCard={onDeleteVocab || (() => {})}
          onAddCard={onAddToVocab}
        />
      ) : (
        /* AI Quiz View */
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 border border-slate-800/60 p-3 sm:p-4 rounded-2xl">
            <div className="flex items-center space-x-2">
              <button
                onClick={() => handleModeChange('en_to_ja')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  mode === 'en_to_ja'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-slate-950 text-slate-400 border border-slate-800'
                }`}
              >
                📖 英日モード（読解）
              </button>
              <button
                onClick={() => handleModeChange('ja_to_en')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  mode === 'ja_to_en'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-950 text-slate-400 border border-slate-800'
                }`}
              >
                ✍️ 日英モード（瞬間英作文）
              </button>
            </div>

            {isStarted && (
              <button
                onClick={() => handleFetchNextQuestion()}
                disabled={isLoading}
                className="flex items-center space-x-1 px-3 py-1.5 bg-slate-950 hover:bg-slate-800 text-blue-400 border border-blue-500/30 rounded-xl text-xs font-semibold"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                <span>次の問題</span>
              </button>
            )}
          </div>

          {!isStarted ? (
            <div className="py-16 text-center space-y-5 bg-slate-900/40 border border-slate-800/60 rounded-3xl p-8">
              <div className="w-16 h-16 mx-auto rounded-3xl bg-blue-950/60 border border-blue-500/30 flex items-center justify-center">
                <Sparkles className="w-8 h-8 text-blue-400" />
              </div>

              <div className="space-y-1.5">
                <h3 className="text-xl font-bold text-white">
                  {mode === 'en_to_ja' ? '英日読解クイズ' : '瞬間英作文（日英）トレーニング'}
                </h3>
                <p className="text-xs sm:text-sm text-slate-400 max-w-md mx-auto">
                  あなたの弱点語彙や重要構文に基づいたオリジナル問題をAIが1問ずつ出題します。
                </p>
              </div>

              <button
                onClick={handleStartQuiz}
                disabled={isLoading}
                className="inline-flex items-center space-x-2 px-8 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-2xl text-sm font-bold shadow-xl shadow-blue-600/30 transition-all"
              >
                {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
                <span>{isLoading ? '準備中...' : 'クイズを開始する'}</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Messages stream */}
              <div className="bg-slate-900/40 border border-slate-800/60 rounded-3xl p-4 sm:p-5 min-h-[350px] max-h-[550px] overflow-y-auto space-y-4">
                {messages.map((msg) => (
                  <div key={msg.id} className="space-y-2">
                    {msg.type === 'question' && msg.questionData && (
                      <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl space-y-2">
                        <div className="flex items-center justify-between text-xs text-blue-400 font-bold">
                          <span>出題 ({mode === 'en_to_ja' ? '英日読解' : '瞬間英作文'}):</span>
                          {mode === 'en_to_ja' && (
                            <button
                              type="button"
                              onClick={() => speakText(msg.questionData!.promptText)}
                              className="p-1 text-slate-400 hover:text-blue-300"
                            >
                              <Volume2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                        <p className="text-base sm:text-lg font-bold text-white">
                          {msg.questionData.promptText}
                        </p>
                        {msg.questionData.constraint && (
                          <p className="text-xs text-amber-300 bg-amber-950/40 border border-amber-500/20 p-2 rounded-xl">
                            ⚠️ {msg.questionData.constraint}
                          </p>
                        )}
                      </div>
                    )}

                    {msg.type === 'answer' && (
                      <div className="flex justify-end">
                        <div className="bg-blue-600 text-white px-4 py-2.5 rounded-2xl rounded-tr-none text-sm max-w-[85%]">
                          {msg.content}
                        </div>
                      </div>
                    )}

                    {msg.type === 'evaluation' && msg.evaluationData && (
                      <div className={`p-4 rounded-2xl border space-y-2.5 ${
                        msg.evaluationData.isCorrect
                          ? 'bg-emerald-950/40 border-emerald-500/40'
                          : 'bg-amber-950/40 border-amber-500/40'
                      }`}>
                        <div className="flex items-center space-x-2 font-bold text-sm">
                          {msg.evaluationData.isCorrect ? (
                            <>
                              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                              <span className="text-emerald-300">正解！Nice work! 🎉</span>
                            </>
                          ) : (
                            <>
                              <XCircle className="w-5 h-5 text-amber-400" />
                              <span className="text-amber-300">惜しい！要チェック 👀</span>
                            </>
                          )}
                        </div>

                        <div className="text-xs space-y-1 text-slate-200">
                          <div>
                            <span className="font-bold text-slate-400">模範解答: </span>
                            <span className="font-bold text-white">{msg.evaluationData.modelAnswer}</span>
                          </div>
                          <p className="text-slate-300 leading-relaxed pt-1">
                            {msg.evaluationData.feedback}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {isLoading && (
                  <div className="flex items-center space-x-2 text-xs text-slate-400 p-2">
                    <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
                    <span>AIが判定 / 出題中...</span>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input bar */}
              <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 p-2 rounded-2xl">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !isLoading) handleSendAnswer();
                  }}
                  placeholder={mode === 'en_to_ja' ? '日本語の訳を入力...' : '英文を入力（瞬間英作文）...'}
                  className="flex-1 bg-transparent px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 outline-none"
                />

                <button
                  onClick={handleSendAnswer}
                  disabled={!inputText.trim() || isLoading}
                  className="p-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl disabled:opacity-40 transition-all"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
