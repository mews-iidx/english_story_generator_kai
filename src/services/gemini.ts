import { ExtractedCorePattern } from '../types/vocab';
import { Story, ContentType, SeriesType, TargetEmbedding } from '../types/story';
import { CefrLevel } from '../types/settings';
import { PatternMasterItem, VocabMasterItem } from '../types/mastery';
import { parseRobustStoryJson } from '../utils/jsonParser';
import { ChatSuggestedVocab } from '../types/chat';
import { Persona, CallMessage, ExtractedCallVocab } from '../types/persona';

export interface GenerateStoryParams {
  apiKey: string;
  model?: string;
  cefrLevel: CefrLevel;
  contentType?: ContentType; // story, podcast, dialogue
  seriesType?: SeriesType; // single, trilogy, omnibus
  episodeIndex?: number; // 1, 2, 3
  totalEpisodes?: number; // 3
  seriesId?: string;
  previousEpisodesSummary?: string;
  userPrompt?: string;
  targetVocabs: string[];
  targetPatterns?: PatternMasterItem[];
  targetVocabMaster?: VocabMasterItem[];
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
    seriesType = 'single',
    episodeIndex,
    totalEpisodes,
    seriesId,
    previousEpisodesSummary,
    userPrompt, 
    targetVocabs, 
    targetPatterns,
    targetVocabMaster,
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

  // 連続ストーリー・オムニバスなどのシリーズ連載指示
  if (seriesType === 'continuous' || seriesType === 'trilogy') {
    const epIdx = episodeIndex || 1;
    const totEp = totalEpisodes || 3;
    promptText += `【★連続連載ストーリー（Continuous Series）: 第 ${epIdx} 話 / 全 ${totEp} 話】\n`;
    if (epIdx === 1) {
      promptText += `【第1話（導入・起）の要件】:\n`;
      promptText += `- 物語の導入、魅力的な主人公・舞台設定、そして物語が動き出すきっかけとなる事件・謎・旅立ちを描いてください。\n`;
      promptText += `- 次の第2話が読みたくなるようなワクワクする展開やクリフハンガーで締めくくってください。\n\n`;
    } else if (epIdx < totEp) {
      promptText += `【第${epIdx}話（展開・承/転）の要件】:\n`;
      if (previousEpisodesSummary) {
        promptText += `前話までのあらすじ:\n${previousEpisodesSummary}\n\n`;
      }
      promptText += `- 前話の続きから始まり、事態の急展開、予期せぬ試練や対立、新事実の発見などを描いてください。\n`;
      promptText += `- 次の展開が気になる緊張感や選択・ピンチで締めくくってください。\n\n`;
    } else {
      promptText += `【第${epIdx}話（完結編・結）の要件】:\n`;
      if (previousEpisodesSummary) {
        promptText += `前話までのあらすじ:\n${previousEpisodesSummary}\n\n`;
      }
      promptText += `- 前話の危機や伏線を回収し、最大のクライマックス、鮮やかな解決、そして心に残るエンディングを描いて物語を美しく完結させてください。\n\n`;
    }
  } else if (seriesType === 'omnibus') {
    const epIdx = episodeIndex || 1;
    const totEp = totalEpisodes || 3;
    promptText += `【★独立オムニバス短編集（Omnibus Collection）: エピソード ${epIdx} / 全 ${totEp} 話】\n`;
    promptText += `- 共通の英語学習ターゲット構文・語彙を含めつつ、1話完結の独立した短編ストーリーにしてください。\n`;
    if (previousEpisodesSummary) {
      promptText += `（既に作成された他話のテーマ・概要:\n${previousEpisodesSummary}\n※これらとは異なる新鮮なシチュエーション・登場人物で描いてください）\n\n`;
    }
  }

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

  // 1. CEFR文法・構文パターンのターゲットバインディング指示
  if (targetPatterns && targetPatterns.length > 0) {
    promptText += `【★最重要：習得対象のCEFR文法・構文パターン（ターゲットバインディング）】\n`;
    promptText += `学習者が身につけるべき重要構文です。**以下の構文パターンをストーリーの本文（セリフや地の文）の中に必ず自然な文脈で登場させてください**：\n`;
    targetPatterns.forEach((p, idx) => {
      promptText += `${idx + 1}. [ID: ${p.id}] "${p.name}" (要点: ${p.focus}${p.meaning ? ` / 意味: ${p.meaning}` : ''})\n`;
    });
    promptText += `\n※登場させた構文は、後述の target_embeddings JSON 配列にそのID・使用フレーズ・訳・解説を必ず明記してください。\n\n`;
  }

