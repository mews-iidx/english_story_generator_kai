export interface QuickTranslationResult {
  originalText: string;
  translatedText: string;
}

/**
 * Google Translate の無料エンドポイント（APIキー不要・爆速・完全無料）
 * スマホChromeの長押し翻訳と同等の品質と即応性を提供
 */
export async function translateWithGoogleFree(text: string): Promise<QuickTranslationResult> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { originalText: '', translatedText: '' };
  }

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ja&dt=t&q=${encodeURIComponent(trimmed)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Google Translate HTTP ${response.status}`);
    }

    const data = await response.json();
    // data[0] は翻訳文の配列 [[translated, original, ...], ...]
    let translated = '';
    if (Array.isArray(data) && Array.isArray(data[0])) {
      translated = data[0].map((item: any) => item[0]).filter(Boolean).join('');
    }

    return {
      originalText: trimmed,
      translatedText: translated || trimmed,
    };
  } catch (error) {
    console.error('Google Translate Free Error:', error);
    // フォールバック（オフライン時やエラー時）
    return {
      originalText: trimmed,
      translatedText: '（翻訳取得失敗）',
    };
  }
}