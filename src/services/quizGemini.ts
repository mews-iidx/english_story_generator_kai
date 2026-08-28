import { CefrLevel } from '../types/settings';
import { QuizMode, QuizQuestion, QuizEvaluation } from '../types/quiz';

const FALLBACK_MODELS = ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];

export interface GenerateQuestionParams {
  apiKey: string;
  model?: string;
  mode: QuizMode;
  cefrLevel: CefrLevel;
  targetVocabs?: string[]; // 弱点リストにある語彙・構文
}

export async function generateQuizQuestion(params: GenerateQuestionParams): Promise<{
  question: QuizQuestion;
  tokenUsage?: { promptTokens: number; candidatesTokens: number };
}> {
  const { apiKey, model = 'gemini-3.7-flash', mode, cefrLevel, targetVocabs = [] } = params;

  if (!apiKey) {
    throw new Error('Gemini APIキーが設定されていません。');
  }

  const levelDescriptions: Record<CefrLevel, string> = {
    A1: '超初級(中学1〜2年・平易な日常短文)',
    A2: '初級(中学3年〜日常会話基礎・定番表現)',
    B1: '中級(高校英語・日常英会話)',
    B2: '中上級(自然なイディオム・句動詞)',
    C1: '上級(高度な語彙・構文)',
  };

  let prompt = `あなたは英語学習者向けの優秀なプロの英語講師です。\n`;
  prompt += `対象レベル: ${cefrLevel} (${levelDescriptions[cefrLevel] || levelDescriptions.A2})\n\n`;

  if (targetVocabs.length > 0) {
    prompt += `【ユーザーの弱点語彙・構文リスト】:\n`;
    targetVocabs.slice(0, 5).forEach((v, i) => {
      prompt += `${i + 1}. ${v}\n`;
    });
    prompt += `※可能であれば上記リストのいずれかの語彙・構文を題材にしてください（なければこのレベルの重要定番表現を選定）。\n\n`;
  } else {
    prompt += `このレベルで非常によく使われる定番の重要表現・文法構文（例: "be going to", "have to", "look forward to", "used to", "too ... to", "be able to" 等）を1つ選定してください。\n\n`;
  }

  if (mode === 'en_to_ja') {
    prompt += `【出題モード】: 英 ➔ 日 モード（英文の意味を日本語で答えてもらう問題）\n`;
    prompt += `要件:\n`;
    prompt += `1. 日常生活や会話で自然に使われる短い英文を1文作成してください。\n`;
    prompt += `2. 出題の核となる表現・単語（target_phrase）とその意味（target_phrase_meaning）を指定してください。\n`;
    prompt += `3. 模範的な自然な日本語訳（reference_answer）を作成してください。\n`;
  } else {
    prompt += `【出題モード】: 日 ➔ 英 モード（日本語から英語に英作文してもらう問題）\n`;
    prompt += `要件:\n`;
    prompt += `1. 英語に直しやすい自然な日本語の日常文（1文）を作成してください。\n`;
    prompt += `2. 制約・ヒント（constraint: 例 "be going to を使って", "too ... to を使って", "制約なし"）を指定してください。\n`;
    prompt += `3. 出題の核となる表現・単語（target_phrase）とその意味（target_phrase_meaning）を指定してください。\n`;
    prompt += `4. 模範的な自然な英語表現（reference_answer）を作成してください。\n`;
  }

  prompt += `\n必ず以下のJSONフォーマットのみを返してください。
{
  "prompt_text": "${mode === 'en_to_ja' ? '出題する英文' : '出題する日本語文'}",
  "constraint": "${mode === 'ja_to_en' ? '制約条件（例: be going to を使って）' : ''}",
  "target_phrase": "核となる単語や構文（例: be going to）",
  "target_phrase_meaning": "その表現の日本語の意味",
  "reference_answer": "模範解答"
}`;

  const candidateModels = Array.from(new Set([model, ...FALLBACK_MODELS]));
  let lastError: Error | null = null;

  for (const currentModel of candidateModels) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const msg = errData?.error?.message || `HTTP ${response.status}`;
        if (response.status === 429 || response.status === 503 || msg.includes('high demand')) {
          continue;
        }
        throw new Error(msg);
      }

      const data = await response.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) throw new Error('Geminiの応答が空でした');

      let clean = rawText.trim();
      if (clean.startsWith('```json')) clean = clean.replace(/^```json\s*/, '').replace(/```\s*$/, '');
      else if (clean.startsWith('```')) clean = clean.replace(/^```\s*/, '').replace(/```\s*$/, '');

      const parsed = JSON.parse(clean);
      const usage = data?.usageMetadata;

      return {
        question: {
          id: 'q_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
          mode,
          promptText: parsed.prompt_text,
          constraint: parsed.constraint || undefined,
          targetPhrase: parsed.target_phrase || '',
          targetPhraseMeaning: parsed.target_phrase_meaning || '',
          cefrLevel,
          referenceAnswer: parsed.reference_answer || '',
          createdAt: new Date().toISOString(),
        },
        tokenUsage: {
          promptTokens: usage?.promptTokenCount || 0,
          candidatesTokens: usage?.candidatesTokenCount || 0,
        },
      };
    } catch (e: any) {
      lastError = e;
      continue;
    }
  }

  throw lastError || new Error('クイズ問題の生成に失敗しました。');
}

