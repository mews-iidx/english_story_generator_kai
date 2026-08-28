import React, { useState, useMemo } from 'react';
import { VocabItem } from '../types/vocab';
import { Bookmark, Search, Volume2, BookmarkCheck, Trash2, Sparkles, CheckCircle2, RotateCcw } from 'lucide-react';
import { speakText } from '../utils/speech';
import { getTodayDateString } from '../utils/srs';

interface VocabBankViewProps {
  vocabs: VocabItem[];
  onMasterVocab: (id: string) => void;
  onDeleteVocab: (id: string) => void;
}

export const VocabBankView: React.FC<VocabBankViewProps> = ({
  vocabs,
  onMasterVocab,
  onDeleteVocab,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'due' | 'learning' | 'mastered'>('all');

  const today = getTodayDateString();

  // 統計情報
  const stats = useMemo(() => {
    const total = vocabs.length;
    const due = vocabs.filter(v => v.nextReviewDate <= today).length;
    const mastered = vocabs.filter(v => v.intervalDays >= 30).length;
    const learning = total - mastered;
    return { total, due, mastered, learning };
  }, [vocabs, today]);

  // フィルタリングと検索
  const filteredVocabs = useMemo(() => {
    return vocabs.filter(v => {
      const matchesSearch = 
        v.phrase.toLowerCase().includes(searchQuery.toLowerCase()) ||
        v.meaning.toLowerCase().includes(searchQuery.toLowerCase()) ||
        v.contextNote.toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;

      if (activeFilter === 'due') {
        return v.nextReviewDate <= today;
      }
      if (activeFilter === 'learning') {
        return v.intervalDays < 30;
      }
      if (activeFilter === 'mastered') {
        return v.intervalDays >= 30;
      }
      return true;
    });
  }, [vocabs, searchQuery, activeFilter, today]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      {/* 1. Summary Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div 
          onClick={() => setActiveFilter('all')}
          className={`p-4 rounded-2xl border cursor-pointer transition-all ${
            activeFilter === 'all' 
              ? 'bg-slate-800/90 border-emerald-500/50 shadow-lg' 
              : 'bg-slate-900/60 border-slate-800/80 hover:bg-slate-850'
          }`}
        >
          <span className="text-xs text-slate-400 font-medium">総蓄積語彙</span>
          <p className="text-2xl font-bold text-white mt-1">{stats.total}<span className="text-xs font-normal text-slate-400 ml-1">語</span></p>
        </div>

        <div 
          onClick={() => setActiveFilter('due')}
          className={`p-4 rounded-2xl border cursor-pointer transition-all ${
            activeFilter === 'due' 
              ? 'bg-amber-950/40 border-amber-500/60 shadow-lg' 
              : 'bg-slate-900/60 border-slate-800/80 hover:bg-slate-850'
          }`}
        >
          <span className="text-xs text-amber-400 font-medium flex items-center gap-1">
            <Sparkles className="w-3 h-3" /> 本日復習対象
          </span>
          <p className="text-2xl font-bold text-amber-400 mt-1">{stats.due}<span className="text-xs font-normal text-slate-400 ml-1">語</span></p>
        </div>

        <div 
          onClick={() => setActiveFilter('learning')}
          className={`p-4 rounded-2xl border cursor-pointer transition-all ${
            activeFilter === 'learning' 
              ? 'bg-slate-800/90 border-teal-500/50 shadow-lg' 
              : 'bg-slate-900/60 border-slate-800/80 hover:bg-slate-850'
          }`}
        >
          <span className="text-xs text-teal-400 font-medium flex items-center gap-1">
            <RotateCcw className="w-3 h-3" /> 定着中
          </span>
          <p className="text-2xl font-bold text-teal-400 mt-1">{stats.learning}<span className="text-xs font-normal text-slate-400 ml-1">語</span></p>
        </div>

        <div 
          onClick={() => setActiveFilter('mastered')}
          className={`p-4 rounded-2xl border cursor-pointer transition-all ${
            activeFilter === 'mastered' 
              ? 'bg-emerald-950/40 border-emerald-500/60 shadow-lg' 
              : 'bg-slate-900/60 border-slate-800/80 hover:bg-slate-850'
          }`}
        >
          <span className="text-xs text-emerald-400 font-medium flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> 習得済み (30日+)
          </span>
          <p className="text-2xl font-bold text-emerald-400 mt-1">{stats.mastered}<span className="text-xs font-normal text-slate-400 ml-1">語</span></p>
        </div>
      </div>

      {/* 2. Filter Tabs & Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="語彙・意味・例文を検索..."
            className="w-full bg-slate-900/80 border border-slate-800 focus:border-emerald-500 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-none transition-all"
          />
        </div>

        <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 sm:pb-0">
          {(['all', 'due', 'learning', 'mastered'] as const).map((filter) => {
            const labels = {
              all: 'すべて',
              due: `本日復習 (${stats.due})`,
              learning: '定着中',
              mastered: '習得済み',
            };
            return (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter)}
                className={`px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-all ${
                  activeFilter === filter
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                    : 'bg-slate-900/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-slate-800'
                }`}
              >
                {labels[filter]}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Vocab List */}
      {filteredVocabs.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredVocabs.map((vocab) => {
            const isDue = vocab.nextReviewDate <= today;
            const isMastered = vocab.intervalDays >= 30;

            return (
              <div
                key={vocab.id}
                className="bg-slate-900/70 border border-slate-800/80 hover:border-slate-700 rounded-2xl p-5 shadow-lg backdrop-blur-sm flex flex-col justify-between space-y-4 transition-all"
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center space-x-2">
                        <h4 className="text-xl font-bold text-emerald-400 tracking-tight">
                          {vocab.phrase}
                        </h4>
                        <button
                          onClick={() => speakText(vocab.phrase)}
                          className="p-1 text-slate-400 hover:text-emerald-400 rounded-md transition-colors"
                          title="発音再生"
                        >
                          <Volume2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {vocab.partOfSpeech && (
                        <span className="inline-block mt-0.5 text-[11px] font-medium text-slate-400 px-2 py-0.2 bg-slate-800 rounded-md border border-slate-700/60">
                          {vocab.partOfSpeech}
                        </span>
                      )}
                    </div>

                    {isDue ? (
                      <span className="text-[11px] font-bold text-amber-400 bg-amber-950/60 border border-amber-500/40 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <Sparkles className="w-3 h-3" /> 復習期日
                      </span>
                    ) : isMastered ? (
                      <span className="text-[11px] font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-500/40 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> 習得
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full">
                        {vocab.intervalDays}日後
                      </span>
                    )}
                  </div>

                  <p className="text-base font-semibold text-white">
                    {vocab.meaning}
                  </p>

                  {vocab.contextNote && (
                    <p className="text-xs text-slate-300 bg-slate-950/50 p-2.5 rounded-xl border border-slate-800/60 leading-relaxed">
                      {vocab.contextNote}
                    </p>
                  )}

                  {vocab.exampleSentence && (
                    <blockquote className="text-xs italic text-slate-400 border-l-2 border-slate-700 pl-2.5 py-0.5">
                      "{vocab.exampleSentence}"
                    </blockquote>
                  )}
                </div>

                <div className="pt-3 border-t border-slate-800/70 flex items-center justify-between text-xs text-slate-400">
                  <div className="flex items-center space-x-3 text-[11px]">
                    <span>忘れた回数: <strong className="text-slate-200">{vocab.lapseCount}回</strong></span>
                    <span>次回: <strong className="text-slate-200">{vocab.nextReviewDate}</strong></span>
                  </div>

                  <div className="flex items-center space-x-1">
                    <button
                      onClick={() => onMasterVocab(vocab.id)}
                      className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded-lg transition-colors"
                      title="覚えた！（次回間隔を延長）"
                    >
                      <BookmarkCheck className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => onDeleteVocab(vocab.id)}
                      className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors"
                      title="削除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="py-16 text-center space-y-3 bg-slate-900/30 border border-slate-800/60 rounded-3xl p-8">
          <Bookmark className="w-12 h-12 text-slate-600 mx-auto" />
          <p className="text-base font-medium text-slate-300">
            {searchQuery ? '該当する語彙が見つかりませんでした' : '蓄積された語彙はまだありません'}
          </p>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            ストーリーを読んでいて分からない単語やイディオムをタップすると、ここに自動で蓄積されます。
          </p>
        </div>
      )}
    </div>
  );
};