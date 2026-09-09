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