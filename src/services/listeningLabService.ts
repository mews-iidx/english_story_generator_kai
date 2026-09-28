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
  '💻 職場・Slack・リモートワーク（Slackの通知音、画面共有の不具合、マイクのミュート解除、共有ドライブの権限、締め切りのリスケ）',
  '☕ カフェ・テラス席（季節限定のオーツミルクラテ、空席の確保、Wi-Fiパスワード、店員のおすすめ、持ち帰りカップ）',
  '🍳 自炊・キッチンのハプニング（パスタの茹で加減、調味料の買い忘れ、フライパンのこびりつき、新作レシピの味見、作り置き保存）',
  '🛒 スーパー・買い物・レジ（特売のイチゴ、エコバッグの持参、ポイントカードの提示、セルフレジの操作、賞味期限の確認）',
  '📱 スマホ・バッテリー・SNS（充電ケーブルの接触不良、画面のひび割れ、写真のバックアップ、通知のオフ、機内モード）',
  '🚇 電車・バス・通勤ラッシュ（急行電車の通過待ち、定期券のタッチ、座席を譲る、ドア付近の混雑、乗り換えアプリの案内）',
  '🐕 ペット・犬猫との暮らし（散歩用のリード、猫のゴロゴロ音、爪切りへの抵抗、お気に入りのおやつ、動物病院の予約）',
  '🏃‍♂️ ジム・フィットネス・健康（プロテインシェイカー、トレッドミルの速度、ストレッチポール、筋肉痛の予防、水分補給）',
  '📦 ネット通販・宅配便（置き配の指定、段ボールの開封、不在票の再配達、サイズ違いの返品、レビューの投稿）',
  '🎬 週末の動画配信・映画（話題のSFドラマの一気見、字幕と吹替の切り替え、映画館のポップコーン、結末のネタバレ注意）',
  '🌦️ 急な天気・気温の変化（突然のゲリラ豪雨、心地よい秋風、エアコンのリモコン、折りたたみ傘の骨、朝晩の冷え込み）',
  '🏠 家事・部屋の模様替え（ロボット掃除機の迷子、洗濯物の部屋干し、観葉植物の葉水、クローゼットの整理、ゴミの分別）',
  '🤝 友人との食事・雑談（久しぶりの近況報告、おすすめの居酒屋、割り勘アプリ、旅行の計画、写真のAirDrop）',
  '✈️ 空港・ホテル・旅行（保安検査場のトレー、搭乗口の変更、ホテルのルームキー、スーツケースの重量、観光ガイドブック）',
  '📚 図書館・勉強・資格（静かな自習スペース、参考書の付箋、蛍光ペンのインク切れ、集中タイマー、英単語の復習）',
  '🍽️ レストラン・ディナー（日替わりパスタの注文、アレルギー食材の確認、お冷のおかわり、デザートメニューの追加、お会計）',
  '🚗 ドライブ・ガソリンスタンド（カーナビのリルート、タイヤの空気圧、洗車機のコース選択、サービスエリアの休憩、渋滞情報）',
  '⛺ キャンプ・アウトドア（焚き火の薪割り、テントのペグ打ち、虫除けスプレー、満点の星空、朝淹れたてのコーヒー）',
  '🎨 趣味・カメラ・DIY（レンズのキャップ、ドライバーのサイズ、日曜大工の棚作り、水彩画の筆洗い、お気に入りのアングル）',
  '🏥 病院・薬局・体調（花粉症の目薬、処方箋の受付、体温計のピピッという音、ビタミン剤の服用、うがいと手洗い）',
  '🛍️ ファッション・試着室（サイズ感の確認、色違いの在庫、丈の長さの調整、レジ前のセール品、春物のアウター）',
  '🎧 音楽・ライブ・ポッドキャスト（ワイヤレスイヤホンのペアリング、お気に入りプレイリスト、ライブのチケット抽選、ギターのコード練習）',
  '🎂 サプライズ・記念日（誕生日ケーキのロウソク、プレゼントのラッピング、メッセージカード、お祝いの乾杯、記念撮影）',
  '🧹 大掃除・不用品整理（メルカリの出品写真、プチプチでの梱包、押し入れの奥の掘り出し物、窓ガラスの拭き掃除）',
  '💼 就活・面接・キャリア（オンライン面接の背景、履歴書の推敲、志望動機の整理、オフィスカジュアル、名刺交換の練習）',
  '🥐 ベーカリー・朝の風景（焼きたてメロンパンの香り、トングとトレイ、モーニングセット、テイクアウトの紙袋）',
  '🌧️ 雨の日の過ごし方（窓を叩く雨音、ホットココア、お気に入りの長靴、濡れたタオルの乾燥、読書に没頭）',
  '🎡 遊園地・テーマパーク（アトラクションの待ち時間、ファストパスの取得、ポップコーンバケット、お化け屋敷の絶叫）',
  '🪴 ガーデニング・ベランダ菜園（ミニトマトの芽吹き、プランターの土入れ、ハーブの収穫、朝の水やり）',
  '🎮 ゲーム・オンライン対戦（ボイスチャットの音量、コントローラーの充電、協力プレイの作戦会議、高難易度ボスの攻略）',
  '💇 美容院・ヘアサロン（カットの長さの相談、シャンプーの力加減、トリートメントの香り、雑誌のページめくり）',
  '📮 郵便局・市役所（書類の記入、窓口の整理券、身分証明書の提示、切手の貼り付け、マイナンバーカード）',
  '🌙 深夜・夜更かし（静まり返った部屋、間接照明、温かいハーブティー、深夜ラジオ、明日へのアラーム設定）',
  '🚲 自転車・サイクリング（タイヤの空気入れ、チェーンの注油、坂道でのギアチェンジ、川沿いの爽快な風）',
  '🍱 ピクニック・公園（レジャーシートを広げる、手作りのおにぎり、芝生での昼寝、シャボン玉、鳩の群れ）',
];

