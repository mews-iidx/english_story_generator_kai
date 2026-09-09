import { Story, ContentType } from '../types/story';
import { CefrLevel } from '../types/settings';
import { parseRobustStoryJson } from '../utils/jsonParser';
import { ChatSuggestedVocab } from '../types/chat';
import { Persona, CallMessage, ExtractedCallVocab } from '../types/persona';

export interface GenerateStoryParams {
  apiKey: string;
  model?: string;
  cefrLevel: CefrLevel;
  contentType?: ContentType; // story, podcast, dialogue
  userPrompt?: string;
  targetVocabs: string[];
  targetErrorPatterns?: { corePattern: string; naturalExpression: string; explanation: string }[];
  recentSummaries: string[];
  targetWordCount?: number; // 目標単語数 (デフォルト 700語)
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
  const { 
    apiKey, 
    model = 'gemini-3.7-flash', 
    cefrLevel, 
    contentType = 'story', 
    userPrompt, 
    targetVocabs, 
    recentSummaries, 
    targetWordCount = 700 
  } = params;

  if (!apiKey) {
    throw new Error('Gemini APIキーが設定されていません。右上の「設定」からAPIキーを入力してください。');
  }

  const levelGuidelines: Record<CefrLevel, string> = {
    A1: '【超初級 (A1 / 中学1〜2年レベル)】\n極めて平易な基本単語（英検5級〜4級レベル）のみを使用し、1文は短く簡潔に（7〜10語程度）。現在形や平易な過去形を中心とした、読みやすい文章を作成してください。',
    A2: '【初級 (A2 / 中学3年〜日常会話基礎)】\n中学英語レベルの基本単語と身近な日常表現（英検3級〜準2級レベル）を使用してください。複雑な複文は避け、分かりやすく温かみのあるストーリーにしてください。',
    B1: '【中級 (B1 / 高校英語・日常英会話)】\n日常会話や旅行、身近な出来事をテーマに、標準的な語彙と表現を使ったストーリーを作成してください。',
    B2: '【中上級 (B2 / 自然なイディオム・表現)】\n自然な句動詞やイディオム、生き生きとした表現を含む読み応えのあるストーリーを作成してください。',
    C1: '【上級 (C1 / 高度な語彙・文学的表現)】\n高度で洗練された語彙や多様な構文を含むストーリーを作成してください。'
  };

  let promptText = `あなたは英語学習者向けの優秀なプロの英語作家兼英語講師です。\n`;
  promptText += `${levelGuidelines[cefrLevel] || levelGuidelines.A2}\n\n`;

  // コンテンツタイプ別の指示
  if (contentType === 'podcast') {
    promptText += `【★フォーマット：ポッドキャスト風 1人語りエッセイ（Listening Time スタイル）】\n`;
    promptText += `人気英語ポッドキャスト『Listening Time』のように、ネイティブスピーカーがリスナーに向かって親しみやすく語りかける一人語りのエッセイ・トークスクリプトを作成してください。\n`;
    promptText += `- 「Welcome back to the podcast...」「Today, I want to talk about...」「To be honest,」「What surprised me was...」のような、自然な話し言葉の導入や接続表現を用いてください。\n`;
    promptText += `- リスナーが耳で聴いたときに映像が浮かびやすく、頭から順に理解しやすい明瞭な構成にしてください。\n\n`;
  } else if (contentType === 'dialogue') {
    promptText += `【★フォーマット：2人の自然な日常会話劇（Dialogue）】\n`;
    promptText += `2人の登場人物（例: Alex と Mia）による、テンポの良い自然な日常会話・ダイアログ形式を作成してください。\n`;
    promptText += `- 相槌、感情表現、日常の自然なやり取りを含めてください。\n`;
    promptText += `- 発言ごとに "Alex: ..." のように話者名を明記してください。\n\n`;
  } else {
    promptText += `【★フォーマット：ショートストーリー（物語）】\n`;
    promptText += `出だしがマンネリ化しないよう、会話から始まる、または情景・音・主人公の疑問から始まるなど、魅力的なオープニングで物語を始めてください。\n\n`;
  }

  promptText += `【★最重要：本文の目標単語数】\n英語本文（story）の長さは【約 ${targetWordCount} 語（words）】を目安に作成してください。しっかりと展開のある満足感の高いボリュームにしてください。\n\n`;

