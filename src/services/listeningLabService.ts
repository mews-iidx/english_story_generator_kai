import { CefrLevel } from '../types/settings';
import {
  LabQuestion,
  LabChunk,
  LabDiagnosisResult,
  LabQuestionRecord,
  LabSessionSummary,
  LabAnalyticsSummary,
  BandwidthMatrixData,
  LabBottleneckType
} from '../types/listeningLab';
import { LiveLogger } from './liveLogger';

const STORAGE_KEY = 'compile_eng_listening_lab_records';
const FALLBACK_MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.0-flash-lite', 'gemini-3.7-flash'];

export interface GenerateLabBatchParams {
  wordCount: number; // 4, 6, 8, 12, 16, 20
  speedWpm: number;
  count?: number; // default 5
  cefrLevel?: CefrLevel;
  apiKey: string;
  model?: string;
}

export interface DiagnoseUserResponseParams {
  question: LabQuestion;
  userResponse: string;
  speedWpm: number;
  wordCount: number;
  apiKey: string;
  model?: string;
}

const SITUATION_SEEDS = [
  '💻 職場・IT・PCトラブル（Wi-Fiが切れた、メールの返信、締め切り、会議、PCの再起動）',
  '🍳 料理・食事・グルメ（新しいレシピ、夕食の準備、美味しいデザート、お弁当、味付け）',
  '🐕 ペット・動物（犬の散歩、猫の昼寝、動物病院、可愛い仕草、餌やり）',
  '📱 スマホ・SNS・買い物（バッテリー残量、ネット通販の荷物、写真の共有、アプリの通知）',
  '🎬 映画・音楽・エンタメ（おすすめの映画、ライブ、ゲームの新作、読書、ギターの練習）',
  '🏃‍♂️ 健康・運動・睡眠（ジョギング、昨夜の睡眠不足、ジム、水分補給、ストレッチ）',
  '🚗 移動・交通・街歩き（渋滞、買い出し、スーパーのセール、公園のベンチ、自転車のパンク）',
  '🌤️ 天気・週末の過ごし方（急な夕立、気持ちいい晴天、ピクニック、家で映画鑑賞）',
  '🤝 友達・家族との日常（週末の約束、久しぶりの再会、サプライズプレゼント、感謝の言葉）',
  '🏠 家事・部屋の片付け（掃除機の故障、部屋の模様替え、洗濯物が乾かない、ゴミ出し）',
  '🎒 学び・新しい挑戦（新しいスキルの練習、英会話の練習、図書館で勉強、資格試験）',
  '☕ カフェ・リラックス（お気に入りの席、本を読みながら休憩、テラス席での雑談）',
];

