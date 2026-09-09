export type ErrorCauseCategory = 
  | 'vocabulary'           // 単語・イディオムを知らなかった
  | 'syntax_order'         // 語順・文の組み立て（瞬間英作文）が追いつかなかった
  | 'direct_translation'   // 日本語を直訳して不自然になった
  | 'tense_modals'         // 時制・助動詞（would/could等）の使い分けミス
  | 'preposition_colloc'   // 前置詞やコロケーションのミス
  | 'other';

export interface ExpressionErrorItem {
  id: string;
  userUtterance: string;        // ユーザーの発話（例: "I very want to eat sushi."）
  naturalExpression: string;    // 自然な英語（例: "I really want to eat sushi." / "I'd love to have sushi."）
  corePattern: string;          // 本質的な文法・語法パターン（例: "動詞の強調における very の誤用（very ではなく really / love to を使う）"）
  explanation: string;          // なぜ間違いなのか、どう考えるべきかの解説
  causeCategory: ErrorCauseCategory; // なぜ詰まったか
  userNote?: string;            // ユーザー自身のメモ・気づき
  sourceSessionId?: string;     // どの英会話セッション由来か
  personaName?: string;         // 誰との会話か
  storyReinforcedCount: number; // ストーリーで応用出題された回数
  createdAt: string;            // ISO timestamp
  lastReinforcedAt?: string;    // 直近でストーリーに出現した日時
}