  if (targetVocabs.length > 0) {
    promptText += `【復習対象の単語・イディオム・定型句】\n`;
    targetVocabs.forEach((v, idx) => {
      promptText += `${idx + 1}. "${v}"\n`;
    });
    promptText += `\n★単語・イディオムの出題ルール：前回とは異なる自然な文脈や生き生きとしたシチュエーションで登場させてください。\n\n`;
  }

  const { targetErrorPatterns } = params;
  if (targetErrorPatterns && targetErrorPatterns.length > 0) {
    promptText += `【★最重要：克服すべき文法・語法パターン（本質の応用出題）】\n`;
    promptText += `ユーザーが過去の会話で詰まったり間違えたりした文法・語法パターンです。同じ例文のコピペではなく、**その本質的な型・ニュアンスを今回のストーリーに自然に織り込み、登場人物のセリフや文章として登場させてください**：\n`;
    targetErrorPatterns.forEach((p: any, idx: number) => {
      promptText += `${idx + 1}. パターン: "${p.corePattern}" (自然な用例: ${p.naturalExpression} - 解説: ${p.explanation})\n`;
    });
    promptText += `\n`;
  }

  if (userPrompt && userPrompt.trim().length > 0) {
    promptText += `【ユーザーの希望テーマ・ジャンル】\n"${userPrompt}"\n\n`;
  } else {
    promptText += `【テーマ】\n指定なし（おまかせ）。日常、冒険、発見、ポッドキャストトーク、ミステリー、SFなど楽しいシチュエーション。\n\n`;
    if (recentSummaries.length > 0) {
      promptText += `【直近のストーリー概要（これらと設定やシチュエーションが重複しない、新鮮な設定にしてください）】\n`;
      recentSummaries.forEach(s => {
        promptText += `${s}\n`;
      });
      promptText += `\n`;
    }
  }

  promptText += `【出力フォーマット】\n`;
  promptText += `必ず以下のJSONフォーマットのみを出力してください。Markdownタグ（\`\`\`jsonなど）は付けず、純粋なJSON文字列のみを出力してください。\n\n`;
  promptText += `{\n`;
  promptText += `  "title": "英語のタイトル",\n`;
  promptText += `  "title_ja": "日本語のタイトル",\n`;
  promptText += `  "genres": ["Adventure", "Daily Life", "Podcast"など2〜3個のジャンルタグ],\n`;
  promptText += `  "summary": "日本語で1〜2文の導入あらすじ（※オチや結末のネタバレは絶対に含めないでください）",\n`;
  promptText += `  "story": "英語の本文（段落ごとに \\n\\n で区切る。目標単語数 約 ${targetWordCount} 語）",\n`;
  promptText += `  "japanese_translation": "本文の自然な日本語全訳（段落ごとに \\n\\n で区切る）",\n`;
  promptText += `  "target_vocab_used": ["本文に登場させた復習語彙のリスト"]\n`;
  promptText += `}\n`;

  const candidateModels = Array.from(new Set([model, ...FALLBACK_MODELS]));
  let lastError: Error | null = null;

