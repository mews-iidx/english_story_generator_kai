import { CefrLevel } from './settings';

export type QuizMode = 'en_to_ja' | 'ja_to_en';

export interface QuizQuestion {
  id: string;
  mode: QuizMode;
  promptText: string; // 英日なら英文、日英なら日本文
  constraint?: string; // 日英の場合の制約（例: "be going to を使って", "制約なし"）
  targetPhrase: string; // 出題の核となる表現・構文（例: "be going to", "look forward to"）
  targetPhraseMeaning: string;
  cefrLevel: CefrLevel;
  referenceAnswer: string;
  createdAt: string;
}

export interface QuizEvaluation {
  isCorrect: boolean;
  score: number; // 0 - 100
  feedback: string; // 優しい解説・良かった点
  modelAnswer: string; // 模範解答 / より自然なネイティブ表現
  nuanceExplanation: string; // 構文や文法の解説
  targetPhrase: string;
  targetPhraseMeaning: string;
}

export interface QuizMessage {
  id: string;
  sender: 'ai' | 'user';
  type: 'question' | 'answer' | 'evaluation' | 'system';
  content: string;
  questionData?: QuizQuestion;
  evaluationData?: QuizEvaluation;
  timestamp: string;
}