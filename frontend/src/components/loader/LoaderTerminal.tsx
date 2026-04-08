import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Terminal as TerminalIcon } from 'lucide-react';

interface LogEntry {
  type: 'info' | 'success' | 'warning' | 'compile' | 'ready';
  message: string;
  timestamp: string;
}

const generateLogSequence: LogEntry[] = [
  { type: 'info', message: 'Starting generation engine...', timestamp: '00:00' },
  { type: 'compile', message: 'Compiling...', timestamp: '00:01' },
  { type: 'info', message: 'Creating app/page.tsx', timestamp: '00:02' },
  { type: 'success', message: '✓ Compiled successfully', timestamp: '00:03' },
  { type: 'info', message: 'Creating components/header.tsx', timestamp: '00:04' },
  { type: 'compile', message: 'Compiling /page...', timestamp: '00:05' },
  { type: 'success', message: '✓ Compiled /page in 234ms', timestamp: '00:06' },
  { type: 'info', message: 'Creating components/hero.tsx', timestamp: '00:07' },
  { type: 'info', message: 'Installing dependencies...', timestamp: '00:08' },
  { type: 'success', message: '✓ Packages installed', timestamp: '00:09' },
  { type: 'compile', message: 'Compiling...', timestamp: '00:10' },
  { type: 'success', message: '✓ Compiled successfully in 456ms', timestamp: '00:11' },
  { type: 'info', message: 'Creating components/features.tsx', timestamp: '00:12' },
  { type: 'info', message: 'Creating components/footer.tsx', timestamp: '00:13' },
  { type: 'compile', message: 'Compiling...', timestamp: '00:14' },
  { type: 'success', message: '✓ Compiled successfully in 312ms', timestamp: '00:15' },
  { type: 'info', message: 'Optimizing images...', timestamp: '00:16' },
  { type: 'success', message: '✓ Images optimized', timestamp: '00:17' },
  { type: 'info', message: 'Running TypeScript checks...', timestamp: '00:18' },
  { type: 'success', message: '✓ No TypeScript errors', timestamp: '00:19' },
];

const buildLogSequence: LogEntry[] = [
  { type: 'info', message: 'Installing dependencies...', timestamp: '00:00' },
  { type: 'success', message: '✓ npm install complete', timestamp: '00:02' },
  { type: 'compile', message: 'Running vite build...', timestamp: '00:03' },
  { type: 'info', message: 'Transforming modules...', timestamp: '00:04' },
  { type: 'success', message: '✓ Build complete in 1.4s', timestamp: '00:06' },
  { type: 'ready', message: '✓ Preview ready on localhost:4173', timestamp: '00:07' },
];

export function LoaderTerminal({ progress, variant }: { progress: number; variant: 'generating' | 'building' }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const logSequence = variant === 'building' ? buildLogSequence : generateLogSequence;
  const visibleLogs = Math.floor((progress / 100) * logSequence.length);

  useEffect(() => {
    setLogs(logSequence.slice(0, visibleLogs));
  }, [visibleLogs, logSequence]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  const getLogColor = (type: LogEntry['type']) => {
    switch (type) {
      case 'success':
        return 'text-green-400';
      case 'warning':
        return 'text-yellow-400';
      case 'compile':
        return 'text-blue-400';
      case 'ready':
        return 'text-green-400 font-medium';
      default:
        return 'text-muted-foreground';
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border/50 bg-card/30 backdrop-blur-sm">
      <div className="flex items-center gap-2 border-b border-border/50 bg-secondary/30 px-3 py-2">
        <TerminalIcon className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">Terminal</span>
        <span className="ml-auto text-xs text-muted-foreground">bash</span>
      </div>

      <div ref={containerRef} className="flex-1 overflow-auto p-3 font-mono text-xs">
        <div className="mb-2 flex items-center gap-2 text-muted-foreground">
          <ChevronRight className="h-3 w-3 text-green-400" />
          <span className="text-green-400">~</span>
          <span>{variant === 'building' ? 'vite build && vite preview' : 'npm run dev'}</span>
        </div>

        <AnimatePresence>
          {logs.map((log, i) => (
            <motion.div
              key={`${log.timestamp}-${i}`}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.15 }}
              className={`flex items-start gap-2 py-0.5 ${getLogColor(log.type)}`}
            >
              <span className="shrink-0 text-muted-foreground/50">{log.timestamp}</span>
              <span>{log.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>

        {progress < 100 ? (
          <div className="mt-1 flex items-center gap-2">
            <ChevronRight className="h-3 w-3 text-green-400" />
            <motion.span animate={{ opacity: [1, 0] }} transition={{ duration: 0.6, repeat: Infinity }} className="inline-block h-4 w-1.5 bg-foreground" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
