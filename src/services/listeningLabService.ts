import { CefrLevel } from '../types/settings';
import {
  LabQuestion,
  LabChunk,
  LabQuestionRecord,
  LabAnalyticsSummary,
  WordCountStat,
  DailyLPHistory,
} from '../types/listeningLab';
import { LiveLogger } from './liveLogger';

const STORAGE_KEY = 'compile_eng_listening_lab_records_v2';
const FALLBACK_MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.0-flash-lite', 'gemini-3.7-flash'];

export interface GenerateLabBatchParams {
  wordCount: number; // 4 to 25
  speedRate: number; // 0.8, 0.9, 1.0, 1.1, 1.2
  count?: number; // default 5
  cefrLevel?: CefrLevel;
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

/**
 * 英語音声学・Thought Group分割ユーティリティ（互換性用）
 */
export function splitIntoSmartChunks(sentenceEn: string, translationJa: string = ''): LabChunk[] {
  const cleanEn = sentenceEn.trim().replace(/[.?!]+$/, '');
  if (!cleanEn) return [];

  const words = cleanEn.split(/\s+/).filter(Boolean);
  if (words.length <= 8) {
    return [
      {
        text: cleanEn,
        translationJa: translationJa || cleanEn,
        boundaryReason: '基本の骨格（1つの完結したThought Group）',
      },
    ];
  }

  const mid = Math.ceil(words.length / 2);
  const chunk1 = words.slice(0, mid).join(' ');
  const chunk2 = words.slice(mid).join(' ');

  return [
    { text: chunk1, translationJa: '...', boundaryReason: '主部・前半骨格' },
    { text: chunk2, translationJa: translationJa || '...', boundaryReason: '展開・述部' },
  ];
}

/**
 * リスニング処理パワー (Listening Power: LP) の計算
 * 式: 有効既知単語数 × 速度倍率 × (聞き取れた単語数 / 有効既知単語数)^2 × (10 / sqrt(再生回数))
 * 未知語（isVocabGap）の場合はnullを返しベンチマーク対象外とする
 */
export function calculateListeningPower(params: {
  wordCount: number;
  speedRate: number;
  missedSoundCount: number;
  unknownVocabCount: number;
  playCount: number;
  isVocabGap?: boolean;
}): number | null {
  if (params.isVocabGap) {
    return null; // 未知語による除外
  }

  const effectiveKnownWords = Math.max(1, params.wordCount - params.unknownVocabCount);
  const heardWords = Math.max(0, effectiveKnownWords - params.missedSoundCount);
  const accuracy = heardWords / effectiveKnownWords;
  const playPenalty = Math.sqrt(Math.max(1, params.playCount));

  const score = effectiveKnownWords * params.speedRate * Math.pow(accuracy, 2) * (10 / playPenalty);
  return Math.round(score * 10) / 10;
}

export async function generateLabBatch(params: GenerateLabBatchParams): Promise<LabQuestion[]> {
  const {
    wordCount,
    count = 5,
    cefrLevel = 'A2',
    apiKey,
    model = 'gemini-2.0-flash',
  } = params;

  if (!apiKey) {
    return getFallbackBatch(wordCount, count, cefrLevel);
  }

  const shuffledSeeds = [...SITUATION_SEEDS].sort(() => Math.random() - 0.5);
  const selectedSituations = shuffledSeeds.slice(0, count);

  const situationPrompts = selectedSituations
    .map((s, idx) => `  - ${idx + 1}問目の場面: ${s}`)
    .join('\n');

  const systemInstruction = `あなたは第二言語習得論（SLA）およびリスニング認知負荷トレーニングの専門家です。
リスニングの「ワーキングメモリ（脳内バッファ）限界測定＆リアルタイム聴解訓練」のために、指定された【目標単語数（${wordCount}単語）】に厳密に合わせた、自然で生き生きとしたネイティブの日常会話短文を【${count}問】作成してください。

【絶対ルール】
1. 各英文の単語数は、目標単語数【${wordCount}単語】（±1語以内）に厳密に一致させてください。
2. ${count}問はすべて全く異なるシチュエーション、多様な主語（I, You, She, He, We, My coworker, The barista など）、自然な日常動詞を用いて作成してください。
3. 【禁止事項】「Leo」「Alex」「駅への行き方 (way to the station)」「傘を忘れた (forgot umbrella)」のようなステレオタイプな教科書フレーズは避け、リアルな現代生活シーンから作成してください。
4. 英文は生きたカジュアルな日常会話・口語表現にしてください（短縮形や自然な前置詞・句動詞を歓迎）。
5. 日本語訳（translationJa）は、自然で正確な日本語にしてください。
6. 英語の急所解説（englishExplanation）と、音声変化（phoneticPoints: リダクション、リンキング、脱落音のポイント）を付与してください。

【必ず守る出力フォーマット（純粋なJSON配列のみ）】:
[
  {
    "sentenceEn": "...",
    "translationJa": "...",
    "wordCount": ${wordCount},
    "englishExplanation": "...",
    "phoneticPoints": "..."
  }
]`;

  const userPrompt = `CEFRレベル【${cefrLevel}】、目標単語数【${wordCount}単語】で、以下のシチュエーションに基づく${count}問のリスニング用短文をJSON配列で生成してください:\n${situationPrompts}`;

  const modelsToTry = [model, ...FALLBACK_MODELS.filter(m => m !== model)];

  for (const currentModel of modelsToTry) {
    try {
      LiveLogger.logQuizDrill('ListeningLab', `Gemini生成リクエスト送信中 (Model: ${currentModel}, Words: ${wordCount}, CEFR: ${cefrLevel})`);

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: userPrompt }] }],
          systemInstruction: { parts: [{ text: systemInstruction }] },
          generationConfig: {
            temperature: 0.75,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        LiveLogger.logQuizDrill('ListeningLab', `Model ${currentModel} error (${res.status}): ${errText}`, undefined, 'WARN');
        continue;
      }

      const json = await res.json();
      const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) continue;

      const parsed = JSON.parse(rawText);
      const items: any[] = Array.isArray(parsed) ? parsed : (parsed.questions || parsed.sentences || []);

      if (items.length > 0) {
        LiveLogger.logQuizDrill('ListeningLab', `${items.length}件のリスニング問題を正常に生成しました`);
        return items.map((item, idx) => {
          const sentenceEn = (item.sentenceEn || item.sentence || '').trim();
          const words = sentenceEn.split(/\s+/).filter(Boolean);
          return {
            id: `lab_q_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 6)}`,
            sentenceEn,
            translationJa: item.translationJa || item.translation || '',
            wordCount: words.length || wordCount,
            words,
            cefrLevel,
            englishExplanation: item.englishExplanation || item.keyPoints || '',
            phoneticPoints: item.phoneticPoints || '',
          };
        });
      }
    } catch (e: any) {
      LiveLogger.logQuizDrill('ListeningLab', `Model ${currentModel} exception: ${e?.message || e}`, undefined, 'WARN');
    }
  }

  return getFallbackBatch(wordCount, count, cefrLevel);
}

