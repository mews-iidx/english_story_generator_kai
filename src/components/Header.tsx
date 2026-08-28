import React from 'react';
import { BookOpen, Bookmark, History, Settings, Cloud, RefreshCw, Zap } from 'lucide-react';

export type NavTab = 'reader' | 'quiz' | 'vocab' | 'history' | 'settings';

interface HeaderProps {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  dueCount: number;
  isSyncing?: boolean;
  hasGoogleSync?: boolean;
  onSyncClick?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  dueCount,
  isSyncing,
  hasGoogleSync,
  onSyncClick,
}) => {
  return (
    <header className="sticky top-0 z-40 bg-slate-950/85 backdrop-blur-md border-b border-slate-800/80 px-4 py-3">
      <div className="max-w-4xl mx-auto flex items-center justify-between">
        <div 
          onClick={() => setActiveTab('reader')}
          className="flex items-center space-x-2.5 cursor-pointer select-none"
        >
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-sky-400 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <BookOpen className="w-4 h-4 text-white" />
          </div>
          <div>
            <span className="text-lg font-bold tracking-tight text-white flex items-center gap-1.5">
              StoryKai <span className="text-xs px-1.5 py-0.5 rounded-md bg-blue-500/20 text-blue-400 border border-blue-500/30 font-medium">A1-C1 / SRS</span>
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-1 sm:space-x-2">
          {hasGoogleSync && (
            <button
              onClick={onSyncClick}
              disabled={isSyncing}
              className={`p-2 rounded-lg text-xs font-medium flex items-center space-x-1.5 transition-all ${
                isSyncing 
                  ? 'bg-blue-950/60 text-blue-400 border border-blue-500/30 animate-pulse' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
              }`}
              title="Googleスプレッドシートと同期"
            >
              {isSyncing ? (
                <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
              ) : (
                <Cloud className="w-4 h-4 text-blue-400" />
              )}
              <span className="hidden sm:inline">Drive同期</span>
            </button>
          )}

          <nav className="flex items-center bg-slate-900/90 border border-slate-800 rounded-xl p-1">
            {/* 1. Reader */}
            <button
              onClick={() => setActiveTab('reader')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                activeTab === 'reader'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              <span>読む</span>
            </button>

            {/* 2. Quiz */}
            <button
              onClick={() => setActiveTab('quiz')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                activeTab === 'quiz'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Zap className="w-4 h-4" />
              <span>クイズ</span>
            </button>

            {/* 3. Vocab */}
            <button
              onClick={() => setActiveTab('vocab')}
              className={`relative flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                activeTab === 'vocab'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Bookmark className="w-4 h-4" />
              <span>語彙</span>
              {dueCount > 0 && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500 text-slate-950">
                  {dueCount}
                </span>
              )}
            </button>

            {/* 4. History */}
            <button
              onClick={() => setActiveTab('history')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                activeTab === 'history'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <History className="w-4 h-4" />
              <span className="hidden sm:inline">履歴</span>
            </button>

            {/* 5. Settings */}
            <button
              onClick={() => setActiveTab('settings')}
              className={`flex items-center space-x-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                activeTab === 'settings'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Settings className="w-4 h-4" />
            </button>
          </nav>
        </div>
      </div>
    </header>
  );
};