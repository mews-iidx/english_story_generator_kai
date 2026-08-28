import React, { useState, useMemo } from 'react';
import { Story } from '../types/story';
import { BookOpen, Calendar, Trash2, Search, Tag, Sparkles, Filter } from 'lucide-react';

interface HistoryViewProps {
  stories: Story[];
  onSelectStory: (story: Story) => void;
  onDeleteStory: (storyId: string) => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  stories,
  onSelectStory,
  onDeleteStory,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [genreFilter, setGenreFilter] = useState<string>('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');

  // 全ストーリーからユニークなジャンル一覧を抽出
  const allGenres = useMemo(() => {
    const set = new Set<string>();
    stories.forEach(s => {
      if (s.genres && Array.isArray(s.genres)) {
        s.genres.forEach(g => set.add(g));
      }
    });
    return Array.from(set);
  }, [stories]);

  // 検索・フィルタリング・ソート
  const filteredStories = useMemo(() => {
    return stories
      .filter(s => {
        const matchesSearch =
          s.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
          s.titleJa.toLowerCase().includes(searchTerm.toLowerCase()) ||
          s.summary.toLowerCase().includes(searchTerm.toLowerCase()) ||
          s.storyContent.toLowerCase().includes(searchTerm.toLowerCase());

        if (!matchesSearch) return false;

        if (levelFilter !== 'all' && (s.cefrLevel || 'A2') !== levelFilter) {
          return false;
        }

        if (genreFilter !== 'all') {
          const storyGenres = s.genres || ['General'];
          if (!storyGenres.includes(genreFilter)) return false;
        }

        return true;
      })
      .sort((a, b) => {
        const timeA = new Date(a.createdAt).getTime();
        const timeB = new Date(b.createdAt).getTime();
        return sortOrder === 'newest' ? timeB - timeA : timeA - timeB;
      });
  }, [stories, searchTerm, levelFilter, genreFilter, sortOrder]);

  const getCoverGradient = (index: number) => {
    const gradients = [
      'from-blue-600 via-indigo-700 to-slate-900 border-blue-400/40',
      'from-indigo-600 via-purple-700 to-slate-900 border-indigo-400/40',
      'from-sky-600 via-teal-700 to-slate-900 border-sky-400/40',
      'from-emerald-600 via-teal-800 to-slate-900 border-emerald-400/40',
      'from-amber-600 via-orange-800 to-slate-900 border-amber-400/40',
      'from-rose-600 via-pink-800 to-slate-900 border-rose-400/40',
    ];
    return gradients[index % gradients.length];
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* 1. Header & Search Shelf Controls */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                マイスクール本棚（読解履歴）📚
              </h2>
              <p className="text-xs sm:text-sm text-slate-400">
                あなたが読んだ物語のコレクションです。いつでも再読して復習できます。
              </p>
            </div>
          </div>

          <div className="bg-slate-950 px-4 py-2 rounded-xl border border-slate-800 text-center">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">所蔵冊数</span>
            <span className="text-xl font-bold text-blue-400">{stories.length} <span className="text-xs font-normal text-slate-400">冊</span></span>
          </div>
        </div>

        {/* Search Bar & Filters */}
        <div className="space-y-3 pt-1 border-t border-slate-800/80">
          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="タイトル、日本語名、あらすじ、英文を検索..."
                className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl pl-9 pr-4 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none"
              />
            </div>

            <div className="flex items-center space-x-2">
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as any)}
                className="bg-slate-950 border border-slate-800 text-xs text-slate-300 rounded-xl px-3 py-2 outline-none"
              >
                <option value="newest">📅 新しい順</option>
                <option value="oldest">📅 古い順</option>
              </select>
            </div>
          </div>

          {/* Level & Genre Filter Pills */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
            <div className="flex items-center space-x-1 overflow-x-auto pb-1 sm:pb-0">
              <span className="text-slate-500 mr-1 flex items-center gap-1 font-semibold">
                <Filter className="w-3 h-3" /> レベル:
              </span>
              {['all', 'A1', 'A2', 'B1', 'B2', 'C1'].map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => setLevelFilter(lvl)}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all ${
                    levelFilter === lvl
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  {lvl === 'all' ? 'すべて' : lvl}
                </button>
              ))}
            </div>

            {allGenres.length > 0 && (
              <div className="flex items-center space-x-1 overflow-x-auto pb-1 sm:pb-0">
                <span className="text-slate-500 mr-1 flex items-center gap-1 font-semibold">
                  <Tag className="w-3 h-3" /> ジャンル:
                </span>
                <button
                  onClick={() => setGenreFilter('all')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                    genreFilter === 'all'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  すべて
                </button>
                {allGenres.map((g) => (
                  <button
                    key={g}
                    onClick={() => setGenreFilter(g)}
                    className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                      genreFilter === g
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 2. Bookshelf Grid */}
      {filteredStories.length > 0 ? (
        <div className="space-y-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredStories.map((story, index) => {
              const coverStyle = getCoverGradient(index);

              return (
                <div
                  key={story.id}
                  onClick={() => onSelectStory(story)}
                  className={`group relative rounded-3xl p-5 bg-gradient-to-br ${coverStyle} border transition-all duration-300 hover:-translate-y-1.5 hover:shadow-2xl hover:shadow-blue-500/20 cursor-pointer flex flex-col justify-between space-y-4 overflow-hidden`}
                >
                  <div className="absolute top-0 left-0 bottom-0 w-3 bg-black/30 border-r border-white/10" />

                  <div className="flex items-start justify-between gap-2 pl-2">
                    <div className="flex items-center space-x-1.5 flex-wrap">
                      <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-black/40 text-white font-bold backdrop-blur-md border border-white/20">
                        {story.cefrLevel || 'A2'}
                      </span>
                      {story.genres && story.genres.length > 0 && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-slate-200 font-medium backdrop-blur-md">
                          {story.genres[0]}
                        </span>
                      )}
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteStory(story.id);
                      }}
                      className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-black/40 rounded-xl transition-colors"
                      title="削除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="pl-2 space-y-2 flex-1">
                    <h3 className="text-lg font-bold text-white tracking-tight group-hover:text-sky-300 transition-colors line-clamp-2">
                      {story.title}
                    </h3>
                    <p className="text-xs text-sky-200/90 font-medium line-clamp-1">
                      {story.titleJa}
                    </p>

                    {story.summary && (
                      <p className="text-xs text-slate-300/80 line-clamp-3 leading-relaxed pt-1">
                        {story.summary}
                      </p>
                    )}
                  </div>

                  <div className="pl-2 pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-slate-300/80">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(story.createdAt).toLocaleDateString('ja-JP')}
                    </span>

                    {story.targetVocabList && story.targetVocabList.length > 0 && (
                      <span className="flex items-center gap-1 text-amber-300 font-semibold">
                        <Sparkles className="w-3 h-3" />
                        復習語彙: {story.targetVocabList.length}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="h-3 bg-gradient-to-r from-slate-950 via-slate-800 to-slate-950 rounded-full shadow-inner border-t border-slate-700/60" />
        </div>
      ) : (
        <div className="py-20 text-center space-y-3 bg-slate-900/40 border border-slate-800/60 rounded-3xl p-8">
          <BookOpen className="w-12 h-12 text-slate-600 mx-auto" />
          <p className="text-sm text-slate-400">条件に一致するストーリーは見つかりませんでした。</p>
        </div>
      )}
    </div>
  );
};