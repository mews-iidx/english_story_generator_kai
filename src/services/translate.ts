export interface QuickTranslationResult {
  originalText: string;
  translatedText: string;
}

// 翻訳インメモリキャッシュ（同じ単語・フレーズの再取得を0ms即時に）
const translationCache = new Map<string, string>();

/**
 * 堅牢なマルチティア無料翻訳サービス
 * 1. Google Chrome Extension Dict API
 * 2. Google Translate gtx API
 * 3. MyMemory Free API
 * 4. Gemini Flash-Lite (APIキーがある場合の最終防衛ライン)
 */
export async function translateWithGoogleFree(text: string, fallbackApiKey?: string): Promise<QuickTranslationResult> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { originalText: '', translatedText: '' };
  }

  const cacheKey = trimmed.toLowerCase();
  if (translationCache.has(cacheKey)) {
    return {
      originalText: trimmed,
      translatedText: translationCache.get(cacheKey)!,
    };
  }

  // Tier 1: Google Chrome Extension Dictionary API
  try {
    const url = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=en&tl=ja&q=${encodeURIComponent(trimmed)}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      let result = '';
      if (Array.isArray(data) && typeof data[0] === 'string') {
        result = data[0].trim();
      } else if (Array.isArray(data) && Array.isArray(data[0])) {
        result = data[0].map((item: any) => (Array.isArray(item) ? item[0] : item)).join('').trim();
      }
      if (result) {
        translationCache.set(cacheKey, result);
        return { originalText: trimmed, translatedText: result };
      }
    }
  } catch (e) {
    console.warn('Tier 1 (clients5) translation failed, trying Tier 2...', e);
  }

  // Tier 2: Google Translate GTX Single API
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ja&dt=t&q=${encodeURIComponent(trimmed)}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      let result = '';
      if (Array.isArray(data) && Array.isArray(data[0])) {
        result = data[0].map((item: any) => item[0]).filter(Boolean).join('').trim();
      }
      if (result) {
        translationCache.set(cacheKey, result);
        return { originalText: trimmed, translatedText: result };
      }
    }
  } catch (e) {
    console.warn('Tier 2 (gtx) translation failed, trying Tier 3...', e);
  }

  // Tier 3: MyMemory Free API
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(trimmed)}&langpair=en|ja`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const result = data?.responseData?.translatedText?.trim();
      if (result && !result.includes('MYMEMORY WARNING')) {
        translationCache.set(cacheKey, result);
        return { originalText: trimmed, translatedText: result };
      }
    }
  } catch (e) {
    console.warn('Tier 3 (MyMemory) translation failed, trying Tier 4...', e);
  }

  // Tier 4: Gemini Flash-Lite による直接翻訳 (APIキーがある場合)
  if (fallbackApiKey) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${fallbackApiKey}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Translate the following English word/phrase/sentence into natural Japanese. Output ONLY the Japanese translation without quotes or explanations.\n"${trimmed}"` }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 60 }
        })
      });
      if (res.ok) {
        const data = await res.json();
        const result = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (result) {
          translationCache.set(cacheKey, result);
          return { originalText: trimmed, translatedText: result };
        }
      }
    } catch (e) {
      console.error('Tier 4 (Gemini fallback) translation failed', e);
    }
  }

  return {
    originalText: trimmed,
    translatedText: '（翻訳取得失敗）',
  };
}