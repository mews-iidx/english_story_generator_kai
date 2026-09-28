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

  // 1. 過去の出題履歴（直近50問）を取得して重複禁止リストを作成
  const recentRecords = loadLabQuestionRecords();
  const avoidSentences = Array.from(
    new Set(
      recentRecords
        .slice(0, 50)
        .map(r => r.sentenceEn?.trim())
        .filter(Boolean)
    )
  );

  const isBasicLevel = cefrLevel === 'A1' || cefrLevel === 'A2';

  const vocabRule = isBasicLevel
    ? `【★超重要：中学英語（基本1500語）への厳格な語彙制限】
- 単語は中学校1〜3年生の教科書レベル（Oxford Basic 1500語・超基本英語）のみを絶対に使用してください。
- 未知語による認知負荷をゼロにし、「純粋な音の聞き取りとワーキングメモリでの文構造保持」に100%集中させるのが目的です。
- 【禁止単語の例】Bluetooth, barista, Wi-Fi, treadmill, battery, app, gadget, software, reservation, schedule, presentation, client, coworker, airport などの専門用語・ITガジェット機器語・ビジネス用語・難解語は一切使わないでください。
- 【推奨単語】go, come, make, take, get, have, see, look, hear, tell, say, ask, help, want, need, think, know, find, try, use, work, leave, put, keep, let, start, open, walk, run, buy, wait, send, stay, friend, brother, sister, mother, father, teacher, dog, cat, water, food, book, car, bus, train, room, door, street, park, school, morning, night, time, day, week, rain などの中学基本語。
- 単語数を伸ばす（${wordCount}単語にする）際は、難しい単語を使うのではなく、接続詞（because, when, if, so, but, that）、不定詞（to do）、動名詞（doing）、関係詞（who, that）、前置詞句（in the morning, with my friend, after school）などの文法構造の展開によって長さを出してください。`
    : `【語彙レベル：${cefrLevel}】
- 自然な日常会話で頻出する語彙を用いてください。過度に専門的・学術的な難語は避け、口語表現を中心にしてください。`;

  const systemInstruction = `あなたは第二言語習得論（SLA）およびリスニング認知負荷トレーニング（ワーキングメモリ拡張）の専門家です。
リスニングにおける「リアルタイムで脳内バッファに保持・処理できる文の長さ（4語→6語→8語→12語→16語...）」を段階的に伸ばす訓練のため、指定された【目標単語数（${wordCount}単語）】に厳密に合わせた日常会話短文を【${count}問】作成してください。

${vocabRule}

【絶対ルール】
1. 各英文の単語数は、目標単語数【${wordCount}単語】（±1語以内）に厳密に一致させてください。
2. 5問はそれぞれ全く異なる日常の自然なシチュエーション・多様な主語（I, You, She, He, We, They, My friend, The boy など）で作成してください。
3. ステレオタイプな不自然な教科書例文（"Leo goes to..." など）は避け、ネイティブが日常で実際に口にする自然な発話にしてください。
4. 自然な音声変化（リンキング・リダクション・弱形）を含む、生きた日常英語にしてください。
5. 日本語訳（translationJa）は、自然でこなれた正確な日本語にしてください。
6. 英語の急所解説（englishExplanation）と、音声変化（phoneticPoints: リンキング・脱落等のポイント）を付与してください。
7. 【最重要】過去に出題された定型文の繰り返しを徹底的に排除し、毎回新鮮で初見の英文を生成してください。

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

  let userPrompt = `CEFRレベル【${cefrLevel}】、目標単語数【${wordCount}単語】で、自然な日常リスニング短文を${count}問、JSON配列で生成してください。`;

  if (avoidSentences.length > 0) {
    userPrompt += `\n\n【★最重要：重複・類似禁止リスト（過去に出題済みの以下の英文やこれと似た構文・フレーズは絶対に生成しないでください）】\n${avoidSentences.slice(0, 40).map((s, i) => `${i + 1}. "${s}"`).join('\n')}\n※必ず上記と全く異なる新しい文構造・日常表現を用いてください。`;
  }

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
            temperature: 0.85,
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
        
        // バッチ内および直近過去履歴との重複排除フィルタリング
        const seenInBatch = new Set<string>();
        const avoidNormalizedSet = new Set(avoidSentences.map(s => s.toLowerCase().replace(/[^a-z0-9]/g, '')));
        const validQuestions: LabQuestion[] = [];

        items.forEach((item, idx) => {
          const sentenceEn = (item.sentenceEn || item.sentence || '').trim();
          if (!sentenceEn) return;
          const normalized = sentenceEn.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (seenInBatch.has(normalized) || avoidNormalizedSet.has(normalized)) return;
          seenInBatch.add(normalized);

          const words = sentenceEn.split(/\s+/).filter(Boolean);
          validQuestions.push({
            id: `lab_q_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 6)}`,
            sentenceEn,
            translationJa: item.translationJa || item.translation || '',
            wordCount: words.length || wordCount,
            words,
            cefrLevel,
            englishExplanation: item.englishExplanation || item.keyPoints || '',
            phoneticPoints: item.phoneticPoints || '',
          });
        });

        if (validQuestions.length > 0) {
          return validQuestions;
        }
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
      { en: "Turn off the light.", ja: "電気を消して。", exp: "turn off: （電気などを）消す", pho: "Turn off -> /tɜːrnɔːf/ (連結)" },
      { en: "I missed the bus.", ja: "バスに乗り遅れました。", exp: "miss: 乗り遅れる", pho: "missed the -> /mɪstðə/ (破裂音の脱落)" },
      { en: "Let's eat lunch together.", ja: "一緒にお昼ご飯を食べよう。", exp: "eat lunch: 昼食をとる", pho: "eat lunch -> /iːtlʌntʃ/" },
      { en: "Please open the door.", ja: "ドアを開けてください。", exp: "open the door: ドアを開ける", pho: "open the -> /oʊpənðə/" },
      { en: "We need more time.", ja: "もっと時間が必要です。", exp: "need more: もっと必要", pho: "need more -> /niːdmɔːr/" },
      { en: "Call me back later.", ja: "あとで電話をかけ直してね。", exp: "call back: 折り返し電話する", pho: "call me -> /kɔːlmi/" },
      { en: "I like your room.", ja: "あなたの部屋がいいね。", exp: "like: 好きである・気に入る", pho: "like your -> /laɪkjʊr/" },
      { en: "She went to sleep.", ja: "彼女は寝に行きました。", exp: "go to sleep: 眠りにつく", pho: "went to -> /wɛntə/ (弱形)" },
    ],
    6: [
      { en: "Can you send me a message?", ja: "メッセージを送ってくれる？", exp: "send A B: AにBを送る", pho: "send me -> /sɛndmi/" },
      { en: "I have to leave right now.", ja: "今すぐ出ないといけない。", exp: "have to: 〜しなければならない", pho: "have to -> /hæftə/ (無声化)" },
      { en: "She decided to buy a book.", ja: "彼女は本を買うことに決めた。", exp: "decide to: 〜することに決める", pho: "buy a -> /baɪjə/ (渡り音)" },
      { en: "We are waiting for the rain.", ja: "私たちは雨宿りをしています。", exp: "wait for: 〜を待つ", pho: "waiting for -> /weɪtɪŋfər/ (弱形)" },
      { en: "My brother was busy this morning.", ja: "兄は今朝とても忙しそうでした。", exp: "this morning: 今朝", pho: "was busy -> /wəzbɪzi/" },
      { en: "Could you pass me the cup?", ja: "コップを取っていただけますか？", exp: "pass A B: AにBを渡す", pho: "pass me -> /pæsmi/" },
      { en: "He always drinks water after dinner.", ja: "彼はいつも夕食後に水を飲みます。", exp: "after dinner: 夕食後", pho: "drinks water -> /drɪŋkswɔːtər/" },
    ],
    8: [
      { en: "I should have called you before leaving home.", ja: "家を出る前にあなたに電話するべきだった。", exp: "should have + p.p.: 〜するべきだった", pho: "should have -> /ʃʊdəv/ (弱形・脱落)" },
      { en: "Could you please help me clean this room?", ja: "この部屋を掃除するのを手伝っていただけますか？", exp: "help + O + 原形: Oが〜するのを手伝う", pho: "help me -> /hɛlpmi/" },
      { en: "He was very glad to see his friend.", ja: "彼は友達に会えてとても嬉しそうでした。", exp: "be glad to: 〜して嬉しい", pho: "glad to -> /ɡlædtə/" },
      { en: "We decided to have dinner together tonight.", ja: "私たちは今夜、一緒に夕食を食べることに決めました。", exp: "have dinner: 夕食をとる", pho: "dinner together -> /dɪnərtəɡɛðər/" },
      { en: "She forgot to bring her bag this morning.", ja: "彼女は今朝カバンを持ってくるのを忘れました。", exp: "forget to do: 〜し忘れる", pho: "forgot to -> /fərɡɑːttə/" },
      { en: "I want to take a walk after lunch.", ja: "昼食のあとに散歩に行きたいです。", exp: "take a walk: 散歩する", pho: "take a -> /teɪkə/ (連結)" },
    ],
    10: [
      { en: "I was looking forward to seeing my friends this weekend.", ja: "今週末に友達と会うのをとても楽しみにしていました。", exp: "look forward to -ing: 〜を楽しみに待つ", pho: "forward to -> /fɔːrwərd tə/" },
      { en: "You should wash your hands before eating dinner with us.", ja: "私たちと夕食を食べる前に手を洗ったほうがいいですよ。", exp: "before -ing: 〜する前に", pho: "wash your -> /wɑːʃjʊr/" },
      { en: "My sister helped me cook dinner for the whole family.", ja: "妹が家族全員のための夕食作りを手伝ってくれました。", exp: "help O do: Oが〜するのを手伝う", pho: "helped me -> /hɛlptmi/" },
      { en: "The rain stopped and the sky became clear this afternoon.", ja: "雨が止んで、今日の午後は空が澄み渡りました。", exp: "become clear: 澄み渡る・晴れる", pho: "stopped and -> /stɑːptænd/" },
    ],
    12: [
      { en: "I was wondering if you could help me carry these heavy boxes.", ja: "この重い箱を運ぶのを手伝っていただけないかと思いまして。", exp: "I was wondering if...: 丁寧な依頼表現", pho: "help me -> /hɛlpmi/" },
      { en: "You should take an umbrella because it will rain later this afternoon.", ja: "今日の午後遅くに雨が降るそうなので、傘を持っていくべきです。", exp: "take an umbrella: 傘を持っていく", pho: "take an -> /teɪkən/ (連結)" },
      { en: "She spent the whole morning cleaning her room and reading old books.", ja: "彼女は午前中ずっと部屋の掃除と昔の本を読んで過ごしました。", exp: "spend time -ing: 〜して時間を過ごす", pho: "spent the -> /spɛntðə/" },
    ],
    14: [
      { en: "Even though the bus was very late today, I managed to get to school on time.", ja: "今日はバスがとても遅れたにもかかわらず、なんとか時間通りに学校に着きました。", exp: "manage to: なんとか〜する", pho: "managed to -> /mænɪdʒd tə/" },
      { en: "If you want to know more about this story, please feel free to ask me.", ja: "この物語についてもっと知りたいときは、遠慮なく何でも聞いてくださいね。", exp: "feel free to: ご自由に〜する", pho: "feel free -> /fiːlfriː/" },
    ],
    16: [
      { en: "I was planning to go to the park with my friends, but it was so cold that we stayed home.", ja: "友達と公園に行く予定でしたが、あまりに寒かったので私たちは家にいました。", exp: "so ... that: あまりに〜なので", pho: "stayed home -> /steɪdhoʊm/" },
    ],
    20: [
      { en: "When I arrived at the station this morning, my friends were already waiting for me with warm drinks in their hands.", ja: "今朝駅に着いたとき、友達は手に温かい飲み物を持ってすでに私のことを待ってくれていました。", exp: "arrive at: 〜に到着する", pho: "waiting for me -> /weɪtɪŋfərmi/" },
    ],
  };

  const pool = sampleBank[wordCount] || sampleBank[8] || sampleBank[4];
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const results: LabQuestion[] = [];

  for (let i = 0; i < count; i++) {
    const item = shuffled[i % shuffled.length];
    const words = item.en.split(/\s+/).filter(Boolean);
    results.push({
      id: `lab_q_fallback_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`,
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


/**
 * ストーリー内の文からAnkiリスニングカード用「英英日」解説＆音声変化ポイントを非同期に並列生成
 */
export async function enrichListeningSentenceWithGemini(params: {
  cardId: string;
  sentenceEn: string;
  contextJa?: string;
  storyTitle?: string;
  apiKey: string;
  model?: string;
}): Promise<{
  translation: string;
  englishExplanation: string;
  markedTokens: string[];
} | null> {
  const { cardId, sentenceEn, contextJa = '', storyTitle = '', apiKey, model = 'gemini-2.0-flash' } = params;
  if (!apiKey || !sentenceEn.trim()) return null;

  const systemInstruction = `あなたは英語音声学・第二言語習得論（SLA）の専門家です。
