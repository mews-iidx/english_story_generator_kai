import React from 'react';
import { Story } from '../types/story';
import { History, BookOpen, Trash2 } from 'lucide-react';

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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <History className="w-5 h-5 text-emerald-400" />
            ストーリー読解履歴
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            過去に生成したストーリーをいつでも再読できます。忘れた語彙をタップすると再度復習キューに入ります。
          </p>
        </div>
        <span className="text-xs font-semibold px-3 py-1 bg-slate-900 text-slate-300 border border-slate-800 rounded-full">
          全 {stories.length} 話
        </span>
      </div>

      {stories.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {stories.map((story) => {
            const dateStr = new Date(story.createdAt).toLocaleDateString('ja-JP', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <div
                key={story.id}
                className="bg-slate-900/70 border border-slate-800/80 hover:border-slate-700 rounded-2xl p-5 shadow-lg backdrop-blur-sm flex flex-col justify-between space-y-4 transition-all"
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-lg font-bold text-white tracking-tight">
                        {story.title}
                      </h3>
                      <p className="text-xs font-medium text-emerald-400/90">
                        {story.titleJa}
                      </p>
                    </div>
                    <span className="text-[11px] text-slate-500 font-mono">
                      {dateStr}
                    </span>
                  </div>

                  {story.summary && (
                    <p className="text-xs text-slate-300 bg-slate-950/50 p-2.5 rounded-xl border border-slate-800/60 leading-relaxed">
                      💡 <strong>あらすじ:</strong> {story.summary}
                    </p>
                  )}

                  {story.targetVocabList && story.targetVocabList.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {story.targetVocabList.map((v, i) => (
                        <span
                          key={i}
                          className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-300 border border-amber-500/20"
                        >
                          {v}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-slate-800/70 flex items-center justify-between">
                  <button
                    onClick={() => onSelectStory(story)}
                    className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-xl text-xs font-semibold transition-all"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>この話を再読する</span>
                  </button>

                  <button
                    onClick={() => onDeleteStory(story.id)}
                    className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors"
                    title="削除"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="py-16 text-center space-y-3 bg-slate-900/30 border border-slate-800/60 rounded-3xl p-8">
          <History className="w-12 h-12 text-slate-600 mx-auto" />
          <p className="text-base font-medium text-slate-300">ストーリーの履歴はまだありません</p>
          <p className="text-xs text-slate-500">
            リーダー画面で物語を生成すると、ここに自動保存されます。
          </p>
        </div>
      )}
    </div>
  );
};