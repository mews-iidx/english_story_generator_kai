import React, { useState } from 'react';
import { CefrLevel } from '../types/settings';
import { Story } from '../types/story';
import { Copy, Check, FileJson, X, Sparkles, Download } from 'lucide-react';
import { buildExternalPromptTemplate, parseRobustStoryJson } from '../utils/jsonParser';

interface ImportStoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  cefrLevel: CefrLevel;
  dueVocabs: string[];
  onImportStory: (story: Story) => void;
}

export const ImportStoryModal: React.FC<ImportStoryModalProps> = ({
  isOpen,
  onClose,
  cefrLevel,
  dueVocabs,
  onImportStory,
}) => {
  const [activeTab, setActiveTab] = useState<'prompt' | 'import'>('prompt');
  const [selectedGenre, setSelectedGenre] = useState('Adventure');
  const [jsonInput, setJsonInput] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const promptText = buildExternalPromptTemplate(cefrLevel, dueVocabs, selectedGenre);

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(promptText);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2500);
  };

  const handleImport = () => {
    setErrorMsg(null);
    if (!jsonInput.trim()) {
      setErrorMsg('JSONテキストを入力してください。');
      return;
    }

    try {
      const parsed = parseRobustStoryJson(jsonInput);
      const newStory: Story = {
        id: 'st_imp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        title: parsed.title,
        titleJa: parsed.title_ja,
        summary: parsed.summary,
        storyContent: parsed.story,
        japaneseTranslation: parsed.japanese_translation,
        targetVocabList: parsed.target_vocab_used || dueVocabs,
        genres: parsed.genres && parsed.genres.length > 0 ? parsed.genres : [selectedGenre],
        cefrLevel,
        createdAt: new Date().toISOString(),
      };

      onImportStory(newStory);
      setJsonInput('');
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'JSONの解析に失敗しました。');
    }
  };

  const genres = ['Adventure', 'Thriller', 'Daily Life', 'Mystery', 'Sci-Fi', 'Fantasy', 'Comedy', 'Romance'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div 
        className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] flex flex-col modal-content"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
              <FileJson className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white tracking-tight">
                外部AI連携・JSONコピペインポート
              </h3>
              <p className="text-xs text-slate-400">
                Web版GeminiやChatGPTで作ったストーリーを取り込めます
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setActiveTab('prompt')}
            className={`flex-1 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'prompt'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Copy className="w-3.5 h-3.5" />
            <span>1. 外部AI用プロンプト作成</span>
          </button>

          <button
            onClick={() => setActiveTab('import')}
            className={`flex-1 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'import'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            <span>2. JSON貼り付けインポート</span>
          </button>
        </div>

        {activeTab === 'prompt' && (
          <div className="space-y-3.5 flex-1 overflow-y-auto pr-1">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">希望ジャンル:</label>
              <div className="flex flex-wrap gap-1.5">
                {genres.map(g => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setSelectedGenre(g)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                      selectedGenre === g
                        ? 'bg-blue-600 text-white border border-blue-400/30'
                        : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-300">
                  生成用プロンプト (レベル: <span className="text-blue-400 font-bold">{cefrLevel}</span>, 復習語彙: <span className="text-amber-400 font-bold">{dueVocabs.length}個</span> 注入):
                </label>
                {isCopied && (
                  <span className="text-xs text-blue-400 font-bold flex items-center gap-1 animate-fadeIn">
                    <Check className="w-3.5 h-3.5" /> コピー完了！
                  </span>
                )}
              </div>
              <textarea
                readOnly
                value={promptText}
                rows={8}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-300 font-mono leading-relaxed outline-none select-all"
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              <p className="text-[11px] text-slate-400">
                👉 コピーしてWeb版Gemini / ChatGPTに送信 ➔ 返ってきたJSONを「2」でインポート
              </p>
              <button
                onClick={handleCopyPrompt}
                className="flex items-center space-x-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-600/30 transition-all active:scale-95"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>プロンプトをコピー</span>
              </button>
            </div>
          </div>
        )}

        {activeTab === 'import' && (
          <div className="space-y-3.5 flex-1 overflow-y-auto pr-1">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">
                外部AIから返ってきたJSONを貼り付け:
              </label>
              <textarea
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
                placeholder='```json&#10;{&#10;  "title": "The Mysterious Key",&#10;  "title_ja": "謎の鍵",&#10;  "genres": ["Mystery", "Adventure"],&#10;  "summary": "...",&#10;  "story": "...",&#10;  "japanese_translation": "..."&#10;}&#10;```'
                rows={9}
                className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl p-3 text-xs text-slate-100 font-mono leading-relaxed outline-none transition-all placeholder-slate-600"
              />
            </div>

            {errorMsg && (
              <div className="p-3 bg-red-950/50 border border-red-500/40 rounded-xl text-xs text-red-300 leading-relaxed animate-fadeIn">
                ⚠️ {errorMsg}
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <p className="text-[11px] text-slate-400">
                ※既存のLocalStorageデータはそのまま維持され、新しいストーリーとして追加されます。
              </p>
              <button
                onClick={handleImport}
                className="flex items-center space-x-1.5 px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-600/30 transition-all active:scale-95"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>インポートして読む ➔</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};