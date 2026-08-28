export interface DifficultSentenceItem {
  id: string;
  sentence: string;          // 英文 (全文・選択文)
  translation: string;       // 日本語訳
  highlightedPhrase?: string;// 選択していたフレーズ・キーワード
  sourceStoryId?: string;    // ストーリーID
  sourceStoryTitle?: string; // ストーリータイトル
  note?: string;             // 補足メモ
  createdAt: string;         // ISO timestamp
}