  for (const currentModel of candidateModels) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }],
          generationConfig: {
            temperature: 0.75,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const errMsg = errData.error?.message || `HTTP ${response.status} ${response.statusText}`;
        throw new Error(`Gemini API Error (${currentModel}): ${errMsg}`);
      }

      const data = await response.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!rawText) {
        throw new Error('Geminiから有効なレスポンスが得られませんでした。');
      }

      const parsedData = parseRobustStoryJson(rawText);

      // 単語数の概算カウント
      const actualWords = (parsedData.story || '').trim().split(/\s+/).filter(Boolean).length;

      const storyResult: Story = {
        id: 'story_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        title: parsedData.title || 'Untitled Story',
        titleJa: parsedData.title_ja || '無題の物語',
        summary: parsedData.summary || '',
        storyContent: parsedData.story || '',
        japaneseTranslation: parsedData.japanese_translation || '',
        targetVocabList: parsedData.target_vocab_used || targetVocabs || [],
        userPrompt,
        cefrLevel,
        contentType,
        genres: parsedData.genres || (contentType === 'podcast' ? ['Podcast', 'Daily Life'] : ['Story', 'General']),
        targetWordCount,
        actualWordCount: actualWords,
        isRead: false,
        createdAt: new Date().toISOString(),
      };

      const usage = data?.usageMetadata;
      const promptTokens = usage?.promptTokenCount || 0;
      const candidatesTokens = usage?.candidatesTokenCount || 0;

      return {
        story: storyResult,
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

export interface VocabRankItem {
  id: string;
  phrase: string;
  meaning: string;
}

export interface VocabRankResult {
  id: string;
  importance: number; // 1〜5
  reason?: string;
}

/**
 * 登録語彙をGeminiで一括ランク付け（日常英会話における重要度 1〜5）
 */
export async function rankVocabImportanceWithGemini(
  vocabs: VocabRankItem[],
  apiKey: string,
  model = 'gemini-3.7-flash'
): Promise<{ rankings: VocabRankResult[]; tokenUsage?: { promptTokens: number; candidatesTokens: number } }> {
  if (!apiKey || vocabs.length === 0) return { rankings: [] };

  const prompt = `あなたは英語教育・日常英会話の専門家です。
以下の英語表現（単語・イディオム・構文）リストを【日常英会話・実用英語における重要度・頻出度】の観点から 1〜5 の整数でスコアリングしてください。

【スコアリング基準】
5: 日常英会話で極めて頻出・必須レベル（基本動詞、最重要イディオム、毎日使う表現）
4: 一般的な会話・ビジネス・日常コミュニケーションでよく使われる重要表現
3: 標準的な語彙・知っておくと便利な表現
2: やや文学的・専門的・使用場面が限定される表現
1: 稀・難解・日常会話では滅多に使われない表現

【対象語彙リスト】
${JSON.stringify(vocabs.map(v => ({ id: v.id, phrase: v.phrase, meaning: v.meaning })), null, 2)}

【出力ルール】
必ず以下のJSON配列形式のみを出力してください:
[
  {
    "id": "語彙のID",
    "importance": 5,
    "reason": "日常会話で頻出の重要イディオム"
  }
]`;

  const candidateModels = Array.from(new Set([model, ...FALLBACK_MODELS]));

  for (const currentModel of candidateModels) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
          }
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        const usage = data?.usageMetadata;
        
        let rankings: VocabRankResult[] = [];
        try {
          const cleanJson = rawText.replace(/^```json\s*/, '').replace(/```\s*$/, '').trim();
          rankings = JSON.parse(cleanJson);
        } catch (parseErr) {
          console.warn('JSON parse error for vocab rankings', parseErr, rawText);
        }

        return {
          rankings,
          tokenUsage: {
            promptTokens: usage?.promptTokenCount || 0,
            candidatesTokens: usage?.candidatesTokenCount || 0,
          }
        };
      }
    } catch (e) {
      console.warn('Rank vocab error with model ' + currentModel, e);
    }
  }

  return { rankings: [] };
}

export interface ChatMentorParams {
  messages: { role: 'user' | 'model'; parts: { text: string }[] }[];
  currentQuery: string;
  contextInfo?: {
    recentStoryTitle?: string;
    vocabCount?: number;
    cefrLevel?: string;
  };
  apiKey: string;
  model?: string;
}

export interface ChatMentorResult {
  replyText: string;
  suggestedVocabs: ChatSuggestedVocab[];
  tokenUsage?: { promptTokens: number; candidatesTokens: number };
}

/**
 * AI英語メンターとの対話＆登録推奨フレーズ抽出
 */
