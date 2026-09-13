import { VocabMasterItem } from '../types/mastery';
import { CefrLevel } from '../types/settings';
import { CEFR_VOCAB_MASTER } from '../data/cefrVocabMaster';

// 高速ルックアップ用のマップ（小文字見出し語 -> 候補エントリ配列）
const vocabLookupMap = new Map<string, VocabMasterItem[]>();

// 初期化
CEFR_VOCAB_MASTER.forEach(item => {
  const key = item.phrase.toLowerCase().trim();
  if (!vocabLookupMap.has(key)) {
    vocabLookupMap.set(key, []);
  }
  vocabLookupMap.get(key)!.push(item);
});

export interface ExtractedStoryVocab {
  id: string;
  phrase: string; // 原形
  matchedText: string; // 本文での出現形
  meaning: string;
  cefr: CefrLevel;
  partOfSpeech: string;
}

// 簡易英語レンマタイザー（活用形・屈折から原形への復元）
function getCandidateLemmas(rawWord: string): string[] {
  const word = rawWord.toLowerCase();
  const candidates: string[] = [word];

  // 1. 規則変化の動詞・過去形・過去分詞 (-ed)
  if (word.endsWith('ed')) {
    candidates.push(word.slice(0, -2)); // walked -> walk
    candidates.push(word.slice(0, -1)); // agreed -> agree, loved -> love
    if (word.length > 4 && word[word.length - 3] === word[word.length - 4]) {
      candidates.push(word.slice(0, -3)); // stopped -> stop, planned -> plan
    }
    if (word.endsWith('ied')) {
      candidates.push(word.slice(0, -3) + 'y'); // hurried -> hurry
    }
  }

  // 2. 進行形・動名詞 (-ing)
  if (word.endsWith('ing')) {
    candidates.push(word.slice(0, -3)); // walking -> walk
    candidates.push(word.slice(0, -3) + 'e'); // loving -> love, making -> make
    if (word.length > 5 && word[word.length - 4] === word[word.length - 5]) {
      candidates.push(word.slice(0, -4)); // running -> run, swimming -> swim
    }
    if (word.endsWith('ying')) {
      candidates.push(word.slice(0, -4) + 'ie'); // dying -> die, lying -> lie
    }
  }

  // 3. 複数形・三人称単数 (-s, -es, -ies)
  if (word.endsWith('ies') && word.length > 4) {
    candidates.push(word.slice(0, -3) + 'y'); // stories -> story
  } else if (word.endsWith('es') && word.length > 3) {
    candidates.push(word.slice(0, -2)); // watches -> watch
    candidates.push(word.slice(0, -1)); // loves -> love
  } else if (word.endsWith('s') && !word.endsWith('ss') && word.length > 2) {
    candidates.push(word.slice(0, -1)); // books -> book
  }

  // 4. 比較級・最上級 (-er, -est)
  if (word.endsWith('er') && word.length > 3) {
    candidates.push(word.slice(0, -2)); // faster -> fast
    candidates.push(word.slice(0, -1)); // nicer -> nice
    if (word.endsWith('ier')) {
      candidates.push(word.slice(0, -3) + 'y'); // happier -> happy
    }
  }
  if (word.endsWith('est') && word.length > 4) {
    candidates.push(word.slice(0, -3)); // fastest -> fast
    candidates.push(word.slice(0, -2)); // nicest -> nice
    if (word.endsWith('iest')) {
      candidates.push(word.slice(0, -4) + 'y'); // happiest -> happy
    }
  }

  // 5. 副詞 (-ly)
  if (word.endsWith('ly') && word.length > 4) {
    candidates.push(word.slice(0, -2)); // quickly -> quick
    if (word.endsWith('ily')) {
      candidates.push(word.slice(0, -3) + 'y'); // easily -> easy
    }
  }

  return Array.from(new Set(candidates));
}

const DETERMINERS = new Set(['a', 'an', 'the', 'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her', 'our', 'their', 'its']);

/**
 * ストーリー本文からすべての出現単語（have, a も含む）を抽出し、
 * Oxford 5000 CEFR辞書と照合してユニークな単語一覧を返却する。
 */
export function extractStoryVocabs(storyText: string, currentLevel: CefrLevel = 'A2'): ExtractedStoryVocab[] {
  if (!storyText || !storyText.trim()) return [];

  // 単語と前後の文脈トークンを抽出
  const tokens = storyText
    .replace(/["'""'()[\]{}:;,!?.\-\/\\—–]/g, ' ')
    .split(/\s+/)
    .map(t => t.trim().toLowerCase())
    .filter(t => t.length > 0 && /^[a-z]+$/.test(t));

  const resultMap = new Map<string, ExtractedStoryVocab>();

  for (let i = 0; i < tokens.length; i++) {
    const rawToken = tokens[i];
    // 単一文字は 'a' と 'i' 以外除外
    if (rawToken.length === 1 && rawToken !== 'a' && rawToken !== 'i') continue;

    const lemmas = getCandidateLemmas(rawToken);
    let matchedItem: VocabMasterItem | null = null;

    for (const lemma of lemmas) {
      const candidates = vocabLookupMap.get(lemma);
      if (candidates && candidates.length > 0) {
        if (candidates.length === 1) {
          matchedItem = candidates[0];
        } else {
          // 多義語（book, address など複数品詞・CEFRレベルが存在する場合の判別）
          const prevToken = i > 0 ? tokens[i - 1] : '';

          // 1. 動詞活用形（-ed, -ing）で出現している場合は動詞を優先
          if (rawToken.endsWith('ed') || rawToken.endsWith('ing')) {
            const verbCandidate = candidates.find(c => c.partOfSpeech.includes('動詞'));
            if (verbCandidate) {
              matchedItem = verbCandidate;
              break;
            }
          }

          // 2. 冠詞・所有格の直後にある場合は名詞を優先
          if (DETERMINERS.has(prevToken)) {
            const nounCandidate = candidates.find(c => c.partOfSpeech.includes('名詞'));
            if (nounCandidate) {
              matchedItem = nounCandidate;
              break;
            }
          }

          // 3. 現在の学習レベル（またはA1等の基本形）に最も近いエントリを選択
          const exactLevelMatch = candidates.find(c => c.cefr === currentLevel);
          if (exactLevelMatch) {
            matchedItem = exactLevelMatch;
          } else {
            // A1 > A2 > B1 > B2 > C1 の順に基本形を優先
            const levelOrder = ['A1', 'A2', 'B1', 'B2', 'C1'];
            matchedItem = [...candidates].sort(
              (a, b) => levelOrder.indexOf(a.cefr) - levelOrder.indexOf(b.cefr)
            )[0];
          }
        }
        break;
      }
    }

    if (matchedItem) {
      const key = matchedItem.id;
      if (!resultMap.has(key)) {
        resultMap.set(key, {
          id: matchedItem.id,
          phrase: matchedItem.phrase,
          matchedText: rawToken,
          meaning: matchedItem.meaning,
          cefr: matchedItem.cefr,
          partOfSpeech: matchedItem.partOfSpeech,
        });
      }
    }
  }

  const levelWeight: Record<CefrLevel, number> = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5 };

  // CEFRレベル順（A1 -> A2 -> B1 -> B2 -> C1）、同レベル内はアルファベット順
  return Array.from(resultMap.values()).sort((a, b) => {
    const wA = levelWeight[a.cefr] || 99;
    const wB = levelWeight[b.cefr] || 99;
    if (wA !== wB) return wA - wB;
    return a.phrase.localeCompare(b.phrase);
  });
}
