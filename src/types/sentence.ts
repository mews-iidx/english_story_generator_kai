export type DifficultyReasonCategory = 'word' | 'grammar' | 'modifier' | 'speed' | 'other';

export interface DifficultSentenceItem {
  id: string;
  sentence: string;          // 英文 (全文・選択文)
  translation: string;       // 日本語訳
  highlightedPhrase?: string;// 選択していたフレーズ・キーワード
  sourceStoryId?: string;    // ストーリーID
  sourceStoryTitle?: string; // ストーリータイトル
  reasonCategory?: DifficultyReasonCategory; // 詰まった理由カテゴリ
  reasonNote?: string;       // 理由の自由メモ (例: "関係代名詞の修飾先が分からなかった")
  note?: string;             // 補足メモ
  createdAt: string;         // ISO timestamp
}