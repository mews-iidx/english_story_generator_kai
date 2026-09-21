import { CefrLevel } from '../types/settings';
import {
  LabQuestion,
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
リスニングの「ワーキングメモリ（脳内バッファ）限界測定トレーニング」のために、指定された【単語数（${wordCount}単語程度）】に厳密に合わせた、自然で生き生きとしたネイティブの日常会話短文を【${count}問】作成してください。

【絶対ルール】
1. 各英文の単語数は、目標単語数【${wordCount}単語】（±1語以内）に厳密に一致させてください。
2. 5問はすべて全く異なるシチュエーション、異なる主語（I, You, She, He, We, My friend, The dog など）、異なる動詞を用いて作成してください。
3. 【禁止事項】「駅への行き方 (way to the station)」「傘を忘れた (forgot umbrella/milk)」「コーヒーを飲む (drink coffee)」「日本を訪れる (planning to visit Japan)」のようなステレオタイプな教科書フレーズは絶対に避け、現代の多様な生活シーンから作成してください。
4. 英文は生きたカジュアルな日常会話・口語表現にしてください。
5. 日本語訳（translationJa）は、自然で正確な日本語にしてください。
6. keyPoints には、この文の聞き取りポイント（例: "SVOの骨格", "前置詞句", "関係代名詞", "理由節", "リンキング"）を短く添えてください。

【必ず守る出力フォーマット（純粋なJSON配列のみ）】:
[
  {
    "sentenceEn": "...",
    "translationJa": "...",
    "wordCount": ${wordCount},
    "keyPoints": "..."
  }
]`;

  const promptText = `【難易度】: CEFR ${cefrLevel}
【目標単語数】: 1文あたり約 ${wordCount} 単語
【生成問題数】: ${count} 問
【想定再生速度】: ${speedWpm} WPM

【各問の割り当てシチュエーション（必ずこのテーマに沿って作成）】:
${situationPrompts}

上記条件に合致する、重複のない多彩なリスニング出題用英文をJSON配列で生成してください。`;

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
            temperature: 0.95, // 多様性を高める
            responseMimeType: 'application/json',
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const cleaned = rawText.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
      const parsed = JSON.parse(cleaned);

      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((item: any, idx: number) => {
          const s = (item.sentenceEn || '').trim();
          const words = s.split(/\s+/).filter(Boolean);
          return {
            id: 'lab_q_' + Date.now() + '_' + idx + '_' + Math.random().toString(36).substring(2, 5),
            sentenceEn: s,
            translationJa: (item.translationJa || '').trim(),
            wordCount: words.length || wordCount,
            words,
            cefrLevel,
            keyPoints: item.keyPoints || '日常会話',
          };
        });
      }
    } catch (err: any) {
      LiveLogger.warn('quiz_drill', 'LAB_GEN_MODEL_ERROR', `Model ${currentModel} failed for lab batch gen`, {
        error: err?.message || String(err),
        wordCount,
        speedWpm,
      });
    }
  }

  LiveLogger.warn('quiz_drill', 'LAB_GEN_FALLBACK_USED', 'Using fallback questions for lab batch');
  return getFallbackBatch(wordCount, count, cefrLevel);
}

function getFallbackBatch(wordCount: number, count: number, cefrLevel: CefrLevel): LabQuestion[] {
  const fallbacksByCount: Record<number, { en: string; ja: string }[]> = {
    4: [
      { en: 'My dog is sleeping.', ja: '私の犬は眠っています。' },
      { en: 'The battery is low.', ja: 'バッテリー残量が少ないです。' },
      { en: 'This soup smells great.', ja: 'このスープはとても良い香りがします。' },
      { en: 'We need more time.', ja: '私たちにはもっと時間が必要です。' },
      { en: 'He plays the guitar.', ja: '彼はギターを弾きます。' },
      { en: 'The movie was amazing.', ja: 'その映画は素晴らしかったです。' },
    ],
    6: [
      { en: 'My phone battery died this morning.', ja: '今朝スマホの充電が切れました。' },
      { en: 'The cat is hiding under the bed.', ja: '猫がベッドの下に隠れています。' },
      { en: 'I cooked pasta for my dinner.', ja: '夕食にパスタを作りました。' },
      { en: 'She sent me a funny video.', ja: '彼女は私に面白い動画を送ってくれました。' },
      { en: 'We should clean the kitchen today.', ja: '今日はキッチンを掃除するべきです。' },
    ],
    8: [
      { en: 'My computer suddenly restarted during the online meeting.', ja: 'オンライン会議中にパソコンが突然再起動しました。' },
      { en: 'The little dog was barking at the mailman.', ja: 'その小さな犬は郵便配達員に吠えていました。' },
      { en: 'I tried a new spicy ramen recipe yesterday.', ja: '昨日、新しい激辛ラーメンのレシピを試しました。' },
      { en: 'She is looking for her lost wireless earbuds.', ja: '彼女は紛失したワイヤレスイヤホンを探しています。' },
      { en: 'We took many photos during the outdoor festival.', ja: '私たちは野外フェスでたくさんの写真を撮りました。' },
    ],
    12: [
      { en: 'I wanted to reply to your email earlier, but my laptop was updating.', ja: 'もっと早くメールに返信したかったのですが、ノートPCがアップデート中でした。' },
      { en: 'The chef explained how to bake the perfect chocolate cake from scratch.', ja: 'シェフは完璧なチョコレートケーキを最初から焼く方法を説明しました。' },
      { en: 'She downloaded a new language app that helps her practice speaking skills.', ja: '彼女はスピーキングの練習を助けてくれる新しい語学アプリをダウンロードしました。' },
      { en: 'We decided to order some pizza because nobody wanted to cook tonight.', ja: '今夜は誰も料理をしたくなかったので、ピザを注文することにしました。' },
      { en: 'He was surprised to see how fast his little puppy was running.', ja: '彼は子犬がどれほど速く走っているかを見て驚きました。' },
    ],
  };

  const pool = fallbacksByCount[wordCount] || fallbacksByCount[4];
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const list = shuffled.slice(0, count);

  return list.map((item, idx) => {
    const words = item.en.split(/\s+/).filter(Boolean);
    return {
      id: 'fallback_lab_' + Date.now() + '_' + idx,
      sentenceEn: item.en,
      translationJa: item.ja,
      wordCount: words.length,
      words,
      cefrLevel,
      keyPoints: '基本日常会話',
    };
  });
}

export async function diagnoseUserResponse(params: DiagnoseUserResponseParams): Promise<LabDiagnosisResult> {
  const { question, userResponse, speedWpm, wordCount, apiKey, model = 'gemini-2.0-flash' } = params;

  if (!apiKey) {
    return getSimpleFallbackDiagnosis(question, userResponse);
  }

  const systemInstruction = `あなたは英語リスニングの認知メカニズム（脳内ワーキングメモリ・返り読み・音声知覚）を分析するプロフェッショナルAIコーチです。

学習者は指定の速度（${speedWpm} WPM）、長さ（${wordCount}単語）で流れた英文を聴き、頭に残った内容や聞き取れなかった原因を【自由な自然言語（ラフな感想やメモ）】で入力しました。

【タスク】
出題英文、正解訳、学習者の自由入力メモを精密に突き合わせ、
1. comprehensionRate (0〜100%の理解度)
2. understood (聞き取れていた要素・大意)
3. missed (脱落した情報・誤認した要素)
4. bottleneckType (主な脱落・パンク原因):
   - "memory_overflow": ワーキングメモリ（文長）パンク。前半は覚えているが後半で容量オーバーした、または長すぎて保持できなかった。
   - "backward_parsing": 関係詞・前置詞・接続詞での返り読み癖。後ろから日本語に訳そうと立ち止まって置いていかれた。
   - "phonetic_linking": 音声変化・リンキング・弱形脱落。文字を見ればわかるが音として知覚できなかった。
   - "unknown_vocab": 未知語・多義語。知らない単語が出て思考停止した。
   - "perfect": 完全理解（大意・要点を漏れなく把握）。
5. bottleneckLabel (日本語の短い原因ラベル)
6. diagnosis (学習者の脳内で何が起きていたかの明快な分析・解説 2〜3文)
7. coachingTip (次回この速度・長さで聞き取るための実践的なワンポイントアドバイス 1文)

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

  const promptText = `【出題英文】: ${question.sentenceEn}
【正解の日本語訳】: ${question.translationJa}
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
    diagnosis: `出題英文:「${question.sentenceEn}」\n音声の先頭から語順通りに情景をイメージする練習を重ねましょう。`,
    coachingTip: 'まずは4〜6語の短文で、1語ずつ前から情景を思い浮かべる感覚を掴みましょう。',
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
    // Keep max 500 records
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
