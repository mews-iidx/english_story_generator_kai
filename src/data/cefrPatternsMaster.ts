import { PatternMasterItem } from '../types/mastery';

export const CEFR_PATTERNS_MASTER: PatternMasterItem[] = [
  {
    "id": "pat_a1_001",
    "cefr": "A1",
    "category": "basic_syntax",
    "categoryLabel": "基本文型 (SVO)",
    "name": "S + V + O (第3文型)",
    "meaning": "〜が…を〜する (基本の他動詞文)",
    "focus": "英語の最も基本的な語順「主語 ➔ 動詞 ➔ 目的語」の骨組み",
    "variations": [
      {
        "sentence": "I read an interesting book yesterday.",
        "translation": "私は昨日面白い本を読んだ。",
        "targetTokens": [
          "read",
          "book"
        ]
      },
      {
        "sentence": "She plays tennis every Sunday morning.",
        "translation": "彼女は毎週日曜日の朝にテニスをする。",
        "targetTokens": [
          "plays",
          "tennis"
        ]
      },
      {
        "sentence": "They bought a new car last week.",
        "translation": "彼らは先週新しい車を買った。",
        "targetTokens": [
          "bought",
          "car"
        ]
      }
    ]
  },
  {
    "id": "pat_a1_002",
    "cefr": "A1",
    "category": "basic_syntax",
    "categoryLabel": "基本文型 (SVC)",
    "name": "S + V + C (第2文型 / be動詞・look)",
    "meaning": "〜は…である / …に見える (S = C の関係)",
    "focus": "主語と補語がイコールの関係になる文構造",
    "variations": [
      {
        "sentence": "My brother is a kind doctor.",
        "translation": "私の兄は親切な医者です。",
        "targetTokens": [
          "is",
          "doctor"
        ]
      },
      {
        "sentence": "You look very happy today.",
        "translation": "あなたは今日とても嬉しそうに見えます。",
        "targetTokens": [
          "look",
          "happy"
        ]
      },
      {
        "sentence": "This soup smells delicious.",
        "translation": "このスープはとても美味しそうな匂いがする。",
        "targetTokens": [
          "smells",
          "delicious"
        ]
      }
    ]
  },
  {
    "id": "pat_a1_003",
    "cefr": "A1",
    "category": "basic_syntax",
    "categoryLabel": "存在構文 (There is/are)",
    "name": "There is / There are ~",
    "meaning": "〜がある、〜がいる (新情報の導入)",
    "focus": "場所や存在を新しく聞き手に伝える「There is/are」構文",
    "variations": [
      {
        "sentence": "There is a small cat under the table.",
        "translation": "テーブルの下に小さな猫が1匹います。",
        "targetTokens": [
          "There",
          "is"
        ]
      },
      {
        "sentence": "There are many famous parks in London.",
        "translation": "ロンドンには多くの有名な公園があります。",
        "targetTokens": [
          "There",
          "are"
        ]
      },
      {
        "sentence": "There was a big storm last night.",
        "translation": "昨夜大きな嵐がありました。",
        "targetTokens": [
          "There",
          "was"
        ]
      }
    ]
  },
  {
    "id": "pat_a1_004",
    "cefr": "A1",
    "category": "infinitives_gerunds",
    "categoryLabel": "不定詞 (願望・意図)",
    "name": "want to + 動詞の原形",
    "meaning": "〜したい (直接的な願望)",
    "focus": "動詞wantの後にto不定詞を置いて「〜したい」を表す型",
    "variations": [
      {
        "sentence": "I want to learn English quickly.",
        "translation": "私は早く英語を学びたいです。",
        "targetTokens": [
          "want",
          "to"
        ]
      },
      {
        "sentence": "He wants to visit Japan next summer.",
        "translation": "彼は来年の夏に日本を訪れたがっています。",
        "targetTokens": [
          "wants",
          "to"
        ]
      },
      {
        "sentence": "Do you want to drink some coffee?",
        "translation": "コーヒーを少し飲みたいですか？",
        "targetTokens": [
          "want",
          "to"
        ]
      }
    ]
  },
  {
    "id": "pat_a1_005",
    "cefr": "A1",
    "category": "infinitives_gerunds",
    "categoryLabel": "不定詞 (必要性)",
    "name": "need to + 動詞の原形",
    "meaning": "〜する必要がある",
    "focus": "客観的な必要性や義務を柔らかく表す型",
    "variations": [
      {
        "sentence": "You need to rest after work.",
        "translation": "仕事の後は休む必要があります。",
        "targetTokens": [
          "need",
          "to"
        ]
      },
      {
        "sentence": "We need to leave the house early.",
        "translation": "私たちは早く家を出る必要があります。",
        "targetTokens": [
          "need",
          "to"
        ]
      },
      {
        "sentence": "I need to buy some milk today.",
        "translation": "今日牛乳を買う必要があります。",
        "targetTokens": [
          "need",
          "to"
        ]
      }
    ]
  },
  {
    "id": "pat_a1_006",
    "cefr": "A1",
    "category": "infinitives_gerunds",
    "categoryLabel": "動名詞 (趣味・好み)",
    "name": "like + 〜ing (動名詞)",
    "meaning": "〜するのが好きだ",
    "focus": "一般的な行動や習慣を「〜すること」として好む型",
    "variations": [
      {
        "sentence": "She likes cooking Italian food at home.",
        "translation": "彼女は家でイタリア料理を作るのが好きです。",
        "targetTokens": [
          "likes",
          "cooking"
        ]
      },
      {
        "sentence": "I like listening to quiet music at night.",
        "translation": "私は夜に静かな音楽を聴くのが好きです。",
        "targetTokens": [
          "like",
          "listening"
        ]
      },
      {
        "sentence": "Do you like watching action movies?",
        "translation": "アクション映画を見るのは好きですか？",
        "targetTokens": [
          "like",
          "watching"
        ]
      }
    ]
  },
  {
    "id": "pat_a1_007",
    "cefr": "A1",
    "category": "modals",
    "categoryLabel": "助動詞 (能力・許可)",
    "name": "can + 動詞の原形 / can't",
    "meaning": "〜できる / 〜できない",
    "focus": "能力（できる）や許可（〜してもよい）を表す助動詞canの型",
    "variations": [
      {
        "sentence": "He can speak three languages fluently.",
        "translation": "彼は3つの言語を流暢に話すことができます。",
        "targetTokens": [
          "can",
          "speak"
        ]
      },
      {
        "sentence": "I can't find my car keys anywhere.",
        "translation": "車の鍵がどこにも見つかりません。",
        "targetTokens": [
          "can't",
          "find"
        ]
      },
      {
        "sentence": "Can you help me with this box?",
        "translation": "この箱を運ぶのを手伝ってくれますか？",
        "targetTokens": [
          "Can",
          "help"
        ]
      }
    ]
  },
  {
    "id": "pat_a1_008",
    "cefr": "A1",
    "category": "modals",
    "categoryLabel": "助動詞 (義務)",
    "name": "have to + 動詞の原形",
    "meaning": "〜しなければならない (客観的義務)",
    "focus": "状況やルールによって「〜せざるを得ない」義務を表す型",
    "variations": [
      {
        "sentence": "I have to wake up at six tomorrow.",
        "translation": "私は明日6時に起きなければなりません。",
        "targetTokens": [
          "have",
          "to"
        ]
      },
      {
        "sentence": "She has to finish her homework tonight.",
        "translation": "彼女は今夜宿題を終わらせなければなりません。",
        "targetTokens": [
          "has",
          "to"
        ]
      },
      {
        "sentence": "Do we have to wear a suit today?",
        "translation": "私たちは今日スーツを着なければなりませんか？",
        "targetTokens": [
          "have",
          "to"
        ]
      }
    ]
  },
  {
    "id": "pat_a1_009",
    "cefr": "A1",
    "category": "tenses_aspects",
    "categoryLabel": "時制 (進行形)",
    "name": "be + 動詞-ing (現在進行形)",
    "meaning": "いま〜しているところだ",
    "focus": "「現時点で進行中の動作」を生き生きと描く型",
    "variations": [
      {
        "sentence": "Listen, it is raining heavily outside.",
        "translation": "聞いて、外で激しく雨が降っているよ。",
        "targetTokens": [
          "is",
          "raining"
        ]
      },
      {
        "sentence": "What are you doing in the kitchen?",
        "translation": "台所で何をしているの？",
        "targetTokens": [
          "are",
          "doing"
        ]
      },
      {
        "sentence": "They are waiting for the next bus.",
        "translation": "彼らは次のバスを待っているところです。",
        "targetTokens": [
          "are",
          "waiting"
        ]
      }
    ]
  },
  {
    "id": "pat_a1_010",
    "cefr": "A1",
    "category": "tenses_aspects",
    "categoryLabel": "時制 (過去形)",
    "name": "過去形 (規則変化 -ed / 不規則変化)",
    "meaning": "〜した (過去の出来事・状態)",
    "focus": "すでに終わった過去の事実を述べる基本時制",
    "variations": [
      {
        "sentence": "I visited my grandparents last Sunday.",
        "translation": "私は先週の日曜日に祖父母を訪ねました。",
        "targetTokens": [
          "visited"
        ]
      },
      {
        "sentence": "She went to Paris two years ago.",
        "translation": "彼女は2年前にパリに行きました。",
        "targetTokens": [
          "went"
        ]
      },
      {
        "sentence": "We saw a great movie together yesterday.",
        "translation": "私たちは昨日一緒に素晴らしい映画を見ました。",
        "targetTokens": [
          "saw"
        ]
      }
    ]
  },
  {
    "id": "pat_a1_011",
    "cefr": "A1",
    "category": "questions_negatives",
    "categoryLabel": "疑問文 (5W1H)",
    "name": "Wh- 疑問文 (Where / What / When / Why / Who / How)",
    "meaning": "どこで / 何を / いつ / なぜ / 誰が / どのように",
    "focus": "Yes/Noではなく具体的な情報を尋ねる疑問詞の語順",
    "variations": [
      {
        "sentence": "Where did you buy that beautiful shirt?",
        "translation": "その素敵なシャツはどこで買ったのですか？",
        "targetTokens": [
          "Where",
          "did"
        ]
      },
      {
        "sentence": "Why are you looking so worried today?",
        "translation": "なぜ今日はそんなに心配そうな顔をしているのですか？",
        "targetTokens": [
          "Why",
          "are"
        ]
      },
      {
        "sentence": "How much does this cup of coffee cost?",
        "translation": "このコーヒーはいくらですか？",
        "targetTokens": [
          "How",
          "much"
        ]
      }
    ]
  },
  {
    "id": "pat_a1_012",
    "cefr": "A1",
    "category": "coordination",
    "categoryLabel": "接続詞 (因果関係)",
    "name": "because + S + V (理由の接続詞)",
    "meaning": "なぜなら〜だから (理由・原因の提示)",
    "focus": "文と文を「理由」で繋ぐ最も基本的な従属接続詞",
    "variations": [
      {
        "sentence": "I stayed home because it was raining.",
        "translation": "雨が降っていたので私は家にいました。",
        "targetTokens": [
          "because"
        ]
      },
      {
        "sentence": "He was happy because he passed the test.",
        "translation": "テストに合格したので彼は嬉しかった。",
        "targetTokens": [
          "because"
        ]
      },
      {
        "sentence": "She smiled because she saw a cute puppy.",
        "translation": "可愛い子犬を見たので彼女は微笑んだ。",
        "targetTokens": [
          "because"
        ]
      }
    ]
  },
  {
    "id": "pat_a1_013",
    "cefr": "A1",
    "category": "basic_syntax",
    "categoryLabel": "命令文・依頼",
    "name": "Imperative (動詞原形) / Please ~",
    "meaning": "〜しなさい / どうぞ〜してください",
    "focus": "主語を省いて動詞から始める指示・依頼の型",
    "variations": [
      {
        "sentence": "Please close the door quietly.",
        "translation": "静かにドアを閉めてください。",
        "targetTokens": [
          "Please",
          "close"
        ]
      },
      {
        "sentence": "Take an umbrella with you today.",
        "translation": "今日は傘を持っていきなさい。",
        "targetTokens": [
          "Take"
        ]
      },
      {
        "sentence": "Don't touch that hot pan.",
        "translation": "その熱いフライパンに触らないで。",
        "targetTokens": [
          "Don't",
          "touch"
        ]
      }
    ]
  },
  {
    "id": "pat_a1_014",
    "cefr": "A1",
    "category": "basic_syntax",
    "categoryLabel": "授与動詞 (SVOO)",
    "name": "give / show / send + 人 + 物 (第4文型)",
    "meaning": "人に物をあげる / 見せる / 送る",
    "focus": "「人」に「物」を与える二重目的語の語順",
    "variations": [
      {
        "sentence": "He gave his sister a birthday present.",
        "translation": "彼は妹に誕生日プレゼントをあげた。",
        "targetTokens": [
          "gave",
          "sister",
          "present"
        ]
      },
      {
        "sentence": "Show me your new smartphone.",
        "translation": "あなたの新しいスマートフォンを見せてください。",
        "targetTokens": [
          "Show",
          "me"
        ]
      },
      {
        "sentence": "I will send you an email tonight.",
        "translation": "今夜あなたにメールを送ります。",
        "targetTokens": [
          "send",
          "you",
          "email"
        ]
      }
    ]
  },
  {
    "id": "pat_a2_001",
    "cefr": "A2",
    "category": "comparatives",
    "categoryLabel": "比較 (同等比較)",
    "name": "as + 形容詞/副詞 + as ~",
    "meaning": "〜と同じくらい…だ",
    "focus": "2つのものを比較して「同程度」であることを表す基本相関構文",
    "variations": [
      {
        "sentence": "Tom is as tall as his father now.",
        "translation": "トムは今や父親と同じくらいの背丈だ。",
        "targetTokens": [
          "as",
          "as"
        ]
      },
      {
        "sentence": "This puzzle is not as easy as it looks.",
        "translation": "このパズルは見た目ほど簡単ではない。",
        "targetTokens": [
          "as",
          "as"
        ]
      },
      {
        "sentence": "Please reply as soon as possible.",
        "translation": "できるだけ早く返信してください。",
        "targetTokens": [
          "as",
          "as"
        ]
      }
    ]
  },
  {
    "id": "pat_a2_002",
    "cefr": "A2",
    "category": "comparatives",
    "categoryLabel": "比較 (比較級・最上級)",
    "name": "比較級 + than / the + 最上級",
    "meaning": "〜よりも…だ / 最も…だ",
    "focus": "-er than や the -est / more than による差異の強調",
    "variations": [
      {
        "sentence": "Health is more important than money.",
        "translation": "健康はお金よりも大切です。",
        "targetTokens": [
          "more",
          "than"
        ]
      },
      {
        "sentence": "Today is much warmer than yesterday.",
        "translation": "今日は昨日よりずっと暖かいです。",
        "targetTokens": [
          "warmer",
          "than"
        ]
      },
      {
        "sentence": "This is the oldest building in our city.",
        "translation": "これは私たちの街で最も古い建物です。",
        "targetTokens": [
          "the",
          "oldest"
        ]
      }
    ]
  },
  {
    "id": "pat_a2_003",
    "cefr": "A2",
    "category": "correlative",
    "categoryLabel": "程度構文 (過剰)",
    "name": "too + 形容詞 (過度の程度)",
    "meaning": "あまりにも…すぎる (限度を超えている)",
    "focus": "「too + 形容詞」で度が過ぎているネガティブなニュアンスを表す",
    "variations": [
      {
        "sentence": "The water in the pool is too cold.",
        "translation": "プールの水は冷たすぎます。",
        "targetTokens": [
          "too",
          "cold"
        ]
      },
      {
        "sentence": "This jacket is too expensive for me.",
        "translation": "このジャケットは私には高すぎます。",
        "targetTokens": [
          "too",
          "expensive"
        ]
      },
      {
        "sentence": "He drives too fast on this road.",
        "translation": "彼はこの道でスピードを出しすぎている。",
        "targetTokens": [
          "too",
          "fast"
        ]
      }
    ]
  },
  {
    "id": "pat_a2_004",
    "cefr": "A2",
    "category": "correlative",
    "categoryLabel": "程度構文 (十分)",
    "name": "形容詞 + enough (十分な程度)",
    "meaning": "十分に…である",
    "focus": "enoughが形容詞の「後ろ」に置かれる語順ルール",
    "variations": [
      {
        "sentence": "Is this room warm enough for you?",
        "translation": "この部屋はあなたにとって十分に暖かいですか？",
        "targetTokens": [
          "warm",
          "enough"
        ]
      },
      {
        "sentence": "She is old enough to drive a car.",
        "translation": "彼女は車を運転できる年齢だ。",
        "targetTokens": [
          "old",
          "enough"
        ]
      },
      {
        "sentence": "We arrived early enough to get good seats.",
        "translation": "私たちは良い席を取るのに十分早く到着した。",
        "targetTokens": [
          "early",
          "enough"
        ]
      }
    ]
  },
  {
    "id": "pat_a2_005",
    "cefr": "A2",
    "category": "tenses_aspects",
    "categoryLabel": "時制 (未来予定)",
    "name": "be going to + 動詞の原形",
    "meaning": "〜する予定だ、〜しそうだ (確定的な未来)",
    "focus": "すでに決まっている予定や、目に見える兆候のある未来",
    "variations": [
      {
        "sentence": "Look at those dark clouds; it is going to rain.",
        "translation": "あの暗い雲を見て、雨が降りそうだ。",
        "targetTokens": [
          "going",
          "to"
        ]
      },
      {
        "sentence": "I am going to meet my friend at seven.",
        "translation": "私は7時に友達と会う予定です。",
        "targetTokens": [
          "going",
          "to"
        ]
      },
      {
        "sentence": "What are you going to do this weekend?",
        "translation": "今週末は何をする予定ですか？",
        "targetTokens": [
          "going",
          "to"
        ]
      }
    ]
  },
  {
    "id": "pat_a2_006",
    "cefr": "A2",
    "category": "tenses_aspects",
    "categoryLabel": "時制 (経験の現在完了)",
    "name": "Have you ever + 過去分詞 ~?",
    "meaning": "今までに〜したことがありますか？",
    "focus": "過去から現在までの「経験」の有無を尋ねる型",
    "variations": [
      {
        "sentence": "Have you ever been to Hawaii?",
        "translation": "今までにハワイに行ったことがありますか？",
        "targetTokens": [
          "Have",
          "ever",
          "been"
        ]
      },
      {
        "sentence": "Have you ever eaten traditional Spanish food?",
        "translation": "伝統的なスペイン料理を食べたことがありますか？",
        "targetTokens": [
          "Have",
          "ever",
          "eaten"
        ]
      },
      {
        "sentence": "I have never seen such a huge dog before.",
        "translation": "私は以前にこんな大きな犬を見たことがありません。",
        "targetTokens": [
          "have",
          "never",
          "seen"
        ]
      }
    ]
  },
  {
    "id": "pat_a2_007",
    "cefr": "A2",
    "category": "tenses_aspects",
    "categoryLabel": "過去の習慣 (used to)",
    "name": "used to + 動詞の原形",
    "meaning": "以前は〜していた (今はもうしていない)",
    "focus": "「過去の習慣や状態」と「現在との対比」を表す重要構文",
    "variations": [
      {
        "sentence": "I used to live near the ocean when I was young.",
        "translation": "私は若い頃海の近くに住んでいた（今は住んでいない）。",
        "targetTokens": [
          "used",
          "to"
        ]
      },
      {
        "sentence": "She used to play the piano every day.",
        "translation": "彼女は以前毎日ピアノを弾いていた。",
        "targetTokens": [
          "used",
          "to"
        ]
      },
      {
        "sentence": "There used to be a bakery on this corner.",
        "translation": "この角には以前パン屋があった。",
        "targetTokens": [
          "used",
          "to"
        ]
      }
    ]
  },
  {
    "id": "pat_a2_008",
    "cefr": "A2",
    "category": "causative_passive",
    "categoryLabel": "使役・許可 (make / let)",
    "name": "make / let + 人 + 動詞の原形",
    "meaning": "人に〜させる / 人に〜させてあげる",
    "focus": "toのない原形不定詞を取る使役構文の基本",
    "variations": [
      {
        "sentence": "The funny movie made everyone laugh.",
        "translation": "その面白い映画はみんなを笑わせた。",
        "targetTokens": [
          "made",
          "laugh"
        ]
      },
      {
        "sentence": "Please let me know when you arrive.",
        "translation": "到着したら私に知らせてください。",
        "targetTokens": [
          "let",
          "know"
        ]
      },
      {
        "sentence": "Her parents let her study abroad in Canada.",
        "translation": "彼女の両親は彼女にカナダ留学をさせてあげた。",
        "targetTokens": [
          "let",
          "study"
        ]
      }
    ]
  },
  {
    "id": "pat_b1_001",
    "cefr": "B1",
    "category": "correlative",
    "categoryLabel": "相関構文 (過剰否定)",
    "name": "too [形容詞] to [動詞]",
    "meaning": "〜すぎて…できない (否定語なしの否定)",
    "focus": "tooとto不定詞がペアになり「結果として〜できない」を表す必須構文",
    "variations": [
      {
        "sentence": "I was too tired to drive home safely.",
        "translation": "私は疲れすぎて安全に家まで運転できなかった。",
        "targetTokens": [
          "too",
          "to"
        ]
      },
      {
        "sentence": "The box was too heavy for the boy to lift.",
        "translation": "その箱は重すぎてその少年には持ち上げられなかった。",
        "targetTokens": [
          "too",
          "to"
        ]
      },
      {
        "sentence": "The explanation was too complicated to understand.",
        "translation": "その説明は複雑すぎて理解できなかった。",
        "targetTokens": [
          "too",
          "to"
        ]
      }
    ]
  },
  {
    "id": "pat_b1_002",
    "cefr": "B1",
    "category": "correlative",
    "categoryLabel": "相関構文 (結果のso that)",
    "name": "so [形容詞/副詞] that [S + V]",
    "meaning": "とても…なので〜だ (原因と結果の強調)",
    "focus": "soで程度を強調し、that以下の節で生じた結果を述べる重要構文",
    "variations": [
      {
        "sentence": "It was so cold that the river froze overnight.",
        "translation": "とても寒かったので川が一晩で凍りついた。",
        "targetTokens": [
          "so",
          "that"
        ]
      },
      {
        "sentence": "She spoke so fast that nobody could follow her.",
        "translation": "彼女はあまりに早口で話したので誰もついていけなかった。",
        "targetTokens": [
          "so",
          "that"
        ]
      },
      {
        "sentence": "He was so excited that he couldn't sleep at all.",
        "translation": "彼は興奮しすぎて全く眠れなかった。",
        "targetTokens": [
          "so",
          "that"
        ]
      }
    ]
  },
  {
    "id": "pat_b1_003",
    "cefr": "B1",
    "category": "coordination",
    "categoryLabel": "相関接続詞 (並列)",
    "name": "not only A but also B",
    "meaning": "AだけでなくBも",
    "focus": "AとBに文法上対等な要素（名詞、動詞、文）を並べる相関構文",
    "variations": [
      {
        "sentence": "She speaks not only English but also French fluently.",
        "translation": "彼女は英語だけでなくフランス語も流暢に話す。",
        "targetTokens": [
          "not",
          "only",
          "but",
          "also"
        ]
      },
      {
        "sentence": "The plan is not only creative but also practical.",
        "translation": "その計画は独創的であるだけでなく実用的でもある。",
        "targetTokens": [
          "not",
          "only",
          "but",
          "also"
        ]
      },
      {
        "sentence": "He not only apologized but also paid for the damage.",
        "translation": "彼は謝罪しただけでなく損害の弁償もした。",
        "targetTokens": [
          "not",
          "only",
          "but",
          "also"
        ]
      }
    ]
  },
  {
    "id": "pat_b1_004",
    "cefr": "B1",
    "category": "coordination",
    "categoryLabel": "相関接続詞 (二者択一・両否定)",
    "name": "either A or B / neither A nor B",
    "meaning": "AかBのどちらか / AもBもどちらも〜ない",
    "focus": "2つの選択肢の肯定（either）と完全否定（neither）のペア構造",
    "variations": [
      {
        "sentence": "Neither the manager nor the staff knew the password.",
        "translation": "マネージャーもスタッフも誰もパスワードを知らなかった。",
        "targetTokens": [
          "Neither",
          "nor"
        ]
      },
      {
        "sentence": "You can choose either coffee or tea with your dessert.",
        "translation": "デザートにはコーヒーか紅茶のどちらかをお選びいただけます。",
        "targetTokens": [
          "either",
          "or"
        ]
      },
      {
        "sentence": "Neither answer was completely correct.",
        "translation": "どちらの答えも完全には正しくなかった。",
        "targetTokens": [
          "Neither"
        ]
      }
    ]
  },
  {
    "id": "pat_b1_005",
    "cefr": "B1",
    "category": "relative_clauses",
    "categoryLabel": "関係代名詞 (先行詞修飾)",
    "name": "関係代名詞節 (who / which / that による名詞後置修飾)",
    "meaning": "〜するような［名詞］",
    "focus": "先行詞（名詞）を後ろから文の形で詳しく説明する英語の核心構造",
    "variations": [
      {
        "sentence": "I met a traveler who had visited over fifty countries.",
        "translation": "私は50カ国以上を旅した旅行者に出会った。",
        "targetTokens": [
          "who"
        ]
      },
      {
        "sentence": "This is the problem that we must solve first.",
        "translation": "これが私たちが最初に解決しなければならない問題だ。",
        "targetTokens": [
          "that"
        ]
      },
      {
        "sentence": "The camera which broke yesterday was very expensive.",
        "translation": "昨日壊れたカメラはとても高価だった。",
        "targetTokens": [
          "which"
        ]
      }
    ]
  },
  {
    "id": "pat_b1_006",
    "cefr": "B1",
    "category": "conditionals",
    "categoryLabel": "仮定法 (現在の非現実)",
    "name": "仮定法過去 (If + S + 過去形, S + would/could + 原形)",
    "meaning": "もし（今）〜なら、…だろうに (現在の事実と反対の妄想)",
    "focus": "時制を過去にずらすことで「現実との距離感（妄想）」を表す型",
    "variations": [
      {
        "sentence": "If I had more free time, I would learn Spanish.",
        "translation": "もしもっと自由な時間があれば、スペイン語を学ぶのになあ。",
        "targetTokens": [
          "If",
          "had",
          "would"
        ]
      },
      {
        "sentence": "If she were here, she would know what to do.",
        "translation": "もし彼女がここにいれば、どうすべきか分かるだろうに。",
        "targetTokens": [
          "If",
          "were",
          "would"
        ]
      },
      {
        "sentence": "What would you do if you won the lottery?",
        "translation": "もし宝くじに当たったら何をしますか？",
        "targetTokens": [
          "would",
          "if",
          "won"
        ]
      }
    ]
  },
  {
    "id": "pat_b1_007",
    "cefr": "B1",
    "category": "coordination",
    "categoryLabel": "目的構文 (so that)",
    "name": "so that + S + can/could ~ (目的)",
    "meaning": "〜できるように、〜するために",
    "focus": "目的を表す「so that + 助動詞」の節構造",
    "variations": [
      {
        "sentence": "I woke up early so that I could catch the first train.",
        "translation": "始発電車に乗れるように私は早起きした。",
        "targetTokens": [
          "so",
          "that",
          "could"
        ]
      },
      {
        "sentence": "Speak louder so that everyone can hear you clearly.",
        "translation": "みんなにはっきり聞こえるようにもっと大きな声で話してください。",
        "targetTokens": [
          "so",
          "that",
          "can"
        ]
      },
      {
        "sentence": "He took notes so that he wouldn't forget the instructions.",
        "translation": "指示を忘れないように彼はメモを取った。",
        "targetTokens": [
          "so",
          "that",
          "wouldn't"
        ]
      }
    ]
  },
  {
    "id": "pat_b1_008",
    "cefr": "B1",
    "category": "correlative",
    "categoryLabel": "定型表現 (当然の帰結)",
    "name": "It goes without saying that ~",
    "meaning": "〜は言うまでもない、当然のことだ",
    "focus": "前置きとして当たり前の真理や重要事実を強調する定型構文",
    "variations": [
      {
        "sentence": "It goes without saying that good health is essential.",
        "translation": "健康が不可欠であることは言うまでもない。",
        "targetTokens": [
          "It",
          "goes",
          "without",
          "saying",
          "that"
        ]
      },
      {
        "sentence": "It goes without saying that practice is the key to success.",
        "translation": "練習が成功の鍵であることは言うまでもない。",
        "targetTokens": [
          "It",
          "goes",
          "without",
          "saying",
          "that"
        ]
      },
      {
        "sentence": "It goes without saying that honesty matters most.",
        "translation": "正直さが最も大切であることは言うまでもない。",
        "targetTokens": [
          "It",
          "goes",
          "without",
          "saying",
          "that"
        ]
      }
    ]
  },
  {
    "id": "pat_b2_001",
    "cefr": "B2",
    "category": "inversion_emphasis",
    "categoryLabel": "倒置構文 (否定語の文頭倒置)",
    "name": "Not only + 助動詞 + S + V ... but also",
    "meaning": "〜であるだけでなく、さらに…だ (劇的強調の倒置)",
    "focus": "否定語Not onlyが文頭に出ることで疑問文の語順（倒置）になる高度構文",
    "variations": [
      {
        "sentence": "Not only did he apologize, but he also repaired the car.",
        "translation": "彼は謝罪しただけでなく、さらに車を修理までしてくれた。",
        "targetTokens": [
          "Not",
          "only",
          "did",
          "but"
        ]
      },
      {
        "sentence": "Not only was the hotel expensive, but it was also noisy.",
        "translation": "そのホテルは高価だっただけでなく、騒々しくさえあった。",
        "targetTokens": [
          "Not",
          "only",
          "was",
          "but"
        ]
      },
      {
        "sentence": "Not only can she sing, but she also writes her own songs.",
        "translation": "彼女は歌えるだけでなく、自分で曲も書く。",
        "targetTokens": [
          "Not",
          "only",
          "can",
          "but"
        ]
      }
    ]
  },
  {
    "id": "pat_b2_002",
    "cefr": "B2",
    "category": "participles",
    "categoryLabel": "分詞構文 (状況・時・理由)",
    "name": "分詞構文 (〜ing / 過去分詞 で始まる従属節の短縮)",
    "meaning": "〜しながら / 〜したとき / 〜なので",
    "focus": "接続詞と主語を省略し、動詞を-ing/過去分詞にして文を簡潔に繋ぐ構造",
    "variations": [
      {
        "sentence": "Walking down the crowded street, I ran into an old friend.",
        "translation": "混雑した通りを歩いていると、旧友に偶然出会った。",
        "targetTokens": [
          "Walking"
        ]
      },
      {
        "sentence": "Shocked by the sudden news, she couldn't say a single word.",
        "translation": "突然の知らせにショックを受けて、彼女は一言も言えなかった。",
        "targetTokens": [
          "Shocked"
        ]
      },
      {
        "sentence": "Having finished all his tasks, he left the office with a smile.",
        "translation": "すべての仕事を終えて、彼は笑顔でオフィスを出た。",
        "targetTokens": [
          "Having",
          "finished"
        ]
      }
    ]
  },
  {
    "id": "pat_b2_003",
    "cefr": "B2",
    "category": "conditionals",
    "categoryLabel": "仮定法 (過去の非現実と後悔)",
    "name": "仮定法過去完了 (If + S + had + 過去分詞, S + would have + 過去分詞)",
    "meaning": "もし（あのとき）〜していたら、…だっただろうに",
    "focus": "「過去の事実とは逆の仮定」と「後悔や安堵」を表す構文",
    "variations": [
      {
        "sentence": "If I had known the truth, I would not have made that mistake.",
        "translation": "もし真実を知っていたら、あんな間違いはしなかっただろうに。",
        "targetTokens": [
          "had",
          "known",
          "would",
          "have"
        ]
      },
      {
        "sentence": "If she had left five minutes earlier, she would have caught the train.",
        "translation": "もし5分早く出ていたら、彼女は電車に乗れただろうに。",
        "targetTokens": [
          "had",
          "left",
          "would",
          "have"
        ]
      },
      {
        "sentence": "We would have lost the game if he had not scored.",
        "translation": "もし彼が得点していなかったら、私たちは試合に負けていただろう。",
        "targetTokens": [
          "would",
          "have",
          "had",
          "not"
        ]
      }
    ]
  },
  {
    "id": "pat_b2_004",
    "cefr": "B2",
    "category": "inversion_emphasis",
    "categoryLabel": "強調構文 (It is ... that)",
    "name": "It is [強調したい要素] that [文の残り]",
    "meaning": "〜なのはまさに［…］である",
    "focus": "文の一部（主語、目的語、副詞句）をIt isとthatの間に挟んでスポットライトを当てる",
    "variations": [
      {
        "sentence": "It was in Paris that they first fell in love.",
        "translation": "彼らが初めて恋に落ちたのは、まさにパリでのことだった。",
        "targetTokens": [
          "It",
          "was",
          "that"
        ]
      },
      {
        "sentence": "It was his courage that saved the trapped passengers.",
        "translation": "閉じ込められた乗客を救ったのは、まさに彼の勇気だった。",
        "targetTokens": [
          "It",
          "was",
          "that"
        ]
      },
      {
        "sentence": "It is not money that brings true happiness.",
        "translation": "本当の幸福をもたらすのは、決してお金ではない。",
        "targetTokens": [
          "It",
          "is",
          "that"
        ]
      }
    ]
  },
  {
    "id": "pat_b2_005",
    "cefr": "B2",
    "category": "inversion_emphasis",
    "categoryLabel": "時間相関構文 (即時性)",
    "name": "Hardly / Scarcely + had + S + 過去分詞 ... when / before ~",
    "meaning": "〜するかしないかのうちに…した",
    "focus": "「〜した瞬間すぐに次の事が起きた」という時間的直結をドラマチックに表す倒置構文",
    "variations": [
      {
        "sentence": "Hardly had I stepped outside when the heavy rain began.",
        "translation": "私が外に出るか出ないかのうちに大雨が降り出した。",
        "targetTokens": [
          "Hardly",
          "had",
          "when"
        ]
      },
      {
        "sentence": "Scarcely had the movie ended before everyone stood up to applaud.",
        "translation": "映画が終わるやいなや、観客は総立ちになって拍手した。",
        "targetTokens": [
          "Scarcely",
          "had",
          "before"
        ]
      },
      {
        "sentence": "No sooner had he arrived at the station than the train departed.",
        "translation": "彼が駅に着くやいなや電車は出発した。",
        "targetTokens": [
          "No",
          "sooner",
          "had",
          "than"
        ]
      }
    ]
  },
  {
    "id": "pat_b2_006",
    "cefr": "B2",
    "category": "correlative",
    "categoryLabel": "対比・本質構文",
    "name": "not so much A as B",
    "meaning": "AというよりはむしろBだ",
    "focus": "単なる否定ではなく「本質はAではなくBである」と対比して言い換える洗練された構文",
    "variations": [
      {
        "sentence": "He is not so much a scholar as an inspiring storyteller.",
        "translation": "彼は学者というよりはむしろ心動かすストーリーテラーだ。",
        "targetTokens": [
          "not",
          "so",
          "much",
          "as"
        ]
      },
      {
        "sentence": "Success is not so much about talent as about persistence.",
        "translation": "成功は才能というよりはむしろ粘り強さによるものだ。",
        "targetTokens": [
          "not",
          "so",
          "much",
          "as"
        ]
      },
      {
        "sentence": "It was not so much anger as deep sadness that she felt.",
        "translation": "彼女が感じたのは怒りというよりはむしろ深い悲しみだった。",
        "targetTokens": [
          "not",
          "so",
          "much",
          "as"
        ]
      }
    ]
  }
];

export function getPatternById(id: string): PatternMasterItem | undefined {
  return CEFR_PATTERNS_MASTER.find(p => p.id === id);
}

export function getPatternsByLevel(level: string): PatternMasterItem[] {
  return CEFR_PATTERNS_MASTER.filter(p => p.cefr === level);
}
