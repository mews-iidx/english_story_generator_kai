import React, { useState } from 'react';
import { CefrLevel } from '../types/settings';
import { VocabItem } from '../types/vocab';
import { PlusCircle, Edit3 } from 'lucide-react';
import { AnkiFlashcardView } from './AnkiFlashcardView';
import { AnkiCardEditorView } from './AnkiCardEditorView';
import { getTodayDateString } from '../utils/srs';

interface QuizViewProps {
  apiKey: string;
  model: string;
  cefrLevel: CefrLevel;
  onLevelChange?: (level: CefrLevel) => void;
  dueVocabs: string[];
  vocabs: VocabItem[];
  onAddToVocab: (phrase: string, meaning: string, sentence?: string, note?: string, level?: CefrLevel) => void;
  onUpdateVocab?: (updatedCard: VocabItem) => void;
  onDeleteVocab?: (vocabId: string) => void;
  onRecordTokenUsage?: (promptTokens: number, candidatesTokens: number) => void;
  onRateAnkiCard?: (vocabId: string, rating: 'again' | 'hard' | 'good' | 'easy') => void;
  onRevertAnkiCard?: (previousCard: VocabItem) => void;
}

export const QuizView: React.FC<QuizViewProps> = ({
  vocabs,
  onAddToVocab,
  onUpdateVocab,
  onDeleteVocab,
  onRateAnkiCard,
  onRevertAnkiCard,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'anki' | 'editor'>('anki');

  const today = getTodayDateString();
  const dueCount = React.useMemo(() => {
    return vocabs.filter(v => v.nextReviewDate <= today || v.cardState === 'learning' || v.cardState === 'relearning').length;
  }, [vocabs, today]);

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20 px-3 sm:px-4 animate-fadeIn">
      {/* 1. Sub-Tab Switcher */}
      <div className="flex items-center justify-center">
        <div className="bg-slate-900/90 border border-slate-800 p-1.5 rounded-2xl flex items-center gap-1 shadow-xl">
          <button
            type="button"
            onClick={() => setActiveSubTab('anki')}
            className={`flex items-center space-x-2 px-5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
              activeSubTab === 'anki'
                ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-lg shadow-amber-500/25 scale-[1.02]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
            }`}
          >
            <PlusCircle className="w-4 h-4" />
            <span>🃏 Anki学習</span>
            {dueCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-extrabold bg-white text-slate-950">
                {dueCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('editor')}
            className={`flex items-center space-x-2 px-5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
              activeSubTab === 'editor'
                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/25 scale-[1.02]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
            }`}
          >
            <Edit3 className="w-4 h-4" />
            <span>📝 カードエディタ・一覧</span>
            <span className="text-[10px] opacity-70 font-mono">({vocabs.length})</span>
          </button>
        </div>
      </div>

      {/* 2. Sub-Tab Content */}
      {activeSubTab === 'anki' ? (
        <AnkiFlashcardView
          vocabs={vocabs}
          onRateCard={onRateAnkiCard || (() => {})}
          onRevertCard={onRevertAnkiCard}
        />
      ) : (
        <AnkiCardEditorView
          vocabs={vocabs}
          onUpdateCard={onUpdateVocab || (() => {})}
          onDeleteCard={onDeleteVocab || (() => {})}
          onAddCard={onAddToVocab}
        />
      )}
    </div>
  );
};