export interface EvaluateAnswerParams {
  apiKey: string;
  model?: string;
  question: QuizQuestion;
  userAnswer: string;
}

export async function evaluateQuizAnswer(params: EvaluateAnswerParams): Promise<{
  evaluation: QuizEvaluation;
  tokenUsage?: { promptTokens: number; candidatesTokens: number };
}> {
  const { apiKey, model = 'gemini-3.7-flash', question, userAnswer } = params;

  if (!apiKey) {
    throw new Error('Gemini APIキーが設定されていません。');
  }

  let prompt = `あなたは英語学習者を温かく励ますプロの英語講師です。\n`;
  prompt += `【出題モード】: ${question.mode === 'en_to_ja' ? '英 ➔ 日（英文の意味を回答）' : '日 ➔ 英（日本語から英作文）'}\n`;
  prompt += `【出題文】: "${question.promptText}"\n`;
  if (question.constraint) {
    prompt += `【指定制約】: "${question.constraint}"\n`;
  }
  prompt += `【出題のポイント表現】: "${question.targetPhrase}" (${question.targetPhraseMeaning})\n`;
  prompt += `【模範解答】: "${question.referenceAnswer}"\n\n`;
  prompt += `【ユーザーの回答】: "${userAnswer}"\n\n`;

  prompt += `ユーザーの回答を採点・評価してください。\n`;
  prompt += `要件:\n`;
  prompt += `1. is_correct: 意味が通じていれば true、大幅に間違っていたり意味が通じない場合は false。\n`;
  prompt += `2. score: 0〜100点（小さなタイプミスやニュアンスのズレは減点しつつも高めに評価）。\n`;
  prompt += `3. feedback: 温かく褒めつつ、改善点やより良い表現のアドバイスを1〜2文で日本語で記述。\n`;
  prompt += `4. model_answer: 最も自然な模範解答。\n`;
  prompt += `5. nuance_explanation: 出題ポイントとなった表現や文法・構文の使い方を分かりやすく1〜2文で解説。\n`;

  prompt += `\n必ず以下のJSONフォーマットのみを返してください。
{
  "is_correct": true,
  "score": 90,
  "feedback": "とても自然で素晴らしい回答です！",
  "model_answer": "模範解答",
  "nuance_explanation": "be going to はすでに予定している未来の行動を表す時によく使われます。"
}`;

  const candidateModels = Array.from(new Set([model, ...FALLBACK_MODELS]));
  let lastError: Error | null = null;

  for (const currentModel of candidateModels) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const msg = errData?.error?.message || `HTTP ${response.status}`;
        if (response.status === 429 || response.status === 503 || msg.includes('high demand')) {
          continue;
        }
        throw new Error(msg);
      }

      const data = await response.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) throw new Error('Geminiの応答が空でした');

      let clean = rawText.trim();
      if (clean.startsWith('```json')) clean = clean.replace(/^```json\s*/, '').replace(/```\s*$/, '');
      else if (clean.startsWith('```')) clean = clean.replace(/^```\s*/, '').replace(/```\s*$/, '');

      const parsed = JSON.parse(clean);
      const usage = data?.usageMetadata;

      return {
        evaluation: {
          isCorrect: Boolean(parsed.is_correct),
          score: typeof parsed.score === 'number' ? parsed.score : 80,
          feedback: parsed.feedback || '',
          modelAnswer: parsed.model_answer || question.referenceAnswer,
          nuanceExplanation: parsed.nuance_explanation || '',
          targetPhrase: question.targetPhrase,
          targetPhraseMeaning: question.targetPhraseMeaning,
        },
        tokenUsage: {
          promptTokens: usage?.promptTokenCount || 0,
          candidatesTokens: usage?.candidatesTokenCount || 0,
        },
      };
    } catch (e: any) {
      lastError = e;
      continue;
    }
  }

  throw lastError || new Error('採点に失敗しました。');
}