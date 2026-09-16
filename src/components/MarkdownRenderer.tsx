import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className = '' }) => {
  return (
    <div className={`space-y-2 text-xs sm:text-sm leading-relaxed ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed text-slate-200">{children}</p>,
          strong: ({ children }) => <strong className="font-bold text-amber-300">{children}</strong>,
          em: ({ children }) => <em className="italic text-cyan-300">{children}</em>,
          ul: ({ children }) => <ul className="list-disc list-inside space-y-1 my-2 text-slate-200 pl-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal list-inside space-y-1 my-2 text-slate-200 pl-1">{children}</ol>,
          li: ({ children }) => <li className="text-slate-200">{children}</li>,
          h1: ({ children }) => <h1 className="text-base font-bold text-white mt-3 mb-1.5 border-b border-slate-800 pb-1">{children}</h1>,
          h2: ({ children }) => <h2 className="text-sm font-bold text-white mt-2.5 mb-1 text-indigo-300">{children}</h2>,
          h3: ({ children }) => <h3 className="text-xs font-bold text-white mt-2 mb-1 text-cyan-300">{children}</h3>,
          code: ({ children }) => (
            <code className="px-1.5 py-0.5 bg-slate-950 text-cyan-300 rounded-md font-mono text-[11px] border border-slate-800">
              {children}
            </code>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-indigo-500/80 bg-indigo-950/20 pl-2.5 py-1 rounded-r-lg italic text-slate-300 my-2">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-2">
              <table className="min-w-full text-xs text-left border-collapse border border-slate-800">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border border-slate-800 bg-slate-950/80 px-2 py-1 text-slate-300 font-bold">{children}</th>,
          td: ({ children }) => <td className="border border-slate-800 px-2 py-1 text-slate-300">{children}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
