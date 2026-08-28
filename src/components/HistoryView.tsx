import React from 'react';
import { Story } from '../types/story';
import { BookOpen, Calendar, Trash2, Sparkles, ChevronRight } from 'lucide-react';

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
  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl">
        <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
          読解ストーリー履歴
        </h2>
        <p className="text-xs sm:text-sm text-slate-400 mt-1">
          これまでに読んだショートストーリーの履歴です。いつでも再読できます。
        </p>
      </div>

      {stories.length > 0 ? (
        <div className="space-y-3">
          {stories.map((story) => (
            <div
              key={story.id}
              onClick={() => onSelectStory(story)}
              className="bg-slate-900/70 border border-slate-800/90 hover:border-blue-500/50 hover:bg-slate-900 rounded-2xl p-4 sm:p-5 transition-all shadow-md cursor-pointer flex items-center justify-between gap-4 group"
            >
              <div className="space-y-1.5 flex-1 min-w-0">
                <div className="flex items-center space-x-2 flex-wrap">
                  <span className="text-base sm:text-lg font-bold text-white group-hover:text-blue-400 transition-colors truncate">
                    {story.title}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-400 font-bold">
                    {story.cefrLevel || 'A2'}
                  </span>
                </div>

                <p className="text-xs text-blue-400/90 font-medium truncate">
                  {story.titleJa}
                </p>

                {story.summary && (
                  <p className="text-xs text-slate-400 line-clamp-1">
                    {story.summary}
                  </p>
                )}

                <div className="flex items-center space-x-3 text-[11px] text-slate-500 pt-1">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {new Date(story.createdAt).toLocaleDateString('ja-JP')}
                  </span>
                  {story.targetVocabList && story.targetVocabList.length > 0 && (
                    <span className="flex items-center gap-1 text-amber-400/90">
                      <Sparkles className="w-3 h-3" />
                      復習語彙: {story.targetVocabList.length}個
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-2 flex-shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteStory(story.id);
                  }}
                  className="p-2 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded-xl transition-colors"
                  title="履歴から削除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <ChevronRight className="w-5 h-5 text-slate-600 group-hover:text-blue-400 transition-colors" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-16 text-center space-y-3 bg-slate-900/40 border border-slate-800/60 rounded-3xl p-8">
          <BookOpen className="w-10 h-10 text-slate-600 mx-auto" />
          <p className="text-sm text-slate-400">まだ読解履歴がありません。</p>
        </div>
      )}
    </div>
  );
};