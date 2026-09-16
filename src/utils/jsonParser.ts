import { StoryGenerationResponse } from '../types/story';

/**
 * Geminiから返却されたストーリーJSONを極めて堅牢にパースするユーティリティ
 */
export function parseRobustStoryJson(rawText: string): StoryGenerationResponse {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('JSONテキストが空です。');
  }

  let clean = rawText.trim();

  // 1. Markdownコードブロックの除去
  if (clean.startsWith('```json')) {
    clean = clean.replace(/^```json\s*/, '').replace(/```\s*$/, '');
  } else if (clean.startsWith('```')) {
    clean = clean.replace(/^```\s*/, '').replace(/```\s*$/, '');
  }

  // 2. 最も外側の波括弧を探す
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace !== -1) {
    if (lastBrace !== -1 && lastBrace > firstBrace) {
      clean = clean.substring(firstBrace, lastBrace + 1);
    } else {
      clean = clean.substring(firstBrace);
    }
  }

  // 3. 標準の JSON.parse
  try {
    const parsed = JSON.parse(clean);
    return normalizeStoryResponse(parsed);
  } catch (initialErr) {
    console.warn('Direct JSON.parse failed, attempting repair...', initialErr);
  }

  // 4. トラブルシューティング & 修復処理
  try {
    let repaired = clean;

    // 末尾カンマの除去 (例: , } や , ])
    repaired = repaired.replace(/,\s*([}\]])/g, '$1');

    // 途中で切れた不完全JSON（トークンリミット等）の補完
    if (!repaired.endsWith('}')) {
      const openBraces = (repaired.match(/{/g) || []).length;
      const closeBraces = (repaired.match(/}/g) || []).length;
      const openQuotes = (repaired.match(/"/g) || []).length;
      
      if (openQuotes % 2 !== 0) {
        repaired += '"';
      }
      for (let i = 0; i < openBraces - closeBraces; i++) {
        repaired += '}';
      }
    }

    const parsed = JSON.parse(repaired);
    return normalizeStoryResponse(parsed);
  } catch (repairErr) {
    console.warn('Basic repair failed, attempting control-character & string repair...', repairErr);
  }

  // 5. 文字列内部の改行エスケープ修復
  try {
    const repairedStrings = repairUnescapedNewlinesInJson(clean);
    const parsed = JSON.parse(repairedStrings);
    return normalizeStoryResponse(parsed);
  } catch (strRepairErr) {
    console.warn('String repair failed, falling back to regex extraction...', strRepairErr);
  }

  // 6. 正規表現によるフィールド個別抽出（最強フォールバック）
  try {
    const parsed = extractFieldsByRegex(clean);
    if (parsed.story || parsed.title) {
      return normalizeStoryResponse(parsed);
    }
  } catch (regexErr) {
    console.error('Regex JSON recovery failed', regexErr);
  }

  throw new Error('ストーリーJSONのパースに失敗しました。AIの出力を解析できませんでした。');
}

/**
 * JSON文字列リテラル内部の未エスケープ改行を安全に \n に置換
 */
function repairUnescapedNewlinesInJson(jsonStr: string): string {
  let result = '';
  let inString = false;
  let isEscaped = false;

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];

    if (char === '"' && !isEscaped) {
      inString = !inString;
      result += char;
    } else if (inString) {
      if (char === '\\') {
        isEscaped = !isEscaped;
        result += char;
      } else {
        if (char === '\n') {
          result += '\\n';
        } else if (char === '\r') {
          result += '\\r';
        } else if (char === '\t') {
          result += '\\t';
        } else {
          result += char;
        }
        isEscaped = false;
      }
    } else {
      result += char;
      isEscaped = false;
    }
  }

  return result;
}

function normalizeStoryResponse(data: any): StoryGenerationResponse {
  return {
    title: data.title || data.title_en || 'Untitled Story',
    title_ja: data.title_ja || data.titleJa || '無題のストーリー',
    summary: data.summary || data.synopsis || '概要なし',
    story: data.story || data.content || data.storyContent || '',
    japanese_translation: data.japanese_translation || data.japaneseTranslation || data.translation || '',
    target_vocab_used: Array.isArray(data.target_vocab_used) ? data.target_vocab_used : (Array.isArray(data.target_vocabs) ? data.target_vocabs : []),
    genres: Array.isArray(data.genres) ? data.genres : (data.genre ? [data.genre] : ['General']),
    vocabulary_list: Array.isArray(data.vocabulary_list) ? data.vocabulary_list : undefined,
    target_embeddings: Array.isArray(data.target_embeddings) ? data.target_embeddings : undefined,
  };
}

function extractFieldsByRegex(text: string): Partial<StoryGenerationResponse> {
  const result: Partial<StoryGenerationResponse> = {};

  const extractString = (key: string): string => {
    // 柔軟なキー探索
    const patterns = [
      new RegExp(`"${key}"\\s*:\\s*"([\\s\\S]*?)(?="\\s*,\\s*"[a-zA-Z_]+"|"\\s*})`),
      new RegExp(`"${key}"\\s*:\\s*"([\\s\\S]*?)$`),
    ];

    for (const pat of patterns) {
      const match = text.match(pat);
      if (match && match[1]) {
        return match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
      }
    }
    return '';
  };

  result.title = extractString('title');
  result.title_ja = extractString('title_ja');
  result.summary = extractString('summary');
  result.story = extractString('story');
  result.japanese_translation = extractString('japanese_translation');

  return result;
}

export function buildExternalPromptTemplate(cefrLevel: string, targetVocabs: string[], genre = 'おまかせ', wordCount = 700): string {
  let prompt = `以下の要件に従って、英語学習者向けのショートストーリーを【JSON形式のみ】で作成してください。\n\n`;
  prompt += `【英語難易度レベル】: ${cefrLevel} (CEFR)\n`;
  prompt += `【希望ジャンル】: ${genre} (例: Adventure, Daily Life, Mystery, Sci-Fi, Comedy, Romance 等)\n`;
  prompt += `【★本文の目標単語数】: 約 ${wordCount} 語（words）\n\n`;

  if (targetVocabs.length > 0) {
    prompt += `【復習対象の重要表現・構文（物語の中に自然に応用して登場させてください）】:\n`;
    targetVocabs.forEach((v, i) => {
      prompt += `${i + 1}. ${v}\n`;
    });
    prompt += `\n`;
  }

  prompt += `【要件】:
1. 英語本文（story）は約 ${wordCount} 語で読みやすく適切な段落（改行）を入れてください。セリフ等でダブルクォートを使う場合は必ず JSON エスケープ (\\") するか、シングルクォート (‘ ’) を使用してください。
2. 日本語のあらすじ（summary）は、結末やオチのネタバレを絶対に書かず、導入・設定の紹介（1〜2文）のみを記述してください。
3. 日本語対訳（japanese_translation）を付与してください。
4. genres には該当するジャンル名（例: ["Adventure", "Daily Life"]）を含めてください。

必ず以下のJSONスキーマの通りに出力してください（前後の説明文は不要です）。
\`\`\`json
{
  "title": "英語のタイトル",
  "title_ja": "日本語のタイトル",
  "genres": ["${genre !== 'おまかせ' ? genre : 'Adventure'}", "Daily Life"],
  "summary": "日本語での1-2文のあらすじ・シチュエーション概要（ネタバレ厳禁）",
  "story": "英語の物語本文 (約${wordCount}語)",
  "japanese_translation": "物語全体の自然な日本語訳",
  "target_vocab_used": ["実際に物語で使ったターゲット表現"]
}
\`\`\``;

  return prompt;
}
