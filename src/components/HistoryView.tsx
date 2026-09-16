import React, { useState, useMemo } from 'react';
import { Story } from '../types/story';
import { BookOpen, Calendar, Trash2, Search, Sparkles, Filter, RefreshCw, PlusCircle, ChevronDown, ChevronUp, Layers, Plus } from 'lucide-react';
import { StoryQueueTask } from '../types/storyQueue';

interface HistoryViewProps {
  stories: Story[];
  onSelectStory: (story: Story) => void;
  onDeleteStory: (storyId: string) => void;
  onNavigateToCreate?: () => void;
  isGenerating?: boolean;
  generatingTheme?: string;
  queueTasks?: StoryQueueTask[];
  onOpenQueueModal?: () => void;
  onQueueNextEpisode?: (story: Story) => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  stories,
  onSelectStory,
  onDeleteStory,
  onNavigateToCreate,
  isGenerating,
  generatingTheme,
  queueTasks = [],
  onOpenQueueModal,
  onQueueNextEpisode,
}) => {
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');

  // アクティブなフィルター数
  const activeFilterCount = (searchTerm.trim() ? 1 : 0) + (levelFilter !== 'all' ? 1 : 0) + (typeFilter !== 'all' ? 1 : 0);

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

        if (typeFilter !== 'all' && (s.contentType || 'story') !== typeFilter) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        const timeA = new Date(a.createdAt).getTime();
        const timeB = new Date(b.createdAt).getTime();
        return sortOrder === 'newest' ? timeB - timeA : timeA - timeB;
      });
  }, [stories, searchTerm, levelFilter, typeFilter, sortOrder]);

  const getCoverGradient = (index: number, contentType?: string) => {
    if (contentType === 'podcast') {
      return 'from-purple-900 via-indigo-950 to-slate-950 border-purple-500/40';
    }
    if (contentType === 'dialogue') {
      return 'from-emerald-900 via-teal-950 to-slate-950 border-emerald-500/40';
    }
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
      {/* Active Queue Banner */}
      {queueTasks.some(t => t.status === 'generating' || t.status === 'pending') && (
        <div className="bg-gradient-to-r from-blue-950/80 to-indigo-950/80 border border-blue-500/40 rounded-3xl p-4 sm:p-5 shadow-xl flex items-center justify-between flex-wrap gap-3 animate-fadeIn">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600/30 border border-blue-500/40 flex items-center justify-center text-blue-300">
              <RefreshCw className="w-4 h-4 animate-spin" />
            </div>
            <div>
              <div className="text-xs font-bold text-blue-300">
                バックグラウンド順次生成中...
              </div>
              <div className="text-sm font-extrabold text-white">
                {queueTasks.find(t => t.status === 'generating')?.title || '待機中タスクを処理中'}
                <span className="text-xs font-normal text-slate-300 ml-2">
                  (残り待機: {queueTasks.filter(t => t.status === 'pending').length}件)
                </span>
              </div>
            </div>
          </div>

          {onOpenQueueModal && (
            <button
              onClick={onOpenQueueModal}
              className="flex items-center space-x-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-600/25 transition-all"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>キューを確認</span>
            </button>
          )}
        </div>
      )}

      {/* 1. Compact Header Bar */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-2xl space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight flex items-center gap-2">
                <span>ストーリー本棚 📚</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-semibold border border-slate-700">
                  {stories.length} 冊
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                本をタップして読書・リスニングを開始
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* Filter Toggle Button */}
            <button
              onClick={() => setIsFilterOpen(!isFilterOpen)}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                isFilterOpen || activeFilterCount > 0
                  ? 'bg-slate-850 text-sky-300 border-sky-500/40 shadow-sm'
                  : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-850'
              }`}
            >
              <Search className="w-3.5 h-3.5" />
              <span>検索・絞り込み</span>
              {activeFilterCount > 0 && (
                <span className="w-4 h-4 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center font-bold">
                  {activeFilterCount}
                </span>
              )}
              {isFilterOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {/* Queue Button */}
            {queueTasks.length > 0 && onOpenQueueModal && (
              <button
                onClick={onOpenQueueModal}
                className="flex items-center space-x-1 px-3 py-1.5 bg-slate-950 text-slate-300 hover:text-white rounded-xl text-xs font-bold border border-slate-800 transition-colors"
                title="生成キュー一覧"
              >
                <Layers className="w-3.5 h-3.5 text-blue-400" />
                <span>キュー ({queueTasks.filter(t => t.status === 'pending' || t.status === 'generating').length})</span>
              </button>
            )}

            {/* Create Story Button */}
            {onNavigateToCreate && (
              <button
                onClick={onNavigateToCreate}
                className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-600/25 transition-all"
              >
                <PlusCircle className="w-4 h-4" />
                <span>物語を生成</span>
              </button>
            )}
          </div>
        </div>

        {/* Collapsible Search & Filter Panel (Default Closed) */}
        {isFilterOpen && (
          <div className="pt-3 border-t border-slate-800/80 space-y-3 animate-fadeIn">
            <div className="flex flex-col sm:flex-row gap-2.5">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-2.5" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="タイトル、日本語名、あらすじ、英文を検索..."
                  className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl pl-9 pr-4 py-1.5 text-xs sm:text-sm text-slate-100 placeholder-slate-500 outline-none"
                />
              </div>

              <div className="flex items-center space-x-2">
                <select
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value as any)}
                  className="bg-slate-950 border border-slate-800 text-xs text-slate-300 rounded-xl px-3 py-1.5 outline-none"
                >
                  <option value="newest">📅 新しい順</option>
                  <option value="oldest">📅 古い順</option>
                </select>

                {activeFilterCount > 0 && (
                  <button
                    onClick={() => {
                      setSearchTerm('');
                      setLevelFilter('all');
                      setTypeFilter('all');
                    }}
                    className="text-[11px] text-rose-400 hover:text-rose-300 px-2.5 py-1 rounded-lg bg-rose-950/40 border border-rose-500/30 font-semibold transition-colors"
                  >
                    リセット
                  </button>
                )}
              </div>
            </div>

            {/* Level & Type Filter Pills */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
              <div className="flex items-center space-x-1 overflow-x-auto pb-1 sm:pb-0">
                <button
                  onClick={() => setTypeFilter('all')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all ${
                    typeFilter === 'all'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  全タイプ
                </button>
                <button
                  onClick={() => setTypeFilter('podcast')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all ${
                    typeFilter === 'podcast'
                      ? 'bg-purple-600 text-white shadow-sm'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  🎙️ Podcast
                </button>
                <button
                  onClick={() => setTypeFilter('dialogue')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all ${
                    typeFilter === 'dialogue'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  💬 Dialogue
                </button>
              </div>

              <div className="flex items-center space-x-1 overflow-x-auto pb-1 sm:pb-0">
                <span className="text-slate-500 mr-1 flex items-center gap-1 font-semibold">
                  <Filter className="w-3 h-3" /> レベル:
                </span>
                {['all', 'A1', 'A2', 'B1', 'B2', 'C1'].map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => setLevelFilter(lvl)}
                    className={`px-2 py-0.5 rounded-lg font-bold transition-all ${
                      levelFilter === lvl
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                    }`}
                  >
                    {lvl === 'all' ? 'すべて' : lvl}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Background Generating Notification Card */}
      {isGenerating && (
        <div className="bg-gradient-to-r from-blue-950/70 via-slate-900 to-indigo-950/70 border border-blue-500/40 rounded-2xl p-4 shadow-lg flex items-center justify-between gap-3 animate-fadeIn">
          <div className="flex items-center space-x-3">
            <RefreshCw className="w-5 h-5 text-sky-400 animate-spin flex-shrink-0" />
            <div>
              <span className="text-xs sm:text-sm font-bold text-white block">
                AIが新しい物語・エピソードを裏で執筆中...
              </span>
              <span className="text-[11px] text-slate-300">
                {generatingTheme ? `テーマ: 「${generatingTheme}」` : '完成すると自動で本棚の先頭に追加されます'}
              </span>
            </div>
          </div>
          <span className="text-[11px] px-2.5 py-1 rounded-full bg-blue-500/20 text-blue-300 font-bold border border-blue-500/30">
            執筆中
          </span>
        </div>
      )}

      {/* 2. Bookshelf Grid */}
      {filteredStories.length > 0 ? (
        <div className="space-y-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredStories.map((story, index) => {
              const coverStyle = getCoverGradient(index, story.contentType);

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
                      {story.contentType === 'podcast' && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/30 text-purple-200 font-bold backdrop-blur-md">
                          🎙️ Podcast
                        </span>
                      )}
                      {story.contentType === 'dialogue' && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/30 text-emerald-200 font-bold backdrop-blur-md">
                          💬 Dialogue
                        </span>
                      )}
                      {story.episodeIndex && story.totalEpisodes && story.totalEpisodes > 1 && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/30 text-blue-200 font-bold backdrop-blur-md border border-blue-400/30">
                          {story.seriesType === 'continuous' || story.seriesType === 'trilogy' ? `連載 ${story.episodeIndex}/${story.totalEpisodes}` : `話 ${story.episodeIndex}/${story.totalEpisodes}`}
                        </span>
                      )}
                      {story.isRead && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/30 text-emerald-300 font-bold border border-emerald-400/40 backdrop-blur-md">
                          ✓ 読了済
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

                    <div className="flex items-center space-x-2">
                      {onQueueNextEpisode && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onQueueNextEpisode(story);
                          }}
                          className="px-2 py-0.5 bg-black/40 hover:bg-black/70 text-amber-300 rounded-lg border border-amber-400/30 text-[10px] font-bold transition-colors flex items-center gap-1"
                          title="この話の設定・あらすじを引き継いで次話をキューに追加"
                        >
                          <Plus className="w-3 h-3" />
                          <span>続きを生成</span>
                        </button>
                      )}

                      <span className="flex items-center gap-1 text-sky-300 font-semibold group-hover:underline">
                        <BookOpen className="w-3.5 h-3.5" />
                        開く ➔
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="h-3 bg-gradient-to-r from-slate-950 via-slate-800 to-slate-950 rounded-full shadow-inner border-t border-slate-700/60" />
        </div>
      ) : (
        <div className="py-20 text-center space-y-4 bg-slate-900/40 border border-slate-800/60 rounded-3xl p-8">
          <BookOpen className="w-12 h-12 text-slate-600 mx-auto" />
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-white">本棚にコンテンツがまだありません</h3>
            <p className="text-xs sm:text-sm text-slate-400">
              「新しい本を作成」ボタンから、ポッドキャスト風エッセイや物語を生成してみましょう！
            </p>
          </div>
          {onNavigateToCreate && (
            <button
              onClick={onNavigateToCreate}
              className="inline-flex items-center space-x-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-blue-600/30 transition-all"
            >
              <Sparkles className="w-4 h-4" />
              <span>コンテンツを作成する</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