export async function chatWithAiMentor(params: ChatMentorParams): Promise<ChatMentorResult> {
  const { messages, currentQuery, contextInfo, apiKey, model = 'gemini-3.7-flash' } = params;

  if (!apiKey) {
    return {
      replyText: 'APIキーが設定されていません。設定画面からGemini APIキーを入力してください。',
      suggestedVocabs: [],
    };
  }

  const systemInstruction = `あなたは親しみやすく優秀な英語パーソナルメンター「CompileEng AI」です。
ユーザーは英語のリアルタイムコンパイル（頭から瞬時に意味を理解する力）と日常英会話リスニング・スピーキングの上達を目指しています。
ユーザーの質問（「〜は英語で何と言う？」「このニュアンスの違いは？」「この文法の意味は？」など）に、分かりやすく温かいトーンで答えてください。

【★最重要ルール：重要フレーズの抽出】
あなたの回答の最後に、ユーザーが語彙帳（Anki・ストーリー生成）に登録して定着させるべき「キー表現（単語・イディオム）」を1〜3個抽出してください。
出力形式として、回答文の末尾に以下の形式でJSONタグを含めてください:
<!--SUGGESTED_VOCABS:[{"phrase":"look forward to","meaning":"〜を楽しみに待つ"}]-->
回答本文は通常の親切な日本語解説（Markdown記法可）で記述してください。`;

  const formattedContents = [
    ...messages,
    {
      role: 'user',
      parts: [
        {
          text: `${currentQuery}\n\n(学習者情報: レベル ${contextInfo?.cefrLevel || 'A2'}, 語彙数: ${contextInfo?.vocabCount || 0}語)`
        }
      ]
    }
  ];

  const candidateModels = Array.from(new Set([model, ...FALLBACK_MODELS]));

  for (const currentModel of candidateModels) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: formattedContents,
          generationConfig: { temperature: 0.7 }
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const rawReply = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const usage = data?.usageMetadata;

        let replyText = rawReply;
        let suggestedVocabs: ChatSuggestedVocab[] = [];

        // <!--SUGGESTED_VOCABS:[...]--> を抽出
        const match = rawReply.match(/<!--SUGGESTED_VOCABS:(.*?)-->/);
        if (match && match[1]) {
          try {
            suggestedVocabs = JSON.parse(match[1]);
            replyText = rawReply.replace(/<!--SUGGESTED_VOCABS:.*?-->/, '').trim();
          } catch (e) {
            console.warn('Failed to parse suggested vocabs', e);
          }
        }

        return {
          replyText,
          suggestedVocabs,
          tokenUsage: {
            promptTokens: usage?.promptTokenCount || 0,
            candidatesTokens: usage?.candidatesTokenCount || 0,
          }
        };
      }
    } catch (e) {
      console.warn('Chat error with ' + currentModel, e);
    }
  }

  return {
    replyText: 'AIメンターの応答取得に失敗しました。もう一度お試しください。',
    suggestedVocabs: [],
  };
}

export interface DetectedExpressionError {
  userUtterance: string;
  naturalExpression: string;
  corePattern: string;
  explanation: string;
  suggestedCause: 'vocabulary' | 'syntax_order' | 'direct_translation' | 'tense_modals' | 'preposition_colloc' | 'other';
}

export interface CallAnalysisResult {
  extractedVocabs: ExtractedCallVocab[];
  detectedErrors?: DetectedExpressionError[];
  recapSummary: string;
  newLikes: string[];
  newDislikes: string[];
  newTopic?: { topic: string; summary: string };
  newUserNotes: string[];
  newPromises?: string[];
  tokenUsage?: { promptTokens: number; candidatesTokens: number };
}

/**
 * 通話終了後の会話ログ分析・新出語彙抽出・ペルソナ記憶更新
 */
export async function analyzeCallSessionAndExtractMemory(params: {
  messages: CallMessage[];
  personaName?: string;
  apiKey: string;
  model?: string;
}): Promise<CallAnalysisResult> {
  const { messages, personaName = 'AI Partner', apiKey, model = 'gemini-3.7-flash' } = params;

  if (!apiKey || messages.length === 0) {
    return {
      recapSummary: '会話ログがありません',
      newLikes: [],
      newDislikes: [],
      newUserNotes: [],
      extractedVocabs: [],
    };
  }

  const prompt = `あなたは英語教育・対話分析の専門AIです。
以下の英語通話（ユーザーと「${personaName}」の会話ログ）を分析し、JSON形式で結果を出力してください。

【会話ログ】
${messages.map(m => `${m.role === 'user' ? 'User' : personaName}: ${m.text}`).join('\n')}

【分析タスク】
1. recapSummary: 今回の会話内容の簡潔な要約（日本語で1〜2文）。
2. newLikes: 会話の中で「${personaName}」が好き・興味があると新しく言及した事物・趣味（日本語の文字列配列）。なければ空配列。
3. newDislikes: 会話の中で「${personaName}」が嫌い・苦手・興味がないと新しく言及した事物（日本語の文字列配列）。なければ空配列。
4. newTopic: 今回話したメインのトピック名（日本語で簡潔に）とその要約。
5. newUserNotes: 会話の中でユーザーに関して新しく判明した情報（例: 「ユーザーは来月京都に行く予定」「カフェラテが好き」など）。なければ空配列。
6. newPromises: 次回までに何かを見る・やる・話す等の約束や宿題があれば抽出。
7. extractedVocabs: 会話中に出てきた【ユーザーが覚えるべき実用英単語・イディオム・表現（2〜5個）】。
   - phrase: 英語表現
   - meaning: 自然な日本語訳
   - contextSentence: 会話内で使われた（または代表的な）例文
   - nuanceNote: 使い方やニュアンスのワンポイント解説

【出力フォーマット（必ず以下のJSON形式のみを出力）】
{
  "recapSummary": "...",
  "newLikes": ["..."],
  "newDislikes": ["..."],
  "newTopic": { "topic": "...", "summary": "..." },
  "newUserNotes": ["..."],
  "newPromises": ["..."],
  "extractedVocabs": [
    {
      "phrase": "...",
      "meaning": "...",
      "contextSentence": "...",
      "nuanceNote": "..."
    }
  ]
}`;

  const candidateModels = Array.from(new Set([model, ...FALLBACK_MODELS]));

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

      if (response.ok) {
        const data = await response.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        const usage = data?.usageMetadata;

        const cleanJson = rawText.replace(/^```json\s*/, '').replace(/```\s*$/, '').trim();
        const parsed = JSON.parse(cleanJson);

        return {
          recapSummary: parsed.recapSummary || '英会話セッション完了',
          newLikes: parsed.newLikes || [],
          newDislikes: parsed.newDislikes || [],
          newTopic: parsed.newTopic,
          newUserNotes: parsed.newUserNotes || [],
          newPromises: parsed.newPromises || [],
          extractedVocabs: parsed.extractedVocabs || [],
          tokenUsage: {
            promptTokens: usage?.promptTokenCount || 0,
            candidatesTokens: usage?.candidatesTokenCount || 0,
          },
        };
      }
    } catch (e) {
      console.warn('Call analysis error with model ' + currentModel, e);
    }
  }

  return {
    recapSummary: '英会話セッション完了',
    newLikes: [],
    newDislikes: [],
    newUserNotes: [],
    extractedVocabs: [],
  };
}

