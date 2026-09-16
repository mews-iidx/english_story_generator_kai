/**
 * CEFR 全文スキャン ＆ 2段階照合エンジン (cefrScanner.ts)
 * 
 * 1. ローカル高速トークン照合 (0トークン): 単語活用形・構文トリガー語による即時フィルタ
 * 2. 2段階軽量JSON判定 (低トークン): 候補Enumによる正確なID確定
 * 3. 汎化ファストトラック ＆ マスターDB自動コミット
 */

import { CEFR_VOCAB_MASTER } from '../data/cefrVocabMaster';
import { CEFR_PATTERNS_MASTER } from '../data/cefrPatternsMaster';
import { VocabMasterItem, PatternMasterItem, MasteryScanTask } from '../types/mastery';
import { loadMasteryState, saveMasteryState } from './storage';
import { getTodayDateString } from '../utils/srs';

// ===================== 1. 単語インデックス (0トークン) =====================

// 単語の活用形・原形マッピング辞書（メモリ内キャッシュ）
let vocabSurfaceMap: Map<string, VocabMasterItem[]> | null = null;

function buildVocabSurfaceMap(): Map<string, VocabMasterItem[]> {
  if (vocabSurfaceMap) return vocabSurfaceMap;
  const map = new Map<string, VocabMasterItem[]>();

  for (const item of CEFR_VOCAB_MASTER) {
    const base = item.phrase.trim().toLowerCase();
    
    // 基本形
    if (!map.has(base)) map.set(base, []);
    map.get(base)!.push(item);

    // 活用形（surfaceFormsまたは標準活用ルール）
    const forms = new Set<string>();
    if (item.surfaceForms && item.surfaceForms.length > 0) {
      item.surfaceForms.forEach(f => forms.add(f.toLowerCase().trim()));
    } else {
      // 簡易活用形生成 (-s, -es, -ed, -ing)
      if (base.length > 2) {
        forms.add(base + 's');
        forms.add(base + 'es');
        forms.add(base + 'ed');
        forms.add(base + 'ing');
        if (base.endsWith('e')) {
          forms.add(base + 'd');
          forms.add(base.slice(0, -1) + 'ing');
        }
        if (base.endsWith('y')) {
          forms.add(base.slice(0, -1) + 'ies');
          forms.add(base.slice(0, -1) + 'ied');
        }
      }
    }

    for (const form of forms) {
      if (!map.has(form)) map.set(form, []);
      if (!map.get(form)!.some(v => v.id === item.id)) {
        map.get(form)!.push(item);
      }
    }
  }

  vocabSurfaceMap = map;
  return map;
}

/**
 * テキストから出現するCEFR単語を高速抽出（0トークン）
 */
export function scanTextForVocabs(text: string): VocabMasterItem[] {
  const map = buildVocabSurfaceMap();
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9'\-\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1);

  const matchedSet = new Map<string, VocabMasterItem>();

  for (const word of words) {
    const hits = map.get(word);
    if (hits && hits.length > 0) {
      // 最初の一致（または品詞の一致）を採用
      hits.forEach(item => {
        if (!matchedSet.has(item.id)) {
          matchedSet.set(item.id, item);
        }
      });
    }
  }

  return Array.from(matchedSet.values());
}

// ===================== 2. 構文プレフィルタ (0トークン) =====================

/**
 * 文ごとに該当しそうな構文候補を抽出
 */
export interface SentencePatternCandidate {
  sentence: string;
  candidatePatterns: PatternMasterItem[];
}

