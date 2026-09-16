import React from 'react';
import {
  X,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Layers
} from 'lucide-react';
import { StoryQueueTask } from '../types/storyQueue';

interface StoryQueueModalProps {
  isOpen: boolean;
  onClose: () => void;
  tasks: StoryQueueTask[];
  onCancelTask: (taskId: string) => void;
  onRemoveTask: (taskId: string) => void;
  onRetryTask?: (task: StoryQueueTask) => void;
  isProcessing?: boolean;
}

export const StoryQueueModal: React.FC<StoryQueueModalProps> = ({
  isOpen,
  onClose,
  tasks,
  onCancelTask,
  onRemoveTask,
  onRetryTask,
  isProcessing = false,
}) => {
  if (!isOpen) return null;

  const activeTask = tasks.find(t => t.status === 'generating');
  const pendingTasks = tasks.filter(t => t.status === 'pending');
  const historyTasks = tasks.filter(t => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-10 h-10 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                物語生成キュー
                {isProcessing && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30 animate-pulse">
                    処理中
                  </span>
                )}
                {pendingTasks.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                    待機中: {pendingTasks.length}件
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-400">
                バックグラウンドで1件ずつ安全に順次生成します
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-6">
          {/* 1. 現在生成中のタスク */}
          {activeTask ? (
            <div className="p-5 bg-gradient-to-br from-blue-950/60 to-indigo-950/60 border border-blue-500/40 rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 text-blue-400 font-extrabold text-sm">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>執筆中: {activeTask.title}</span>
                </div>
                <span className="text-xs font-bold text-indigo-300 bg-indigo-950 px-2.5 py-0.5 rounded-lg border border-indigo-500/30">
                  {activeTask.seriesType === 'continuous' ? '連載' : activeTask.seriesType === 'omnibus' ? 'オムニバス' : '短編'}
                  {activeTask.totalEpisodes > 1 && ` (${activeTask.currentEpisodeIndex || 1}/${activeTask.totalEpisodes}話)`}
                </span>
              </div>

              {/* プログレスバー */}
              <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-blue-500/20">
                <div
                  className="bg-gradient-to-r from-blue-500 to-indigo-500 h-full transition-all duration-500 rounded-full"
                  style={{
                    width: `${Math.max(10, ((activeTask.currentEpisodeIndex || 1) / (activeTask.totalEpisodes || 1)) * 100)}%`
                  }}
                />
              </div>

              <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
                <span>{activeTask.progressMessage || 'AIがストーリーを生成中...'}</span>
                <button
                  onClick={() => onCancelTask(activeTask.id)}
                  className="text-rose-400 hover:text-rose-300 font-semibold"
                >
                  キャンセル
                </button>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl text-center text-xs text-slate-400 flex items-center justify-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>現在進行中のタスクはありません（待機中または完了）</span>
            </div>
          )}

          {/* 2. 待機中キュー */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-400 tracking-wider flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-blue-400" />
              <span>待機中キュー ({pendingTasks.length}件)</span>
            </h3>

            {pendingTasks.length === 0 ? (
              <p className="text-xs text-slate-500 italic p-3 bg-slate-950/40 rounded-xl border border-slate-800/60">
                待機中のタスクはありません。物語メニューからいつでも何本でも追加できます。
              </p>
            ) : (
              <div className="space-y-2">
                {pendingTasks.map((t, idx) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between p-3.5 bg-slate-950/70 border border-slate-800 rounded-xl text-xs"
                  >
                    <div className="flex items-center space-x-3">
                      <span className="w-6 h-6 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center font-bold text-slate-400 text-[11px]">
                        {idx + 1}
                      </span>
                      <div>
                        <div className="font-bold text-white text-sm">{t.title}</div>
                        <div className="text-[11px] text-slate-400 flex items-center gap-2">
                          <span>{t.seriesType === 'continuous' ? `連載 (全${t.totalEpisodes}話)` : t.seriesType === 'omnibus' ? `オムニバス (全${t.totalEpisodes}話)` : '単発短編'}</span>
                          {t.topic && <span className="text-slate-500">• {t.topic}</span>}
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => onCancelTask(t.id)}
                      className="px-2.5 py-1 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded-lg transition-colors font-semibold"
                    >
                      キャンセル
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 3. 履歴（完了・キャンセル・失敗） */}
          {historyTasks.length > 0 && (
            <div className="space-y-3 pt-3 border-t border-slate-800">
              <h3 className="text-xs font-bold text-slate-400 tracking-wider">
                最近の履歴 ({historyTasks.length}件)
              </h3>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {historyTasks.slice(-10).reverse().map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between p-3 bg-slate-950/40 border border-slate-800/80 rounded-xl text-xs text-slate-400"
                  >
                    <div className="flex items-center space-x-2.5">
                      {t.status === 'completed' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                      {t.status === 'cancelled' && <X className="w-4 h-4 text-slate-500" />}
                      {t.status === 'failed' && <AlertCircle className="w-4 h-4 text-rose-400" />}
                      <div>
                        <span className="font-bold text-slate-300">{t.title}</span>
                        <span className="text-[10px] text-slate-500 ml-2">
                          {t.status === 'completed' ? '生成完了' : t.status === 'cancelled' ? 'キャンセル済' : `失敗: ${t.error || ''}`}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center space-x-1">
                      {t.status === 'failed' && onRetryTask && (
                        <button
                          onClick={() => onRetryTask(t)}
                          className="p-1.5 text-blue-400 hover:bg-blue-950/60 rounded-lg"
                          title="再試行"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => onRemoveTask(t.id)}
                        className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 rounded-lg"
                        title="履歴から削除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/80 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition-colors"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
