import React, { useState, useMemo } from 'react';
import { VocabItem } from '../types/vocab';
import { DifficultSentenceItem } from '../types/sentence';
import { BookMarked, Search, Volume2, Trash2, CheckCircle2, ChevronDown, ChevronUp, FileText, Calendar, Sparkles, RefreshCw, Star } from 'lucide-react';
import { speakText } from '../utils/speech';
import { getTodayDateString } from '../utils/srs';

interface VocabBankViewProps {
  vocabs: VocabItem[];
  difficultSentences?: DifficultSentenceItem[];
  onMasterVocab: (vocabId: string) => void;
  onDeleteVocab: (vocabId: string) => void;
  onDeleteSentence?: (sentenceId: string) => void;
  onUpdateImportance?: (vocabId: string, importance: number) => void;
  onRankVocabImportance?: () => Promise<void>;
  isRankingImportance?: boolean;
}

export const VocabBankView: React.FC<VocabBankViewProps> = ({
  vocabs,
  difficultSentences = [],
  onMasterVocab,
  onDeleteVocab,
  onDeleteSentence,
  onUpdateImportance,
  onRankVocabImportance,
  isRankingImportance,
}) => {
  const [activeTab, setActiveTab] = useState<'words' | 'sentences'>('words');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'due' | 'learning' | 'mastered'>('all');
  const [sortBy, setSortBy] = useState<'importance' | 'due' | 'alpha' | 'lapses'>('importance');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const today = getTodayDateString();

  // 単語フィルタリング＆ソート
  const filteredVocabs = useMemo(() => {
    return vocabs
      .filter((v) => {
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
      })
      .sort((a, b) => {
        if (sortBy === 'importance') {
          const impA = a.importance ?? 3;
          const impB = b.importance ?? 3;
          if (impB !== impA) return impB - impA;
          return b.lapseCount - a.lapseCount;
        }
        if (sortBy === 'due') {
          return a.nextReviewDate.localeCompare(b.nextReviewDate);
        }
        if (sortBy === 'alpha') {
          return a.phrase.localeCompare(b.phrase);
        }
        if (sortBy === 'lapses') {
          return b.lapseCount - a.lapseCount;
        }
        return 0;
      });
  }, [vocabs, searchTerm, statusFilter, sortBy, today]);

  // 訳せなかった文フィルタリング
  const filteredSentences = useMemo(() => {
    return difficultSentences.filter((s) => {
      return (
        s.sentence.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.translation.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (s.highlightedPhrase && s.highlightedPhrase.toLowerCase().includes(searchTerm.toLowerCase()))
      );
    });
  }, [difficultSentences, searchTerm]);

  const dueCount = vocabs.filter(v => v.nextReviewDate <= today).length;
  const masteredCount = vocabs.filter(v => v.repetitionCount >= 4).length;
  const learningCount = vocabs.filter(v => v.repetitionCount < 4).length;

  const toggleExpand = (id: string) => {
    setExpandedId(prev => (prev === id ? null : id));
  };

  const getImportanceLabel = (imp: number = 3) => {
    switch (imp) {
      case 5: return '⭐⭐⭐⭐⭐ 日常必須・超重要';
      case 4: return '⭐⭐⭐⭐ 重要・頻出';
      case 3: return '⭐⭐⭐ 標準';
      case 2: return '⭐⭐ やや専門的';
      case 1: return '⭐ 稀・難解';
      default: return '⭐⭐⭐ 標準';
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-5">
      {/* 1. Subtab Switcher & AI Importance Rank Action */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl space-y-3.5">
        <div className="flex items-center justify-between flex-wrap gap-2.5">
          {/* Subtab Buttons */}
          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setActiveTab('words')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all ${
                activeTab === 'words'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BookMarked className="w-3.5 h-3.5" />
              <span>単語・イディオム ({vocabs.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('sentences')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all ${
                activeTab === 'sentences'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>訳せなかった文 ({difficultSentences.length})</span>
            </button>
          </div>

          {/* AI Rank Importance Button */}
          {activeTab === 'words' && onRankVocabImportance && (
            <button
              onClick={onRankVocabImportance}
              disabled={isRankingImportance || vocabs.length === 0}
              className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 active:scale-95 text-white rounded-xl text-xs font-bold shadow-md shadow-amber-600/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              title="日常英会話における重要度（★1〜★5）をAIで自動判定します"
            >
              {isRankingImportance ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>AIランク付け中...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-yellow-300" />
                  <span>AIで重要度を自動ランク付け</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Search Bar, Filters & Sort Dropdown */}
        <div className="space-y-2.5 pt-1 border-t border-slate-800/80">
          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={activeTab === 'words' ? '単語・フレーズ・意味を検索...' : '訳せなかった英文や日本語訳を検索...'}
                className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl pl-9 pr-4 py-2 text-xs sm:text-sm text-slate-100 placeholder-slate-500 outline-none"
              />
            </div>

            {activeTab === 'words' && (
              <div className="flex items-center space-x-2">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="bg-slate-950 border border-slate-800 text-xs text-slate-300 rounded-xl px-3 py-2 outline-none"
                >
                  <option value="importance">⭐ 重要度順 (高→低)</option>
                  <option value="due">📅 復習期日順</option>
                  <option value="lapses">🔥 忘却回数順</option>
                  <option value="alpha">🔤 アルファベット順</option>
                </select>
              </div>
            )}
          </div>

          {activeTab === 'words' && (
            <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
              <div className="flex items-center space-x-1 overflow-x-auto pb-0.5 font-semibold">
                <button
                  onClick={() => setStatusFilter('all')}
                  className={`px-3 py-1 rounded-xl transition-all ${
                    statusFilter === 'all'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  すべて ({vocabs.length})
                </button>
                <button
                  onClick={() => setStatusFilter('due')}
                  className={`px-3 py-1 rounded-xl transition-all ${
                    statusFilter === 'due'
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  要復習 ({dueCount})
                </button>
                <button
                  onClick={() => setStatusFilter('learning')}
                  className={`px-3 py-1 rounded-xl transition-all ${
                    statusFilter === 'learning'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  習得中 ({learningCount})
                </button>
                <button
                  onClick={() => setStatusFilter('mastered')}
                  className={`px-3 py-1 rounded-xl transition-all ${
                    statusFilter === 'mastered'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  定着済 ({masteredCount})
                </button>
              </div>

              <div className="text-[11px] text-slate-400 hidden sm:block">
                ※重要度の高い語彙から優先的に物語に注入されます
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 2. Content Area: Subtab 1 - Words List */}
      {activeTab === 'words' && (
        <>
          {filteredVocabs.length > 0 ? (
            <div className="space-y-2.5">
              {filteredVocabs.map((vocab) => {
                const isDue = vocab.nextReviewDate <= today;
                const isExpanded = expandedId === vocab.id;
                const currentImportance = vocab.importance ?? 3;

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
                          <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                            <span className="text-base sm:text-lg font-bold text-white tracking-tight">
                              {vocab.phrase}
                            </span>

                            {/* Importance Badge */}
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                              currentImportance >= 4
                                ? 'bg-amber-950/60 text-amber-300 border-amber-500/40'
                                : 'bg-slate-800 text-slate-300 border-slate-700'
                            }`}>
                              ★{currentImportance}
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

                    {isExpanded && (
                      <div className="px-4 pb-4 pt-1 bg-slate-950/60 border-t border-slate-800/80 space-y-3 text-xs animate-fadeIn">
                        {/* Interactive Star Rating for Importance */}
                        <div className="flex items-center justify-between bg-slate-900/60 p-2.5 rounded-xl border border-slate-800">
                          <span className="text-slate-300 font-medium flex items-center gap-1">
                            <span>日常会話における重要度:</span>
                            <strong className="text-amber-400 font-bold ml-1">{getImportanceLabel(currentImportance)}</strong>
                          </span>

                          <div className="flex items-center space-x-1">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <button
                                key={star}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (onUpdateImportance) onUpdateImportance(vocab.id, star);
                                }}
                                className={`p-1 transition-transform hover:scale-125 ${
                                  star <= currentImportance ? 'text-amber-400' : 'text-slate-600 hover:text-slate-400'
                                }`}
                                title={`重要度を ${star} に設定`}
                              >
                                <Star className="w-4 h-4 fill-current" />
                              </button>
                            ))}
                          </div>
                        </div>

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

                        {vocab.contextNote && (
                          <div className="bg-slate-900/50 p-2.5 rounded-xl border border-slate-800/60 text-slate-300 leading-relaxed">
                            <span className="text-blue-400 font-bold block mb-0.5">💡 構文・ニュアンス解説:</span>
                            <p>{vocab.contextNote}</p>
                          </div>
                        )}

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
                {searchTerm ? '一致する語彙が見つかりませんでした。' : '登録された語彙はまだありません。'}
              </p>
            </div>
          )}
        </>
      )}

      {/* 3. Content Area: Subtab 2 - Difficult Sentences */}
      {activeTab === 'sentences' && (
        <div className="space-y-3">
          <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl text-xs text-slate-400 leading-relaxed">
            💡 単語は分かるが構文・文脈が難しかった文の記録です。後で自己分析や苦手な文法の傾向把握に活用できます。
          </div>

          {filteredSentences.length > 0 ? (
            <div className="space-y-3">
              {filteredSentences.map((item) => (
                <div
                  key={item.id}
                  className="bg-slate-900/90 border border-slate-800 hover:border-indigo-500/40 rounded-2xl p-4 sm:p-5 shadow-lg space-y-3 transition-all"
                >
                  {/* English Sentence */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center space-x-2">
                        <span className="text-[10px] uppercase font-bold text-indigo-400 bg-indigo-950/60 border border-indigo-500/30 px-2 py-0.5 rounded-md">
                          訳せなかった文
                        </span>
                        {item.highlightedPhrase && (
                          <span className="text-[10px] text-sky-300 font-medium bg-slate-800 px-2 py-0.5 rounded-md">
                            選択フレーズ: {item.highlightedPhrase}
                          </span>
                        )}
                      </div>

                      <p className="text-base sm:text-lg font-semibold text-white leading-relaxed font-serif pt-1">
                        "{item.sentence}"
                      </p>
                    </div>

                    <div className="flex items-center space-x-1 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => speakText(item.sentence)}
                        className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-slate-800 rounded-lg transition-colors"
                        title="英文を再生"
                      >
                        <Volume2 className="w-4 h-4" />
                      </button>

                      {onDeleteSentence && (
                        <button
                          type="button"
                          onClick={() => onDeleteSentence(item.id)}
                          className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-950/40 rounded-lg transition-colors"
                          title="削除"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Japanese Translation */}
                  <div className="bg-slate-950/80 border border-slate-800/80 p-3 rounded-xl space-y-1">
                    <span className="text-[11px] font-bold text-blue-400 block">日本語訳:</span>
                    <p className="text-xs sm:text-sm text-slate-200 leading-relaxed font-medium">
                      {item.translation || '（訳なし）'}
                    </p>
                  </div>

                  {/* Footer Meta */}
                  <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(item.createdAt).toLocaleDateString('ja-JP')}
                    </span>
                    {item.sourceStoryTitle && (
                      <span className="truncate max-w-[200px]">
                        出典: {item.sourceStoryTitle}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-16 text-center space-y-3 bg-slate-900/40 border border-slate-800/60 rounded-2xl p-8">
              <FileText className="w-10 h-10 text-slate-600 mx-auto" />
              <p className="text-xs sm:text-sm text-slate-400">
                {searchTerm ? '一致する文章は見つかりませんでした。' : '「訳せなかった文」として保存された文章はまだありません。リーダーで文章を選択した際、「訳せなかった文として保存」を押すとここに蓄積されます。'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};