ストーリー英文に対して、リスニング学習者が「音の脱落・連結・弱形」を理解し、英語のまま直感的なニュアンスを掴むための【英英日（英語ニュアンス解説＋音声変化＋日本語訳）】の分析を行ってください。

【出力フォーマット（純粋なJSONオブジェクトのみ）】:
{
  "translation": "自然で正確な日本語訳",
  "englishExplanation": "Concise English explanation of communicative nuance, key phrases, and natural context (1-2 sentences in clear English).",
  "phoneticPoints": "Key sound shifts in natural spoken speed (e.g. reduction: 'want to' -> /wɑnə/, linking: 'pick up' -> /pɪkʌp/, flap-t, dropped consonants)",
  "markedTokens": ["linking/reduction words or key phonetic chunks in the sentence"]
}`;

  const userPrompt = `Story: "${storyTitle}"
Sentence: "${sentenceEn}"
Context Japanese: "${contextJa}"

上記英文のリスニングカード用解説（英英日）をJSONで生成してください。`;

  const modelsToTry = [model, ...FALLBACK_MODELS.filter(m => m !== model)];

  for (const currentModel of modelsToTry) {
    try {
      LiveLogger.logQuizDrill('ListeningEnrichment', `リスニング文の英英日解説を生成中 (Model: ${currentModel}): "${sentenceEn.slice(0, 30)}..."`);

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: userPrompt }] }],
          systemInstruction: { parts: [{ text: systemInstruction }] },
          generationConfig: {
            temperature: 0.3,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (!res.ok) continue;

      const json = await res.json();
      const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) continue;

      const parsed = JSON.parse(rawText);
      const translation = (parsed.translation || contextJa || '').trim();
      const englishExplanation = (parsed.englishExplanation || '').trim();
      const phoneticPoints = (parsed.phoneticPoints || '').trim();
      const markedTokens: string[] = Array.isArray(parsed.markedTokens) ? parsed.markedTokens : [];

      const fullExplanation = [
        englishExplanation ? `💡 ${englishExplanation}` : '',
        phoneticPoints ? `🗣️ 音声変化: ${phoneticPoints}` : '',
      ].filter(Boolean).join('\n');

      // Return parsed enrichment result (caller handles storage update)

      LiveLogger.logQuizDrill('ListeningEnrichment', `リスニングAnkiカードの英英日解説が完了しました (${cardId})`);

      return {
        translation,
        englishExplanation: fullExplanation,
        markedTokens,
      };
    } catch (e: any) {
      console.warn(`Listening enrichment error with model ${currentModel}:`, e);
    }
  }

  return null;
}
