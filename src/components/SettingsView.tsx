import React, { useState, useRef, useEffect, useMemo } from 'react';
import { AppSettings, CefrLevel } from '../types/settings';
import {
  Key, Cloud, Download, Upload, Check, ExternalLink, RefreshCw,
  ShieldCheck, HelpCircle, Activity, AlertTriangle, Smartphone,
  Copy, Trash2, Terminal, Search, ChevronDown, ChevronRight,
  X, AlertCircle, Info, BookOpen, MessageSquare, Brain
} from 'lucide-react';
import { LiveLogger, AppLogEntry, LogCategory, LogLevel } from '../services/liveLogger';
import { exportAllData, importAllData } from '../services/storage';

interface SettingsViewProps {
  settings: AppSettings;
  onSaveSettings: (settings: AppSettings) => void;
  onGoogleConnect: () => Promise<void>;
  onGoogleSync: () => Promise<void>;
  isSyncing: boolean;
  onDataImported: () => void;
  onResetAllData: () => void;
  canInstallPWA?: boolean;
  onInstallPWA?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onSaveSettings,
  onGoogleConnect,
  onGoogleSync,
  isSyncing,
  onDataImported,
  onResetAllData,
  canInstallPWA,
  onInstallPWA,
}) => {
  const [apiKey, setApiKey] = useState(settings.geminiApiKey);
  const [model, setModel] = useState(settings.geminiModel || 'gemini-3.7-flash');
  const [customModel, setCustomModel] = useState('');
  const [cefrLevel, setCefrLevel] = useState<CefrLevel>(settings.cefrLevel || 'A2');
  const [clientId, setClientId] = useState(settings.googleClientId);
  const [isSaved, setIsSaved] = useState(false);
  const [showOauthGuide, setShowOauthGuide] = useState(false);
  const [showPwaGuide, setShowPwaGuide] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Debug Log State
  const [logs, setLogs] = useState<AppLogEntry[]>(() => LiveLogger.getLogs());
  const [copiedLog, setCopiedLog] = useState(false);
  const [copiedDetailId, setCopiedDetailId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'error' | LogCategory>('all');
  const [levelFilter, setLevelFilter] = useState<'ALL' | LogLevel>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const unsub = LiveLogger.subscribe(() => {
      setLogs(LiveLogger.getLogs());
    });
    return unsub;
  }, []);

  const presetModels = ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-pro-preview'];
  const isPresetModel = presetModels.includes(model);

  const tokenStats = settings.tokenStats || {
    totalPromptTokens: 0,
    totalCandidatesTokens: 0,
    totalTokens: 0,
    totalGenerations: 0,
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const finalModel = model === 'custom' ? (customModel.trim() || 'gemini-3.7-flash') : model;
    onSaveSettings({
      ...settings,
      geminiApiKey: apiKey.trim(),
      geminiModel: finalModel,
      cefrLevel,
      googleClientId: clientId.trim(),
    });
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const handleExportBackup = () => {
    const jsonStr = exportAllData();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `storykai_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target?.result as string;
        const res = importAllData(text);
        const details = [
          `ストーリー: ${res.storyCount}件`,
          `登録語彙: ${res.vocabCount}件`,
          `難解文: ${res.sentenceCount}件`,
          res.hasMastery ? 'CEFR進捗状態: 復元完了' : null,
          res.hasSnapshots ? '学習履歴・WPM推移: 復元完了' : null,
        ].filter(Boolean).join('\n・');
        alert(`🎉 バックアップからの復元が完了しました！\n\n・${details}`);
        onDataImported();
      } catch (err: any) {
        alert(`インポート失敗: ${err.message}`);
      }
    };
    reader.readAsText(file);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleResetConfirm = () => {
    const confirmed = window.confirm(
      '【警告】すべてのストーリー履歴、登録単語、CEFR進捗データ、学習履歴、トークン統計を完全にリセットしますか？\n（※APIキー等の接続設定は保持されます）'
    );
    if (confirmed) {
      onResetAllData();
      alert('すべてのデータを初期状態にリセットしました。');
    }
  };

  // Log Filtering and Counts
  const counts = useMemo(() => {
    let error = 0;
    let story = 0;
    let call = 0;
    let quiz_drill = 0;
    let sync_storage = 0;
    logs.forEach((l) => {
      if (l.level === 'ERROR') error++;
      if (l.category === 'story') story++;
      else if (l.category === 'call') call++;
      else if (l.category === 'quiz_drill') quiz_drill++;
      else if (l.category === 'sync_storage') sync_storage++;
    });
    return { error, story, call, quiz_drill, sync_storage, total: logs.length };
  }, [logs]);

  const filteredLogs = useMemo(() => {
    return logs.filter((entry) => {
      // Level filter
      if (levelFilter !== 'ALL' && entry.level !== levelFilter) {
        return false;
      }

      // Category filter
      if (categoryFilter === 'error') {
        if (entry.level !== 'ERROR') return false;
      } else if (categoryFilter !== 'all') {
        if (entry.category !== categoryFilter) return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchMsg = entry.message.toLowerCase().includes(q);
        const matchTag = entry.tag.toLowerCase().includes(q);
        const matchDetails = entry.details
          ? (typeof entry.details === 'string'
              ? entry.details
              : JSON.stringify(entry.details)
            ).toLowerCase().includes(q)
          : false;

        if (!matchMsg && !matchTag && !matchDetails) {
          return false;
        }
      }

      return true;
    });
  }, [logs, categoryFilter, levelFilter, searchQuery]);

  const toggleLogExpand = (id: string) => {
    setExpandedLogIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleToggleExpandAll = () => {
    if (expandedLogIds.size >= filteredLogs.length && filteredLogs.length > 0) {
      setExpandedLogIds(new Set());
    } else {
      setExpandedLogIds(new Set(filteredLogs.map((l) => l.id)));
    }
  };

  const handleCopySingleDetail = (entry: AppLogEntry) => {
    const text = typeof entry.details === 'string'
      ? entry.details
      : JSON.stringify(entry.details, null, 2);
    navigator.clipboard.writeText(text);
    setCopiedDetailId(entry.id);
    setTimeout(() => setCopiedDetailId(null), 2000);
  };

  const handleCopyFilteredLogs = () => {
    const text = LiveLogger.exportLogsAsText(filteredLogs);
    navigator.clipboard.writeText(text);
    setCopiedLog(true);
    setTimeout(() => setCopiedLog(false), 2000);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-16">
      <div>
        <h1 className="text-2xl font-bold text-white mb-2">設定</h1>
        <p className="text-slate-400">
          APIキーの設定やデータのバックアップ、動作・エラー診断ログの管理を行います。
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* 1. Token Counter Dashboard */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
          <div className="flex items-center space-x-2.5 text-white font-bold text-lg border-b border-slate-800 pb-3">
            <Activity className="w-5 h-5 text-indigo-400" />
            <span>Gemini Token 使用量・統計</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-950/70 border border-slate-800 p-3.5 rounded-xl">
              <span className="text-[11px] text-slate-400">総生成回数</span>
              <p className="text-xl font-bold text-white mt-0.5">
                {tokenStats.totalGenerations}
                <span className="text-xs font-normal text-slate-400 ml-1">回</span>
              </p>
            </div>

            <div className="bg-slate-950/70 border border-slate-800 p-3.5 rounded-xl">
              <span className="text-[11px] text-slate-400">入力 (Prompt)</span>
              <p className="text-xl font-bold text-sky-400 mt-0.5">
                {tokenStats.totalPromptTokens.toLocaleString()}
                <span className="text-xs font-normal text-slate-400 ml-1">tok</span>
              </p>
            </div>

            <div className="bg-slate-950/70 border border-slate-800 p-3.5 rounded-xl">
              <span className="text-[11px] text-slate-400">出力 (Output)</span>
              <p className="text-xl font-bold text-emerald-400 mt-0.5">
                {tokenStats.totalCandidatesTokens.toLocaleString()}
                <span className="text-xs font-normal text-slate-400 ml-1">tok</span>
              </p>
            </div>

            <div className="bg-slate-950/70 border border-slate-800 p-3.5 rounded-xl">
              <span className="text-[11px] text-slate-400">合計 Tokens</span>
              <p className="text-xl font-bold text-indigo-400 mt-0.5">
                {tokenStats.totalTokens.toLocaleString()}
                <span className="text-xs font-normal text-slate-400 ml-1">tok</span>
              </p>
            </div>
          </div>
        </div>

        {/* 2. Gemini API Settings */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
          <div className="flex items-center space-x-2.5 text-white font-bold text-lg border-b border-slate-800 pb-3">
            <Key className="w-5 h-5 text-indigo-400" />
            <span>Gemini API 設定</span>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                Gemini API キー <span className="text-indigo-400">*</span>
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
              />
              <p className="text-xs text-slate-400 mt-1.5 flex items-center gap-1">
                <span>※ブラウザのLocalStorageにのみ保持されます。無料APIキーで利用可能です。</span>
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-0.5 underline font-medium ml-1"
                >
                  キーを取得 <ExternalLink className="w-3 h-3" />
                </a>
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  モデル選定
                </label>
                <select
                  value={isPresetModel ? model : 'custom'}
                  onChange={(e) => {
                    if (e.target.value === 'custom') {
                      setModel('custom');
                    } else {
                      setModel(e.target.value);
                    }
                  }}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                >
                  <option value="gemini-3.7-flash">Gemini 3.7 Flash (推奨・最新高速⚡)</option>
                  <option value="gemini-3.6-flash">Gemini 3.6 Flash (最新安定)</option>
                  <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash Lite (最速・軽量)</option>
                  <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro Preview (高度な推論✨)</option>
                  <option value="custom">カスタムモデル名を手動指定...</option>
                </select>
                {model === 'custom' && (
                  <div className="mt-2.5">
                    <input
                      type="text"
                      value={customModel}
                      onChange={(e) => setCustomModel(e.target.value)}
                      placeholder="例: gemini-2.5-flash"
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  目標 CEFR レベル
                </label>
                <select
                  value={cefrLevel}
                  onChange={(e) => setCefrLevel(e.target.value as CefrLevel)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                >
                  <option value="A1">A1 (入門・初級・やさしい短文)</option>
                  <option value="A2">A2 (初級・中学3年〜日常基礎・おすすめ🌱)</option>
                  <option value="B1">B1 (中級・日常会話〜旅行)</option>
                  <option value="B2">B2 (中上級・自然な表現・実務応用)</option>
                  <option value="C1">C1 (上級・専門・高度な語彙)</option>
                  <option value="C2">C2 (最上級・ネイティブ級)</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* 3. Smartphone PWA Install Guide */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center space-x-2.5 text-white font-bold text-lg">
              <Smartphone className="w-5 h-5 text-indigo-400" />
              <span>スマホにアプリとしてインストール (PWA)</span>
            </div>
            <button
              type="button"
              onClick={() => setShowPwaGuide(!showPwaGuide)}
              className="text-xs text-indigo-400 hover:underline"
            >
              {showPwaGuide ? '閉じる' : '手順を見る'}
            </button>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed">
            StoryKaiは<strong>PWA（Progressive Web App）に対応</strong>しており、スマホのホーム画面にアプリアイコンを追加して、アドレスバーのない全画面ネイティブアプリとして起動できます。
          </p>

          {canInstallPWA && onInstallPWA && (
            <div className="pt-1">
              <button
                type="button"
                onClick={onInstallPWA}
                className="flex items-center space-x-2 px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 transition-all active:scale-95"
              >
                <Smartphone className="w-4 h-4" />
                <span>📲 今すぐアプリとしてインストール</span>
              </button>
            </div>
          )}

          {showPwaGuide && (
            <div className="bg-slate-950/70 border border-slate-800 p-4 rounded-xl space-y-3 text-xs text-slate-300">
              <div>
                <strong className="text-sky-300 block mb-1">📱 iPhone / iPad (Safari) の場合:</strong>
                <ol className="list-decimal list-inside space-y-1 pl-1 text-slate-400">
                  <li>Safariでこのページを開く</li>
                  <li>画面下部中央の <strong>「共有ボタン（四角から矢印）」</strong> をタップ</li>
                  <li>メニューから <strong>「ホーム画面に追加」</strong> を選択</li>
                  <li>右上の「追加」を押すと、ホーム画面に専用アイコンが配置されます</li>
                </ol>
              </div>

              <div className="pt-2 border-t border-slate-800/80">
                <strong className="text-sky-300 block mb-1">🤖 Android (Chrome) の場合:</strong>
                <ol className="list-decimal list-inside space-y-1 pl-1 text-slate-400">
                  <li>Chromeでこのページを開く</li>
                  <li>右上のメニュー（縦の3点リーダー <strong>︙</strong>）をタップ</li>
                  <li><strong>「アプリをインストール」</strong> または <strong>「ホーム画面に追加」</strong> を選択</li>
                </ol>
              </div>
            </div>
          )}
        </div>

        {/* 4. Google Drive Sync Settings */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center space-x-2.5 text-white font-bold text-lg">
              <Cloud className="w-5 h-5 text-sky-400" />
              <span>Google Drive クラウド同期</span>
            </div>
            <button
              type="button"
              onClick={() => setShowOauthGuide(!showOauthGuide)}
              className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>{showOauthGuide ? 'ガイドを閉じる' : '設定ガイド'}</span>
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                Google Cloud OAuth クライアント ID
              </label>
              <input
                type="text"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="123456789-abcdef.apps.googleusercontent.com"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm font-mono"
              />
            </div>

            {showOauthGuide && (
              <div className="bg-slate-950 border border-sky-900/40 rounded-xl p-4 text-xs text-slate-300 space-y-2 leading-relaxed">
                <div className="font-semibold text-sky-300 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Google Cloud 設定手順</span>
                </div>
                <ol className="list-decimal list-inside space-y-1 text-slate-400">
                  <li>Google Cloud Console でプロジェクトを作成し、Google Drive API を有効化します。</li>
                  <li>「認証情報」から OAuth 2.0 クライアント ID (ウェブアプリケーション) を作成します。</li>
                  <li>「承認済みの JavaScript 生成元」に本アプリの URL を追加します。</li>
                  <li>発行されたクライアント ID を上記に入力して「基本設定を保存」してください。</li>
                </ol>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={onGoogleConnect}
                disabled={!clientId.trim()}
                className="flex items-center space-x-2 px-4 py-2.5 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-xl text-xs font-semibold transition-all shadow-md"
              >
                <Cloud className="w-4 h-4" />
                <span>Google アカウントと連携</span>
              </button>

              <button
                type="button"
                onClick={onGoogleSync}
                disabled={isSyncing}
                className="flex items-center space-x-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition-all disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin text-sky-400' : ''}`} />
                <span>{isSyncing ? '同期中...' : '今すぐ手動同期'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* 5. Save Button Bar */}
        <div className="flex items-center justify-between">
          <button
            type="submit"
            className="flex items-center space-x-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold shadow-lg shadow-indigo-500/25 transition-all"
          >
            {isSaved ? <Check className="w-4 h-4 text-emerald-300" /> : <ShieldCheck className="w-4 h-4" />}
            <span>{isSaved ? '設定を保存しました！' : '基本設定を保存'}</span>
          </button>
        </div>

        {/* 6. Backup & Data Management */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
          <div className="flex items-center space-x-2.5 text-white font-bold text-lg border-b border-slate-800 pb-3">
            <Download className="w-5 h-5 text-amber-400" />
            <span>データバックアップ & 復元</span>
          </div>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleExportBackup}
                className="flex items-center space-x-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition-all"
              >
                <Download className="w-4 h-4 text-amber-400" />
                <span>ローカルバックアップ (JSON) をダウンロード</span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center space-x-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition-all"
              >
                <Upload className="w-4 h-4 text-emerald-400" />
                <span>JSONファイルから復元</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
              <div className="text-xs text-slate-400">
                <span>ストーリー履歴と登録語彙を初期状態に戻します。</span>
              </div>
              <button
                type="button"
                onClick={handleResetConfirm}
                className="flex items-center space-x-1.5 px-3.5 py-2 bg-red-950/40 hover:bg-red-950/80 text-red-400 border border-red-500/30 rounded-xl text-xs font-semibold transition-all"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>全データをリセット</span>
              </button>
            </div>
          </div>
        </div>

        {/* 7. Comprehensive Debug & Telemetry Log Inspector */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
          <div className="flex flex-wrap items-center justify-between border-b border-slate-800 pb-3 gap-2">
            <div className="flex items-center space-x-2.5 text-white font-bold text-lg">
              <Terminal className="w-5 h-5 text-indigo-400" />
              <span>アプリケーション診断・動作ログ</span>
            </div>
            <div className="flex items-center gap-2">
              {counts.error > 0 && (
                <span className="text-xs font-bold text-red-400 bg-red-950/70 border border-red-500/40 px-2.5 py-0.5 rounded-full flex items-center gap-1 animate-pulse">
                  <AlertCircle className="w-3 h-3" />
                  {counts.error} 件のエラー
                </span>
              )}
              <span className="text-xs font-semibold text-slate-300 bg-slate-800 border border-slate-700 px-2.5 py-0.5 rounded-full">
                {counts.total} 件記録中
              </span>
            </div>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed">
            物語生成のエラー原因（APIリクエスト・HTTPステータス・JSONパース・プロンプト）、リアルタイム通話（Gemini Live）の遅延計測、瞬間英作文ドリル、クラウド同期の<strong>全詳細ログ</strong>をリアルタイムに確認・検索・エクスポートできます。
          </p>

          {/* Action Bar */}
          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => LiveLogger.downloadLogsFile('txt', filteredLogs)}
              className="flex items-center space-x-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition-all shadow-md"
              title="絞り込み状態のログをテキストファイルとしてダウンロード"
            >
              <Download className="w-3.5 h-3.5" />
              <span>テキスト保存 (.txt)</span>
            </button>

            <button
              type="button"
              onClick={() => LiveLogger.downloadLogsFile('json', filteredLogs)}
              className="flex items-center space-x-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition-all"
              title="詳細なJSONオブジェクト形式でエクスポート"
            >
              <Download className="w-3.5 h-3.5 text-blue-400" />
              <span>JSON保存 (.json)</span>
            </button>

            <button
              type="button"
              onClick={handleCopyFilteredLogs}
              className="flex items-center space-x-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition-all"
            >
              {copiedLog ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-amber-400" />}
              <span>{copiedLog ? 'コピー完了！' : '画面のログをコピー'}</span>
            </button>

            <button
              type="button"
              onClick={handleToggleExpandAll}
              className="flex items-center space-x-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition-all"
            >
              <Activity className="w-3.5 h-3.5 text-cyan-400" />
              <span>
                {expandedLogIds.size >= filteredLogs.length && filteredLogs.length > 0
                  ? '全詳細を閉じる'
                  : '全詳細を展開'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (confirm('記録されたすべての診断・動作ログを消去しますか？')) {
                  LiveLogger.clearLogs();
                  setLogs([]);
                  setExpandedLogIds(new Set());
                }
              }}
              className="flex items-center space-x-1.5 px-3 py-2 bg-slate-850 hover:bg-red-950/60 text-slate-400 hover:text-red-300 border border-slate-800 hover:border-red-500/30 rounded-xl text-xs font-semibold transition-all ml-auto"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>ログ消去</span>
            </button>
          </div>

          {/* Filter and Search Bar */}
          <div className="bg-slate-950/90 border border-slate-800/90 rounded-xl p-3 space-y-3">
            {/* Category Filter Tabs */}
            <div>
              <div className="text-[11px] font-semibold text-slate-400 mb-1.5">機能別フィルタ:</div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setCategoryFilter('all')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    categoryFilter === 'all'
                      ? 'bg-indigo-600 text-white shadow-md'
                      : 'bg-slate-850 text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-800'
                  }`}
                >
                  全て ({counts.total})
                </button>

                <button
                  type="button"
                  onClick={() => setCategoryFilter('error')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-all ${
                    categoryFilter === 'error'
                      ? 'bg-red-600 text-white shadow-md'
                      : 'bg-slate-850 text-red-400 hover:bg-red-950/50 border border-red-900/30'
                  }`}
                >
                  <AlertCircle className="w-3 h-3" />
                  エラーのみ ({counts.error})
                </button>

                <button
                  type="button"
                  onClick={() => setCategoryFilter('story')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-all ${
                    categoryFilter === 'story'
                      ? 'bg-purple-600 text-white shadow-md'
                      : 'bg-slate-850 text-slate-400 hover:text-purple-300 hover:bg-slate-800 border border-slate-800'
                  }`}
                >
                  <BookOpen className="w-3 h-3" />
                  物語生成 ({counts.story})
                </button>

                <button
                  type="button"
                  onClick={() => setCategoryFilter('call')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-all ${
                    categoryFilter === 'call'
                      ? 'bg-emerald-600 text-white shadow-md'
                      : 'bg-slate-850 text-slate-400 hover:text-emerald-300 hover:bg-slate-800 border border-slate-800'
                  }`}
                >
                  <MessageSquare className="w-3 h-3" />
                  通話・会話 ({counts.call})
                </button>

                <button
                  type="button"
                  onClick={() => setCategoryFilter('quiz_drill')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-all ${
                    categoryFilter === 'quiz_drill'
                      ? 'bg-amber-600 text-white shadow-md'
                      : 'bg-slate-850 text-slate-400 hover:text-amber-300 hover:bg-slate-800 border border-slate-800'
                  }`}
                >
                  <Brain className="w-3 h-3" />
                  ドリル・クイズ ({counts.quiz_drill})
                </button>

                <button
                  type="button"
                  onClick={() => setCategoryFilter('sync_storage')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-all ${
                    categoryFilter === 'sync_storage'
                      ? 'bg-sky-600 text-white shadow-md'
                      : 'bg-slate-850 text-slate-400 hover:text-sky-300 hover:bg-slate-800 border border-slate-800'
                  }`}
                >
                  <Cloud className="w-3 h-3" />
                  同期・保存 ({counts.sync_storage})
                </button>
              </div>
            </div>

            {/* Level Filter & Search Field */}
            <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-800/80">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-semibold text-slate-400">レベル:</span>
                {(['ALL', 'ERROR', 'WARN', 'INFO'] as const).map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setLevelFilter(lvl)}
                    className={`px-2 py-0.5 rounded text-[11px] font-bold transition-all ${
                      levelFilter === lvl
                        ? lvl === 'ERROR'
                          ? 'bg-red-600 text-white'
                          : lvl === 'WARN'
                          ? 'bg-amber-600 text-white'
                          : lvl === 'INFO'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-700 text-white'
                        : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                    }`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>

              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ログ内容、タグ、エラー、プロンプトを全文検索..."
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-7 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Embedded Logs List View */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-[11px] text-slate-300 max-h-[500px] overflow-y-auto space-y-2">
            {filteredLogs.length === 0 ? (
              <div className="py-8 text-center text-slate-500 text-xs">
                <Info className="w-5 h-5 mx-auto mb-1.5 opacity-50" />
                <span>条件に該当するログはありません</span>
              </div>
            ) : (
              filteredLogs.map((entry) => {
                const isExpanded = expandedLogIds.has(entry.id);
                const hasDetails = !!entry.details;

                // Category badge colors
                let catColor = 'bg-slate-800 text-slate-300 border-slate-700';
                if (entry.category === 'story') catColor = 'bg-purple-950/80 text-purple-300 border-purple-500/40';
                else if (entry.category === 'call') catColor = 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40';
                else if (entry.category === 'quiz_drill') catColor = 'bg-amber-950/80 text-amber-300 border-amber-500/40';
                else if (entry.category === 'sync_storage') catColor = 'bg-sky-950/80 text-sky-300 border-sky-500/40';

                // Level badge colors
                let lvlColor = 'bg-slate-800 text-slate-300 border-slate-700';
                if (entry.level === 'ERROR') lvlColor = 'bg-red-950/90 text-red-300 border-red-500/50';
                else if (entry.level === 'WARN') lvlColor = 'bg-amber-950/90 text-amber-300 border-amber-500/50';
                else if (entry.level === 'INFO') lvlColor = 'bg-emerald-950/70 text-emerald-300 border-emerald-500/30';

                return (
                  <div
                    key={entry.id}
                    className={`rounded-lg border transition-all ${
                      entry.level === 'ERROR'
                        ? 'bg-red-950/15 border-red-900/40'
                        : isExpanded
                        ? 'bg-slate-900/90 border-slate-700'
                        : 'bg-slate-900/40 border-slate-850 hover:border-slate-750'
                    }`}
                  >
                    {/* Log Row Header */}
                    <div
                      onClick={() => hasDetails && toggleLogExpand(entry.id)}
                      className={`p-2.5 flex items-start gap-2.5 select-text ${
                        hasDetails ? 'cursor-pointer hover:bg-slate-800/40' : ''
                      }`}
                    >
                      {/* Expand / Collapse Icon */}
                      <div className="pt-0.5 shrink-0 text-slate-500">
                        {hasDetails ? (
                          isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5 text-indigo-400" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                          )
                        ) : (
                          <div className="w-3.5 h-3.5" />
                        )}
                      </div>

                      {/* Timestamp */}
                      <span className="text-slate-400 shrink-0 font-sans text-[10px] pt-0.5">
                        {new Date(entry.isoTime).toLocaleTimeString('ja-JP', { hour12: false })}
                        <span className="text-slate-500 ml-1">
                          (+{(entry.relativeTimeMs / 1000).toFixed(2)}s)
                        </span>
                      </span>

                      {/* Level Badge */}
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-sans font-bold border shrink-0 ${lvlColor}`}>
                        {entry.level}
                      </span>

                      {/* Category Badge */}
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-sans font-semibold border shrink-0 uppercase ${catColor}`}>
                        {entry.category}
                      </span>

                      {/* Tag Badge */}
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800/90 text-slate-300 border border-slate-700 shrink-0">
                        {entry.tag}
                      </span>

                      {/* Message Text */}
                      <span
                        className={`flex-1 break-words font-sans text-xs ${
                          entry.level === 'ERROR'
                            ? 'text-red-300 font-semibold'
                            : entry.level === 'WARN'
                            ? 'text-amber-200'
                            : 'text-slate-200'
                        }`}
                      >
                        {entry.message}
                      </span>

                      {/* Detail indicator badge */}
                      {hasDetails && (
                        <span className="text-[10px] text-indigo-400 hover:underline shrink-0 font-sans font-medium">
                          {isExpanded ? '詳細を閉じる' : '詳細を展開'}
                        </span>
                      )}
                    </div>

                    {/* Expanded Details Section */}
                    {isExpanded && entry.details && (
                      <div className="px-3 pb-3 pt-1 border-t border-slate-800/80 space-y-2">
                        <div className="flex items-center justify-between text-[11px] text-slate-400 font-sans">
                          <span className="font-semibold text-slate-300 flex items-center gap-1">
                            <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                            ペイロード詳細 / エラー情報:
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopySingleDetail(entry);
                            }}
                            className="flex items-center gap-1 text-xs px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 transition-all"
                          >
                            {copiedDetailId === entry.id ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-400" />
                                <span className="text-emerald-400 font-semibold">コピー完了</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3 text-indigo-300" />
                                <span>詳細をコピー</span>
                              </>
                            )}
                          </button>
                        </div>

                        <pre className="bg-black/90 text-slate-200 p-3 rounded-lg text-[11px] font-mono whitespace-pre-wrap break-all max-h-80 overflow-y-auto border border-slate-800/90 leading-relaxed select-text">
                          {typeof entry.details === 'string'
                            ? entry.details
                            : JSON.stringify(entry.details, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </form>
    </div>
  );
};
