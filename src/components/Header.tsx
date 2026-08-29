import React from 'react';
import { BookOpen, Sparkles, BookMarked, History, Settings, RefreshCw, Zap, Download } from 'lucide-react';

export type NavTab = 'reader' | 'quiz' | 'vocab' | 'history' | 'settings';

interface HeaderProps {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  dueCount: number;
  isSyncing: boolean;
  hasGoogleSync: boolean;
  onSyncClick: () => void;
  canInstallPWA?: boolean;
  onInstallPWA?: () => void;
}

interface TabItem {
  id: NavTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  dueCount,
  isSyncing,
  hasGoogleSync,
  onSyncClick,
  canInstallPWA,
  onInstallPWA,
}) => {
  const tabs: TabItem[] = [
    { id: 'reader', label: 'リーダー', icon: BookOpen },
    { id: 'quiz', label: 'クイズ', icon: Zap },
    { id: 'vocab', label: '語彙帳', icon: BookMarked, badge: dueCount > 0 ? dueCount : undefined },
    { id: 'history', label: '本棚', icon: History },
    { id: 'settings', label: '設定', icon: Settings },
  ];

  return (
    <>
      {/* 1. Desktop & Mobile Top Header */}
      <header className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-5xl mx-auto px-3 sm:px-6 h-14 flex items-center justify-between">
          {/* Logo */}
          <div 
            onClick={() => setActiveTab('reader')}
            className="flex items-center space-x-2 cursor-pointer group"
          >
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-md shadow-blue-500/20 group-hover:scale-105 transition-transform">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div className="flex items-baseline space-x-1.5">
              <span className="font-extrabold text-base sm:text-lg tracking-tight bg-gradient-to-r from-blue-400 via-sky-300 to-indigo-400 bg-clip-text text-transparent">
                StoryKai
              </span>
              <span className="text-[10px] uppercase font-bold text-blue-500/80 tracking-widest hidden sm:inline">
                Reader
              </span>
            </div>
          </div>

          {/* Desktop Navigation Tabs (Hidden on mobile) */}
          <nav className="hidden md:flex items-center space-x-1 bg-slate-900/90 p-1 rounded-2xl border border-slate-800">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative flex items-center space-x-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                  {tab.badge !== undefined && (
                    <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500 text-slate-950">
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Right Action (Install PWA & Google Sync Indicator) */}
          <div className="flex items-center space-x-2">
            {canInstallPWA && onInstallPWA && (
              <button
                onClick={onInstallPWA}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-600/25 transition-all animate-pulse"
                title="アプリをスマホにインストール"
              >
                <Download className="w-3.5 h-3.5" />
                <span>アプリをインストール</span>
              </button>
            )}

            {hasGoogleSync && (
              <button
                onClick={onSyncClick}
                disabled={isSyncing}
                title="Google Drive同期"
                className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-850 text-slate-400 hover:text-blue-400 text-xs transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-blue-400 ${isSyncing ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline text-[11px] font-medium">Drive同期</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* 2. Mobile Bottom Navigation Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 backdrop-blur-lg border-t border-slate-800/90 px-2 py-1.5 flex items-center justify-around shadow-2xl safe-area-pb">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex flex-col items-center justify-center py-1 px-2.5 rounded-xl transition-all flex-1 ${
                isActive
                  ? 'text-blue-400 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="relative">
                <Icon className={`w-5 h-5 transition-transform ${isActive ? 'scale-110' : ''}`} />
                {tab.badge !== undefined && (
                  <span className="absolute -top-1 -right-2.5 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold bg-amber-500 text-slate-950 flex items-center justify-center">
                    {tab.badge}
                  </span>
                )}
              </div>
              <span className="text-[10px] mt-0.5 tracking-tight">{tab.label}</span>
              {isActive && (
                <span className="absolute bottom-0.5 w-1 h-1 bg-blue-400 rounded-full" />
              )}
            </button>
          );
        })}
      </nav>
    </>
  );
};