// Protected multi-word collocations & catenatives (never split inside these)
const PROTECTED_PATTERNS: RegExp[] = [
  // Catenative / Semi-modals + to
  /\b(?:want|wants|wanted|going|have|has|had|need|needs|needed|try|tries|tried|like|likes|liked|plan|plans|planned|used|ought|able|decided|decides|decide|hope|hopes|hoped|love|loves|loved|start|starts|started|begin|begins|began|prefer|prefers|preferred|wish|wishes|wished|learn|learns|learned|forget|forgets|forgot|remember|remembers|remembered|afford|affords|afforded|expect|expects|expected|manage|manages|managed|refuse|refuses|refused|seem|seems|seemed|appear|appears|appeared|continue|continues|continued)\s+to\b/gi,
  /\bwould\s+like\s+to\b/gi,
  /\bin\s+order\s+to\b/gi,
  /\bso\s+as\s+to\b/gi,
  // Phrasal verbs / Verb + preposition collocations
  /\b(?:talk|talks|talked|talking)\s+(?:about|to|with)\b/gi,
  /\b(?:speak|speaks|spoke|speaking)\s+(?:to|with|about)\b/gi,
  /\b(?:look|looks|looked|looking)\s+(?:at|for|after|forward\s+to|into|up\s+to|down\s+on)\b/gi,
  /\b(?:listen|listens|listened|listening)\s+to\b/gi,
  /\b(?:wait|waits|waited|waiting)\s+for\b/gi,
  /\b(?:depend|depends|depended|depending)\s+on\b/gi,
  /\b(?:rely|relies|relied|relying)\s+on\b/gi,
  /\b(?:think|thinks|thought|thinking)\s+(?:about|of)\b/gi,
  /\b(?:worry|worries|worried|worrying)\s+about\b/gi,
  /\b(?:care|cares|cared|caring)\s+(?:about|for)\b/gi,
  /\b(?:agree|agrees|agreed|agreeing)\s+with\b/gi,
  /\b(?:belong|belongs|belonged|belonging)\s+to\b/gi,
  /\b(?:pay|pays|paid|paying)\s+for\b/gi,
  /\b(?:ask|asks|asked|asking)\s+(?:for|about)\b/gi,
  /\b(?:search|searches|searched|searching)\s+for\b/gi,
  /\b(?:work|works|worked|working)\s+(?:on|with|for|at)\b/gi,
  /\b(?:focus|focuses|focused|focusing)\s+on\b/gi,
  /\b(?:deal|deals|dealt|dealing)\s+with\b/gi,
  /\b(?:believe|believes|believed|believing)\s+in\b/gi,
  /\b(?:give|gives|gave|giving)\s+up\b/gi,
  /\b(?:take|takes|took|taking)\s+care\s+of\b/gi,
  /\b(?:run|runs|ran|running)\s+out\s+of\b/gi,
  // Fixed idiomatic connectors
  /\bas\s+well\s+as\b/gi,
  /\bin\s+front\s+of\b/gi,
  /\bat\s+the\s+same\s+time\b/gi,
  /\bby\s+the\s+way\b/gi,
  /\bas\s+soon\s+as\b/gi,
  /\bon\s+the\s+other\s+hand\b/gi,
  /\bfor\s+example\b/gi,
  /\bsuch\s+as\b/gi,
  /\baccording\s+to\b/gi,
  /\ba\s+lot\s+of\b/gi,
  /\blots\s+of\b/gi,
  /\ba\s+bit\s+of\b/gi,
];

const CLAUSE_CONNECTORS = new Set([
  'because', 'although', 'even though', 'though', 'since', 'while', 'whereas',
  'if', 'unless', 'whether',
  'when', 'whenever', 'after', 'before', 'until', 'as soon as',
  'that', 'which', 'who', 'whom', 'whose', 'where',
  'and', 'but', 'so', 'yet', 'or'
]);

/**
 * 英語音声学・TESOL標準の「Thought Group（思考の塊）」ルールに基づき英文を自然に分割
 */
