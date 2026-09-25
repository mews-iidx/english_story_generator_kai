import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Zap, Volume2, Flame, Layers, Check, Undo2,
  Eye, RefreshCw, Trophy
} from 'lucide-react';
import { VocabMasterItem, MasteryStatus } from '../types/mastery';
import { CefrLevel } from '../types/settings';
import { getVocabMasterByLevel } from '../data/cefrVocabMaster';
import {
  loadMasteryState,
  recordVocabMasteryStatus,
  saveSentenceCardWithSiblings,
} from '../services/storage';
import { generateVocabCardsBatchWithGemini } from '../services/gemini';
import { speakText } from '../utils/speech';

interface DrillViewProps {
  apiKey: string;
  selectedModel?: string;
  userLevel?: CefrLevel;
  onNavigateToAnki?: () => void;
  onUpdateVocabs?: () => void;
}

export type DrillFilterMode = 'unseen' | 'lapsed' | 'all';

interface DrillHistoryItem {
  vocab: VocabMasterItem;
  prevStatus: MasteryStatus;
  newStatus: MasteryStatus;
  index: number;
}

export const DrillView: React.FC<DrillViewProps> = ({
  apiKey,
  selectedModel = 'gemini-3.7-flash',
  userLevel = 'A1',
  onNavigateToAnki,
  onUpdateVocabs,
}) => {
  const [selectedCefr, setSelectedCefr] = useState<CefrLevel>(userLevel || 'A1');
  const [filterMode, setFilterMode] = useState<DrillFilterMode>('unseen');
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isRevealed, setIsRevealed] = useState<boolean>(false);
  const [history, setHistory] = useState<DrillHistoryItem[]>([]);
  const [masteryStateVersion, setMasteryStateVersion] = useState<number>(0);

  // Background Anki Card Generation Queue
  const [bgQueue, setBgQueue] = useState<VocabMasterItem[]>([]);
  const [bgProcessedCount, setBgProcessedCount] = useState<number>(0);
  const isProcessingRef = useRef<boolean>(false);

  // Session summary counters
  const [sessionStats, setSessionStats] = useState<{
    mastered: number;
    lapsed: number;
    exposed: number;
  }>({ mastered: 0, lapsed: 0, exposed: 0 });

  // 1. Load Vocab Pool based on Level and Filter
  const filteredVocabs = useMemo(() => {
    const all = getVocabMasterByLevel(selectedCefr);
    const state = loadMasteryState();

    if (filterMode === 'unseen') {
      return all.filter(v => {
        const s = state.vocabs[v.phrase.toLowerCase()]?.status || state.vocabs[v.id]?.status;
        return !s || s === 'unseen';
      });
    } else if (filterMode === 'lapsed') {
      return all.filter(v => {
        const s = state.vocabs[v.phrase.toLowerCase()]?.status || state.vocabs[v.id]?.status;
        return s === 'lapsed';
      });
    }
    return all;
  }, [selectedCefr, filterMode, masteryStateVersion]);

  // Reset index when level or filter changes
  useEffect(() => {
    setCurrentIndex(0);
    setIsRevealed(false);
  }, [selectedCefr, filterMode]);

  const currentVocab: VocabMasterItem | undefined = filteredVocabs[currentIndex];

  // Play audio for current word
  const playWordAudio = useCallback((phrase?: string) => {
    const target = phrase || currentVocab?.phrase;
    if (target) {
      speakText(target, 1.0, 'en-US');
    }
  }, [currentVocab]);

  // Auto-play audio when a new word is shown
  useEffect(() => {
    if (currentVocab) {
      playWordAudio(currentVocab.phrase);
    }
  }, [currentIndex, currentVocab?.id]);

  // 2. Background Anki Card Generator Worker
  useEffect(() => {
    if (bgQueue.length === 0 || isProcessingRef.current || !apiKey) {
      return;
    }

    const processNextBatch = async () => {
      isProcessingRef.current = true;

      const batch = bgQueue.slice(0, 4);
      try {
        const reqItems = batch.map(v => ({
          phrase: v.phrase,
          partOfSpeech: v.partOfSpeech || '単語',
          meaning: v.meaning,
          cefr: v.cefr,
        }));

        const result = await generateVocabCardsBatchWithGemini(reqItems, apiKey, selectedModel);

        if (result.cards && result.cards.length > 0) {
          result.cards.forEach(card => {
            saveSentenceCardWithSiblings({
              sentence: card.sentence,
              translation: card.translation,
              focusType: 'word',
              focusWord: card.phrase,
              focusMeaning: card.meaning,
              corePatterns: card.corePatterns,
              importance: card.importance || 4,
            });
          });

          setBgProcessedCount(prev => prev + result.cards.length);
          if (onUpdateVocabs) {
            onUpdateVocabs();
          }
        }
      } catch (err) {
        console.warn('Background Anki card generation error:', err);
      } finally {
        setBgQueue(prev => prev.slice(batch.length));
        isProcessingRef.current = false;
      }
    };

    processNextBatch();
  }, [bgQueue, apiKey, selectedModel, onUpdateVocabs]);

  // 3. Handle Rating & Triage
  const handleRate = useCallback((status: MasteryStatus, enqueueToAnki: boolean = false) => {
    if (!currentVocab) return;

    const state = loadMasteryState();
    const prevStatus: MasteryStatus = state.vocabs[currentVocab.phrase.toLowerCase()]?.status || 'unseen';

    // Update mastery status in storage
    recordVocabMasteryStatus(currentVocab.phrase, status);
    recordVocabMasteryStatus(currentVocab.id, status);

    // If "🔴 もう一度" or "🟡 難しい", enqueue for background Anki card generation
    if (enqueueToAnki) {
      setBgQueue(prev => {
        if (prev.some(v => v.id === currentVocab.id || v.phrase.toLowerCase() === currentVocab.phrase.toLowerCase())) {
          return prev;
        }
        return [...prev, currentVocab];
      });
    }

    // Record undo history
    setHistory(prev => [
      { vocab: currentVocab, prevStatus, newStatus: status, index: currentIndex },
      ...prev.slice(0, 30),
    ]);

    // Update session stats
    setSessionStats(prev => ({
      mastered: status === 'mastered' ? prev.mastered + 1 : prev.mastered,
      lapsed: status === 'lapsed' ? prev.lapsed + 1 : prev.lapsed,
      exposed: status === 'exposed' ? prev.exposed + 1 : prev.exposed,
    }));

    // Advance to next word
    setIsRevealed(false);
    setCurrentIndex(prev => prev + 1);
    setMasteryStateVersion(v => v + 1);
  }, [currentVocab, currentIndex]);

  // 4. Handle Undo (巻き戻し)
  const handleUndo = useCallback(() => {
    if (history.length === 0) return;

    const [lastAction, ...restHistory] = history;
    setHistory(restHistory);

    // Revert status in storage
    recordVocabMasteryStatus(lastAction.vocab.phrase, lastAction.prevStatus);
    recordVocabMasteryStatus(lastAction.vocab.id, lastAction.prevStatus);

    // Remove from bgQueue if pending
    setBgQueue(prev => prev.filter(v => v.id !== lastAction.vocab.id && v.phrase !== lastAction.vocab.phrase));

    // Revert index & state
    setCurrentIndex(lastAction.index);
    setIsRevealed(true);
    setMasteryStateVersion(v => v + 1);
  }, [history]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if (e.code === 'Space' || e.code === 'Numpad0' || e.code === 'Digit0') {
        e.preventDefault();
        // ⚡ 絶対わかる (Instant skip from front, or rate mastered from back)
        handleRate('mastered', false);
      } else if (e.code === 'Enter' || e.code === 'ArrowDown') {
        e.preventDefault();
        setIsRevealed(prev => !prev);
      } else if (e.code === 'Digit1' || e.code === 'Numpad1') {
        e.preventDefault();
        handleRate('lapsed', true); // 🔴 もう一度 (Ankiキューへ)
      } else if (e.code === 'Digit2' || e.code === 'Numpad2') {
        e.preventDefault();
        handleRate('exposed', true); // 🟡 難しい (Ankiキューへ)
      } else if (e.code === 'Digit3' || e.code === 'Numpad3') {
        e.preventDefault();
        handleRate('exposed', false); // 🔵 覚えた
      } else if (e.code === 'Digit4' || e.code === 'Numpad4') {
        e.preventDefault();
        handleRate('exposed', false); // 🟢 簡単
      } else if (e.code === 'KeyZ' || e.code === 'Backspace') {
        e.preventDefault();
        handleUndo();
      } else if (e.code === 'KeyR') {
        e.preventDefault();
        playWordAudio();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleRate, handleUndo, playWordAudio]);

  const totalCount = filteredVocabs.length;
  const progressPercent = totalCount > 0 ? Math.round((currentIndex / totalCount) * 100) : 100;

  return (
    <div className="max-w-3xl mx-auto space-y-5 py-4 sm:py-6 animate-fadeIn pb-32">
      {/* 1. Top Control & Mode Selector Bar */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-2xl backdrop-blur-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 via-orange-600 to-rose-500 flex items-center justify-center text-white shadow-lg shadow-amber-500/20">
              <Flame className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold text-white">
                  高速単語ドリル
                </h1>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">
                  未知潰し特化
                </span>
              </div>
              <p className="text-xs text-slate-400">
                単語を高速トリアージ。知らん単語は裏でAnkiに自動生成蓄積！
              </p>
            </div>
          </div>

          {/* Background Anki Queue Indicator */}
          <div className="flex items-center gap-2">
            {bgQueue.length > 0 ? (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-950/80 border border-purple-500/40 text-purple-300 text-xs font-bold animate-pulse">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Anki生成中: 残り {bgQueue.length} 語</span>
              </div>
            ) : bgProcessedCount > 0 ? (
              <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-950/80 border border-emerald-500/30 text-emerald-300 text-xs font-bold rounded-xl">
                <Check className="w-3.5 h-3.5" />
                <span>Anki {bgProcessedCount} 語 蓄積済</span>
              </div>
            ) : null}

            {onNavigateToAnki && (
              <button
                onClick={onNavigateToAnki}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-950 hover:bg-slate-800 text-slate-300 hover:text-white rounded-xl text-xs font-bold border border-slate-800 transition-all cursor-pointer"
              >
                <Layers className="w-3.5 h-3.5 text-cyan-400" />
                <span>Ankiへ</span>
              </button>
            )}
          </div>
        </div>

        {/* Level & Filter Selector Grid */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-slate-800/80">
          {/* CEFR Level Tabs */}
          <div className="flex items-center space-x-1 p-1 bg-slate-950 rounded-2xl border border-slate-800">
            {(['A1', 'A2', 'B1', 'B2'] as CefrLevel[]).map(lvl => (
              <button
                key={lvl}
                onClick={() => setSelectedCefr(lvl)}
                className={`px-3 py-1 rounded-xl text-xs font-bold font-mono transition-all cursor-pointer ${
                  selectedCefr === lvl
                    ? 'bg-amber-500 text-slate-950 shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {lvl}
              </button>
            ))}
          </div>

          {/* Filter Mode Tabs */}
          <div className="flex items-center space-x-1 p-1 bg-slate-950 rounded-2xl border border-slate-800 text-xs">
            {[
              { key: 'unseen', label: '未遭遇のみ (未知潰し)' },
              { key: 'lapsed', label: '要復習のみ' },
              { key: 'all', label: '全単語' },
            ].map(f => (
              <button
                key={f.key}
                onClick={() => setFilterMode(f.key as DrillFilterMode)}
                className={`px-2.5 py-1 rounded-xl text-[11px] font-bold transition-all cursor-pointer ${
                  filterMode === f.key
                    ? 'bg-slate-800 text-amber-300 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Main Flashcard Area */}
      {!currentVocab || currentIndex >= totalCount ? (
        /* Completion Screen */
        <div className="bg-slate-900/95 border border-amber-500/30 rounded-3xl p-8 sm:p-12 text-center shadow-2xl space-y-6">
          <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-amber-500 via-orange-500 to-emerald-500 flex items-center justify-center mx-auto shadow-xl shadow-amber-500/20">
            <Trophy className="w-8 h-8 text-white" />
          </div>

          <div className="space-y-2">
            <span className="px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30 text-xs">
              {selectedCefr} {filterMode === 'unseen' ? '未遭遇単語' : ''} ドリル完了
            </span>
            <h2 className="text-2xl sm:text-3xl font-black text-white">
              すべての単語を仕分け切りました！🎉
            </h2>
            <p className="text-sm text-slate-300 max-w-md mx-auto">
              今回のセッションで「⚡ 絶対わかる」にした単語は完全に卒業し、分からなかった単語は裏でAnkiデッキに自動蓄積されています。
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 max-w-sm mx-auto p-4 bg-slate-950/80 rounded-2xl border border-slate-800 text-xs">
            <div className="text-center">
              <span className="text-slate-400 block text-[10px]">⚡ 卒業</span>
              <span className="text-lg font-black text-amber-300 font-mono">{sessionStats.mastered}</span>
            </div>
            <div className="text-center">
              <span className="text-slate-400 block text-[10px]">🔴 要復習(Anki)</span>
              <span className="text-lg font-black text-rose-400 font-mono">{sessionStats.lapsed}</span>
            </div>
            <div className="text-center">
              <span className="text-slate-400 block text-[10px]">🔵 覚えた/簡単</span>
              <span className="text-lg font-black text-cyan-400 font-mono">{sessionStats.exposed}</span>
            </div>
          </div>

          <div className="pt-2 flex flex-wrap justify-center gap-3">
            <button
              onClick={() => {
                setCurrentIndex(0);
                setIsRevealed(false);
                setFilterMode('all');
              }}
              className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              全単語で再挑戦
            </button>
            {onNavigateToAnki && (
              <button
                onClick={onNavigateToAnki}
                className="px-6 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-xl text-xs font-black shadow-lg shadow-cyan-600/30 transition-all cursor-pointer"
              >
                Ankiで無心フラッシュカード復習へ 🚀
              </button>
            )}
          </div>
        </div>
      ) : (
        /* Active Card */
        <div className="space-y-4">
          {/* Progress Bar & Counter */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3 shadow-lg space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-300 flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-md bg-amber-500/20 text-amber-300 font-mono font-bold">
                  {currentIndex + 1} / {totalCount} 語
                </span>
                <span className="text-[11px] text-slate-400">
                  ({selectedCefr} レベル)
                </span>
              </span>

              <div className="flex items-center gap-3">
                {history.length > 0 && (
                  <button
                    type="button"
                    onClick={handleUndo}
                    className="flex items-center space-x-1 text-slate-400 hover:text-amber-300 transition-colors cursor-pointer text-[11px]"
                    title="直前の判定を取り消す (Zキー)"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                    <span>1つ戻る (Z)</span>
                  </button>
                )}
                <span className="text-[11px] text-amber-300 font-mono font-bold">
                  {progressPercent}%
                </span>
              </div>
            </div>

            <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
              <div
                className="bg-gradient-to-r from-amber-400 via-orange-500 to-rose-400 h-full transition-all duration-200"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {/* Big Flashcard Body */}
          <div
            onClick={() => setIsRevealed(prev => !prev)}
            className="bg-slate-950/90 border border-slate-800 hover:border-slate-700 rounded-3xl p-6 sm:p-10 space-y-6 text-center shadow-2xl relative overflow-hidden min-h-[300px] flex flex-col justify-center cursor-pointer transition-all group"
          >
            {/* Top info row */}
            <div className="flex items-center justify-between">
              <span className="px-2.5 py-0.5 rounded-full bg-slate-900 text-slate-400 border border-slate-800 text-[11px] font-mono">
                {currentVocab.partOfSpeech || '単語'}
              </span>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  playWordAudio();
                }}
                className="p-2.5 rounded-xl bg-slate-900 hover:bg-slate-850 text-slate-300 hover:text-cyan-400 border border-slate-800 transition-all cursor-pointer shadow-sm active:scale-95"
                title="発音を再生 (Rキー)"
              >
                <Volume2 className="w-4 h-4" />
              </button>
            </div>

            {/* Front: English Word */}
            <div className="space-y-2 py-4">
              <h2 className="text-3xl sm:text-5xl font-black text-white font-serif tracking-wide group-hover:scale-[1.02] transition-transform">
                {currentVocab.phrase}
              </h2>
            </div>

            {/* Back: Japanese Meaning */}
            {isRevealed ? (
              <div className="p-5 sm:p-6 bg-slate-900/90 border border-amber-500/30 rounded-2xl space-y-2 animate-fadeIn shadow-lg">
                <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider block">
                  【日本語の意味】
                </span>
                <p className="text-xl sm:text-2xl font-black text-amber-200">
                  {currentVocab.meaning}
                </p>
              </div>
            ) : (
              <div className="py-4 text-xs font-bold text-slate-500 group-hover:text-slate-400 flex items-center justify-center gap-1.5 transition-colors">
                <Eye className="w-4 h-4 text-slate-500" />
                <span>タップ または Enter で訳を表示（知っていればそのまま Space でスキップ！）</span>
              </div>
            )}
          </div>

          {/* 3. Action Buttons */}
          <div className="space-y-2.5">
            {/* ⚡ 絶対わかる (Instant Master / Skip Button) - Full width, top prominence */}
            <button
              type="button"
              onClick={() => handleRate('mastered', false)}
              className="w-full flex items-center justify-center space-x-2 py-3.5 px-6 rounded-2xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-400 hover:to-orange-400 text-slate-950 text-sm sm:text-base font-black shadow-xl shadow-amber-500/25 transition-all active:scale-[0.98] cursor-pointer"
            >
              <Zap className="w-5 h-5 fill-slate-950" />
              <span>⚡ 絶対わかる（完全習得・今後出題不要） [Space / 0]</span>
            </button>

            {/* 4-grade Anki buttons */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => handleRate('lapsed', true)}
                className="flex flex-col items-center justify-center p-3 rounded-2xl bg-rose-950/50 hover:bg-rose-900/60 border border-rose-500/40 text-rose-300 hover:text-white text-xs font-bold transition-all active:scale-95 cursor-pointer space-y-1 shadow-md"
              >
                <div className="flex items-center gap-1">
                  <span>🔴 もう一度</span>
                  <span className="font-mono text-[10px] text-rose-400">[1]</span>
                </div>
                <span className="text-[10px] text-rose-400/80 font-normal">Ankiカード自動生成</span>
              </button>

              <button
                type="button"
                onClick={() => handleRate('exposed', true)}
                className="flex flex-col items-center justify-center p-3 rounded-2xl bg-amber-950/50 hover:bg-amber-900/60 border border-amber-500/40 text-amber-300 hover:text-white text-xs font-bold transition-all active:scale-95 cursor-pointer space-y-1 shadow-md"
              >
                <div className="flex items-center gap-1">
                  <span>🟡 難しい</span>
                  <span className="font-mono text-[10px] text-amber-400">[2]</span>
                </div>
                <span className="text-[10px] text-amber-400/80 font-normal">Ankiカード自動生成</span>
              </button>

              <button
                type="button"
                onClick={() => handleRate('exposed', false)}
                className="flex flex-col items-center justify-center p-3 rounded-2xl bg-sky-950/50 hover:bg-sky-900/60 border border-sky-500/40 text-sky-300 hover:text-white text-xs font-bold transition-all active:scale-95 cursor-pointer space-y-1 shadow-md"
              >
                <div className="flex items-center gap-1">
                  <span>🔵 覚えた</span>
                  <span className="font-mono text-[10px] text-sky-400">[3]</span>
                </div>
                <span className="text-[10px] text-sky-400/80 font-normal">定期復習へ</span>
              </button>

              <button
                type="button"
                onClick={() => handleRate('exposed', false)}
                className="flex flex-col items-center justify-center p-3 rounded-2xl bg-emerald-950/50 hover:bg-emerald-900/60 border border-emerald-500/40 text-emerald-300 hover:text-white text-xs font-bold transition-all active:scale-95 cursor-pointer space-y-1 shadow-md"
              >
                <div className="flex items-center gap-1">
                  <span>🟢 簡単</span>
                  <span className="font-mono text-[10px] text-emerald-400">[4]</span>
                </div>
                <span className="text-[10px] text-emerald-400/80 font-normal">間隔延長</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