/**
 * ユーザー指定またはランダムなLanguage Exchangeペルソナを自動生成
 */
export async function generateCustomPersona(params: {
  apiKey: string;
  userPrompt?: string;
  model?: string;
}): Promise<{ persona: Persona; tokenUsage?: { promptTokens: number; candidatesTokens: number } }> {
  const { apiKey, userPrompt, model = 'gemini-3.7-flash' } = params;

  const prompt = `あなたは英語学習者向けのLanguage Exchange（言語交換パートナー）キャラクターを創造するクリエイティブAIです。
${userPrompt ? `ユーザーからの要望: 「${userPrompt}」` : '自然で魅力的なネイティブまたは流暢な英語話者の友達キャラクターを1人生成してください。'}

以下のJSONフォーマットで出力してください:
{
  "name": "英語名（例: Chloe, Alex, Leo）",
  "avatarEmoji": "キャラを表す絵文字（例: 🏄, 🎨, 📚, ☕）",
  "nationality": "出身国・都市（例: オーストラリア (シドニー)）",
  "nativeLanguage": "英語",
  "age": 25,
  "occupation": "職業（例: サーフショップ店員 / Webデザイナー）",
  "personality": "性格や口調の特徴（日本語で1文。例: 明るくサバサバしていて、アウトドアの話題が好き。初心者にも親身。）",
  "interests": ["サーフィン", "キャンプ", "アコースティックギター", "タコス"],
  "cefrLevel": "A2" または "B1",
  "voiceName": "Aoede" または "Puck" または "Fenrir" または "Charon" または "Kore",
  "memory": {
    "likes": ["海", "アコースティック音楽", "朝の散歩"],
    "dislikes": ["寒さ", "都会の満員電車"],
    "recentTopics": [],
    "userNotes": [],
    "promisesOrFutureTasks": []
  }
}`;

  const candidateModels = Array.from(new Set([model, ...FALLBACK_MODELS]));

  for (const currentModel of candidateModels) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.8,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        const usage = data?.usageMetadata;

        const cleanJson = rawText.replace(/^```json\s*/, '').replace(/```\s*$/, '').trim();
        const parsed = JSON.parse(cleanJson);

        const newPersona: Persona = {
          id: 'persona_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
          name: parsed.name || 'Alex',
          avatarEmoji: parsed.avatarEmoji || '✨',
          nationality: parsed.nationality || 'アメリカ',
          nativeLanguage: parsed.nativeLanguage || '英語',
          age: parsed.age || 25,
          occupation: parsed.occupation || 'Freelancer',
          personality: parsed.personality || 'フレンドリーで親身',
          interests: parsed.interests || ['旅行', '映画'],
          cefrLevel: parsed.cefrLevel || 'A2',
          voiceName: parsed.voiceName || 'Aoede',
          memory: parsed.memory || { likes: [], dislikes: [], recentTopics: [], userNotes: [] },
          totalConversations: 0,
          isPreset: false,
          createdAt: new Date().toISOString(),
        };

        return {
          persona: newPersona,
          tokenUsage: {
            promptTokens: usage?.promptTokenCount || 0,
            candidatesTokens: usage?.candidatesTokenCount || 0,
          },
        };
      }
    } catch (e) {
      console.warn('Persona generation error with model ' + currentModel, e);
    }
  }

  throw new Error('ペルソナの生成に失敗しました');
}