  // 2. 語彙のターゲットバインディング指示
  const combinedVocabs = Array.from(new Set([
    ...targetVocabs,
    ...(targetVocabMaster?.map(v => v.phrase) || [])
  ]));

  if (combinedVocabs.length > 0) {
    promptText += `【復習対象の重要単語・イディオム・定型句】\n`;
    combinedVocabs.forEach((v, idx) => {
      promptText += `${idx + 1}. "${v}"\n`;
    });
    promptText += `\n★単語・イディオムの出題ルール：前回とは異なる自然な文脈や生き生きとしたシチュエーションで登場させてください。\n\n`;
  }

  const { targetErrorPatterns } = params;
  if (targetErrorPatterns && targetErrorPatterns.length > 0) {
    promptText += `【★最重要：克服すべき発話文法・語法パターン（本質の応用出題）】\n`;
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
  promptText += `  "target_vocab_used": ["本文に登場させた復習語彙のリスト"],\n`;
  promptText += `  "target_embeddings": [\n`;
  promptText += `    {\n`;
  promptText += `      "targetId": "構文ID（例: pat_b1_001）または単語ID",\n`;
  promptText += `      "type": "pattern または vocab",\n`;
  promptText += `      "targetName": "too [形容詞] to [動詞]",\n`;
  promptText += `      "textSpan": "本文中で実際に使われているフレーズ（例: too tired to drive）",\n`;
  promptText += `      "translation": "疲れすぎて運転できなかった",\n`;
  promptText += `      "focusPoint": "〜すぎて…できない"\n`;
  promptText += `    }\n`;
  promptText += `  ]\n`;
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

      // ターゲット埋め込みの補完
      let embeddings: TargetEmbedding[] = parsedData.target_embeddings || [];
      if (embeddings.length === 0 && targetPatterns && targetPatterns.length > 0) {
        embeddings = targetPatterns.map(p => ({
          targetId: p.id,
          type: 'pattern' as const,
          targetName: p.name,
          focusPoint: p.focus,
          translation: p.meaning,
        }));
      }

      const storyResult: Story = {
        id: 'story_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        title: parsedData.title || 'Untitled Story',
        titleJa: parsedData.title_ja || '無題の物語',
        summary: parsedData.summary || '',
        storyContent: parsedData.story || '',
        japaneseTranslation: parsedData.japanese_translation || '',
        targetVocabList: parsedData.target_vocab_used || combinedVocabs || [],
        targetEmbeddings: embeddings,
        seriesId: seriesId || (seriesType !== 'single' ? 'series_' + Date.now() : undefined),
        episodeIndex,
        totalEpisodes,
        seriesType,
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

/**
 * 単発・連続連載・オムニバスの任意話数（1〜5話）バッチ生成オーケストレーター
 */
export async function generateStorySeriesWithGemini(
  params: Omit<GenerateStoryParams, 'episodeIndex' | 'totalEpisodes' | 'seriesId' | 'previousEpisodesSummary'> & {
    seriesType?: SeriesType;
    storyCount?: number;
    isContinuous?: boolean;
  },
  onProgress?: (current: number, total: number, message: string) => void
): Promise<{ stories: Story[]; totalPromptTokens: number; totalCandidatesTokens: number }> {
  const storyCount = Math.max(1, Math.min(5, params.storyCount ?? (params.seriesType === 'trilogy' || params.seriesType === 'omnibus' ? 3 : 1)));
  const isContinuous = params.isContinuous !== undefined 
    ? params.isContinuous 
    : (params.seriesType === 'trilogy' || params.seriesType === 'continuous' || storyCount > 1);
  const seriesType: SeriesType = storyCount <= 1 ? 'single' : (isContinuous ? 'continuous' : 'omnibus');

  if (storyCount === 1) {
    onProgress?.(1, 1, 'ストーリーを生成中...');
    const res = await generateStoryWithGemini({
      ...params,
      seriesType: 'single',
      episodeIndex: 1,
      totalEpisodes: 1,
    });
    return {
      stories: [res.story],
      totalPromptTokens: res.tokenUsage?.promptTokens || 0,
      totalCandidatesTokens: res.tokenUsage?.candidatesTokens || 0,
    };
  }

  const seriesId = 'series_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
  const stories: Story[] = [];
  let totalPromptTokens = 0;
  let totalCandidatesTokens = 0;

  for (let i = 1; i <= storyCount; i++) {
    const progressLabel = isContinuous
      ? `第 ${i}/${storyCount} 話（連載: ${i === 1 ? '前編' : i === storyCount ? '完結編' : '中編'}）を執筆中...`
      : `第 ${i}/${storyCount} 話（独立オムニバス）を執筆中...`;
    
    onProgress?.(i, storyCount, progressLabel);

    // 前話までのあらすじ/概要の集約
    let previousSummary = '';
    if (stories.length > 0) {
      if (isContinuous) {
        previousSummary = stories.map((s, idx) => `第${idx + 1}話「${s.titleJa || s.title}」: ${s.summary}`).join('\n');
      } else {
        previousSummary = stories.map((s, idx) => `エピソード${idx + 1}「${s.titleJa || s.title}」: ${s.summary}`).join('\n');
      }
    }

    const res = await generateStoryWithGemini({
      ...params,
      seriesType,
      episodeIndex: i,
      totalEpisodes: storyCount,
      seriesId,
      previousEpisodesSummary: previousSummary,
    });

    stories.push(res.story);
    totalPromptTokens += res.tokenUsage?.promptTokens || 0;
    totalCandidatesTokens += res.tokenUsage?.candidatesTokens || 0;
  }

  return { stories, totalPromptTokens, totalCandidatesTokens };
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
    levelProgressSummary?: string;
    masteryStats?: {
      level: string;
      patternProgress: number;
      vocabProgress: number;
      totalMastered: number;
      dailyReadingWords: number;
      estimatedDaysToTarget?: number;
    };
    weakestPatterns?: Array<{
      patternName: string;
      formula?: string;
      focus?: string;
      mistakeCount: number;
      lastErrorReason?: string;
    }>;
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
 * AI英語メンターとの対話＆登録推奨フレーズ抽出（習得度テレメトリ連動）
 */
export async function chatWithAiMentor(params: ChatMentorParams): Promise<ChatMentorResult> {
  const { messages, currentQuery, contextInfo, apiKey, model = 'gemini-3.7-flash' } = params;

  if (!apiKey) {
    return {
      replyText: 'APIキーが設定されていません。設定画面からGemini APIキーを入力してください。',
      suggestedVocabs: [],
    };
  }

  let systemInstruction = `あなたは親しみやすく優秀な英語パーソナルメンター「CompileEng AI」です。
ユーザーは英語のリアルタイムコンパイル（頭から瞬時に意味を理解する力）と日常英会話リスニング・スピーキングの上達を目指しています。
ユーザーの質問（「〜は英語で何と言う？」「このニュアンスの違いは？」「この文法の意味は？」「学習ペースの相談」など）に、分かりやすく温かいトーンで答えてください。`;

  if (contextInfo?.masteryStats) {
    const s = contextInfo.masteryStats;
    systemInstruction += `\n\n【学習者の現在の習得度テレメトリ（HUD情報）】
- 目標/現在CEFR: ${s.level}
- 構文習得率: ${Math.round(s.patternProgress * 100)}%
- 重要単語習得率: ${Math.round(s.vocabProgress * 100)}%
- 総マスター項目数: ${s.totalMastered} 項目
- 今日の読書量: ${s.dailyReadingWords} 語
${s.estimatedDaysToTarget ? `- 現在ペースでの目標達成予測: 約 ${s.estimatedDaysToTarget} 日` : ''}

※学習ペースや達成時期について相談された場合、このデータを元に現実的で励みになる具体的なアドバイス（例: 「1日1話（約700語）の読書を続けると、あと約○日でB1レベルの構文をコンプリートできますよ！」など）を提供してください。`;
  }

  if (contextInfo?.weakestPatterns && contextInfo.weakestPatterns.length > 0) {
    systemInstruction += `\n\n【★学習者の弱点構文（ドリル・Ankiでミス多発）】
${contextInfo.weakestPatterns.map(w => `- 構文: ${w.patternName} (${w.formula || w.focus || ''}) / ミス回数: ${w.mistakeCount}回 / 直近の誤り傾向: ${w.lastErrorReason || 'なし'}`).join('\n')}
※ユーザーから「苦手な構文は？」「弱点を教えて」「苦手な文法を特訓して」と聞かれた場合、この弱点構文を具体的に提示し、なぜ間違えやすいのかの解説や、この構文を使った例文作成トレーニングを出題してあげてください。`;
  }

  systemInstruction += `\n\n【★最重要ルール：重要フレーズの抽出】
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
          text: `${currentQuery}\n\n(学習者情報: レベル ${contextInfo?.cefrLevel || 'A2'}, 語彙数: ${contextInfo?.vocabCount || 0}語${contextInfo?.levelProgressSummary ? `, 進捗: ${contextInfo.levelProgressSummary}` : ''})`
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
    replyText: 'AIメンターからの返答取得に失敗しました。時間をおいて再試行してください。',
    suggestedVocabs: [],
  };
}

export interface DetectedExpressionError {
  userUtterance: string;
  naturalExpression: string;
  corePattern: string;
  suggestedCause?: string;
  explanation: string;
}

export interface CallAnalysisResult {
  newLikes: string[];
  newDislikes: string[];
  newTopic?: string;
  newUserNotes?: string[];
  newPromises?: string[];
  recapSummary?: string;
  extractedVocabs?: ExtractedCallVocab[];
  detectedErrors?: DetectedExpressionError[];
  tokenUsage?: {
    promptTokens: number;
    candidatesTokens: number;
  };
}

/**
 * 通話セッション終了時に、会話ログから
 * 1. 相手ペルソナが記憶すべきユーザー情報・話題要約
 * 2. ユーザーが犯した「偽英語・不自然な表現・文法ミス」と「その本質構文パターン」
 * をGeminiで一括解析・抽出する
 */
export async function analyzeCallSessionAndExtractMemory(params: {
  apiKey: string;
  model?: string;
  personaName?: string;
  persona?: Persona;
  messages: CallMessage[];
  extractedVocabs?: ExtractedCallVocab[];
}): Promise<CallAnalysisResult> {
  const { apiKey, model = 'gemini-3.7-flash', persona, personaName = 'AI Partner', messages, extractedVocabs } = params;
  const pName = persona?.name || personaName;

  if (!apiKey || messages.length < 2) {
    return { newLikes: [], newDislikes: [] };
  }

  const conversationText = messages
    .map(m => `${m.role === 'user' ? 'User' : pName}: ${m.text}`)
    .join('\n');

  const prompt = `あなたは卓越した言語交換AIエージェントおよび英語指導のプロです。
以下の「ユーザーとネイティブキャラクター(${pName})の英会話通話ログ」を分析し、2つのタスクを行ってください。

【会話ログ】
${conversationText}

---
【タスク1: ペルソナの記憶更新 (Memory Update)】
会話を通じて${pName}が新たに知ったユーザーの好み(likes)、苦手なもの(dislikes)、ユーザーに関する重要メモ(userNotes)、および今回の会話トピックの1文要約(topicSummary)を抽出してください。新規情報がない項目は空配列にしてください。

【タスク2: 発話カルテ・文法語法パターンの抽出 (Expression Error Analysis)】
ユーザーの発言の中に、不自然な英語、文法ミス、和製英語、意図が伝わりにくい表現があれば最大3個まで抽出してください。
特に重要なのは「corePattern（本質の構文・語法パターン）」です。単なる単語のミスではなく、「too ~ to ...」「prevent A from -ing」「look forward to -ing」「I wish I had ...」などの文法・語法の抽象的な型を抽出してください。

以下のJSONフォーマットのみを出力してください:
{
  "memoryUpdates": {
    "likes": ["新しく分かったユーザーの好きなこと・もの"],
    "dislikes": ["新しく分かったユーザーの嫌いなこと・苦手なもの"],
    "userNotes": ["ユーザーの職業、家族、計画など記憶すべき事実"],
    "topicSummary": "今回の会話の簡潔なまとめ（日本語1文）"
  },
  "detectedErrors": [
    {
      "mistake": "ユーザーが実際に言った不自然な文・間違い",
      "corrected": "ネイティブならこう言う自然な表現",
      "corePattern": "抽象化された文法・語法パターン（例: look forward to + ~ing）",
      "explanation": "なぜ不自然なのか、どう使い分けるのかの簡潔な日本語解説（1〜2文）"
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

        const mem = parsed.memoryUpdates || parsed;
        const errors: DetectedExpressionError[] = (parsed.detectedErrors || []).map((e: any) => ({
          userUtterance: e.userUtterance || e.mistake || '',
          naturalExpression: e.naturalExpression || e.corrected || '',
          corePattern: e.corePattern || '',
          suggestedCause: e.suggestedCause || e.causeCategory || 'grammar',
          explanation: e.explanation || '',
        }));

        return {
          newLikes: mem.likes || mem.newLikes || [],
          newDislikes: mem.dislikes || mem.newDislikes || [],
          newTopic: mem.topicSummary || mem.newTopic || '',
          newUserNotes: mem.userNotes || mem.newUserNotes || [],
          newPromises: mem.promises || mem.newPromises || [],
          recapSummary: mem.topicSummary || mem.recapSummary || '',
          extractedVocabs: extractedVocabs || [],
          detectedErrors: errors,
          tokenUsage: {
            promptTokens: usage?.promptTokenCount || 0,
            candidatesTokens: usage?.candidatesTokenCount || 0,
          },
        };
      }
    } catch (e) {
      console.warn('Analysis error with model ' + currentModel, e);
    }
  }

  return { newLikes: [], newDislikes: [] };
}

/**
 * ユーザーの希望（「カフェの店員」「同年代のオーストラリア人サーファー」等）から
 * 完全なペルソナプロフィールを自動生成する
 */
export async function generateCustomPersona(params: {
  apiKey: string;
  model?: string;
  userPrompt?: string;
}): Promise<{
  persona: Persona;
  tokenUsage?: { promptTokens: number; candidatesTokens: number };
}> {
  const { apiKey, model = 'gemini-3.7-flash', userPrompt } = params;

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

  const contents: any[] = [];
  const recentHistory = history.slice(-10);
  for (const msg of recentHistory) {
    contents.push({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.text }],
    });
  }

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

/**
 * 単語・フレーズの文脈に即した自然な日本語訳をオンデマンドで取得
 */
export async function fetchContextualWordMeaning(
  word: string,
  contextSentence: string,
  apiKey: string,
  preferredModel?: string
): Promise<{ meaning: string; partOfSpeech?: string; tokenUsage?: { promptTokens: number; candidatesTokens: number } }> {
  if (!apiKey) {
    throw new Error('Gemini APIキーが設定されていません。');
  }

  const promptText = `あなたはプロの英語辞書編纂者兼英語講師です。
以下の英文におけるターゲット単語・フレーズ「${word}」の、**この文脈に完全に即した自然で簡潔な日本語訳（単語帳の見出し用）**を出力してください。
機械翻訳のような直訳や多義語の不自然な訳（例: pacedを「ペースのある」とする等）は避け、文脈で実際に意図されている生きた意味を端的に返してください。

【文】: "${contextSentence || word}"
【対象単語】: "${word}"

必ず以下のJSONフォーマットのみを出力してください：
{
  "meaning": "文脈に即した自然な日本語訳（例: （不安で）行ったり来たりした、予約する）",
  "partOfSpeech": "品詞（動詞、名詞、形容詞、句動詞など）"
}`;

  const candidateModels = preferredModel
    ? [preferredModel, 'gemini-3.5-flash-lite', 'gemini-3.7-flash', 'gemini-3.6-flash']
    : ['gemini-3.5-flash-lite', 'gemini-3.7-flash', 'gemini-3.6-flash'];

  for (const currentModel of candidateModels) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 120,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        const usage = data?.usageMetadata;
        if (rawText) {
          const parsed = JSON.parse(rawText.replace(/```json|```/g, '').trim());
          if (parsed?.meaning) {
            return {
              meaning: parsed.meaning.trim(),
              partOfSpeech: parsed.partOfSpeech?.trim(),
              tokenUsage: {
                promptTokens: usage?.promptTokenCount || 0,
                candidatesTokens: usage?.candidatesTokenCount || 0,
              },
            };
          }
        }
      }
    } catch (e) {
      console.warn(`fetchContextualWordMeaning error on ${currentModel}:`, e);
    }
  }