export function splitIntoSmartChunks(sentenceEn: string, translationJa: string = ''): LabChunk[] {
  const cleanEn = sentenceEn.trim().replace(/[.?!]+$/, '');
  if (!cleanEn) return [];

  const words = cleanEn.split(/\s+/).filter(Boolean);

  // 短文（8語以下）は分断せず1つの完結したThought Groupとして保持
  if (words.length <= 8) {
    return [
      {
        text: cleanEn,
        translationJa: translationJa || cleanEn,
        boundaryReason: '基本の骨格（1つの完結したThought Group）',
      },
    ];
  }

  // 1. 保護対象のイディオム・定型句スパン（want to, look forward to 等）を特定
  const protectedSpans: { start: number; end: number }[] = [];
  for (const pattern of PROTECTED_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(cleanEn)) !== null) {
      protectedSpans.push({ start: match.index, end: match.index + match[0].length });
    }
  }

  const isCharIndexProtected = (charIdx: number) => {
    return protectedSpans.some(span => charIdx >= span.start && charIdx <= span.end);
  };

  // 単語の位置をインデックス化
  const wordSpans: { word: string; start: number; end: number }[] = [];
  let curr = 0;
  for (const w of words) {
    const idx = cleanEn.indexOf(w, curr);
    if (idx !== -1) {
      wordSpans.push({ word: w, start: idx, end: idx + w.length });
      curr = idx + w.length;
    } else {
      wordSpans.push({ word: w, start: curr, end: curr + w.length });
      curr += w.length + 1;
    }
  }

  const splitIndices = new Set<number>();

  // Pass 1: 句読点（カンマ `,`、セミコロン `;`、ダッシュ等）での自然な境界
  for (let i = 0; i < words.length - 1; i++) {
    const w = words[i];
    if (/[,;:\-—]$/.test(w)) {
      if (i >= 2 && words.length - (i + 1) >= 2) {
        splitIndices.add(i + 1);
      }
    }
  }

  // Pass 2: 節の接続詞（because, when, although, that, which 等）
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    const cleanW = w.replace(/[^a-zA-Z]/g, '').toLowerCase();

    let twoWord = '';
    if (i + 1 < words.length) {
      twoWord = cleanW + ' ' + words[i + 1].replace(/[^a-zA-Z]/g, '').toLowerCase();
    }

    const isConnector = CLAUSE_CONNECTORS.has(cleanW) || CLAUSE_CONNECTORS.has(twoWord);
    if (isConnector) {
      const wStart = wordSpans[i]?.start ?? 0;
      if (!isCharIndexProtected(wStart)) {
        const sortedSoFar = Array.from(splitIndices).filter(idx => idx <= i);
        const prevSplit = sortedSoFar.length > 0 ? Math.max(...sortedSoFar) : 0;
        const wordsInCurrent = i - prevSplit;
        const wordsRemaining = words.length - i;
        if (wordsInCurrent >= 3 && wordsRemaining >= 3) {
          splitIndices.add(i);
        }
      }
    }
  }

  // Pass 3: 前置詞（非常に長いセグメント >= 8語 が残っている場合のみ補助分割）
  const sortedSplits = Array.from(splitIndices).sort((a, b) => a - b);
  const allSplits = [0, ...sortedSplits, words.length];
  const prepositions = new Set(['in', 'at', 'on', 'with', 'for', 'from', 'by', 'during', 'under', 'near']);

  for (let idxRange = 0; idxRange < allSplits.length - 1; idxRange++) {
    const startW = allSplits[idxRange];
    const endW = allSplits[idxRange + 1];
    const segmentLen = endW - startW;

    if (segmentLen >= 8) {
      for (let i = startW + 3; i <= endW - 3; i++) {
        const cleanW = words[i].replace(/[^a-zA-Z]/g, '').toLowerCase();
        if (prepositions.has(cleanW)) {
          const wStart = wordSpans[i]?.start ?? 0;
          if (!isCharIndexProtected(wStart)) {
            splitIndices.add(i);
            break;
          }
        }
      }
    }
  }

  // 最終的なチャンクの構築
  const finalSortedSplits = Array.from(splitIndices).sort((a, b) => a - b);
  const rawChunks: string[] = [];
  let prevIdx = 0;

  for (const splitIdx of finalSortedSplits) {
    const chunkWords = words.slice(prevIdx, splitIdx);
    if (chunkWords.length > 0) {
      rawChunks.push(chunkWords.join(' '));
    }
    prevIdx = splitIdx;
  }

  const remainingWords = words.slice(prevIdx);
  if (remainingWords.length > 0) {
    rawChunks.push(remainingWords.join(' '));
  }

  // 極端に短いチャンク（3語未満）を前方に統合
  const mergedChunks: string[] = [];
  for (const c of rawChunks) {
    const cWords = c.split(/\s+/).filter(Boolean);
    if (cWords.length < 3 && mergedChunks.length > 0) {
      mergedChunks[mergedChunks.length - 1] = mergedChunks[mergedChunks.length - 1] + ' ' + c;
    } else {
      mergedChunks.push(c);
    }
  }

  return mergedChunks.map((c, idx) => {
    const firstWord = c.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '') || '';
    let reason = '主部＋動詞・骨格（Thought Group）';
    if (idx > 0) {
      if (['because', 'since', 'so', 'although', 'though'].includes(firstWord)) {
        reason = '理由・譲歩節（Thought Group）';
      } else if (['when', 'while', 'after', 'before', 'until'].includes(firstWord)) {
        reason = '時間・タイミング節（Thought Group）';
      } else if (['that', 'which', 'who', 'where'].includes(firstWord)) {
        reason = '関係節・補足（Thought Group）';
      } else if (['in', 'at', 'on', 'with', 'for', 'from', 'by', 'under'].includes(firstWord)) {
        reason = '前置詞句・付加情報（Thought Group）';
      } else {
        reason = '展開・修飾句（Thought Group）';
      }
    }

    return {
      text: c,
      translationJa: idx === 0 ? (translationJa.slice(0, 20) || c) : '…',
      boundaryReason: reason,
    };
  });
}

