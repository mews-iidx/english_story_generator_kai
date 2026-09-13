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

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);

/**
 * 英語レンマタイザー（活用形・屈折から原形への高精度復元）
 * 誤抽出（例: start -> star, stared -> star）を防止し、英語の正書法規則に基づいた優先度で候補を生成
 */
export function getCandidateLemmas(rawWord: string): string[] {
  const word = rawWord.toLowerCase();
  const candidates: string[] = [word];

  // 1. 規則変化の動詞・過去形・過去分詞 (-ed)
  if (word.endsWith('ed') && word.length > 3) {
    const stem = word.slice(0, -2); // started -> start, stared -> star/stare
    if (word.endsWith('ied') && word.length > 4) {
      candidates.push(word.slice(0, -3) + 'y'); // hurried -> hurry
    } else if (word.length > 4 && word[word.length - 3] === word[word.length - 4] && !VOWELS.has(word[word.length - 3])) {
      candidates.push(word.slice(0, -3)); // stopped -> stop, starred -> star, planned -> plan
    } else {
      // 語幹の末尾パターン判定
      // 1. 母音 + 単一子音 + ed（例: star-ed, hop-ed, car-ed）-> サイレントe動詞 (stare, hope, care, save, live)
      if (stem.length >= 2 && VOWELS.has(stem[stem.length - 2]) && !VOWELS.has(stem[stem.length - 1]) && (stem.length < 3 || !VOWELS.has(stem[stem.length - 3]))) {
        candidates.push(stem + 'e'); // stared -> stare, cared -> care, hoped -> hope
        candidates.push(stem);       // フォールバック
      } else if (stem.endsWith('c') || stem.endsWith('g') || stem.endsWith('s') || stem.endsWith('z') || stem.endsWith('v')) {
        candidates.push(stem + 'e'); // placed -> place, changed -> change, closed -> close
        candidates.push(stem);
      } else {
        candidates.push(stem);       // started -> start, walked -> walk, looked -> look
        candidates.push(stem + 'e');
      }
    }
  }

  // 2. 進行形・動名詞 (-ing)
  if (word.endsWith('ing') && word.length > 4) {
    const stem = word.slice(0, -3); // starting -> start, staring -> stare/star
    if (word.endsWith('ying') && word.length > 4) {
      candidates.push(word.slice(0, -4) + 'ie'); // dying -> die, lying -> lie
    } else if (word.length > 5 && word[word.length - 4] === word[word.length - 5] && !VOWELS.has(word[word.length - 4])) {
      candidates.push(word.slice(0, -4)); // running -> run, starring -> star, stopping -> stop
    } else {
      // 1. 母音 + 単一子音 + ing（例: star-ing, hop-ing, mak-ing）-> サイレントe動詞 (stare, hope, make, take)
      if (stem.length >= 2 && VOWELS.has(stem[stem.length - 2]) && !VOWELS.has(stem[stem.length - 1]) && (stem.length < 3 || !VOWELS.has(stem[stem.length - 3]))) {
        candidates.push(stem + 'e'); // staring -> stare, hoping -> hope, making -> make
        candidates.push(stem);
      } else if (stem.endsWith('c') || stem.endsWith('g') || stem.endsWith('s') || stem.endsWith('z') || stem.endsWith('v')) {
        candidates.push(stem + 'e'); // placing -> place, changing -> change, closing -> close
        candidates.push(stem);
      } else {
        candidates.push(stem);       // starting -> start, walking -> walk, reading -> read
        candidates.push(stem + 'e');
      }
    }
  }

  // 3. 複数形・三人称単数 (-s, -es, -ies)
  if (word.endsWith('ies') && word.length > 4) {
    candidates.push(word.slice(0, -3) + 'y'); // stories -> story
  } else if (word.endsWith('es') && word.length > 3) {
    if (word.endsWith('shes') || word.endsWith('ches') || word.endsWith('sses') || word.endsWith('xes') || word.endsWith('zes')) {
      candidates.push(word.slice(0, -2)); // watches -> watch, passes -> pass, boxes -> box
    } else {
      candidates.push(word.slice(0, -1)); // loves -> love, changes -> change
      candidates.push(word.slice(0, -2));
    }
  } else if (word.endsWith('s') && !word.endsWith('ss') && word.length > 2) {
    candidates.push(word.slice(0, -1)); // starts -> start, stars -> star, books -> book
  }

  // 4. 比較級・最上級 (-er, -est)
  if (word.endsWith('er') && word.length > 3) {
    if (word.endsWith('ier') && word.length > 4) {
      candidates.push(word.slice(0, -3) + 'y'); // happier -> happy
    } else if (word.length > 4 && word[word.length - 3] === word[word.length - 4] && !VOWELS.has(word[word.length - 3])) {
      candidates.push(word.slice(0, -3)); // bigger -> big
    } else {
      candidates.push(word.slice(0, -2)); // faster -> fast
      candidates.push(word.slice(0, -1)); // nicer -> nice
    }
  }

  if (word.endsWith('est') && word.length > 4) {
    if (word.endsWith('iest') && word.length > 5) {
      candidates.push(word.slice(0, -4) + 'y'); // happiest -> happy
    } else if (word.length > 5 && word[word.length - 4] === word[word.length - 5] && !VOWELS.has(word[word.length - 4])) {
      candidates.push(word.slice(0, -4)); // biggest -> big
    } else {
      candidates.push(word.slice(0, -3)); // fastest -> fast
      candidates.push(word.slice(0, -2)); // nicest -> nice
    }
  }

  // 5. 副詞 (-ly)
  if (word.endsWith('ly') && word.length > 4) {
    if (word.endsWith('ily') && word.length > 4) {
      candidates.push(word.slice(0, -3) + 'y'); // easily -> easy
    } else {
      candidates.push(word.slice(0, -2)); // quickly -> quick
    }
  }

  return Array.from(new Set(candidates));
}

const DETERMINERS = new Set(['a', 'an', 'the', 'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her', 'our', 'their', 'its']);

/**
 * ストーリー本文からすべての出現単語を抽出し、
 * Oxford 5000 CEFR辞書と照合してユニークな単語一覧を返却する。
 */
export function extractStoryVocabs(storyText: string, currentLevel: CefrLevel = 'A2'): ExtractedStoryVocab[] {
  if (!storyText || !storyText.trim()) return [];

  const tokens = storyText
    .replace(/["'""'()[\]{}:;,!?.\-\/\—–]/g, ' ')
    .split(/\s+/)
    .map(t => t.trim().toLowerCase())
    .filter(t => t.length > 0 && /^[a-z]+$/.test(t));

  const resultMap = new Map<string, ExtractedStoryVocab>();

  for (let i = 0; i < tokens.length; i++) {
    const rawToken = tokens[i];
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

  return Array.from(resultMap.values()).sort((a, b) => {
    const wA = levelWeight[a.cefr] || 99;
    const wB = levelWeight[b.cefr] || 99;
    if (wA !== wB) return wA - wB;
    return a.phrase.localeCompare(b.phrase);
  });
}
