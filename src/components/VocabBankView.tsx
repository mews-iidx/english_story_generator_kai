import React, { useState, useMemo } from 'react';
import { VocabItem } from '../types/vocab';
import { BookMarked, Search, Volume2, Trash2, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { speakText } from '../utils/speech';
import { getTodayDateString } from '../utils/srs';

interface VocabBankViewProps {
  vocabs: VocabItem[];
  onMasterVocab: (vocabId: string) => void;
  onDeleteVocab: (vocabId: string) => void;
}

export const VocabBankView: React.FC<VocabBankViewProps> = ({
  vocabs,
  onMasterVocab,
  onDeleteVocab,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'due' | 'learning' | 'mastered'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const today = getTodayDateString();

  // フィルタリング
  const filteredVocabs = useMemo(() => {
    return vocabs.filter((v) => {
      const matchesSearch =
        v.phrase.toLowerCase().includes(searchTerm.toLowerCase()) ||
        v.meaning.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (v.contextNote && v.contextNote.toLowerCase().includes(searchTerm.toLowerCase()));

      if (!matchesSearch) return false;

      if (statusFilter === 'due') {
        return v.nextReviewDate <= today;
      }
      if (statusFilter === 'mastered') {
        return v.repetitionCount >= 4;
      }
      if (statusFilter === 'learning') {
        return v.repetitionCount < 4;
      }
      return true;
    });
  }, [vocabs, searchTerm, statusFilter, today]);

  const dueCount = vocabs.filter(v => v.nextReviewDate <= today).length;
  const masteredCount = vocabs.filter(v => v.repetitionCount >= 4).length;
  const learningCount = vocabs.filter(v => v.repetitionCount < 4).length;

  const toggleExpand = (id: string) => {
    setExpandedId(prev => (prev === id ? null : id));
  };

  return (
    <div className="max-w-4xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-5">
      {/* 1. Header & Quick Stats */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl space-y-3.5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
              <BookMarked className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
                マイスクール語彙帳 📚
              </h2>
              <p className="text-xs text-slate-400">
                タップして調べた単語・フレーズが忘却曲線（SRS）で自動管理されます
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 text-xs">
            <span className="px-2.5 py-1 rounded-lg bg-amber-950/60 border border-amber-500/30 text-amber-400 font-bold">
              今日復習: {dueCount}
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-blue-950/60 border border-blue-500/30 text-blue-400 font-bold">
              習得中: {learningCount}
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-emerald-950/60 border border-emerald-500/30 text-emerald-400 font-bold hidden sm:inline">
              定着済: {masteredCount}
            </span>
          </div>
        </div>

        {/* Search Bar & Filter Buttons */}
        <div className="flex flex-col sm:flex-row gap-2.5 pt-1 border-t border-slate-800/80">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="単語・フレーズ・意味を検索..."
              className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl pl-9 pr-4 py-2 text-xs sm:text-sm text-slate-100 placeholder-slate-500 outline-none"
            />
          </div>

          <div className="flex items-center space-x-1 overflow-x-auto pb-0.5 text-xs font-semibold">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 rounded-xl transition-all ${
                statusFilter === 'all'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              すべて ({vocabs.length})
            </button>
            <button
              onClick={() => setStatusFilter('due')}
              className={`px-3 py-1.5 rounded-xl transition-all ${
                statusFilter === 'due'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              要復習 ({dueCount})
            </button>
            <button
              onClick={() => setStatusFilter('learning')}
              className={`px-3 py-1.5 rounded-xl transition-all ${
                statusFilter === 'learning'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              習得中 ({learningCount})
            </button>
          </div>
        </div>
      </div>

      {/* 2. Vocab Compact List (タップして全文・詳細展開) */}
      {filteredVocabs.length > 0 ? (
        <div className="space-y-2.5">
          {filteredVocabs.map((vocab) => {
            const isDue = vocab.nextReviewDate <= today;
            const isExpanded = expandedId === vocab.id;

            return (
              <div
                key={vocab.id}
                className={`bg-slate-900/80 border rounded-2xl transition-all duration-200 overflow-hidden ${
                  isExpanded
                    ? 'border-blue-500/50 shadow-xl shadow-blue-500/10'
                    : isDue
                    ? 'border-amber-500/30 hover:border-amber-400/50'
                    : 'border-slate-800 hover:border-slate-700'
                }`}
              >
                {/* Compact Row (常に簡潔に表示) */}
                <div
                  onClick={() => toggleExpand(vocab.id)}
                  className="p-3.5 sm:p-4 flex items-center justify-between gap-3 cursor-pointer select-none hover:bg-slate-850/50 transition-colors"
                >
                  <div className="flex items-center space-x-3 min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        speakText(vocab.phrase);
                      }}
                      className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-slate-800 rounded-lg transition-colors flex-shrink-0"
                      title="発音を再生"
                    >
                      <Volume2 className="w-4 h-4" />
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center space-x-2 flex-wrap">
                        <span className="text-base sm:text-lg font-bold text-white tracking-tight">
                          {vocab.phrase}
                        </span>
                        {isDue && (
                          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            復習期日
                          </span>
                        )}
                        {vocab.repetitionCount >= 4 && (
                          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            定着済 ✨
                          </span>
                        )}
                      </div>
                      <p className="text-xs sm:text-sm text-slate-300 font-medium truncate mt-0.5">
                        {vocab.meaning}
                      </p>
                    </div>
                  </div>

                  {/* Actions & Expand Chevron */}
                  <div className="flex items-center space-x-1 sm:space-x-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMasterVocab(vocab.id);
                      }}
                      className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-emerald-950/40 rounded-lg transition-colors text-xs flex items-center gap-1"
                      title="覚えた！(次回期日を延長)"
                    >
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span className="hidden sm:inline">覚えた</span>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteVocab(vocab.id);
                      }}
                      className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-950/40 rounded-lg transition-colors"
                      title="削除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>

                    <div className="text-slate-400 pl-1">
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                  </div>
                </div>

                {/* Expanded Detail Drawer (選択時に全文例文・詳細を表示) */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-1 bg-slate-950/60 border-t border-slate-800/80 space-y-3 text-xs animate-fadeIn">
                    {/* Context Sentence (全文) */}
                    {vocab.exampleSentence ? (
                      <div className="space-y-1 bg-slate-900/80 p-3 rounded-xl border border-slate-800">
                        <div className="flex items-center justify-between text-[11px] text-blue-400 font-bold">
                          <span>📖 登場した文脈・例文 (全文):</span>
                          <button
                            type="button"
                            onClick={() => speakText(vocab.exampleSentence)}
                            className="p-1 text-slate-400 hover:text-blue-300"
                            title="例文を再生"
                          >
                            <Volume2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <p className="text-xs sm:text-sm text-slate-200 leading-relaxed font-serif">
                          "{vocab.exampleSentence}"
                        </p>
                      </div>
                    ) : (
                      <p className="text-slate-500 italic">※例文の登録はありません</p>
                    )}

                    {/* AI Nuance / Grammar explanation */}
                    {vocab.contextNote && (
                      <div className="bg-slate-900/50 p-2.5 rounded-xl border border-slate-800/60 text-slate-300 leading-relaxed">
                        <span className="text-blue-400 font-bold block mb-0.5">💡 構文・ニュアンス解説:</span>
                        <p>{vocab.contextNote}</p>
                      </div>
                    )}

                    {/* SRS Meta info */}
                    <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                      <span>SRS 定着回数: <strong>{vocab.repetitionCount}回</strong> (復習間隔: {vocab.intervalDays}日)</span>
                      <span>次回復習: <strong>{vocab.nextReviewDate}</strong></span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="py-16 text-center space-y-3 bg-slate-900/40 border border-slate-800/60 rounded-2xl p-8">
          <BookMarked className="w-10 h-10 text-slate-600 mx-auto" />
          <p className="text-xs sm:text-sm text-slate-400">
            {searchTerm ? '一致する語彙が見つかりませんでした。' : '登録された語彙はまだありません。ストーリー中の単語をタップして登録してみましょう！'}
          </p>
        </div>
      )}
    </div>
  );
};