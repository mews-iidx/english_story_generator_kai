import { CefrLevel } from '../types/settings';
import {
  LabQuestion,
  LabDiagnosisResult,
  LabQuestionRecord,
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

  const systemInstruction = `あなたは第二言語習得論（SLA）およびリスニング認知負荷トレーニングの専門家です。
リスニングの「ワーキングメモリ（脳内バッファ）限界測定トレーニング」のために、指定された【単語数（${wordCount}単語程度）】に厳密に合わせた、自然で生き生きとしたネイティブの日常会話短文を【${count}問】作成してください。

【絶対ルール】
1. 各英文の単語数は、目標単語数【${wordCount}単語】（±1語以内）に厳密に一致させてください。
   - 4語の例: "This is my dog." (4語), "I like green tea." (4語), "Where is the station?" (4語)
   - 8語の例: "I need to wake up early tomorrow morning." (8語)
2. 英文は生きた日常会話・口語表現にしてください。
3. 日本語訳（translationJa）は、自然で正確な日本語にしてください。
4. keyPoints には、この文の聞き取りポイント（例: "SVOの骨格", "前置詞の追加", "関係代名詞の修飾", "リンキング"）を短く添えてください。

【必ず守る出力フォーマット（純粋なJSON配列のみ）】:
[
  {
    "sentenceEn": "This is a pen.",
    "translationJa": "これはペンです。",
    "wordCount": 4,
    "keyPoints": "基礎SVO/主語と補語"
  }
]`;

  const promptText = `【難易度】: CEFR ${cefrLevel}
【目標単語数】: 1文あたり約 ${wordCount} 単語
【生成問題数】: ${count} 問
【想定再生速度】: ${speedWpm} WPM

上記条件に合致するリスニング出題用英文をJSON配列で生成してください。`;

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
            temperature: 0.8,
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
      { en: 'This is my dog.', ja: 'これは私の犬です。' },
      { en: 'I like hot coffee.', ja: '私は温かいコーヒーが好きです。' },
      { en: 'Where is my phone?', ja: '私のスマホはどこですか？' },
      { en: 'She is very happy.', ja: '彼女はとても幸せです。' },
      { en: 'Can you help me?', ja: '手伝ってくれますか？' },
    ],
    6: [
      { en: 'We will meet at the station.', ja: '私たちは駅で集合します。' },
      { en: 'He is drinking a cold tea.', ja: '彼は冷たいお茶を飲んでいます。' },
      { en: 'I forgot to lock the door.', ja: 'ドアに鍵をかけるのを忘れました。' },
      { en: 'She bought a new red car.', ja: '彼女は新しい赤い車を買いました。' },
      { en: 'Please send me the details later.', ja: '後で詳細を送ってください。' },
    ],
    8: [
      { en: 'I need to wake up early tomorrow morning.', ja: '明日の朝は早く起きる必要があります。' },
      { en: 'The doctor told him to take some rest.', ja: '医者は彼に少し休むように言いました。' },
      { en: 'She decided to study English for her career.', ja: '彼女はキャリアのために英語を勉強することに決めました。' },
      { en: 'We had a wonderful dinner near the beach.', ja: '私たちは海岸の近くで素晴らしい夕食を食べました。' },
      { en: 'He was looking for his lost car keys.', ja: '彼は紛失した車の鍵を探していました。' },
    ],
    12: [
      { en: 'I wanted to call you yesterday, but my phone battery was completely dead.', ja: '昨日あなたに電話したかったのですが、スマホの充電が完全に切れていました。' },
      { en: 'The doctor explained the treatment plan before the surgery started this morning.', ja: '今朝手術が始まる前に、医師は治療計画について説明しました。' },
      { en: 'She loves reading books that give her new perspectives on daily life.', ja: '彼女は日常生活に新しい視点を与えてくれる本を読むのが大好きです。' },
      { en: 'We should leave early tomorrow so that we can avoid heavy traffic.', ja: '渋滞を避けることができるように、明日は早く出発すべきです。' },
      { en: 'He could not understand why the train was delayed for thirty minutes.', ja: '彼はなぜ電車が30分も遅延したのか理解できませんでした。' },
    ],
  };

  const pool = fallbacksByCount[wordCount] || fallbacksByCount[4];
  const list = pool.slice(0, count);

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

  records.forEach((r) => {
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
  });

  return {
    totalQuestions: records.length,
    avgComprehension: records.length > 0 ? Math.round(totalScore / records.length) : 0,
    bottleneckCounts,
    matrix,
    recentRecords: records.slice(-20).reverse(),
  };
}