/**
 * ペルソナとのテキストチャット対話関数
 * 音声通話（Gemini Live）と同じペルソナ情報・動的記憶を共有してチャットを行う
 */
export async function chatWithPersona(params: {
  apiKey: string;
  model?: string;
  persona?: Persona | null;
  history: { role: 'user' | 'assistant'; text: string }[];
  userText: string;
}): Promise<{
  text: string;
  tokenUsage?: { promptTokens: number; candidatesTokens: number };
}> {
  const { apiKey, model = 'gemini-2.0-flash', persona, history, userText } = params;

  let systemInstruction = '';
  if (persona) {
    const memory = persona.memory || { likes: [], dislikes: [], recentTopics: [], userNotes: [] };
    const likesStr = memory.likes.length > 0 ? memory.likes.join(', ') : 'なし';
    const dislikesStr = memory.dislikes.length > 0 ? memory.dislikes.join(', ') : 'なし';
    const topicsStr = memory.recentTopics.length > 0
      ? memory.recentTopics.map(t => `• [${t.date}] ${t.topic}: ${t.summary}`).join('\n')
      : 'まだ過去の会話履歴はありません。';
    const userNotesStr = memory.userNotes.length > 0 ? memory.userNotes.join('\n• ') : '特になし';

    systemInstruction = `You are roleplaying as "${persona.name}", a native/fluent English speaker in a casual Language Exchange chat.

[YOUR PROFILE]
- Name: ${persona.name} (${persona.avatarEmoji})
- Age: ${persona.age}
- Nationality/City: ${persona.nationality}
- Occupation: ${persona.occupation}
- Personality & Tone: ${persona.personality}
- Interests: ${persona.interests.join(', ')}
- Your Likes: ${likesStr}
- Your Dislikes: ${dislikesStr}

[YOUR MEMORY & SHARED HISTORY WITH THE USER]
- What you know about the user:
  • ${userNotesStr}
- Previous conversation topics & summaries:
  ${topicsStr}

[CORE CHAT RULES - VERY IMPORTANT]
1. Respond in short, casual, and natural conversational English (1 to 3 sentences). Do NOT write long paragraphs.
2. Ask one friendly follow-up question or react naturally like a real friend messaging on LINE/WhatsApp.
3. Be consistent with your personality, likes, dislikes, and past conversation memories.
4. If the user asks a question in Japanese or asks for English help/explanation (e.g. 「これってどういう意味？」「〜は英語で何て言う？」), seamlessly switch to Japanese to explain warmly and clearly, and then give a natural English example and continue the chat in English.`;
  } else {
    systemInstruction = `You are a friendly, encouraging native English speaking language exchange partner.
- Respond in short, casual, conversational English (1 to 3 sentences).
- If the user asks for explanations or types in Japanese, explain warmly in Japanese and then encourage them with a natural English response.`;
  }

  // Format contents for Gemini API (Multi-turn format)
  const contents: any[] = [];

  // Recent history (up to last 10 messages)
  const recentHistory = history.slice(-10);
  for (const msg of recentHistory) {
    contents.push({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.text }],
    });
  }

  // Current user message
  contents.push({
    role: 'user',
    parts: [{ text: userText }],
  });

  const candidateModels = Array.from(new Set([model, ...FALLBACK_MODELS]));

  for (const currentModel of candidateModels) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemInstruction }],
          },
          contents,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 500,
          },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        const usage = data?.usageMetadata;

        if (text) {
          return {
            text,
            tokenUsage: {
              promptTokens: usage?.promptTokenCount || 0,
              candidatesTokens: usage?.candidatesTokenCount || 0,
            },
          };
        }
      }
    } catch (e) {
      console.warn(`chatWithPersona error on ${currentModel}:`, e);
    }
  }

  throw new Error('メッセージの送信に失敗しました');
}
