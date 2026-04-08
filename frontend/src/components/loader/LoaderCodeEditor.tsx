import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Circle, X } from 'lucide-react';

type SnippetLine = { content: string; indent: number };
type Snippet = { filename: string; lines: SnippetLine[] };

const generatingSnippets: Snippet[] = [
  {
    filename: 'page.tsx',
    lines: [
      { content: "import { Hero } from '@/components/hero'", indent: 0 },
      { content: "import { Features } from '@/components/features'", indent: 0 },
      { content: "import { Footer } from '@/components/footer'", indent: 0 },
      { content: '', indent: 0 },
      { content: 'export default function Home() {', indent: 0 },
      { content: 'return (', indent: 1 },
      { content: '<main className="min-h-screen">', indent: 2 },
      { content: '<Hero />', indent: 3 },
      { content: '<Features />', indent: 3 },
      { content: '<Footer />', indent: 3 },
      { content: '</main>', indent: 2 },
      { content: ')', indent: 1 },
      { content: '}', indent: 0 },
    ],
  },
  {
    filename: 'hero.tsx',
    lines: [
      { content: "'use client'", indent: 0 },
      { content: '', indent: 0 },
      { content: "import { motion } from 'framer-motion'", indent: 0 },
      { content: 'export function Hero() {', indent: 0 },
      { content: 'return (', indent: 1 },
      { content: '<section className="relative py-24">', indent: 2 },
      { content: '<motion.h1 className="text-5xl font-bold">', indent: 3 },
      { content: 'Build faster with AI', indent: 4 },
      { content: '</motion.h1>', indent: 3 },
      { content: '</section>', indent: 2 },
      { content: ')', indent: 1 },
      { content: '}', indent: 0 },
    ],
  },
  {
    filename: 'features.tsx',
    lines: [
      { content: 'const features = [', indent: 0 },
      { content: "{ title: 'Lightning Fast' },", indent: 1 },
      { content: "{ title: 'Type Safe' },", indent: 1 },
      { content: "{ title: 'Production Ready' },", indent: 1 },
      { content: ']', indent: 0 },
    ],
  },
];

const buildingSnippets: Snippet[] = [
  {
    filename: 'terminal.log',
    lines: [
      { content: 'npm install', indent: 0 },
      { content: 'vite build', indent: 0 },
      { content: '✓ Compiled successfully', indent: 0 },
      { content: '✓ Assets optimized', indent: 0 },
      { content: '✓ Preview build complete', indent: 0 },
    ],
  },
  {
    filename: 'dist/index.html',
    lines: [
      { content: '<!doctype html>', indent: 0 },
      { content: '<html lang="en">', indent: 0 },
      { content: '<body>', indent: 1 },
      { content: '<div id="root"></div>', indent: 2 },
      { content: '</body>', indent: 1 },
      { content: '</html>', indent: 0 },
    ],
  },
];

