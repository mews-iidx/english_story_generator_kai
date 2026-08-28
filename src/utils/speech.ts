export function speakText(text: string, lang: string = 'en-US'): void {
  if (!('speechSynthesis' in window)) {
    console.warn('Speech synthesis not supported');
    return;
  }

  window.speechSynthesis.cancel(); // 既存再生を停止

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = 0.95; // 少し聞き取りやすい速度

  // 可能な限り英語ネイティブの高品質ボイスを選択
  const voices = window.speechSynthesis.getVoices();
  const englishVoice = voices.find(v => (v.lang === 'en-US' || v.lang.startsWith('en')) && (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Samantha') || v.name.includes('Daniel')));
  if (englishVoice) {
    utterance.voice = englishVoice;
  }

  window.speechSynthesis.speak(utterance);
}