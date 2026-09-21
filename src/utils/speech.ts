export interface WordOffset {
  word: string;
  start: number;
  end: number;
}

/**
 * 英文から各単語の文字開始位置・終了位置を抽出（onboundary イベントとの照合用）
 */
export function extractWordOffsets(text: string): WordOffset[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const offsets: WordOffset[] = [];
  let searchIdx = 0;
  for (const w of words) {
    const idx = text.indexOf(w, searchIdx);
    if (idx !== -1) {
      offsets.push({ word: w, start: idx, end: idx + w.length });
      searchIdx = idx + w.length;
    } else {
      offsets.push({ word: w, start: searchIdx, end: searchIdx + w.length });
      searchIdx += w.length + 1;
    }
  }
  return offsets;
}

/**
 * 自然な英文・チャンク一括読み上げ（リンキング・弱形発動）＋リアルタイム単語位置トラッキング
 */
export function speakNaturalWithWordTracking(
  text: string,
  rateMultiplier: number = 1.0,
  onWordChange?: (wordIndex: number, word: string) => void,
  onEnd?: () => void,
  lang: string = 'en-US'
): () => void {
  if (!('speechSynthesis' in window)) {
    console.warn('Speech synthesis not supported');
    if (onEnd) onEnd();
    return () => {};
  }

  window.speechSynthesis.cancel(); // 既存の再生を停止

  const cleanText = text.trim();
  if (!cleanText) {
    if (onEnd) onEnd();
    return () => {};
  }

  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = lang;
  utterance.rate = Math.max(0.5, Math.min(2.0, rateMultiplier));

  // 英語ネイティブの高品質ボイスを選択
  const voices = window.speechSynthesis.getVoices();
  const englishVoice = voices.find(v => 
    (v.lang === 'en-US' || v.lang.startsWith('en')) && 
    (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Samantha') || v.name.includes('Daniel') || v.name.includes('Karen') || v.name.includes('Jenny') || v.name.includes('Guy'))
  );
  
  if (englishVoice) {
    utterance.voice = englishVoice;
  }

  const offsets = extractWordOffsets(cleanText);

  // 初期単語通知
  if (offsets.length > 0 && onWordChange) {
    onWordChange(0, offsets[0].word);
  }

  let boundaryFired = false;
  let fallbackTimer: any = null;

  // 1. onboundary イベント（自然な音声の中で今喋っている単語を検知）
  utterance.onboundary = (event: SpeechSynthesisEvent) => {
    if (event.name === 'word') {
      boundaryFired = true;
      const charIndex = event.charIndex;
      const wordIdx = offsets.findIndex(
        (item, i) =>
          charIndex >= item.start &&
          (i === offsets.length - 1 || charIndex < offsets[i + 1].start)
      );
      if (wordIdx >= 0 && onWordChange) {
        onWordChange(wordIdx, offsets[wordIdx].word);
      }
    }
  };

  // 2. 万一 onboundary が発火しないブラウザ向けのタイマーフォールバック
  const estimatedDurationMs = Math.max(700, (offsets.length / (rateMultiplier * 2.5)) * 1000);
  const perWordMs = Math.round(estimatedDurationMs / Math.max(1, offsets.length));
  let fallbackWordIdx = 0;

  fallbackTimer = setInterval(() => {
    if (!boundaryFired && fallbackWordIdx < offsets.length - 1) {
      fallbackWordIdx++;
      if (onWordChange) {
        onWordChange(fallbackWordIdx, offsets[fallbackWordIdx].word);
      }
    }
  }, perWordMs);

  const cleanup = () => {
    if (fallbackTimer) {
      clearInterval(fallbackTimer);
      fallbackTimer = null;
    }
  };

  utterance.onend = () => {
    cleanup();
    if (onEnd) onEnd();
  };

  utterance.onerror = () => {
    cleanup();
    if (onEnd) onEnd();
  };

  window.speechSynthesis.speak(utterance);

  // キャンセル関数を返す
  return () => {
    cleanup();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };
}

export function speakText(
  text: string,
  rate: number = 0.95,
  lang: string = 'en-US',
  onEnd?: () => void
): void {
  if (!('speechSynthesis' in window)) {
    console.warn('Speech synthesis not supported');
    if (onEnd) onEnd();
    return;
  }

  window.speechSynthesis.cancel(); // 既存再生を停止

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = Math.max(0.5, Math.min(2.0, rate)); // 速度調整

  if (onEnd) {
    utterance.onend = onEnd;
    utterance.onerror = () => onEnd();
  }

  // 可能な限り英語ネイティブの高品質ボイスを選択
  const voices = window.speechSynthesis.getVoices();
  const englishVoice = voices.find(v => 
    (v.lang === 'en-US' || v.lang.startsWith('en')) && 
    (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Samantha') || v.name.includes('Daniel') || v.name.includes('Karen'))
  );
  
  if (englishVoice) {
    utterance.voice = englishVoice;
  }

  window.speechSynthesis.speak(utterance);
}

export function stopSpeech(): void {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

export function isSpeaking(): boolean {
  if ('speechSynthesis' in window) {
    return window.speechSynthesis.speaking;
  }
  return false;
}