  throw new Error('文脈訳の取得に失敗しました');
}


/**
 * 難解文・選択文から2〜3個の核心文法・構文パターン仮説を構造化抽出
 */
export async function extractSentenceCorePatternsWithGemini(
  sentence: string,
  translation?: string,
  apiKey?: string,
  preferredModel?: string
): Promise<{ patterns: ExtractedCorePattern[]; tokenUsage?: { promptTokens: number; candidatesTokens: number } }> {
  if (!apiKey || !sentence.trim()) {
    return { patterns: [] };
  }

  const promptText = `あなたはプロの英語構文・文法指導者です。
以下の英文（および日本語訳）から、学習者が理解・スピーキングする上で鍵となる【核心の文法・構文パターン（2〜3個）】を抽出し、厳密なフォーマットで構造化してください。

【対象英文】: "${sentence}"
${translation ? `【日本語訳】: "${translation}"` : ''}

【要件】:
1. 曖昧な散文ではなく、S+V記号（S, V, O, C, [Adj], [Verb], that節 など）を用いた定型フォーマット「formula」を作成すること。
2. 該当する構文の日本語テンプレート（meaningTemplate）を「〜すぎて…できない」「Sは〜ということを…」のように作成すること。
3. 文中でその構文を構成している単語の配列「highlightTokens」を抽出すること。
4. なぜその訳になるのか、学習者が一瞬で納得できる急所解説（briefNote）を1行（30文字以内）で書くこと。
5. 必ず2〜3個のパターン仮説を配列で返すこと。

必ず以下のJSON配列フォーマットのみを出力してください：
[
  {
    "patternName": "構文・文法名 (例: too...to 構文 (結果・程度))",
    "formula": "S + be + too [Adj] + to [Verb]",
    "meaningTemplate": "Sはあまりに[Adj]なので[Verb]できない",
    "highlightTokens": ["too", "heavy", "to", "carry"],
    "briefNote": "too + 形容詞 + to不定詞 で否定の意味を含む"
  }
]`;

  const candidateModels = preferredModel
    ? [preferredModel, 'gemini-3.5-flash-lite', 'gemini-3.7-flash', 'gemini-3.6-flash']
    : ['gemini-3.5-flash-lite', 'gemini-3.7-flash', 'gemini-3.6-flash'];

  for (const currentModel of candidateModels) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 500,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        const usage = data?.usageMetadata;
        if (rawText) {
          const parsed = JSON.parse(rawText.replace(/```json|```/g, '').trim());
          if (Array.isArray(parsed) && parsed.length > 0) {
            const patterns: ExtractedCorePattern[] = parsed.map(p => ({
              patternName: String(p.patternName || '重要構文'),
              formula: String(p.formula || ''),
              meaningTemplate: String(p.meaningTemplate || ''),
              highlightTokens: Array.isArray(p.highlightTokens) ? p.highlightTokens.map(String) : [],
              briefNote: String(p.briefNote || ''),
            }));

            return {
              patterns,
              tokenUsage: {
                promptTokens: usage?.promptTokenCount || 0,
                candidatesTokens: usage?.candidatesTokenCount || 0,
              },
            };
          }
        }
      }
    } catch (e) {
      console.warn(`extractSentenceCorePatternsWithGemini error on ${currentModel}:`, e);
    }
  }

  return { patterns: [] };
}

