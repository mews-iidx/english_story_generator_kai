import React from 'react';
import { BookOpen, Settings, RefreshCw, Zap, PlusCircle, Download, Phone, Target, Bot } from 'lucide-react';

export type NavTab = 'bookshelf' | 'drill' | 'listening_lab' | 'quiz' | 'mastery' | 'chat' | 'call' | 'create' | 'settings';

interface HeaderProps {
  activeTab: NavTab;
  isReading?: boolean;
  setActiveTab: (tab: NavTab) => void;
  dueCount: number;
  isSyncing: boolean;
  hasGoogleSync: boolean;
  onSyncClick: () => void;
  canInstallPWA?: boolean;
  onInstallPWA?: () => void;
  isGenerating?: boolean;
  generatingTheme?: string;
  isCallActive?: boolean;
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
  isGenerating,
  generatingTheme,
  isCallActive = false,
  isReading = false,
}) => {
  const tabs: (TabItem & { isMaintenance?: boolean })[] = [
    { id: 'bookshelf', label: '物語', icon: BookOpen },
    { id: 'drill', label: 'ドリル (メンテ中)', icon: Zap, isMaintenance: true },
    { id: 'quiz', label: 'Anki', icon: PlusCircle, badge: dueCount > 0 ? dueCount : undefined },
    { id: 'mastery', label: '分析', icon: Target },
    { id: 'call', label: '英会話', icon: Phone },
    { id: 'chat', label: 'AI相談', icon: Bot },
    { id: 'settings', label: '設定', icon: Settings },
  ];

  const handleTabClick = (tabId: NavTab) => {
    if (isCallActive && tabId !== 'call') {
      alert('⚠️ 通話・特訓セッション中です。画面上の終了ボタンを押してから他のメニューへ移動してください。');
      return;
    }
    if (tabId === 'drill') {
      alert('🛠️ ドリル機能は現在リニューアル・メンテ中です！Ankiや瞬間ラリー英会話をご活用ください。');
      return;
    }
    setActiveTab(tabId);
  };

  return (
    <>
      {/* 1. Desktop & Mobile Top Header */}
      <header className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-5xl mx-auto px-3 sm:px-6 h-14 flex items-center justify-between">
          {/* Logo */}
          <div 
            onClick={() => handleTabClick('bookshelf')}
            className="flex items-center space-x-2 cursor-pointer group"
          >
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-500 via-blue-600 to-indigo-600 flex items-center justify-center shadow-md shadow-cyan-500/20 group-hover:scale-105 transition-transform border border-cyan-400/30">
              <Zap className="w-4 h-4 text-white fill-white" />
            </div>
            <div className="flex items-baseline space-x-1.5">
              <span className="font-extrabold text-base sm:text-lg tracking-tight bg-gradient-to-r from-cyan-400 via-sky-300 to-indigo-400 bg-clip-text text-transparent">
                CompileEng
              </span>
              <span className="text-[10px] uppercase font-bold text-cyan-500/80 tracking-widest hidden sm:inline">
                Realtime Input
              </span>
            </div>
          </div>

          {/* Desktop Navigation Tabs */}
          <nav className="hidden md:flex items-center space-x-1 bg-slate-900/90 p-1 rounded-2xl border border-slate-800">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              const isCallTab = tab.id === 'call';

              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabClick(tab.id)}
                  className={`relative flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                    tab.isMaintenance
                      ? 'opacity-40 text-slate-500 hover:text-slate-400 cursor-not-allowed'
                      : isActive
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                      : isCallActive && isCallTab
                      ? 'bg-rose-950/60 border border-rose-500/40 text-rose-300 animate-pulse'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                  {isCallActive && isCallTab && (
                    <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                  )}
                  {tab.badge !== undefined && (
                    <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500 text-slate-950">
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Right Action */}
          <div className="flex items-center space-x-2">
            {/* Active Call Pill */}
            {isCallActive && (
              <div
                onClick={() => setActiveTab('call')}
                className="flex items-center space-x-1.5 px-2.5 py-1 bg-rose-950/80 border border-rose-500/50 rounded-xl text-xs text-rose-300 cursor-pointer animate-pulse"
                title="通話中（タップで通話画面へ）"
              >
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                <span className="text-[11px] font-bold">🔴 通話・特訓中</span>
              </div>
            )}

            {/* Background generation pill */}
            {isGenerating && (
              <div 
                onClick={() => handleTabClick('create')}
                className="flex items-center space-x-1.5 px-2.5 py-1 bg-blue-950/70 border border-blue-500/40 rounded-xl text-xs text-blue-300 cursor-pointer hover:bg-blue-900/50 transition-colors animate-pulse"
                title={generatingTheme ? `AIが「${generatingTheme}」を裏で執筆中です` : 'AIが裏で物語を執筆中です'}
              >
                <RefreshCw className="w-3 h-3 text-sky-400 animate-spin" />
                <span className="text-[11px] font-bold hidden sm:inline">裏で執筆中...</span>
              </div>
            )}

            {canInstallPWA && onInstallPWA && (
              <button
                onClick={onInstallPWA}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-600/25 transition-all animate-pulse"
                title="アプリをスマホにインストール"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">アプリをインストール</span>
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
      {!isReading && (
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 backdrop-blur-lg border-t border-slate-800/90 px-1 py-1.5 flex items-center justify-around shadow-2xl safe-area-pb">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const isCallTab = tab.id === 'call';

          return (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab.id)}
              className={`relative flex flex-col items-center justify-center py-1 px-0.5 rounded-xl transition-all flex-1 ${
                tab.isMaintenance
                  ? 'opacity-35 text-slate-500'
                  : isActive
                  ? 'text-blue-400 font-bold'
                  : isCallActive && isCallTab
                  ? 'text-rose-400 font-bold animate-pulse'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="relative">
                <Icon className={`w-4 h-4 transition-transform ${isActive ? 'scale-110' : ''}`} />
                {isCallActive && isCallTab && (
                  <span className="absolute -top-1 -left-1 w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                )}
                {tab.badge !== undefined && (
                  <span className="absolute -top-1 -right-2 min-w-[14px] h-3.5 px-0.5 rounded-full text-[8px] font-bold bg-amber-500 text-slate-950 flex items-center justify-center">
                    {tab.badge}
                  </span>
                )}
              </div>
              <span className="text-[8px] mt-0.5 tracking-tight">{tab.label}</span>
              {isActive && (
                <span className="absolute bottom-0 w-1 h-1 bg-blue-400 rounded-full" />
              )}
            </button>
          );
        })}
      </nav>
      )}
    </>
  );
};