export async function generateLabBatch(params: GenerateLabBatchParams): Promise<LabQuestion[]> {
  const {
    wordCount,
    speedWpm,
    count = 5,
    cefrLevel = 'A2',
    apiKey,
    model = 'gemini-2.0-flash',
  } = params;

  if (!apiKey) {
    return getFallbackBatch(wordCount, count, cefrLevel);
  }

  // シャッフルして5つの異なるシチュエーションを抽出
  const shuffledSeeds = [...SITUATION_SEEDS].sort(() => Math.random() - 0.5);
  const selectedSituations = shuffledSeeds.slice(0, count);

  const situationPrompts = selectedSituations
    .map((s, idx) => `  - ${idx + 1}問目の場面: ${s}`)
    .join('\n');

  const systemInstruction = `あなたは第二言語習得論（SLA）およびリスニング認知負荷トレーニングの専門家です。
リスニングの「ワーキングメモリ（脳内バッファ）限界測定＆チャンク即時パッキング訓練」のために、指定された【単語数（${wordCount}単語程度）】に厳密に合わせた、自然で生き生きとしたネイティブの日常会話短文を【${count}問】作成してください。

【絶対ルール】
1. 各英文の単語数は、目標単語数【${wordCount}単語】（±1語以内）に厳密に一致させてください。
2. 5問はすべて全く異なるシチュエーション、異なる主語（I, You, She, He, We, My friend, The dog など）、異なる動詞を用いて作成してください。
3. 【禁止事項】「駅への行き方 (way to the station)」「傘を忘れた (forgot umbrella/milk)」「コーヒーを飲む (drink coffee)」「日本を訪れる (planning to visit Japan)」のようなステレオタイプな教科書フレーズは絶対に避け、現代の多様な生活シーンから作成してください。
4. 英文は生きたカジュアルな日常会話・口語表現にしてください。
5. 日本語訳（translationJa）は、自然で正確な日本語にしてください。
6. 【超重要: チャンク分割（chunks）】
   学習者が全文キャッシュ癖（最後まで聞いてから訳す癖）から脱却できるよう、英文を「意味の塊（チャンク・Thought Group）」に2〜4分割し、各チャンクの【直読直解の日本語訳】と【なぜここで切れるのかの文法シグナル（boundaryReason）】を付与してください。
   例:
   - text: "The doctor called me" / translationJa: "医者が私に電話してきた" / boundaryReason: "主部＋動詞（誰がどうした・文の基本骨格）"
   - text: "about the test results" / translationJa: "検査結果について" / boundaryReason: "前置詞「about」（対象・内容の追加）"
   - text: "early this morning" / translationJa: "今朝早くに" / boundaryReason: "時の副詞句（時間情報の追加）"

【必ず守る出力フォーマット（純粋なJSON配列のみ）】:
[
  {
    "sentenceEn": "...",
    "translationJa": "...",
    "wordCount": ${wordCount},
    "keyPoints": "...",
    "chunks": [
      {
        "text": "...",
        "translationJa": "...",
        "boundaryReason": "..."
      }
    ]
  }
]`;

  const promptText = `【難易度】: CEFR ${cefrLevel}
【目標単語数】: 1文あたり約 ${wordCount} 単語
【生成問題数】: ${count} 問
【想定再生速度】: ${speedWpm} WPM

【各問の割り当てシチュエーション（必ずこのテーマに沿って作成）】:
${situationPrompts}

上記条件に合致する、重複のない多彩なリスニング出題用英文とチャンク分割データをJSON配列で生成してください。`;

  const candidateModels = Array.from(new Set([model, ...FALLBACK_MODELS])).filter(Boolean);

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
            temperature: 0.95,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const cleaned = rawText.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
      const parsed = JSON.parse(cleaned);

      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((item: any, idx: number): LabQuestion => {
          const words = (item.sentenceEn || '')
            .trim()
            .split(/\s+/)
            .filter((w: string) => w.length > 0);

          let chunks: LabChunk[] = [];
          if (Array.isArray(item.chunks) && item.chunks.length > 0) {
            chunks = item.chunks.map((c: any) => ({
              text: c.text || '',
              translationJa: c.translationJa || '',
              boundaryReason: c.boundaryReason || '意味のまとまり',
            }));
          } else {
            chunks = splitIntoSmartChunks(item.sentenceEn || '', item.translationJa || '');
          }

          return {
            id: `lab_q_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 6)}`,
            sentenceEn: item.sentenceEn || '',
            translationJa: item.translationJa || '',
            wordCount: words.length,
            words,
            chunks,
            cefrLevel,
            keyPoints: item.keyPoints || '',
          };
        });
      }
    } catch (err: any) {
      LiveLogger.warn('quiz_drill', 'LAB_GEN_ERROR', `Model ${currentModel} failed for lab generation`, {
        error: String(err),
      });
    }
  }

  return getFallbackBatch(wordCount, count, cefrLevel);
}