// ===================== DRILL EVALUATION WITH GEMINI =====================

export interface EvaluateDrillParams {
  promptJa: string;
  targetItem: {
    id: string;
    name: string;
    meaning: string;
    focus: string;
    sampleSentences?: string[];
  };
  drillType: 'comprehension' | 'assembly';
  userAnswer: string;
  apiKey: string;
  model?: string;
}

export interface EvaluateDrillResult {
  result: 'correct' | 'alternative_hint' | 'wrong'; // 🟢 完全正解 / 🟡 別解誘導 / 🔴 不正解
  feedback: string;
  correctedSentence: string;
  errorReason?: string;
  tokenUsage?: { promptTokens: number; candidatesTokens: number };
}

/**
 * ドリルの解答を3段階でAI自動添削
 * 🟢 correct: ターゲット構文を使って正しく組み立てられた
 * 🟡 alternative_hint: 意味は通じるがターゲット構文を使っていない（ヒントを出してリトライ誘導）
 * 🔴 wrong: 英語として文法破綻、意味が通じない、または構文の誤用
 */
export async function evaluateDrillAnswerWithGemini(params: EvaluateDrillParams): Promise<EvaluateDrillResult> {
  const { promptJa, targetItem, drillType, userAnswer, apiKey, model = 'gemini-3.7-flash' } = params;

  if (!apiKey) {
    return {
      result: 'wrong',
      feedback: 'APIキーが設定されていません。',
      correctedSentence: targetItem.sampleSentences?.[0] || '',
    };
  }

  const systemInstruction = `あなたは日本人英語学習者のためのプロフェッショナルな英語添削AIです。
英語ドリル（1問1答）のユーザー回答を精緻かつ温かく判定してください。

【添削の絶対ルール】
1. 判定結果は以下の3値のいずれか1つ:
   - "correct" (完全正解): ユーザーの回答が自然な英語であり、かつ【ターゲット構文/表現】が正しく使われている。
   - "alternative_hint" (別解誘導・惜しい): 英語として意味は通じるが、【指定されたターゲット構文】を使っていない別の表現になっている（例: "it sounds..." を狙っているのに "it looks like..." と答えた、"used to" を狙っているのに "I lived here before" と答えた等）。❌ にせず、「意味は通じますが、今回は【${targetItem.name}】を使って組み立ててみましょう！」と前向きに再入力を促すフィードバックを作成してください。
   - "wrong" (不正解): 明らかな文法エラー、意味の破綻、語順の誤り、またはターゲット構文の致命的な誤用。
2. feedback: 2〜3文で、親切かつ要点を突いた日本語解説。
3. correctedSentence: ターゲット構文を用いた、最も自然で簡潔な模範英文。
4. errorReason: 不正解または別解の場合の短い理由タグ（例: "過去形の不一致", "ターゲット構文未使用", "前置詞ミス"）。

【必ず守る出力フォーマット】
以下の純粋なJSONオブジェクトのみを出力してください（Markdownコードブロックは不要、前後に余計な説明文を含めないこと）:
{
  "result": "correct" | "alternative_hint" | "wrong",
  "feedback": "...",
  "correctedSentence": "...",
  "errorReason": "..."
}`;

  const promptText = `【ドリル種別】: ${drillType === 'assembly' ? '✍️ 組立（日本語 ➔ 瞬間英作文）' : '📖 理解（読解・意味取り）'}
【お題（日本語）】: ${promptJa}
【ターゲット構文/表現】: ${targetItem.name}
【構文の狙い・公式】: ${targetItem.focus} (${targetItem.meaning})
${targetItem.sampleSentences && targetItem.sampleSentences.length > 0 ? `【参考模範例】: ${targetItem.sampleSentences.join(' / ')}` : ''}
【ユーザーの回答】: ${userAnswer.trim()}

上記を厳密に判定し、指定のJSON形式で返してください。`;

  const candidateModels = Array.from(new Set([model, ...FALLBACK_MODELS]));

  for (const currentModel of candidateModels) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: 'user', parts: [{ text: promptText }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const usage = data.usageMetadata ? {
        promptTokens: data.usageMetadata.promptTokenCount || 0,
        candidatesTokens: data.usageMetadata.candidatesTokenCount || 0,
      } : undefined;

      const cleaned = rawText.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
      const parsed = JSON.parse(cleaned);

      return {
        result: parsed.result === 'correct' || parsed.result === 'alternative_hint' ? parsed.result : 'wrong',
        feedback: parsed.feedback || '添削完了',
        correctedSentence: parsed.correctedSentence || targetItem.sampleSentences?.[0] || '',
        errorReason: parsed.errorReason,
        tokenUsage: usage,
      };
    } catch (err) {
      console.warn(`evaluateDrillAnswerWithGemini failed with ${currentModel}:`, err);
    }
  }

  return {
    result: 'wrong',
    feedback: '添削処理中にエラーが発生しました。もう一度お試しください。',
    correctedSentence: targetItem.sampleSentences?.[0] || '',
  };
}