function getFallbackBatch(wordCount: number, count: number, cefrLevel: CefrLevel): LabQuestion[] {
  const sampleBank: Record<number, { en: string; ja: string; exp: string; pho: string }[]> = {
    4: [
      { en: "Turn off the lights.", ja: "電気を消して。", exp: "Turn off: 句動詞（消す）", pho: "Turn off -> /tɜːrnɔːf/ (連結)" },
      { en: "I missed the bus.", ja: "バスに乗り遅れました。", exp: "miss: 乗り遅れる", pho: "missed the -> /mɪstðə/ (破裂音の消失)" },
      { en: "Let's grab some lunch.", ja: "お昼ご飯を食べに行こう。", exp: "grab lunch: 軽く食事をとる", pho: "grab some -> /ɡræbsəm/" },
      { en: "Please leave a message.", ja: "メッセージを残してください。", exp: "leave a message: 伝言を残す", pho: "leave a -> /liːvə/ (連結)" },
      { en: "We need more time.", ja: "もっと時間が必要です。", exp: "need more: もっと必要", pho: "need more -> /niːdmɔːr/" },
    ],
    6: [
      { en: "Can you send me the file?", ja: "そのファイルを送ってくれる？", exp: "send A B: AにBを送る", pho: "send me -> /sɛndmi/" },
      { en: "I have to leave right now.", ja: "今すぐ出ないといけない。", exp: "have to: 〜しなければならない", pho: "have to -> /hæftə/ (無声化)" },
      { en: "She decided to buy a car.", ja: "彼女は車を買うことに決めた。", exp: "decide to: 〜することに決める", pho: "buy a -> /baɪjə/ (渡り音)" },
      { en: "We are waiting for the rain.", ja: "私たちは雨宿りしています。", exp: "wait for: 〜を待つ", pho: "waiting for -> /weɪtɪŋfər/ (弱形)" },
    ],
    8: [
      { en: "I should have called you before leaving home.", ja: "家を出る前にあなたに電話するべきだった。", exp: "should have + p.p.: 〜するべきだった", pho: "should have -> /ʃʊdəv/ (弱形・脱落)" },
      { en: "Could you please help me move this desk?", ja: "この机を動かすのを手伝っていただけますか？", exp: "help + O + 原形: Oが〜するのを手伝う", pho: "help me -> /hɛlpmi/" },
      { en: "He was surprised to hear the shocking news.", ja: "彼はその衝撃的な知らせを聞いて驚いた。", exp: "be surprised to: 〜して驚く", pho: "surprised to -> /sərpraɪzd tə/" },
    ],
    12: [
      { en: "I was wondering if you could give me a hand with this project.", ja: "このプロジェクトを手伝っていただけないかと思いまして。", exp: "I was wondering if...: 丁寧な依頼表現", pho: "give me a hand -> /ɡɪvmiəhænd/ (連続リンキング)" },
      { en: "You should take an umbrella because the weather forecast predicted heavy rain.", ja: "天気予報で大雨が予想されていたので、傘を持っていくべきです。", exp: "predict: 予測する", pho: "take an -> /teɪkən/, weather forecast -> /wɛðər fɔːrkæst/" },
    ],
  };

  const pool = sampleBank[wordCount] || sampleBank[8] || sampleBank[4];
  const results: LabQuestion[] = [];

  for (let i = 0; i < count; i++) {
    const item = pool[i % pool.length];
    const words = item.en.split(/\s+/).filter(Boolean);
    results.push({
      id: `lab_q_fallback_${Date.now()}_${i}`,
      sentenceEn: item.en,
      translationJa: item.ja,
      wordCount: words.length,
      words,
      cefrLevel,
      englishExplanation: item.exp,
      phoneticPoints: item.pho,
    });
  }

  return results;
}

