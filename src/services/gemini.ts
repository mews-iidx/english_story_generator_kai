import { Story } from '../types/story';
import { CefrLevel } from '../types/settings';
import { parseRobustStoryJson } from '../utils/jsonParser';

export interface GenerateStoryParams {
  apiKey: string;
  model?: string;
  cefrLevel: CefrLevel;
  userPrompt?: string;
  targetVocabs: string[];
  recentSummaries: string[];
}

export interface GeneratedStoryResult {
  story: Story;
  tokenUsage?: {
    promptTokens: number;
    candidatesTokens: number;
  };
}

const FALLBACK_MODELS = ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];

export async function generateStoryWithGemini(params: GenerateStoryParams): Promise<GeneratedStoryResult> {
  const { apiKey, model = 'gemini-3.7-flash', cefrLevel, userPrompt, targetVocabs, recentSummaries } = params;

  if (!apiKey) {
    throw new Error('Gemini APIキーが設定されていません。右上の「設定」からAPIキーを入力してください。');
  }

  const levelGuidelines: Record<CefrLevel, string> = {
    A1: '【超初級 (A1 / 中学1〜2年レベル)】\n極めて平易な基本単語（英検5級〜4級レベル）のみを使用し、1文は短く簡潔に（7〜10語程度）。現在形や平易な過去形を中心とした、100〜140語程度の優しい物語を作成してください。',
    A2: '【初級 (A2 / 中学3年〜日常会話基礎)】\n中学英語レベルの基本単語と身近な日常表現（英検3級〜準2級レベル）を使用してください。複雑な複文は避け、120〜170語程度の分かりやすく温かみのあるストーリーにしてください。',
    B1: '【中級 (B1 / 高校英語・日常英会話)】\n日常会話や旅行、身近な出来事をテーマに、標準的な語彙と表現を使った150〜200語程度のストーリーを作成してください。',
    B2: '【中上級 (B2 / 自然なイディオム・表現)】\n自然な句動詞やイディオム、生き生きとした表現を含む180〜240語程度のストーリーを作成してください。',
    C1: '【上級 (C1 / 高度な語彙・文学的表現)】\n高度で洗練された語彙や多様な構文を含む200〜280語程度の読み応えのあるストーリーを作成してください。'
  };

  let promptText = `あなたは英語学習者向けの優秀なプロの英語作家兼英語講師です。\n`;
  promptText += `${levelGuidelines[cefrLevel] || levelGuidelines.A2}\n\n`;

  if (targetVocabs.length > 0) {
    promptText += `【復習対象の単語・イディオム・文法構文】\n`;
    targetVocabs.forEach((v, idx) => {
      promptText += `${idx + 1}. "${v}"\n`;
    });
    promptText += `\n★重要ルール（構文・イディオムの応用出題について）：\n`;
    promptText += `- 登録語が構文パターン（例: "too ... to ...", "so ... that ...", "used to", "look forward to", "take care of" 等）や特定の一文の場合、全く同じ例文をそのまま使い回すのではなく、**その構文・イディオムの本質的なニュアンスや文法パターンを汲み取り、今回の物語のシチュエーションに合わせた新しい応用例文**（別の主語、別の形容詞/動詞など）として自然に登場させてください。\n`;
    promptText += `- 単語の場合も、前回とは異なる自然な文脈や組み合わせで登場させてください。\n\n`;
  }

  if (userPrompt && userPrompt.trim().length > 0) {
    promptText += `【ユーザーの希望テーマ・ジャンル】\n"${userPrompt}"\n\n`;
  } else {
    promptText += `【テーマ】\n指定なし（おまかせ）。日常、冒険、発見、ミステリー、SFなど楽しいシチュエーション。\n\n`;
    if (recentSummaries.length > 0) {
      promptText += `【直近のストーリー概要（これらと設定やシチュエーションが重複しない、新鮮な設定にしてください）】\n`;
      recentSummaries.forEach(s => {
        promptText += `${s}\n`;
      });
      promptText += `\n`;
    }
  }

  promptText += `【要件】\n`;
  promptText += `1. 英語本文（story）は読みやすく段落（改行）を適切に入れてください。セリフや引用符のダブルクォートはJSON内で安全にエスケープするか、シングルクォート（‘ ’）を使ってください。\n`;
  promptText += `2. 日本語のあらすじ（summary）は、**物語のオチや結末のネタバレを絶対に書かず**、どんなシチュエーションで始まる物語かという導入・設定の紹介（1〜2文）のみを日本語で記述してください。\n`;
  promptText += `3. genres には物語に合ったジャンルタグ（例: ["Adventure", "Daily Life"], ["Mystery", "Sci-Fi"], ["Thriller"], ["Comedy"] 等）を1〜2個指定してください。\n`;
  promptText += `4. 日本語訳（japanese_translation）には物語全体の自然な日本語対訳を含めてください。\n`;
  promptText += `5. target_vocab_used には、今回ストーリー内で実際に使用・応用した表現や構文のリストを記載してください。\n`;
  promptText += `\n必ず以下のJSONフォーマットのみを返してください。`;

  const jsonSchemaDescription = `{
  "title": "英語のタイトル",
  "title_ja": "日本語のタイトル",
  "genres": ["Adventure", "Daily Life"],
  "summary": "日本語での1-2文のあらすじ・シチュエーション概要（ネタバレ厳禁・導入のみ）",
  "story": "英語の物語本文",
  "japanese_translation": "物語全体の自然な日本語訳",
  "target_vocab_used": ["実際に物語で使った・応用したターゲット表現や構文"]
}`;

  promptText += `\n\n【期待するJSONスキーマ】\n` + jsonSchemaDescription;

  const candidateModels = Array.from(new Set([model, ...FALLBACK_MODELS]));
  let lastError: Error | null = null;

  for (const currentModel of candidateModels) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;

      const requestBody = {
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: {
          temperature: 0.7,
          topP: 0.95,
          responseMimeType: "application/json"
        }
      };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const msg = errorData?.error?.message || `HTTP ${response.status}`;
        if (response.status === 429 || response.status === 503 || msg.includes('high demand') || msg.includes('quota') || msg.includes('unavailable')) {
          console.warn(`Model ${currentModel} is busy (${msg}), trying next fallback model...`);
          lastError = new Error(`Gemini API (${currentModel}): ${msg}`);
          continue;
        }
        throw new Error(`Gemini API Error (${currentModel}): ${msg}`);
      }

      const data = await response.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!rawText) throw new Error('Gemini APIからの応答が空でした。');

      // 堅牢パーサーを使用（セリフ等のクォート問題も自動修復）
      const parsed = parseRobustStoryJson(rawText);
      const storyId = 'st_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

      const usage = data?.usageMetadata;
      const promptTokens = usage?.promptTokenCount || 0;
      const candidatesTokens = usage?.candidatesTokenCount || 0;

      const story: Story = {
        id: storyId,
        title: parsed.title || 'Untitled Story',
        titleJa: parsed.title_ja || '無題のストーリー',
        summary: parsed.summary || '概要なし',
        storyContent: parsed.story,
        japaneseTranslation: parsed.japanese_translation,
        targetVocabList: parsed.target_vocab_used || targetVocabs,
        genres: parsed.genres && parsed.genres.length > 0 ? parsed.genres : ['Daily Life'],
        userPrompt: userPrompt || undefined,
        cefrLevel,
        createdAt: new Date().toISOString(),
      };

      return {
        story,
        tokenUsage: {
          promptTokens,
          candidatesTokens,
        }
      };
    } catch (err: any) {
      lastError = err;
      if (err.message.includes('high demand') || err.message.includes('429') || err.message.includes('503')) {
        continue;
      }
      break;
    }
  }

  throw lastError || new Error('ストーリー生成に失敗しました。');
}

export async function getDetailedNuanceWithGemini(
  phrase: string,
  contextSentence: string,
  apiKey: string,
  model = 'gemini-3.7-flash'
): Promise<{ explanation: string; tokenUsage?: { promptTokens: number; candidatesTokens: number } }> {
  if (!apiKey) return { explanation: '' };

  const prompt = `以下の英文における「${phrase}」の使い方・文法構文・ニュアンスについて、英語学習者に分かりやすく1〜2文で解説してください。構文パターンの場合はその型（例: too [形容詞] to [動詞]）も簡潔に示してください。
【英文】: "${contextSentence}"
【対象表現】: "${phrase}"`;

  const candidateModels = Array.from(new Set([model, ...FALLBACK_MODELS]));

  for (const currentModel of candidateModels) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2 }
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        const usage = data?.usageMetadata;
        return {
          explanation: text,
          tokenUsage: {
            promptTokens: usage?.promptTokenCount || 0,
            candidatesTokens: usage?.candidatesTokenCount || 0,
          }
        };
      }
    } catch (e) {
      console.warn('Nuance fetch error', e);
    }
  }
  return { explanation: '' };
}