const CONTEXT_MODIFIERS = [
  { time: '早朝', mood: 'まだ少し眠そうだが澄んだ気持ちで', subject: 'I' },
  { time: '午前中の忙しい時間帯', mood: '手際よくテキパキと', subject: 'My coworker' },
  { time: '昼休み', mood: 'ほっと一息つきながら', subject: 'We' },
  { time: '夕方の帰り道', mood: '一日の疲れを感じつつもリラックスして', subject: 'You' },
  { time: '休日の午後', mood: 'のんびりと趣味を楽しみながら', subject: 'The barista' },
  { time: '深夜', mood: '静かな部屋で落ち着いて', subject: 'My roommate' },
  { time: '急なハプニングの直後', mood: 'ちょっと慌てつつも笑顔で', subject: 'She' },
  { time: '待ち合わせの直前', mood: 'わくわくしながら', subject: 'He' },
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

  // 1. 過去の出題履歴（直近40〜50問）を取得して重複禁止リストを作成
  const recentRecords = loadLabQuestionRecords();
  const avoidSentences = Array.from(
    new Set(
      recentRecords
        .slice(0, 50)
        .map(r => r.sentenceEn?.trim())
        .filter(Boolean)
    )
  );

  // 2. 多様なシチュエーション＆コンテキスト修飾子をランダムにブレンド
  const shuffledSeeds = [...SITUATION_SEEDS].sort(() => Math.random() - 0.5);
  const shuffledModifiers = [...CONTEXT_MODIFIERS].sort(() => Math.random() - 0.5);
  const selectedSituations = shuffledSeeds.slice(0, count);

  const situationPrompts = selectedSituations
    .map((s, idx) => {
      const mod = shuffledModifiers[idx % shuffledModifiers.length];
      return `  - ${idx + 1}問目の場面: ${s} (状況: ${mod.time}、${mod.mood}、主語の例: ${mod.subject})`;
    })
    .join('\n');

  const systemInstruction = `あなたは第二言語習得論（SLA）およびリスニング認知負荷トレーニングの専門家です。
リスニングの「ワーキングメモリ（脳内バッファ）限界測定＆リアルタイム聴解訓練」のために、指定された【目標単語数（${wordCount}単語）】に厳密に合わせた、自然で生き生きとしたネイティブの日常会話短文を【${count}問】作成してください。

【絶対ルール】
1. 各英文の単語数は、目標単語数【${wordCount}単語】（±1語以内）に厳密に一致させてください。
2. ${count}問はすべて全く異なるシチュエーション、多様な主語（I, You, She, He, We, My coworker, The barista, Someone など）、多彩な日常句動詞・前置詞を用いて作成してください。
3. 【禁止事項】「Leo」「Alex」「駅への行き方 (way to the station)」「傘を忘れた (forgot umbrella)」のようなステレオタイプな教科書フレーズは避け、リアルな現代生活シーンから作成してください。
4. 英文は生きたカジュアルな日常会話・口語表現にしてください（短縮形や自然なリンキング・弱形を歓迎）。
5. 日本語訳（translationJa）は、自然でこなれた正確な日本語にしてください。
6. 英語の急所解説（englishExplanation）と、音声変化（phoneticPoints: リダクション、リンキング、脱落音のポイント）を付与してください。
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

  let userPrompt = `CEFRレベル【${cefrLevel}】、目標単語数【${wordCount}単語】で、以下のシチュエーションに基づく${count}問のリスニング用短文をJSON配列で生成してください:\n${situationPrompts}`;

  if (avoidSentences.length > 0) {
    userPrompt += `\n\n【★最重要：重複・類似禁止リスト（過去に出題済みの以下の英文やこれと似た構文・フレーズは絶対に生成しないでください）】\n${avoidSentences.slice(0, 30).map((s, i) => `${i + 1}. "${s}"`).join('\n')}\n※必ず上記と全く異なる新しい文構造・日常表現を用いてください。`;
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
      { en: "Turn off the lights.", ja: "電気を消して。", exp: "Turn off: 句動詞（消す）", pho: "Turn off -> /tɜːrnɔːf/ (連結)" },
      { en: "I missed the bus.", ja: "バスに乗り遅れました。", exp: "miss: 乗り遅れる", pho: "missed the -> /mɪstðə/ (破裂音の消失)" },
      { en: "Let's grab some lunch.", ja: "お昼ご飯を食べに行こう。", exp: "grab lunch: 軽く食事をとる", pho: "grab some -> /ɡræbsəm/" },
      { en: "Please leave a message.", ja: "メッセージを残してください。", exp: "leave a message: 伝言を残す", pho: "leave a -> /liːvə/ (連結)" },
      { en: "We need more time.", ja: "もっと時間が必要です。", exp: "need more: もっと必要", pho: "need more -> /niːdmɔːr/" },
      { en: "Call me back later.", ja: "あとで掛け直してね。", exp: "call back: 折り返し電話する", pho: "call me -> /kɔːlmi/" },
      { en: "The battery is low.", ja: "バッテリーが切れそうです。", exp: "battery is low: 残量低下", pho: "is low -> /ɪzloʊ/" },
      { en: "Keep up the work.", ja: "その調子で頑張って。", exp: "keep up: 維持する", pho: "keep up -> /kiːpʌp/" },
    ],
    6: [
      { en: "Can you send me the file?", ja: "そのファイルを送ってくれる？", exp: "send A B: AにBを送る", pho: "send me -> /sɛndmi/" },
      { en: "I have to leave right now.", ja: "今すぐ出ないといけない。", exp: "have to: 〜しなければならない", pho: "have to -> /hæftə/ (無声化)" },
      { en: "She decided to buy a car.", ja: "彼女は車を買うことに決めた。", exp: "decide to: 〜することに決める", pho: "buy a -> /baɪjə/ (渡り音)" },
      { en: "We are waiting for the rain.", ja: "私たちは雨宿りしています。", exp: "wait for: 〜を待つ", pho: "waiting for -> /weɪtɪŋfər/ (弱形)" },
      { en: "My train was delayed this morning.", ja: "今朝は電車が遅延していました。", exp: "be delayed: 遅延する", pho: "was delayed -> /wəzdɪleɪd/" },
      { en: "Could you pass me the salt?", ja: "お塩を取っていただけますか？", exp: "pass A B: AにBを渡す", pho: "pass me -> /pæsmi/" },
      { en: "He always drinks coffee after lunch.", ja: "彼はいつも昼食後にコーヒーを飲みます。", exp: "after lunch: 昼食後", pho: "drinks coffee -> /drɪŋkskɔːfi/" },
    ],
    8: [
      { en: "I should have called you before leaving home.", ja: "家を出る前にあなたに電話するべきだった。", exp: "should have + p.p.: 〜するべきだった", pho: "should have -> /ʃʊdəv/ (弱形・脱落)" },
      { en: "Could you please help me move this desk?", ja: "この机を動かすのを手伝っていただけますか？", exp: "help + O + 原形: Oが〜するのを手伝う", pho: "help me -> /hɛlpmi/" },
      { en: "He was surprised to hear the shocking news.", ja: "彼はその衝撃的な知らせを聞いて驚いた。", exp: "be surprised to: 〜して驚く", pho: "surprised to -> /sərpraɪzd tə/" },
      { en: "We decided to hold the meeting online today.", ja: "私たちは今日、会議をオンラインで開催することに決めました。", exp: "hold a meeting: 会議を開催する", pho: "meeting online -> /miːtɪŋɔːnlaɪn/" },
      { en: "She forgot to charge her phone last night.", ja: "彼女は昨夜スマホを充電し忘れました。", exp: "forget to do: 〜し忘れる", pho: "forgot to -> /fərɡɑːttə/" },
      { en: "I cannot connect to the office Wi-Fi network.", ja: "オフィスのWi-Fiネットワークに接続できません。", exp: "connect to: 〜に接続する", pho: "connect to -> /kənɛkt tə/" },
    ],
    10: [
      { en: "I was looking forward to seeing my friends this weekend.", ja: "今週末に友達と会うのをとても楽しみにしていました。", exp: "look forward to -ing: 〜を楽しみに待つ", pho: "forward to -> /fɔːrwərd tə/" },
      { en: "You should double check your passport before heading to the airport.", ja: "空港に向かう前にパスポートを再確認したほうがいいですよ。", exp: "head to: 〜に向かう", pho: "heading to -> /hɛdɪŋtə/" },
      { en: "My coworker helped me prepare the slides for the presentation.", ja: "同僚がプレゼンのスライド準備を手伝ってくれました。", exp: "prepare for: 〜の準備をする", pho: "helped me -> /hɛlptmi/" },
      { en: "The weather forecast said it would clear up by evening.", ja: "天気予報では夕方までに晴れると言っていました。", exp: "clear up: 晴れ上がる", pho: "clear up -> /klɪrʌp/ (連結)" },
    ],
    12: [
      { en: "I was wondering if you could give me a hand with this project.", ja: "このプロジェクトを手伝っていただけないかと思いまして。", exp: "I was wondering if...: 丁寧な依頼表現", pho: "give me a hand -> /ɡɪvmiəhænd/ (連続リンキング)" },
      { en: "You should take an umbrella because the weather forecast predicted heavy rain.", ja: "天気予報で大雨が予想されていたので、傘を持っていくべきです。", exp: "predict: 予測する", pho: "take an -> /teɪkən/, weather forecast -> /wɛðər fɔːrkæst/" },
      { en: "She spent the whole afternoon cleaning her room and organizing old books.", ja: "彼女は午後ずっと部屋の掃除と古い本の整理をして過ごしました。", exp: "spend time -ing: 〜して時間を過ごす", pho: "spent the -> /spɛntðə/" },
    ],
    14: [
      { en: "Even though the traffic was terrible this morning, I managed to arrive at work on time.", ja: "今朝は渋滞がひどかったにもかかわらず、なんとか時間通りに出社できました。", exp: "manage to: なんとか〜する", pho: "managed to -> /mænɪdʒd tə/" },
      { en: "If you have any questions about the new software, please feel free to ask me.", ja: "新しいソフトウェアについて何か質問があれば、いつでも遠慮なく聞いてくださいね。", exp: "feel free to: ご自由に〜する", pho: "feel free -> /fiːlfriː/" },
    ],
    16: [
      { en: "I was planning to go grocery shopping after work, but I was so exhausted that I went straight home.", ja: "仕事の後に買い出しに行く予定でしたが、あまりに疲れていたのでまっすぐ家に帰りました。", exp: "so ... that: あまりに〜なので", pho: "grocery shopping -> /ɡroʊsəri ʃɑːpɪŋ/" },
    ],
    20: [
      { en: "Although we encountered several unexpected technical issues during the launch, the team worked together and successfully delivered the update without any major downtime.", ja: "ローンチ中に予期せぬ技術的トラブルがいくつか発生したものの、チームが一丸となって対応し、大きなサービス停止もなく無事にアップデートを完了できました。", exp: "encounter issues: 問題に直面する", pho: "worked together -> /wɜːrkt təɡɛðər/" },
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
