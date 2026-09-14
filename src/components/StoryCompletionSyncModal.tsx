import React from 'react';
import { Story } from '../types/story';
import { Sparkles, Trophy, Zap, BookOpen, ArrowRight } from 'lucide-react';
import confetti from 'canvas-confetti';

interface StoryCompletionSyncModalProps {
  story: Story;
  calculatedWpm: number;
  newCapturedCount: number;
  onClose: () => void;
  onNextStory?: () => void;
}

export const StoryCompletionSyncModal: React.FC<StoryCompletionSyncModalProps> = ({
  story,
  calculatedWpm,
  newCapturedCount,
  onClose,
  onNextStory,
}) => {
  React.useEffect(() => {
    // 読了時の紙吹雪演出
    confetti({
      particleCount: 50,
      spread: 60,
      origin: { y: 0.7 },
      colors: ['#38bdf8', '#818cf8', '#34d399', '#fbbf24']
    });
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-lg rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 text-white text-center">
        {/* Top Trophy Icon */}
        <div className="mx-auto w-16 h-16 rounded-3xl bg-gradient-to-tr from-cyan-500 via-blue-600 to-indigo-600 flex items-center justify-center shadow-xl shadow-blue-500/25 border border-cyan-400/30">
          <Trophy className="w-8 h-8 text-white" />
        </div>

        <div className="space-y-1.5">
          <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            読了お疲れ様でした！
          </h2>
          <p className="text-sm text-slate-400">
            『{story.title}』を読み終えました。脳のコンパイル速度が鍛えられています！
          </p>
        </div>

        {/* 読書スコア HUD */}
        <div className="grid grid-cols-3 gap-3 p-4 bg-slate-950/80 border border-slate-800 rounded-2xl">
          <div className="space-y-1 text-center">
            <div className="text-[11px] font-bold text-slate-400 flex items-center justify-center space-x-1">
              <BookOpen className="w-3.5 h-3.5 text-sky-400" />
              <span>読了語数</span>
            </div>
            <div className="text-lg sm:text-xl font-black text-white">
              {story.actualWordCount || story.targetWordCount || 250} <span className="text-xs font-normal text-slate-400">語</span>
            </div>
          </div>

          <div className="space-y-1 text-center border-x border-slate-800">
            <div className="text-[11px] font-bold text-slate-400 flex items-center justify-center space-x-1">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>読書速度</span>
            </div>
            <div className="text-lg sm:text-xl font-black text-amber-300">
              {calculatedWpm || 120} <span className="text-xs font-normal text-slate-400">WPM</span>
            </div>
          </div>

          <div className="space-y-1 text-center">
            <div className="text-[11px] font-bold text-slate-400 flex items-center justify-center space-x-1">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              <span>獲得センテンス</span>
            </div>
            <div className="text-lg sm:text-xl font-black text-indigo-300">
              {newCapturedCount} <span className="text-xs font-normal text-slate-400">文</span>
            </div>
          </div>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          読書中に保存した文は、Anki（英和・和英カード）で自動復習キューに追加されています。
        </p>

        {/* Action Buttons */}
        <div className="flex items-center space-x-3 pt-2">
          <button
            onClick={onClose}
            className="flex-1 py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-bold transition-all shadow-md active:scale-95"
          >
            本棚に戻る
          </button>

          {onNextStory && (
            <button
              onClick={onNextStory}
              className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-sm font-bold flex items-center justify-center space-x-1.5 shadow-lg shadow-blue-600/30 transition-all active:scale-95"
            >
              <span>次のストーリー</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
