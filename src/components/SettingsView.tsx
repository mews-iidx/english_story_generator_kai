import React, { useState, useRef } from 'react';
import { AppSettings, CefrLevel } from '../types/settings';
import { Key, Cloud, Download, Upload, Check, ExternalLink, RefreshCw, ShieldCheck, HelpCircle } from 'lucide-react';
import { exportAllData, importAllData } from '../services/storage';

interface SettingsViewProps {
  settings: AppSettings;
  onSaveSettings: (settings: AppSettings) => void;
  onGoogleConnect: () => Promise<void>;
  onGoogleSync: () => Promise<void>;
  isSyncing: boolean;
  onDataImported: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onSaveSettings,
  onGoogleConnect,
  onGoogleSync,
  isSyncing,
  onDataImported,
}) => {
  const [apiKey, setApiKey] = useState(settings.geminiApiKey);
  const [model, setModel] = useState(settings.geminiModel || 'gemini-3.7-flash');
  const [customModel, setCustomModel] = useState('');
  const [cefrLevel, setCefrLevel] = useState<CefrLevel>(settings.cefrLevel || 'A2');
  const [clientId, setClientId] = useState(settings.googleClientId);
  const [isSaved, setIsSaved] = useState(false);
  const [showOauthGuide, setShowOauthGuide] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const presetModels = ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-pro-preview'];
  const isPresetModel = presetModels.includes(model);

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
    setTimeout(() => setIsSaved(false), 2500);
  };

  const handleExport = () => {
    const jsonStr = exportAllData();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `storykai_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target?.result as string;
        const res = importAllData(text);
        alert(`インポート成功！ (ストーリー: ${res.storyCount}件, 語彙: ${res.vocabCount}件)`);
        onDataImported();
      } catch (err: any) {
        alert(`インポート失敗: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <form onSubmit={handleSave} className="space-y-6">
        {/* 1. Gemini API Settings */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
          <div className="flex items-center space-x-2.5 text-white font-bold text-lg border-b border-slate-800 pb-3">
            <Key className="w-5 h-5 text-emerald-400" />
            <span>Gemini API 設定</span>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Google AI Studio API Key <span className="text-emerald-400">*</span>
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-600 outline-none transition-all"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                ※ブラウザのLocalStorageにのみ保持されます。無料APIキーで利用可能です。
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  モデル選定
                </label>
                <select
                  value={isPresetModel ? model : 'custom'}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 outline-none"
                >
                  <option value="gemini-3.7-flash">gemini-3.7-flash (推奨・最新最速⚡)</option>
                  <option value="gemini-3.6-flash">gemini-3.6-flash (最新安定)</option>
                  <option value="gemini-3.5-flash-lite">gemini-3.5-flash-lite (最速・軽量)</option>
                  <option value="gemini-3.1-pro-preview">gemini-3.1-pro-preview (高度な推論✨)</option>
                  <option value="custom">その他 (カスタム指定)</option>
                </select>
                {model === 'custom' && (
                  <input
                    type="text"
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                    placeholder="例: gemini-3.7-flash"
                    className="w-full mt-2 bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-slate-200 outline-none"
                  />
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  デフォルト英語レベル
                </label>
                <select
                  value={cefrLevel}
                  onChange={(e) => setCefrLevel(e.target.value as CefrLevel)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 outline-none"
                >
                  <option value="A1">A1 (超初級・中学1〜2年・やさしい短文)</option>
                  <option value="A2">A2 (初級・中学3年〜日常基礎・おすすめ🌱)</option>
                  <option value="B1">B1 (中級・日常会話〜旅行)</option>
                  <option value="B2">B2 (中上級・自然な表現・イディオム)</option>
                  <option value="C1">C1 (上級・高度な語彙)</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* 2. Google Drive / Sheets Private DB Settings */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center space-x-2.5 text-white font-bold text-lg">
              <Cloud className="w-5 h-5 text-emerald-400" />
              <span>Google Drive / スプレッドシート連携（任意）</span>
            </div>
            {settings.googleSpreadsheetId && (
              <span className="text-[11px] font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" /> 接続済み
              </span>
            )}
          </div>

          <div className="space-y-3">
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-400">💡 OAuth設定は今必要？</span>
                <button
                  type="button"
                  onClick={() => setShowOauthGuide(!showOauthGuide)}
                  className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1 underline"
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                  {showOauthGuide ? 'ガイドを閉じる' : '連携手順を見る'}
                </button>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                <strong>今は未設定のままで全く問題ありません！</strong><br />
                アプリはブラウザ内（LocalStorage）で完結して動作するため、APIキーを入れるだけで全機能（生成、単語タップ翻訳、忘却曲線、履歴保存）がすぐに使えます。
              </p>
              {showOauthGuide && (
                <div className="pt-2 border-t border-slate-800 text-[11px] text-slate-400 space-y-1 animate-fadeIn">
                  <p className="font-semibold text-slate-200">【スプレッドシート連携したい場合の手順】</p>
                  <ol className="list-decimal list-inside space-y-1 pl-1 text-slate-300">
                    <li>Google Cloud Consoleでプロジェクトを作成</li>
                    <li>「APIとサービス」で Google Sheets API & Google Drive API を有効化</li>
                    <li>「認証情報」から「OAuth 2.0 クライアント ID」（ウェブアプリケーション）を作成</li>
                    <li>承認済みのJavaScript生成元に <code className="text-emerald-400 bg-slate-900 px-1 py-0.5 rounded">http://localhost:5173</code> を追加</li>
                    <li>発行されたクライアントIDを下の入力欄に貼り付けて「認証」を押す</li>
                  </ol>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Google OAuth 2.0 Client ID (スプレッドシート連携時のみ)
              </label>
              <input
                type="text"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="xxxxxx.apps.googleusercontent.com (未入力でOK)"
                className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-600 outline-none"
              />
            </div>

            {clientId && (
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={onGoogleConnect}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition-all flex items-center gap-2"
                >
                  <Cloud className="w-4 h-4 text-emerald-400" />
                  <span>Googleアカウントで認証・シート作成</span>
                </button>

                {settings.googleSpreadsheetId && (
                  <>
                    <button
                      type="button"
                      onClick={onGoogleSync}
                      disabled={isSyncing}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold transition-all flex items-center gap-2"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                      <span>今すぐDrive同期</span>
                    </button>

                    <a
                      href={`https://docs.google.com/spreadsheets/d/${settings.googleSpreadsheetId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3.5 py-2 text-emerald-400 hover:text-emerald-300 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                    >
                      <span>スプレッドシートを開く</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </>
                )}
              </div>
            )}

            {settings.lastSyncedAt && (
              <p className="text-[11px] text-slate-500">
                最終同期日時: {new Date(settings.lastSyncedAt).toLocaleString('ja-JP')}
              </p>
            )}
          </div>
        </div>

        {/* 3. Manual Backup & Restore */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
          <div className="flex items-center space-x-2.5 text-white font-bold text-lg border-b border-slate-800 pb-3">
            <Download className="w-5 h-5 text-emerald-400" />
            <span>データのエクスポート・インポート（手動バックアップ）</span>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleExport}
              className="flex items-center space-x-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition-all"
            >
              <Download className="w-4 h-4 text-emerald-400" />
              <span>JSONバックアップをダウンロード</span>
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center space-x-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition-all"
            >
              <Upload className="w-4 h-4 text-teal-400" />
              <span>JSONバックアップから復元</span>
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImportFile}
              accept=".json"
              className="hidden"
            />
          </div>
        </div>

        {/* Save Button */}
        <div className="flex items-center justify-end space-x-3 pt-2">
          {isSaved && (
            <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1 animate-fadeIn">
              <Check className="w-4 h-4" /> 設定を保存しました
            </span>
          )}
          <button
            type="submit"
            className="px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white rounded-xl text-sm font-semibold shadow-lg shadow-emerald-600/20 transition-all"
          >
            設定を保存する
          </button>
        </div>
      </form>
    </div>
  );
};