function getFallbackBatch(_wordCount: number, count: number, cefrLevel: CefrLevel): LabQuestion[] {
  const bank: { en: string; ja: string; chunks: LabChunk[] }[] = [
    {
      en: 'The doctor called me about the test results early this morning.',
      ja: '今朝早く、医師が検査結果について私に電話をかけてきました。',
      chunks: [
        { text: 'The doctor called me', translationJa: '医師が私に電話をかけてきた', boundaryReason: '主部＋動詞（誰がどうした・文の基本骨格）' },
        { text: 'about the test results', translationJa: '検査結果について', boundaryReason: '前置詞「about」（対象・内容の追加）' },
        { text: 'early this morning', translationJa: '今朝早くに', boundaryReason: '時の副詞句（時間情報の追加）' },
      ]
    },
    {
      en: 'I need to finish my work before leaving the office today.',
      ja: '私は今日オフィスを出る前に仕事を終わらせる必要があります。',
      chunks: [
        { text: 'I need to finish my work', translationJa: '仕事を終わらせる必要がある', boundaryReason: '主部＋動詞＋目的語（基本骨格）' },
        { text: 'before leaving the office', translationJa: 'オフィスを出る前に', boundaryReason: '前置詞句（時間的タイミング）' },
        { text: 'today', translationJa: '今日', boundaryReason: '時の副詞（時間情報の確定）' },
      ]
    },
    {
      en: 'She bought a warm cup of coffee from the nearby shop.',
      ja: '彼女は近くの店で温かいコーヒーを一杯買いました。',
      chunks: [
        { text: 'She bought a warm cup of coffee', translationJa: '彼女は温かいコーヒーを一杯買った', boundaryReason: '主部＋動詞＋目的語（基本骨格）' },
        { text: 'from the nearby shop', translationJa: '近くの店から', boundaryReason: '前置詞「from」（場所・起点の追加）' },
      ]
    },
    {
      en: 'We should definitely try that new Italian restaurant this weekend.',
      ja: '私たちは今週末、あの新しいイタリア料理店に絶対行くべきです。',
      chunks: [
        { text: 'We should definitely try', translationJa: '私たちは絶対試すべきだ', boundaryReason: '主部＋助動詞＋動詞（意図の表明）' },
        { text: 'that new Italian restaurant', translationJa: 'あの新しいイタリア料理店を', boundaryReason: '目的語（対象の明示）' },
        { text: 'this weekend', translationJa: '今週末に', boundaryReason: '時の副詞句（時間情報の確定）' },
      ]
    },
    {
      en: 'He always listens to soft music while studying in his room.',
      ja: '彼は部屋で勉強しているとき、いつも静かな音楽を聴きます。',
      chunks: [
        { text: 'He always listens to soft music', translationJa: '彼はいつも静かな音楽を聴く', boundaryReason: '主部＋動詞＋目的語（基本骨格）' },
        { text: 'while studying', translationJa: '勉強している間', boundaryReason: '接続詞「while」（状況・タイミング）' },
        { text: 'in his room', translationJa: '自分の部屋で', boundaryReason: '前置詞「in」（場所の追加）' },
      ]
    },
  ];

  return bank.slice(0, count).map((item, idx) => {
    const words = item.en.split(/\s+/);
    return {
      id: `lab_fb_${Date.now()}_${idx}`,
      sentenceEn: item.en,
      translationJa: item.ja,
      wordCount: words.length,
      words,
      chunks: item.chunks,
      cefrLevel,
    };
  });
}

// ===================== DIAGNOSIS ENGINE =====================