export function extractSentencePatternCandidates(text: string): SentencePatternCandidate[] {
  // 文単位に分割
  const sentences = text
    .replace(/([.!?]["']?)(?:\s+|\n+|$)/g, '$1\n')
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 5);

  const results: SentencePatternCandidate[] = [];

  for (const sentence of sentences) {
    const sLower = sentence.toLowerCase();
    const sWords = new Set(sLower.replace(/[^a-z0-9'\-\s]/g, ' ').split(/\s+/));
    const matchedPatterns: PatternMasterItem[] = [];

    for (const pat of CEFR_PATTERNS_MASTER) {
      // 1. targetTokens による照合
      let isHit = false;
      if (pat.variations && pat.variations.length > 0) {
        const tokens = pat.variations[0].targetTokens;
        if (tokens && tokens.length > 0) {
          isHit = tokens.every(t => sWords.has(t.toLowerCase()) || sLower.includes(t.toLowerCase()));
        }
      }

      // 2. triggerKeywords による照合
      if (!isHit && pat.triggerKeywords && pat.triggerKeywords.length > 0) {
        isHit = pat.triggerKeywords.every(k => sWords.has(k.toLowerCase()) || sLower.includes(k.toLowerCase()));
      }

      if (isHit) {
        matchedPatterns.push(pat);
        if (matchedPatterns.length >= 3) break; // 各文最大3件に絞り込み
      }
    }

    if (matchedPatterns.length > 0) {
      results.push({
        sentence,
        candidatePatterns: matchedPatterns,
      });
    }
  }

  return results;
}

// ===================== 3. バックグラウンド判定 ＆ DBコミット =====================

/**
 * 読書・会話後のスキャン結果をマスターDBへ一括コミット
 */
export interface CommitScanParams {
  sourceType: 'story' | 'call' | 'mentor';
  text: string;
  userUtterances?: string[];
  lookedUpTokens?: string[];
  storyId?: string;
  storyTitle?: string;
}

export async function processAndCommitMasteryScan(params: CommitScanParams): Promise<{
  matchedVocabCount: number;
  matchedPatternCount: number;
  newExposedCount: number;
  newMasteredCount: number;
}> {
  const { text, userUtterances = [], lookedUpTokens = [], sourceType: _sourceType } = params;
  const today = getTodayDateString();
  const mastery = loadMasteryState();

  let newExposedCount = 0;
  let newMasteredCount = 0;

  // 1. 単語スキャン (理解軸)
  const matchedVocabs = scanTextForVocabs(text);
  const lookedUpSet = new Set((lookedUpTokens || []).map(t => t.toLowerCase().trim()));

  for (const vocab of matchedVocabs) {
    const key = vocab.phrase.toLowerCase().trim();
    const prev = mastery.vocabs[key] || {
      encounterCount: 0,
      consecutiveSuccessCount: 0,
      distinctContextCount: 0,
      firstSeenAt: new Date().toISOString(),
    };

    const isLookedUp = lookedUpSet.has(key) || lookedUpSet.has(vocab.id);
    const prevStatus = prev.comprehensionStatus || prev.status || 'unseen';

    let newStatus = prevStatus;
    let encounter = (prev.encounterCount || 0) + 1;
    let successCount = prev.consecutiveSuccessCount || 0;
    let contextCount = prev.distinctContextCount || 0;

    if (isLookedUp) {
      // わからなくて調べた ➔ 要復習 (lapsed)
      newStatus = 'lapsed';
      successCount = 0;
      prev.mistakeCount = (prev.mistakeCount || 0) + 1;
      prev.lastMistakeAt = new Date().toISOString();
    } else {
      // スラスラ読めた
      if (prevStatus === 'unseen') {
        newStatus = 'exposed'; // 遭遇 (learning)
        newExposedCount++;
        successCount = 1;
        contextCount = 1;
      } else if (prevStatus === 'exposed' || prevStatus === 'lapsed') {
        successCount++;
        contextCount++;
        
        // ★ 汎化・ファストトラック判定:
        // A1/A2単語で同日または通算3回以上スラスラ読めた場合、既知へ即時昇格！
        if (
          (vocab.cefr === 'A1' && (contextCount >= 2 || successCount >= 2)) ||
          (vocab.cefr === 'A2' && (contextCount >= 3 || successCount >= 3)) ||
          successCount >= 4
        ) {
          newStatus = 'mastered';
          newMasteredCount++;
          prev.comprehensionMasteredAt = new Date().toISOString();
        }
      }
    }

    mastery.vocabs[key] = {
      ...prev,
      comprehensionStatus: newStatus,
      status: newStatus,
      encounterCount: encounter,
      consecutiveSuccessCount: successCount,
      distinctContextCount: contextCount,
      lastEncounterDate: today,
      lastSeenAt: new Date().toISOString(),
    };
  }

  // 2. 構文スキャン (理解軸)
  const patternCandidates = extractSentencePatternCandidates(text);
  const matchedPatternSet = new Set<string>();

  for (const cand of patternCandidates) {
    for (const pat of cand.candidatePatterns) {
      matchedPatternSet.add(pat.id);
      const prev = mastery.patterns[pat.id] || {
        encounterCount: 0,
        consecutiveSuccessCount: 0,
        distinctContextCount: 0,
        firstSeenAt: new Date().toISOString(),
      };

      const prevStatus = prev.comprehensionStatus || prev.status || 'unseen';
      let newStatus = prevStatus;
      let encounter = (prev.encounterCount || 0) + 1;
      let successCount = (prev.consecutiveSuccessCount || 0) + 1;
      let contextCount = (prev.distinctContextCount || 0) + 1;

      if (prevStatus === 'unseen') {
        newStatus = 'exposed';
        newExposedCount++;
      } else if (prevStatus === 'exposed' || prevStatus === 'lapsed') {
        // ★ 構文の汎化判定: A1/A2構文で異なる文脈3回遭遇でマスター昇格
        if (
          (pat.cefr === 'A1' && (contextCount >= 2 || successCount >= 2)) ||
          (pat.cefr === 'A2' && (contextCount >= 3 || successCount >= 3)) ||
          successCount >= 4
        ) {
          newStatus = 'mastered';
          newMasteredCount++;
          prev.comprehensionMasteredAt = new Date().toISOString();
        }
      }

      mastery.patterns[pat.id] = {
        ...prev,
        comprehensionStatus: newStatus,
        status: newStatus,
        encounterCount: encounter,
        consecutiveSuccessCount: successCount,
        distinctContextCount: contextCount,
        lastEncounterDate: today,
        lastSeenAt: new Date().toISOString(),
      };
    }
  }

  // 3. 発話スキャン (組立軸: 会話やラリーでの自力発話)
  if (userUtterances.length > 0) {
    const userCombinedText = userUtterances.join(' ');
    const userVocabs = scanTextForVocabs(userCombinedText);
    const userPatternCands = extractSentencePatternCandidates(userCombinedText);

    for (const v of userVocabs) {
      const key = v.phrase.toLowerCase().trim();
      const prev = mastery.vocabs[key] || { encounterCount: 0 };
      const currentAssm = prev.assemblyStatus || 'unseen';
      
      mastery.vocabs[key] = {
        ...prev,
        assemblyStatus: currentAssm === 'unseen' ? 'exposed' : (currentAssm === 'exposed' ? 'mastered' : currentAssm),
        assemblyMasteredAt: currentAssm === 'exposed' ? new Date().toISOString() : prev.assemblyMasteredAt,
        lastSeenAt: new Date().toISOString(),
      };
    }

    for (const cand of userPatternCands) {
      for (const p of cand.candidatePatterns) {
        const prev = mastery.patterns[p.id] || { encounterCount: 0 };
        const currentAssm = prev.assemblyStatus || 'unseen';
        
        mastery.patterns[p.id] = {
          ...prev,
          assemblyStatus: currentAssm === 'unseen' ? 'exposed' : (currentAssm === 'exposed' ? 'mastered' : currentAssm),
          assemblyMasteredAt: currentAssm === 'exposed' ? new Date().toISOString() : prev.assemblyMasteredAt,
          lastSeenAt: new Date().toISOString(),
        };
      }
    }
  }

  // マスターDB保存
  saveMasteryState(mastery);

  return {
    matchedVocabCount: matchedVocabs.length,
    matchedPatternCount: matchedPatternSet.size,
    newExposedCount,
    newMasteredCount,
  };
}

// ===================== 4. スキャンキュー管理 =====================

const SCAN_QUEUE_KEY = 'storykai_mastery_scan_queue_v1';

export function loadMasteryScanQueue(): MasteryScanTask[] {
  try {
    const raw = localStorage.getItem(SCAN_QUEUE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to load mastery scan queue', e);
    return [];
  }
}

export function saveMasteryScanQueue(queue: MasteryScanTask[]): void {
  try {
    localStorage.setItem(SCAN_QUEUE_KEY, JSON.stringify(queue.slice(-100)));
  } catch (e) {
    console.error('Failed to save mastery scan queue', e);
  }
}

/**
 * スキャンタスクをキューへ投入し、非同期でバックグラウンド実行
 */
export function enqueueMasteryScanTask(task: Omit<MasteryScanTask, 'id' | 'createdAt' | 'status'>): MasteryScanTask {
  const queue = loadMasteryScanQueue();
  const newTask: MasteryScanTask = {
    ...task,
    id: 'scan_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    createdAt: new Date().toISOString(),
    status: 'pending',
  };

  queue.push(newTask);
  saveMasteryScanQueue(queue);

  // バックグラウンドで即座に実行開始 (非同期)
  setTimeout(() => {
    processNextScanQueueTask();
  }, 100);

  return newTask;
}

let isProcessingQueue = false;

export async function processNextScanQueueTask(): Promise<void> {
  if (isProcessingQueue) return;
  const queue = loadMasteryScanQueue();
  const pendingIdx = queue.findIndex(t => t.status === 'pending');
  if (pendingIdx < 0) return;

  isProcessingQueue = true;
  const task = queue[pendingIdx];
  task.status = 'processing';
  saveMasteryScanQueue(queue);

  try {
    const result = await processAndCommitMasteryScan({
      sourceType: task.sourceType,
      text: task.text,
      userUtterances: task.userUtterances,
      lookedUpTokens: task.lookedUpTokens,
      storyId: task.sourceId,
      storyTitle: task.title,
    });

    task.status = 'completed';
    task.result = result;
  } catch (err) {
    console.error('Failed to process scan task:', err);
    task.status = 'failed';
  } finally {
    saveMasteryScanQueue(queue);
    isProcessingQueue = false;

    // 次のタスクがあれば連続処理
    const nextQueue = loadMasteryScanQueue();
    if (nextQueue.some(t => t.status === 'pending')) {
      setTimeout(() => processNextScanQueueTask(), 200);
    }
  }
}
