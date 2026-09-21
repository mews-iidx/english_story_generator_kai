import React, { useState, useMemo } from 'react';
import { VocabItem } from '../types/vocab';
import { CefrLevel } from '../types/settings';
import {
  Search,
  Edit3,
  Trash2,
  Volume2,
  Plus,
  Check,
  X,
  RotateCcw,
  ArrowUpDown,
  BookOpen
} from 'lucide-react';
import { speakText } from '../utils/speech';
import { getTodayDateString } from '../utils/srs';

interface AnkiCardEditorViewProps {
  vocabs: VocabItem[];
  onUpdateCard: (updatedCard: VocabItem) => void;
  onDeleteCard: (cardId: string) => void;
  onAddCard: (phrase: string, meaning: string, sentence?: string, note?: string, level?: CefrLevel) => void;
}

type SortField = 'nextReviewDate' | 'createdAt' | 'intervalDays' | 'phrase' | 'repetitionCount';
type SortOrder = 'asc' | 'desc';
type StatusFilter = 'all' | 'due' | 'learning' | 'review' | 'graduated';

export const AnkiCardEditorView: React.FC<AnkiCardEditorViewProps> = ({
  vocabs,
  onUpdateCard,
  onDeleteCard,
  onAddCard,
}) => {
  // Search & Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [directionFilter, setDirectionFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('nextReviewDate');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  // Edit Modal State
  const [editingCard, setEditingCard] = useState<VocabItem | null>(null);
  const [editPhrase, setEditPhrase] = useState('');
  const [editMeaning, setEditMeaning] = useState('');
  const [editSentence, setEditSentence] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editLevel, setEditLevel] = useState<CefrLevel>('B1');
  const [editDirection, setEditDirection] = useState<'en_to_ja' | 'ja_to_en'>('en_to_ja');

  // Add Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newPhrase, setNewPhrase] = useState('');
  const [newMeaning, setNewMeaning] = useState('');
  const [newSentence, setNewSentence] = useState('');
  const [newNote, setNewNote] = useState('');
  const [newLevel, setNewLevel] = useState<CefrLevel>('B1');

  // Delete Confirmation State
  const [deletingCardId, setDeletingCardId] = useState<string | null>(null);

  const today = getTodayDateString();

  // Filtered & Sorted Card List
  const filteredCards = useMemo(() => {
    return vocabs.filter((card) => {
      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesPhrase = card.phrase.toLowerCase().includes(q);
        const matchesMeaning = card.meaning.toLowerCase().includes(q);
        const matchesSentence = card.exampleSentence?.toLowerCase().includes(q) || false;
        const matchesNote = card.contextNote?.toLowerCase().includes(q) || false;
        if (!matchesPhrase && !matchesMeaning && !matchesSentence && !matchesNote) {
          return false;
        }
      }

      // 2. Status Filter
      if (statusFilter === 'due') {
        if (card.nextReviewDate > today && card.cardState !== 'learning' && card.cardState !== 'relearning') {
          return false;
        }
      } else if (statusFilter === 'learning') {
        if (card.cardState !== 'learning' && card.cardState !== 'relearning') {
          return false;
        }
      } else if (statusFilter === 'review') {
        if (card.cardState !== 'review') {
          return false;
        }
      } else if (statusFilter === 'graduated') {
        if ((card.intervalDays || 0) < 21) {
          return false;
        }
      }

      // 3. Level Filter
      if (levelFilter !== 'all' && card.level !== levelFilter) {
        return false;
      }

      // 4. Direction Filter
      if (directionFilter === 'en_to_ja' && card.cardDirection === 'ja_to_en') {
        return false;
      }
      if (directionFilter === 'ja_to_en' && card.cardDirection !== 'ja_to_en') {
        return false;
      }

      return true;
    }).sort((a, b) => {
      let valA: any = a[sortField];
      let valB: any = b[sortField];

      if (sortField === 'nextReviewDate') {
        valA = a.nextReviewDate || '';
        valB = b.nextReviewDate || '';
      } else if (sortField === 'createdAt') {
        valA = a.createdAt || '';
        valB = b.createdAt || '';
      } else if (sortField === 'intervalDays') {
        valA = a.intervalDays || 0;
        valB = b.intervalDays || 0;
      } else if (sortField === 'repetitionCount') {
        valA = a.repetitionCount || 0;
        valB = b.repetitionCount || 0;
      } else if (sortField === 'phrase') {
        valA = a.phrase.toLowerCase();
        valB = b.phrase.toLowerCase();
      }

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [vocabs, searchQuery, statusFilter, levelFilter, directionFilter, sortField, sortOrder, today]);

  // Open Edit Modal
  const handleOpenEdit = (card: VocabItem) => {
    setEditingCard(card);
    setEditPhrase(card.phrase);
    setEditMeaning(card.meaning);
    setEditSentence(card.exampleSentence || '');
    setEditNote(card.contextNote || '');
    setEditLevel((card.level as CefrLevel) || 'B1');
    setEditDirection(card.cardDirection || 'en_to_ja');
  };

  // Save Card Edits
  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCard || !editPhrase.trim() || !editMeaning.trim()) return;

    const updated: VocabItem = {
      ...editingCard,
      phrase: editPhrase.trim(),
      meaning: editMeaning.trim(),
      exampleSentence: editSentence.trim(),
      sentence: editSentence.trim() || editingCard.sentence,
      contextNote: editNote.trim(),
      level: editLevel,
      cardDirection: editDirection,
    };

    onUpdateCard(updated);
    setEditingCard(null);
  };

  // Reset SRS Progress for a card
  const handleResetSRS = () => {
    if (!editingCard) return;
    if (window.confirm('このカードの復習進捗をリセットし、今日復習対象にしますか？')) {
      const updated: VocabItem = {
        ...editingCard,
        cardState: 'learning',
        learningStep: 0,
        intervalDays: 1,
        easeFactor: 2.5,
        repetitionCount: 0,
        nextReviewDate: today,
      };
      onUpdateCard(updated);
      setEditingCard(updated);
    }
  };

  // Save New Card
  const handleSaveNewCard = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPhrase.trim() || !newMeaning.trim()) return;

    onAddCard(
      newPhrase.trim(),
      newMeaning.trim(),
      newSentence.trim() || undefined,
      newNote.trim() || undefined,
      newLevel
    );

    setNewPhrase('');
    setNewMeaning('');
    setNewSentence('');
    setNewNote('');
    setIsAddModalOpen(false);
  };

  // Confirm Delete
  const handleConfirmDelete = (cardId: string) => {
    onDeleteCard(cardId);
    setDeletingCardId(null);
  };

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* 1. Top Summary & Action Bar */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-6 shadow-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
              <Edit3 className="w-5 h-5 text-indigo-400" />
              <span>Anki カードエディタ・一覧</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              登録された Anki カードを検索し、テキストの修正・削除・新規追加ができます。
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="flex items-center space-x-1.5 px-3.5 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-600/20 transition-all active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>新規カード作成</span>
            </button>
          </div>
        </div>

        {/* Search & Filter Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5 pt-2">
          {/* Search Box */}
          <div className="relative sm:col-span-2">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="英語・日本語・例文を検索..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-8 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Status Filter */}
          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
            >
              <option value="all">全ステータス ({vocabs.length})</option>
              <option value="due">🔴 要復習 (期日到来)</option>
              <option value="learning">🟡 学習中 (Learning)</option>
              <option value="review">🟢 復習定着中 (Review)</option>
              <option value="graduated">🏆 習得済み (21日以上)</option>
            </select>
          </div>

          {/* Level Filter */}
          <div>
            <select
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
            >
              <option value="all">全CEFRレベル</option>
              <option value="A1">A1 (入門)</option>
              <option value="A2">A2 (初級)</option>
              <option value="B1">B1 (中級)</option>
              <option value="B2">B2 (中上級)</option>
              <option value="C1">C1 (上級)</option>
              <option value="C2">C2 (最上級)</option>
            </select>
          </div>
        </div>

        {/* Direction Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800 text-xs text-slate-400">
          <div className="flex items-center space-x-2">
            <span>該当: <strong className="text-white font-mono">{filteredCards.length}</strong> / {vocabs.length} 件</span>
            <div className="flex items-center space-x-1 ml-2">
              <button
                type="button"
                onClick={() => setDirectionFilter('all')}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold ${directionFilter === 'all' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300'}`}
              >
                すべて
              </button>
              <button
                type="button"
                onClick={() => setDirectionFilter('en_to_ja')}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold ${directionFilter === 'en_to_ja' ? 'bg-blue-600/30 text-blue-300' : 'text-slate-500 hover:text-slate-300'}`}
              >
                📖 読解
              </button>
              <button
                type="button"
                onClick={() => setDirectionFilter('ja_to_en')}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold ${directionFilter === 'ja_to_en' ? 'bg-purple-600/30 text-purple-300' : 'text-slate-500 hover:text-slate-300'}`}
              >
                ✍️ 作文
              </button>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <span className="text-slate-500">並び順:</span>
            <select
              value={sortField}
              onChange={(e) => setSortField(e.target.value as SortField)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-300 focus:outline-none"
            >
              <option value="nextReviewDate">次回復習日</option>
              <option value="createdAt">登録日時</option>
              <option value="intervalDays">復習間隔 (日)</option>
              <option value="repetitionCount">復習回数</option>
              <option value="phrase">アルファベット順</option>
            </select>
            <button
              onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
              className="p-1 rounded bg-slate-950 border border-slate-800 text-slate-400 hover:text-white"
              title={sortOrder === 'asc' ? '昇順' : '降順'}
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* 2. Card List View */}
      {filteredCards.length === 0 ? (
        <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-12 text-center space-y-3">
          <BookOpen className="w-10 h-10 text-slate-600 mx-auto" />
          <h3 className="text-sm font-bold text-slate-300">該当するカードが見つかりません</h3>
          <p className="text-xs text-slate-500">検索条件を変更するか、右上のボタンから新規カードを追加してください。</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredCards.map((card) => {
            const isDue = card.nextReviewDate <= today || card.cardState === 'learning' || card.cardState === 'relearning';

            return (
              <div
                key={card.id}
                className="bg-slate-900/90 border border-slate-800 hover:border-slate-700 rounded-2xl p-4 sm:p-5 shadow-lg transition-all space-y-3 group"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1.5 flex-1 min-w-[240px]">
                    {/* Badges */}
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      {isDue ? (
                        <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold font-mono">
                          🔴 期日到来 ({card.nextReviewDate})
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700 font-mono">
                          📅 次回: {card.nextReviewDate}
                        </span>
                      )}

                      {card.level && (
                        <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-bold font-mono">
                          {card.level}
                        </span>
                      )}

                      <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[10px]">
                        間隔: {card.intervalDays || 1}日 / {card.repetitionCount || 0}回復習
                      </span>

                      {card.cardDirection === 'ja_to_en' ? (
                        <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 text-[10px] font-bold">
                          ✍️ 作文 (JA➔EN)
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 text-[10px] font-bold">
                          📖 読解 (EN➔JA)
                        </span>
                      )}
                    </div>

                    {/* Front Phrase */}
                    <div className="flex items-baseline gap-2 pt-1">
                      <h3 className="text-base sm:text-lg font-bold text-white font-serif leading-snug">
                        {card.phrase}
                      </h3>
                      <button
                        onClick={() => speakText(card.phrase)}
                        className="p-1 text-slate-400 hover:text-cyan-400 rounded transition-colors"
                        title="音声再生"
                      >
                        <Volume2 className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Meaning / Translation */}
                    <p className="text-xs sm:text-sm text-sky-200 leading-relaxed">
                      {card.meaning}
                    </p>

                    {/* Example sentence if available */}
                    {card.exampleSentence && (
                      <p className="text-xs text-slate-400 font-serif italic border-l-2 border-slate-700 pl-2 mt-1">
                        "{card.exampleSentence}"
                      </p>
                    )}

                    {/* Context Note if available */}
                    {card.contextNote && (
                      <p className="text-[11px] text-amber-300/80 bg-amber-950/20 px-2 py-1 rounded-lg border border-amber-500/20 mt-1 inline-block">
                        💡 {card.contextNote}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center space-x-1.5 self-start pt-1">
                    <button
                      onClick={() => handleOpenEdit(card)}
                      className="flex items-center space-x-1 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-semibold border border-slate-700 transition-all hover:text-white"
                      title="カードを編集"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-indigo-400" />
                      <span>編集</span>
                    </button>

                    <button
                      onClick={() => setDeletingCardId(card.id)}
                      className="p-2 rounded-xl bg-slate-850 hover:bg-rose-950/60 text-slate-400 hover:text-rose-300 border border-slate-800 hover:border-rose-500/30 transition-all"
                      title="削除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 3. Edit Card Modal */}
      {editingCard && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-lg shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-indigo-400" />
                <span>Anki カードを編集</span>
              </h3>
              <button
                onClick={() => setEditingCard(null)}
                className="p-1 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4 text-xs">
              {/* Phrase (Front) */}
              <div className="space-y-1">
                <label className="text-slate-300 font-bold block">
                  表面 (英語フレーズ / センテンス) <span className="text-rose-400">*</span>
                </label>
                <textarea
                  value={editPhrase}
                  onChange={(e) => setEditPhrase(e.target.value)}
                  rows={2}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500 font-serif"
                  required
                />
              </div>

              {/* Meaning (Back) */}
              <div className="space-y-1">
                <label className="text-slate-300 font-bold block">
                  裏面 (日本語訳 / 意味) <span className="text-rose-400">*</span>
                </label>
                <textarea
                  value={editMeaning}
                  onChange={(e) => setEditMeaning(e.target.value)}
                  rows={2}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>

              {/* Example Sentence */}
              <div className="space-y-1">
                <label className="text-slate-400 font-semibold block">例文 (任意)</label>
                <textarea
                  value={editSentence}
                  onChange={(e) => setEditSentence(e.target.value)}
                  rows={2}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500 font-serif"
                />
              </div>

              {/* Context Note / Grammar explanation */}
              <div className="space-y-1">
                <label className="text-slate-400 font-semibold block">解説・メモ (任意)</label>
                <input
                  type="text"
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* CEFR Level & Direction */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400 font-semibold block">CEFR レベル</label>
                  <select
                    value={editLevel}
                    onChange={(e) => setEditLevel(e.target.value as CefrLevel)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                  >
                    <option value="A1">A1 (入門)</option>
                    <option value="A2">A2 (初級)</option>
                    <option value="B1">B1 (中級)</option>
                    <option value="B2">B2 (中上級)</option>
                    <option value="C1">C1 (上級)</option>
                    <option value="C2">C2 (最上級)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-slate-400 font-semibold block">カード方向</label>
                  <select
                    value={editDirection}
                    onChange={(e) => setEditDirection(e.target.value as 'en_to_ja' | 'ja_to_en')}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                  >
                    <option value="en_to_ja">📖 読解 (EN ➔ JA)</option>
                    <option value="ja_to_en">✍️ 作文 (JA ➔ EN)</option>
                  </select>
                </div>
              </div>

              {/* SRS Reset Utility */}
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-bold text-slate-300 block">復習進捗のリセット</span>
                  <span className="text-[10px] text-slate-500">間隔を1日に戻して今日期日に設定</span>
                </div>
                <button
                  type="button"
                  onClick={handleResetSRS}
                  className="flex items-center space-x-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg text-[11px] font-bold border border-slate-700 transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>リセット</span>
                </button>
              </div>

              {/* Modal Buttons */}
              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingCard(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300 text-xs font-semibold"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  className="flex items-center space-x-1.5 px-5 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-md"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>変更を保存</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. Add New Card Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-lg shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-blue-400" />
                <span>新規 Anki カード作成</span>
              </h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveNewCard} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="text-slate-300 font-bold block">
                  表面 (英語フレーズ / センテンス) <span className="text-rose-400">*</span>
                </label>
                <textarea
                  value={newPhrase}
                  onChange={(e) => setNewPhrase(e.target.value)}
                  rows={2}
                  placeholder="例: I have a lot on my plate today."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500 font-serif"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-300 font-bold block">
                  裏面 (日本語訳 / 意味) <span className="text-rose-400">*</span>
                </label>
                <textarea
                  value={newMeaning}
                  onChange={(e) => setNewMeaning(e.target.value)}
                  rows={2}
                  placeholder="例: 今日はやるべきことが山積みだ。"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-400 font-semibold block">例文 (任意)</label>
                <textarea
                  value={newSentence}
                  onChange={(e) => setNewSentence(e.target.value)}
                  rows={2}
                  placeholder="例: Don't worry, I will help you out."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500 font-serif"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-400 font-semibold block">解説・メモ (任意)</label>
                <input
                  type="text"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="例: have on one's plate = 抱えている仕事がある"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-400 font-semibold block">CEFR レベル</label>
                <select
                  value={newLevel}
                  onChange={(e) => setNewLevel(e.target.value as CefrLevel)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                >
                  <option value="A1">A1 (入門)</option>
                  <option value="A2">A2 (初級)</option>
                  <option value="B1">B1 (中級)</option>
                  <option value="B2">B2 (中上級)</option>
                  <option value="C1">C1 (上級)</option>
                  <option value="C2">C2 (最上級)</option>
                </select>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300 text-xs font-semibold"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  className="flex items-center space-x-1.5 px-5 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-md"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>カードを作成</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. Delete Confirmation Modal */}
      {deletingCardId && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-rose-500/30 rounded-3xl p-6 w-full max-w-sm shadow-2xl space-y-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-white">カードを削除しますか？</h3>
              <p className="text-xs text-slate-400">
                この Anki カードを削除すると、デッキおよび復習履歴から完全に消去されます。
              </p>
            </div>
            <div className="flex items-center justify-center space-x-2 pt-2">
              <button
                onClick={() => setDeletingCardId(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
              >
                キャンセル
              </button>
              <button
                onClick={() => handleConfirmDelete(deletingCardId)}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-md shadow-rose-600/30"
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