export async function diagnoseUserResponse(params: DiagnoseUserResponseParams): Promise<LabDiagnosisResult> {
  const { question, userResponse, speedWpm, wordCount, apiKey, model = 'gemini-2.0-flash' } = params;

  if (!apiKey) {
    return getSimpleFallbackDiagnosis(question, userResponse);
  }

  const systemInstruction = `あなたは英語リスニングの脳内認知プロセス（第二言語習得・ワーキングメモリ・チャンキング）を精密に診断する専門アナリストです。
学習者は出題英文を音声で聞き、聞き取れた内容や分からなかった理由を自由に入力しました。

学習者の入力内容と正解の英文を比較し、以下の項目を正確かつ温かく分析してください：
1. comprehensionRate: 理解度スコア（0〜100の整数）。
   - 意味が完全に取れていれば 100
   - 前半など一部だけ聞き取れていれば 40〜80
   - ほぼ聞き取れず推測も外れていれば 0〜30
2. understood: 学習者が聞き取れていた部分や要素（短く1行）
3. missed: 脱落・聞き取れなかった部分や誤認（短く1行）
4. bottleneckType: 最も支配的なボトルネックを以下から1つ選択:
   - "memory_overflow": ワーキングメモリ（文長）パンク。前半は覚えていたが後半で消えた、情報量が脳の容量を超えた。
   - "backward_parsing": 関係詞・前置詞・接続詞での返り読み癖。後ろから日本語に訳そうと立ち止まって置いていかれた。
   - "phonetic_linking": 音声変化・リンキング・弱形脱落。文字を見ればわかるが音として知覚できなかった。
   - "unknown_vocab": 未知語・多義語。知らない単語が出て思考停止した。
   - "perfect": 完全理解（大意・要点を漏れなく把握）。
5. bottleneckLabel: 日本語の短い原因ラベル
6. diagnosis: 学習者の脳内で何が起きていたかの明快な分析・解説 2〜3文。特に「どこでチャンクが切れ、どこでキャッシュがパンクしたか」に触れてください。
7. coachingTip: 次回この速度・長さで聞き取るための実践的なワンポイントアドバイス 1文（チャンクの即時パッキングや音の破棄について）。

を出力してください。

【必ず守る出力フォーマット（純粋なJSONのみ）】:
{
  "comprehensionRate": 75,
  "understood": "...",
  "missed": "...",
  "bottleneckType": "memory_overflow",
  "bottleneckLabel": "ワーキングメモリ（文長）オーバーフロー",
  "diagnosis": "...",
  "coachingTip": "..."
}`;

  const chunksText = (question.chunks || [])
    .map((c, i) => `  [Chunk ${i + 1}]: "${c.text}" (訳: ${c.translationJa} / 理由: ${c.boundaryReason})`)
    .join('\n');

  const promptText = `【出題英文】: ${question.sentenceEn}
【正解の日本語訳】: ${question.translationJa}
【チャンク分割】:
${chunksText}
【設定条件】: 単語数 ${wordCount} 語 / 速度 ${speedWpm} WPM
【学習者の自然言語回答・感想メモ】:
「${userResponse.trim()}」

上記を分析し、指定のJSON形式で返答してください。`;

  const candidateModels = Array.from(new Set([model, ...FALLBACK_MODELS])).filter(Boolean);

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
            temperature: 0.3,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const cleaned = rawText.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
      const parsed = JSON.parse(cleaned);

      if (typeof parsed.comprehensionRate === 'number') {
        return {
          comprehensionRate: Math.min(100, Math.max(0, parsed.comprehensionRate)),
          understood: parsed.understood || '大意を把握できました',
          missed: parsed.missed || '特になし',
          bottleneckType: parsed.bottleneckType || 'perfect',
          bottleneckLabel: parsed.bottleneckLabel || getBottleneckLabel(parsed.bottleneckType),
          diagnosis: parsed.diagnosis || '聞き取り完了です。',
          coachingTip: parsed.coachingTip || 'この調子で語数を増やしていきましょう。',
        };
      }
    } catch (err: any) {
      LiveLogger.warn('quiz_drill', 'LAB_DIAG_ERROR', `Model ${currentModel} failed for lab diagnosis`, {
        error: String(err),
      });
    }
  }

  return getSimpleFallbackDiagnosis(question, userResponse);
}

function getBottleneckLabel(type?: LabBottleneckType): string {
  switch (type) {
    case 'memory_overflow': return 'ワーキングメモリ（文長）パンク';
    case 'backward_parsing': return '関係詞・前置詞の返り読み癖';
    case 'phonetic_linking': return '音声変化・リンキング脱落';
    case 'unknown_vocab': return '未知語・多義語の立ち止まり';
    case 'perfect': return 'パーフェクト理解';
    default: return '要確認';
  }
}