// ===================== RALLY & ARSENAL SPARRING PARTNER =====================

export interface RallyPartnerParams {
  userText: string;
  topicPrompt?: string;
  history: { role: 'user' | 'assistant'; text: string }[];
  apiKey: string;
  model?: string;
}

export interface RallyPartnerFeedback {
  hasCorrection: boolean;
  userOriginalText: string;
  grammarFix: string;        // 🔧 最小限の文法修正 (Tier 1)
  naturalExpression: string; // ✨ 洗練されたネイティブ表現 (Tier 2)
  explanation: string;       // 日本語の簡潔な解説
}

export interface RallySuggestionChip {
  text: string;    // 英語の回答切り口
  labelJa: string; // 日本語の要約
}

export interface RallyPartnerResult {
  reaction: string;         // 英語の共感・相槌 (1〜2文)
  nextQuestion: string;     // 次の質問 (1文)
  nextQuestionJa: string;   // 次の質問の日本語訳
  feedback?: RallyPartnerFeedback;
  suggestionChips: RallySuggestionChip[];
  tokenUsage?: { promptTokens: number; candidatesTokens: number };
}

/**
 * 瞬間ラリー特訓（スパーリング＆即時武器化）対話AI
 */
export async function chatWithRallyPartner(params: RallyPartnerParams): Promise<RallyPartnerResult> {
  const { userText, topicPrompt = '日常のカジュアルな雑談', history, apiKey, model = 'gemini-3.7-flash' } = params;

  if (!apiKey) {
    return {
      reaction: 'API key is not configured.',
      nextQuestion: 'Please set your Gemini API key in settings.',
      nextQuestionJa: '設定画面からGemini APIキーを入力してください。',
      suggestionChips: [],
    };
  }

  const systemInstruction = `You are "Rally Bot", an energetic, conversational English sparring partner and immediate fluency coach.
Your goal is to keep an engaging, fast-paced conversational rally with the learner while helping them immediately "weaponize" any unsaid or awkward English into useful sentences.

【CURRENT CONVERSATION TOPIC / SCENARIO】
"${topicPrompt}"

【CORE INTERACTION RULES】
1. USER IS HERE TO PRACTICE RESPONDING:
   - Always keep your conversational reaction short and punchy (1 to 2 casual sentences).
   - Always end with ONE engaging, relevant follow-up question that drives the topic forward.
   - Do NOT give long lectures in your conversational speech.

2. TWO-TIER FEEDBACK (VERY IMPORTANT):
   Analyze the user's latest input:
   - If the user wrote in Japanese (because they didn't know how to say it in English), treat "hasCorrection" as true. Provide:
     • grammarFix: A clear, correct direct English translation.
     • naturalExpression: A super natural, idiomatic native expression.
     • explanation: "日本語でおっしゃった内容を英語化しました。"
   - If the user wrote in English:
     • If it has fatal grammar errors (tense, missing preposition, wrong auxiliary, subject-verb agreement):
       - grammarFix: Fix ONLY the fatal grammar mistakes while keeping the user's exact words and structure as intact as possible.
       - naturalExpression: Provide how a native speaker would naturally/casually say this idea.
       - explanation: 1-2 friendly Japanese sentences explaining the exact fix.
     • If their English is already 100% natural and error-free:
       - hasCorrection: false.
       - grammarFix & naturalExpression can be the user's sentence or a cool synonym.

3. 3 SUGGESTION CHIPS (カンペ候補):
   Generate 3 diverse, natural ways the user could reply to your nextQuestion:
   - 1 positive / enthusiastic angle
   - 1 nuanced / alternative / negative angle
   - 1 counter-question or playful angle
   Each chip MUST have:
   - "text": Natural English sentence (e.g. "Honestly, I'd probably go for...")
   - "labelJa": Short Japanese summary (e.g. "正直〜を選ぶと答える")

【STRICT JSON OUTPUT FORMAT】
Return ONLY a pure JSON object:
{
  "reaction": "...",
  "nextQuestion": "...",
  "nextQuestionJa": "...",
  "feedback": {
    "hasCorrection": true | false,
    "userOriginalText": "...",
    "grammarFix": "...",
    "naturalExpression": "...",
    "explanation": "..."
  },
  "suggestionChips": [
    { "text": "...", "labelJa": "..." },
    { "text": "...", "labelJa": "..." },
    { "text": "...", "labelJa": "..." }
  ]
}`;

  const formattedHistory = history.slice(-8).map(h => ({
    role: h.role === 'user' ? 'user' : 'model',
    parts: [{ text: h.text }],
  }));

  const contents = [
    ...formattedHistory,
    {
      role: 'user',
      parts: [{ text: userText.trim() }],
    },
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
          contents,
          generationConfig: {
            temperature: 0.4,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const usage = data.usageMetadata ? {
        promptTokens: data.usageMetadata.promptTokenCount || 0,
        candidatesTokens: data.usageMetadata.candidatesTokenCount || 0,
      } : undefined;

      const cleaned = rawText.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
      const parsed = JSON.parse(cleaned);

      return {
        reaction: parsed.reaction || 'Got it!',
        nextQuestion: parsed.nextQuestion || 'What do you think?',
        nextQuestionJa: parsed.nextQuestionJa || 'あなたはどう思いますか？',
        feedback: parsed.feedback ? {
          hasCorrection: Boolean(parsed.feedback.hasCorrection),
          userOriginalText: parsed.feedback.userOriginalText || userText,
          grammarFix: parsed.feedback.grammarFix || userText,
          naturalExpression: parsed.feedback.naturalExpression || parsed.feedback.grammarFix || userText,
          explanation: parsed.feedback.explanation || '',
        } : undefined,
        suggestionChips: Array.isArray(parsed.suggestionChips) ? parsed.suggestionChips : [],
        tokenUsage: usage,
      };
    } catch (err) {
      console.warn(`chatWithRallyPartner failed with ${currentModel}:`, err);
    }
  }

  return {
    reaction: 'Thanks for sharing!',
    nextQuestion: 'Could you tell me a little more about that?',
    nextQuestionJa: 'それについてもう少し詳しく教えてもらえますか？',
    suggestionChips: [],
  };
}