function syntaxHighlight(content: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = content;
  let key = 0;
  const patterns = [
    { regex: /^(import|export|from|default|function|return|const)/, className: 'text-pink-400' },
    { regex: /^('[^']*'|"[^"]*")/, className: 'text-green-400' },
    { regex: /^(className|initial|animate)(?==)/, className: 'text-cyan-300' },
    { regex: /^(<\/?[A-Z][a-zA-Z]*)/, className: 'text-blue-400' },
    { regex: /^(<\/?[a-z][a-zA-Z]*)/, className: 'text-red-400' },
    { regex: /^(\{|\}|\(|\)|<|>|\/|=)/, className: 'text-muted-foreground' },
    { regex: /^(\/\/.*)/, className: 'text-muted-foreground/60' },
  ];

  while (remaining.length > 0) {
    let matched = false;
    for (const pattern of patterns) {
      const match = remaining.match(pattern.regex);
      if (match) {
        parts.push(
          <span key={key++} className={pattern.className}>
            {match[0]}
          </span>
        );
        remaining = remaining.slice(match[0].length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      const nextSpecial = remaining.search(/['"{}<>()=\/]|import|export|from|const|function|return|className/);
      if (nextSpecial > 0) {
        parts.push(<span key={key++}>{remaining.slice(0, nextSpecial)}</span>);
        remaining = remaining.slice(nextSpecial);
      } else if (nextSpecial === -1) {
        parts.push(<span key={key++}>{remaining}</span>);
        remaining = '';
      } else {
        parts.push(<span key={key++}>{remaining[0]}</span>);
        remaining = remaining.slice(1);
      }
    }
  }

  return parts;
}

export function LoaderCodeEditor({ progress, variant }: { progress: number; variant: 'generating' | 'building' }) {
  const snippets = variant === 'building' ? buildingSnippets : generatingSnippets;
  const [activeTab, setActiveTab] = useState(0);
  const [visibleLines, setVisibleLines] = useState(0);
  const [cursorLine, setCursorLine] = useState(0);

  const currentSnippet = snippets[activeTab];
  const totalLines = currentSnippet.lines.length;

  useEffect(() => {
    const tabIndex = Math.min(Math.floor((progress / 100) * snippets.length), snippets.length - 1);
    if (tabIndex !== activeTab) {
      setActiveTab(tabIndex);
      setVisibleLines(0);
      setCursorLine(0);
    }
  }, [progress, activeTab, snippets.length]);

  useEffect(() => {
    if (visibleLines < totalLines) {
      const timer = setTimeout(() => {
        setVisibleLines((v) => v + 1);
        setCursorLine((c) => c + 1);
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [visibleLines, totalLines]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border/50 bg-card/30 backdrop-blur-sm">
      <div className="flex items-center border-b border-border/50 bg-secondary/30">
        <div className="flex items-center gap-1.5 px-3 py-2">
          <Circle className="h-3 w-3 fill-red-500/80 text-red-500/80" />
          <Circle className="h-3 w-3 fill-yellow-500/80 text-yellow-500/80" />
          <Circle className="h-3 w-3 fill-green-500/80 text-green-500/80" />
        </div>
        <div className="flex">
          {snippets.map((snippet, i) => (
            <button
              key={snippet.filename}
              onClick={() => {
                setActiveTab(i);
                setVisibleLines(i < activeTab ? snippet.lines.length : 0);
              }}
              className={`flex items-center gap-2 border-r border-border/30 px-3 py-1.5 text-xs transition-colors ${
                i === activeTab ? 'bg-card/50 text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span className={i <= Math.floor((progress / 100) * snippets.length) ? 'text-blue-400' : ''}>{snippet.filename}</span>
              {i === activeTab ? <X className="h-3 w-3 opacity-50" /> : null}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 font-mono text-sm">
        <div className="relative">
          <AnimatePresence mode="wait">
            <motion.div key={activeTab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              {currentSnippet.lines.map((line, i) => (
                <motion.div
                  key={`${currentSnippet.filename}-${i}`}
                  initial={{ opacity: 0 }}
                  animate={i < visibleLines ? { opacity: 1 } : { opacity: 0 }}
                  transition={{ duration: 0.1 }}
                  className="flex"
                >
                  <span className="mr-4 w-6 select-none text-right text-muted-foreground/50">{i + 1}</span>
                  <span style={{ paddingLeft: `${line.indent * 16}px` }}>{syntaxHighlight(line.content)}</span>
                  {i === cursorLine - 1 ? (
                    <motion.span animate={{ opacity: [1, 0] }} transition={{ duration: 0.5, repeat: Infinity }} className="ml-0.5 inline-block h-5 w-0.5 bg-primary" />
                  ) : null}
                </motion.div>
              ))}
            </motion.div>
          </AnimatePresence>

          {visibleLines < totalLines ? (
            <div className="mt-1 space-y-1.5">
              {Array.from({ length: Math.min(3, totalLines - visibleLines) }).map((_, i) => (
                <div key={`skeleton-${i}`} className="flex items-center">
                  <span className="mr-4 w-6" />
                  <motion.div
                    className="h-4 rounded bg-muted/30"
                    style={{ width: `${Math.random() * 40 + 30}%` }}
                    animate={{ opacity: [0.3, 0.6, 0.3] }}
                    transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.2 }}
                  />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