function getSimpleFallbackDiagnosis(question: LabQuestion, userResponse: string): LabDiagnosisResult {
  const isNotEmpty = userResponse.trim().length > 0;
  return {
    comprehensionRate: isNotEmpty ? 70 : 30,
    understood: isNotEmpty ? `入力内容「${userResponse.trim()}」から大意を掴もうとした形跡が確認できました。` : '聞き取れませんでした。',
    missed: `模範訳: ${question.translationJa}`,
    bottleneckType: isNotEmpty ? 'memory_overflow' : 'phonetic_linking',
    bottleneckLabel: isNotEmpty ? 'ワーキングメモリ（文長）パンク' : '音声知覚・スピード負荷',
    diagnosis: `出題英文:「${question.sentenceEn}」\n音声の先頭からチャンク単位で情景をイメージし、音のキャッシュを即座に確定・破棄する練習を重ねましょう。`,
    coachingTip: '前置詞やto不定詞の手前で一度情景を確定させ、音のメモリを捨てる感覚を意識しましょう。',
  };
}

// ===================== STORAGE & MATRIX ANALYTICS =====================

export function loadLabRecords(): LabQuestionRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {}
  return [];
}

export function saveLabRecord(record: LabQuestionRecord): void {
  try {
    const list = loadLabRecords();
    list.push(record);
    const trimmed = list.slice(-500);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (e) {}
}

export function clearLabRecords(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function exportLabRecordsJson(): string {
  const list = loadLabRecords();
  return JSON.stringify(list, null, 2);
}

export function calculateLabAnalytics(): LabAnalyticsSummary {
  const records = loadLabRecords();
  const matrix: BandwidthMatrixData = {};

  const bottleneckCounts: Record<LabBottleneckType, number> = {
    memory_overflow: 0,
    backward_parsing: 0,
    phonetic_linking: 0,
    unknown_vocab: 0,
    perfect: 0,
  };

  let totalScore = 0;

  // Group records into sessions
  const sessionMap = new Map<string, LabQuestionRecord[]>();

  records.forEach((r, idx) => {
    totalScore += r.diagnosis.comprehensionRate;
    const bType = r.diagnosis.bottleneckType || 'memory_overflow';
    if (bottleneckCounts[bType] !== undefined) {
      bottleneckCounts[bType]++;
    }

    const wc = r.wordCount;
    const wpm = r.speedWpm;

    if (!matrix[wc]) matrix[wc] = {};
    if (!matrix[wc][wpm]) {
      matrix[wc][wpm] = { attempts: 0, avgScore: 0, latestScore: 0 };
    }

    const cell = matrix[wc][wpm];
    cell.avgScore = Math.round((cell.avgScore * cell.attempts + r.diagnosis.comprehensionRate) / (cell.attempts + 1));
    cell.attempts += 1;
    cell.latestScore = r.diagnosis.comprehensionRate;

    // Session grouping key
    const sid = r.sessionId || ('sess_' + r.dateString + '_' + r.wordCount + '_' + r.speedWpm + '_' + Math.floor(idx / 5));
    if (!sessionMap.has(sid)) {
      sessionMap.set(sid, []);
    }
    sessionMap.get(sid)!.push(r);
  });

  const sessionHistory: LabSessionSummary[] = [];
  sessionMap.forEach((sRecords, sid) => {
    if (sRecords.length === 0) return;
    const first = sRecords[0];
    const sTotalScore = sRecords.reduce((acc, curr) => acc + curr.diagnosis.comprehensionRate, 0);
    const avg = Math.round(sTotalScore / sRecords.length);
    const perfect = sRecords.filter((r) => r.diagnosis.comprehensionRate >= 90).length;

    sessionHistory.push({
      sessionId: sid,
      timestamp: first.timestamp,
      dateString: first.dateString,
      wordCount: first.wordCount,
      speedWpm: first.speedWpm,
      cefrLevel: first.cefrLevel,
      totalQuestions: sRecords.length,
      averageScore: avg,
      perfectCount: perfect,
      records: sRecords,
    });
  });

  sessionHistory.reverse();

  return {
    totalQuestions: records.length,
    totalSessions: sessionHistory.length,
    avgComprehension: records.length > 0 ? Math.round(totalScore / records.length) : 0,
    bottleneckCounts,
    matrix,
    recentRecords: records.slice(-30).reverse(),
    sessionHistory,
  };
}
