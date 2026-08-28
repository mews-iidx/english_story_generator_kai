import React, { useState, useMemo } from 'react';
import { VocabItem } from '../types/vocab';
import { Search, Volume2, CheckCircle2, Trash2, Calendar, AlertCircle } from 'lucide-react';
import { speakText } from '../utils/speech';

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
  const [filter, setFilter] = useState<'all' | 'due' | 'learning' | 'mastered'>('all');

  const today = new Date().toISOString().split('T')[0];

  const filteredVocabs = useMemo(() => {
    return vocabs.filter((v) => {
      const matchSearch =
        v.phrase.toLowerCase().includes(searchTerm.toLowerCase()) ||
        v.meaning.toLowerCase().includes(searchTerm.toLowerCase());

      if (!matchSearch) return false;

      if (filter === 'due') {
        return v.nextReviewDate <= today;
      }
      if (filter === 'mastered') {
        return v.repetitionCount >= 5;
      }
      if (filter === 'learning') {
        return v.repetitionCount < 5;
      }
      return true;
    });
  }, [vocabs, searchTerm, filter, today]);

  const dueCount = vocabs.filter((v) => v.nextReviewDate <= today).length;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      {/* Header & Stats */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              弱点語彙・構文バンク (SRS)
            </h2>
            <p className="text-xs sm:text-sm text-slate-400">
              タップして調べた単語や間違えた構文が、忘却曲線に基づいて蓄積・再出題されます。
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <div className="bg-slate-950 px-3.5 py-1.5 rounded-xl border border-slate-800 text-center">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block">登録総数</span>
              <span className="text-lg font-bold text-blue-400">{vocabs.length}</span>
            </div>
            <div className="bg-slate-950 px-3.5 py-1.5 rounded-xl border border-slate-800 text-center">
              <span className="text-[10px] text-amber-400 uppercase tracking-wider block">今日復習</span>
              <span className="text-lg font-bold text-amber-400">{dueCount}</span>
            </div>
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="単語・フレーズ・意味を検索..."
              className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl pl-9 pr-4 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none"
            />
          </div>

          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 space-x-1">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                filter === 'all' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              すべて ({vocabs.length})
            </button>
            <button
              onClick={() => setFilter('due')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                filter === 'due' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              復習期日 ({dueCount})
            </button>
            <button
              onClick={() => setFilter('learning')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                filter === 'learning' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              学習中
            </button>
          </div>
        </div>
      </div>

      {/* Vocab Cards List */}
      {filteredVocabs.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {filteredVocabs.map((vocab) => {
            const isDue = vocab.nextReviewDate <= today;

            return (
              <div
                key={vocab.id}
                className={`bg-slate-900/70 border rounded-2xl p-4 sm:p-5 transition-all shadow-md flex flex-col justify-between space-y-3 ${
                  isDue
                    ? 'border-amber-500/40 bg-amber-950/10'
                    : 'border-slate-800/80 hover:border-slate-700'
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center space-x-2 flex-wrap">
                      <span className="text-lg sm:text-xl font-bold text-white tracking-tight">
                        {vocab.phrase}
                      </span>
                      <button
                        onClick={() => speakText(vocab.phrase)}
                        className="p-1 text-slate-400 hover:text-blue-400 rounded-lg transition-colors"
                        title="発音を再生"
                      >
                        <Volume2 className="w-4 h-4" />
                      </button>
                    </div>

                    {isDue && (
                      <span className="text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full flex items-center gap-1 flex-shrink-0">
                        <AlertCircle className="w-3 h-3" /> 復習期日
                      </span>
                    )}
                  </div>

                  <p className="text-sm font-semibold text-blue-400">
                    {vocab.meaning}
                  </p>

                  {vocab.contextNote && (
                    <p className="text-xs text-slate-400 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800 leading-relaxed">
                      💡 {vocab.contextNote}
                    </p>
                  )}

                  {vocab.exampleSentence && (
                    <p className="text-xs text-slate-300 italic bg-slate-950/40 p-2 rounded-lg border border-slate-800/60">
                      "{vocab.exampleSentence}"
                    </p>
                  )}
                </div>

                {/* Card Footer: SRS Info & Actions */}
                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-500">
                  <div className="flex items-center space-x-2">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-slate-400" />
                      次回: {vocab.nextReviewDate}
                    </span>
                    <span>• 忘れた回数: {vocab.lapseCount}</span>
                  </div>

                  <div className="flex items-center space-x-1">
                    <button
                      onClick={() => onMasterVocab(vocab.id)}
                      className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded-lg transition-colors"
                      title="覚えた！(次回期日を延長)"
                    >
                      <CheckCircle2 className="w-4 h-4" />
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
        <div className="py-16 text-center space-y-2 bg-slate-900/40 border border-slate-800/60 rounded-3xl p-8">
          <p className="text-sm text-slate-400">該当する語彙は見つかりませんでした。</p>
        </div>
      )}
    </div>
  );
};