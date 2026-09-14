export interface VocabLookupResult {
  phrase: string;
  meaning: string;
  part_of_speech: string;
  explanation: string;
  context_sentence?: string;
}

export type CardState = 'new' | 'learning' | 'review' | 'relearning';

export interface PatternVariationData {
  sentence: string;
  translation: string;
  targetTokens: string[];
}

/**
 * 構文・文法の構造化コアパターン仮説（2〜3個）
 */
export interface ExtractedCorePattern {
  patternName: string;      // 構文名 (例: "too...to構文", "that名詞節", "否定倒置")
  formula: string;          // 骨格 (例: "S + be + too [Adj] + to [Verb]")
  meaningTemplate: string;  // 日本語の型 (例: "Sはあまりに[Adj]なので[Verb]できない")
  highlightTokens: string[];// 文中で該当する英単語 (例: ["too", "heavy", "to", "carry"])
  briefNote: string;        // 1行の急所解説
}

export interface VocabItem {
  id: string;
  phrase: string;             // 見出し語 / キー表現 / 文
  meaning: string;            // 和訳・意味
  partOfSpeech: string;       // 品詞 / 分類
  contextNote: string;        // ニュアンス・補足
  exampleSentence: string;    // 例文（1文全体）
  
  // 1文カード拡張フィールド
  sentence?: string;          // 1文全体（exampleSentenceと共通）
  translation?: string;       // 1文の日本語訳
  focusType?: 'word' | 'pattern' | 'sentence'; // 何がフォーカスか
  focusWord?: string;         // 単語フォーカス時の語
  focusMeaning?: string;      // 単語フォーカス時の意味
  corePatterns?: ExtractedCorePattern[]; // 構文フォーカス時の2〜3個の構造化仮説
  
  // Anki 兄弟カード (Sibling Cards) & 同日重複防止 (Burying)
  cardDirection?: 'en_to_ja' | 'ja_to_en'; // 'en_to_ja' (読解コンパイル) | 'ja_to_en' (瞬間英作文)
  siblingId?: string;         // 対になる兄弟カードのID
  buriedUntilDate?: string;   // 同日出題防止用の延期期日 (YYYY-MM-DD)

  lapseCount: number;         // 忘れてタップした回数
  repetitionCount: number;    // 正解・定着カウント
  intervalDays: number;       // 次回復習までの間隔日数
  nextReviewDate: string;     // YYYY-MM-DD
  lastReviewedAt: string;     // ISO timestamp
  createdAt: string;          // ISO timestamp
  sourceStoryId?: string;     // どのストーリー由来か
  importance?: number;        // 重要度スコア: 1〜5 (5が最重要・日常英会話必須)
  easeFactor?: number;        // Anki Ease Factor (初期値 2.5, 最小 1.3)
  
  // 本家Anki Learning/Relearning ステップ永続化フィールド
  cardState?: CardState;      // 'new' | 'learning' | 'review' | 'relearning'
  learningStep?: number;      // 0 (Step 1: 1分), 1 (Step 2: 10分)
  dueTimestamp?: number | null; // 当日内再出題のミリ秒タイムスタンプ

  // 互換性フィールド
  cardType?: 'vocab' | 'pattern';
  patternId?: string;
  level?: string;
  variations?: PatternVariationData[];
}

export type VocabFilterStatus = 'all' | 'due' | 'learning' | 'mastered';