// --------------------- PERSISTENCE & ANALYTICS ---------------------

export function loadLabQuestionRecords(): LabQuestionRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to load lab records', e);
    return [];
  }
}

export function saveLabQuestionRecord(record: LabQuestionRecord): void {
  try {
    const records = loadLabQuestionRecords();
    records.unshift(record);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, 1000)));
  } catch (e) {
    console.error('Failed to save lab record', e);
  }
}

export function calculateLabAnalytics(): LabAnalyticsSummary {
  const records = loadLabQuestionRecords();
  const totalQuestions = records.length;
  const perfectCount = records.filter(r => r.isPerfect).length;
  const perfectPassRate = totalQuestions > 0 ? Math.round((perfectCount / totalQuestions) * 100) : 0;

  // 日付の計算
  const todayStr = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  // LPスコアを持つ有効レコード（未知語除外でないもの）
  const validLPRecords = records.filter(r => typeof r.listeningPowerScore === 'number' && !r.isVocabGap);

  // 日別のLP集計
  const dailyMap: Record<string, { sumLP: number; count: number }> = {};
  validLPRecords.forEach(r => {
    const d = r.dateString || r.timestamp.split('T')[0];
    if (!dailyMap[d]) {
      dailyMap[d] = { sumLP: 0, count: 0 };
    }
    dailyMap[d].sumLP += (r.listeningPowerScore || 0);
    dailyMap[d].count++;
  });

  const dailyHistory: DailyLPHistory[] = Object.entries(dailyMap)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 14)
    .map(([dateString, stat]) => ({
      dateString,
      avgLP: stat.count > 0 ? Math.round((stat.sumLP / stat.count) * 10) / 10 : 0,
      questionCount: stat.count,
    }));

  const todayStat = dailyMap[todayStr];
  const todayAverageLP = todayStat && todayStat.count > 0 ? Math.round((todayStat.sumLP / todayStat.count) * 10) / 10 : 0;

  const yesterdayStat = dailyMap[yesterdayStr];
  const yesterdayAverageLP = yesterdayStat && yesterdayStat.count > 0 ? Math.round((yesterdayStat.sumLP / yesterdayStat.count) * 10) / 10 : 0;

  const deltaVsYesterday = yesterdayAverageLP > 0 && todayAverageLP > 0
    ? Math.round((todayAverageLP - yesterdayAverageLP) * 10) / 10
    : 0;

  // 直近7日間のLP移動平均 (最新の有効20問または直近7日の平均)
  const recent7DayRecords = validLPRecords.slice(0, 30);
  const movingAverageLP7Days = recent7DayRecords.length > 0
    ? Math.round((recent7DayRecords.reduce((acc, r) => acc + (r.listeningPowerScore || 0), 0) / recent7DayRecords.length) * 10) / 10
    : 0;

  // 直近20問の単語処理能力移動平均
  const recent20 = records.slice(0, 20);
  let movingAverageWordCapacity = 0;
  if (recent20.length > 0) {
    const sum = recent20.reduce((acc, r) => acc + (r.isPerfect ? r.wordCount : Math.max(0, r.wordCount - (r.markedTokens?.length || 0))), 0);
    movingAverageWordCapacity = Math.round((sum / recent20.length) * 10) / 10;
  }

  // 単語数別の達成率 & 平均LP
  const wordCountStats: Record<number, WordCountStat> = {};
  for (const r of records) {
    const wc = r.wordCount;
    if (!wordCountStats[wc]) {
      wordCountStats[wc] = { wordCount: wc, attempts: 0, perfectCount: 0, passRate: 0, avgLP: 0 };
    }
    wordCountStats[wc].attempts++;
    if (r.isPerfect) {
      wordCountStats[wc].perfectCount++;
    }
  }

  for (const wc of Object.keys(wordCountStats)) {
    const numWc = Number(wc);
    const s = wordCountStats[numWc];
    s.passRate = s.attempts > 0 ? Math.round((s.perfectCount / s.attempts) * 100) : 0;

    const wcLPs = validLPRecords.filter(r => r.wordCount === numWc);
    s.avgLP = wcLPs.length > 0
      ? Math.round((wcLPs.reduce((a, r) => a + (r.listeningPowerScore || 0), 0) / wcLPs.length) * 10) / 10
      : 0;
  }

  return {
    totalQuestions,
    perfectCount,
    perfectPassRate,
    todayAverageLP,
    yesterdayAverageLP,
    deltaVsYesterday,
    movingAverageLP7Days,
    movingAverageWordCapacity,
    dailyHistory,
    wordCountStats,
    recentRecords: records.slice(0, 30),
  };
}
