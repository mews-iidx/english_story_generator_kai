import React from 'react';
import { Bot, Sparkles } from 'lucide-react';

interface FloatingAiAssistantProps {
  selectedText?: string;
  onClick: () => void;
}

export const FloatingAiAssistant: React.FC<FloatingAiAssistantProps> = ({
  selectedText,
  onClick,
}) => {
  return (
    <div className="fixed bottom-20 md:bottom-6 right-4 z-40 animate-slideUp">
      <button
        onClick={onClick}
        className="group relative flex items-center space-x-2 px-3.5 py-2.5 bg-gradient-to-r from-blue-600 via-indigo-600 to-sky-500 hover:from-blue-500 hover:to-sky-400 text-white rounded-full shadow-2xl shadow-blue-600/40 border border-blue-400/40 active:scale-95 transition-all"
        title="AI英語メンターに質問する"
      >
        <div className="relative">
          <Bot className="w-5 h-5 text-white" />
          <Sparkles className="w-2.5 h-2.5 text-yellow-300 absolute -top-1 -right-1 animate-ping" />
        </div>

        {selectedText ? (
          <span className="text-xs font-bold max-w-[120px] truncate">
            「{selectedText}」を質問
          </span>
        ) : (
          <span className="text-xs font-bold hidden sm:inline">
            AIメンターに質問
          </span>
        )}
      </button>
    </div>
  );
};