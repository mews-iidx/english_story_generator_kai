import { VocabItem } from '../types/vocab';
import { Story } from '../types/story';

declare global {
  interface Window {
    google?: any;
  }
}

const SPREADSHEET_TITLE = 'StoryKai English Learning Data';
const VOCAB_SHEET_NAME = 'Vocabularies';
const STORIES_SHEET_NAME = 'Stories';

export interface GoogleAuthResult {
  accessToken: string;
}

/**
 * Google Identity Services の TokenClient を初期化してアクセストークンを取得
 */
export function requestGoogleAccessToken(clientId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) {
      reject(new Error('Google Identity Services SDK が読み込まれていません。'));
      return;
    }

    if (!clientId) {
      reject(new Error('Google Client ID が設定されていません。設定画面で入力してください。'));
      return;
    }

    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file',
      callback: (tokenResponse: any) => {
        if (tokenResponse.error) {
          reject(new Error(`Google認証エラー: ${tokenResponse.error}`));
          return;
        }
        resolve(tokenResponse.access_token);
      },
    });

    tokenClient.requestAccessToken();
  });
}

/**
 * 専用スプレッドシートを作成または取得する
 */
export async function getOrCreateSpreadsheet(accessToken: string, existingSheetId?: string | null): Promise<string> {
  if (existingSheetId) {
    // 既存シートの存在確認
    try {
      const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${existingSheetId}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (res.ok) return existingSheetId;
    } catch (e) {
      console.warn('Existing spreadsheet ID invalid or not found, creating new one...', e);
    }
  }

  // 新規スプレッドシートの作成
  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        title: SPREADSHEET_TITLE,
      },
      sheets: [
        {
          properties: { title: VOCAB_SHEET_NAME }
        },
        {
          properties: { title: STORIES_SHEET_NAME }
        }
      ]
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    throw new Error(`スプレッドシート作成失敗: ${err?.error?.message || createRes.statusText}`);
  }

  const sheetData = await createRes.json();
  const spreadsheetId = sheetData.spreadsheetId;

  // 初期ヘッダーの書き込み
  await writeSheetHeaders(spreadsheetId, accessToken);

  return spreadsheetId;
}

async function writeSheetHeaders(spreadsheetId: string, accessToken: string) {
  const vocabHeaders = [
    ['id', 'phrase', 'meaning', 'part_of_speech', 'context_note', 'example_sentence', 'lapse_count', 'interval_days', 'next_review_date', 'last_reviewed_at', 'created_at']
  ];
  const storyHeaders = [
    ['id', 'title', 'title_ja', 'summary', 'created_at', 'cefr_level', 'target_vocabs_json', 'story_content', 'japanese_translation', 'vocab_dict_json']
  ];

  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: [
        {
          range: `${VOCAB_SHEET_NAME}!A1:K1`,
          values: vocabHeaders
        },
        {
          range: `${STORIES_SHEET_NAME}!A1:J1`,
          values: storyHeaders
        }
      ]
    })
  });
}

/**
 * データをGoogleスプレッドシートに一括同期（上書き・更新）
 */
export async function syncAllToGoogleSheets(
  spreadsheetId: string,
  accessToken: string,
  vocabs: VocabItem[],
  stories: Story[]
): Promise<void> {
  const vocabRows = [
    ['id', 'phrase', 'meaning', 'part_of_speech', 'context_note', 'example_sentence', 'lapse_count', 'interval_days', 'next_review_date', 'last_reviewed_at', 'created_at'],
    ...vocabs.map(v => [
      v.id,
      v.phrase,
      v.meaning,
      v.partOfSpeech,
      v.contextNote,
      v.exampleSentence,
      v.lapseCount,
      v.intervalDays,
      v.nextReviewDate,
      v.lastReviewedAt,
      v.createdAt
    ])
  ];

  const storyRows = [
    ['id', 'title', 'title_ja', 'summary', 'created_at', 'cefr_level', 'target_vocabs_json', 'story_content', 'japanese_translation', 'vocab_dict_json'],
    ...stories.map(s => [
      s.id,
      s.title,
      s.titleJa,
      s.summary,
      s.createdAt,
      s.cefrLevel,
      JSON.stringify(s.targetVocabList),
      s.storyContent,
      s.japaneseTranslation,
      JSON.stringify(s.vocabList)
    ])
  ];

  // シートのクリア
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${VOCAB_SHEET_NAME}!A:K:clear`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${STORIES_SHEET_NAME}!A:J:clear`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  // データの書き込み
  const updateRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: [
        {
          range: `${VOCAB_SHEET_NAME}!A1:K${vocabRows.length}`,
          values: vocabRows
        },
        {
          range: `${STORIES_SHEET_NAME}!A1:J${storyRows.length}`,
          values: storyRows
        }
      ]
    })
  });

  if (!updateRes.ok) {
    const err = await updateRes.json().catch(() => ({}));
    throw new Error(`スプレッドシートへの同期に失敗しました: ${err?.error?.message || updateRes.statusText}`);
  }
}