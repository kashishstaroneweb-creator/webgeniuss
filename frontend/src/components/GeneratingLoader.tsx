import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Zap } from 'lucide-react';
import { LoaderFileTree } from '@/components/loader/LoaderFileTree';
import { LoaderCodeEditor } from '@/components/loader/LoaderCodeEditor';
import { LoaderPreviewPanel } from '@/components/loader/LoaderPreviewPanel';
import { LoaderTerminal } from '@/components/loader/LoaderTerminal';

export interface GeneratingLoaderProps {
  title?: string;
  subtitle?: string;
  variant?: 'generating' | 'building';
}

export function GeneratingLoader({ title, subtitle, variant = 'generating' }: GeneratingLoaderProps) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 96) {
          return 96;
        }
        const increment = Math.random() * 1.5 + 0.5;
        return Math.min(prev + increment, 96);
      });
    }, 150);

    return () => clearInterval(progressInterval);
  }, []);

  const displayTitle = title ?? (variant === 'building' ? 'Building preview...' : 'Generating your website...');
  const displaySubtitle =
    subtitle ??
    (variant === 'building'
      ? 'Running npm install & vite build'
      : 'WebGenius is generating your website');

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-xl border border-border/50 bg-background">
      <div
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
          backgroundSize: '50px 50px',
        }}
      />
      <div className="absolute -left-40 -top-40 h-80 w-80 rounded-full bg-primary/10 blur-[100px]" />
      <div className="absolute -bottom-40 -right-40 h-80 w-80 rounded-full bg-accent/10 blur-[100px]" />

      <div className="relative z-10 flex h-full flex-col overflow-hidden">
        <header className="shrink-0 border-b border-border/50 bg-card/30 backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 shrink-0">
            <div className="flex items-center gap-3">
              <motion.div
                className="flex items-center gap-2 rounded-full border border-primary/50 bg-primary/10 px-3 py-1.5"
                animate={{
                  boxShadow: [
                    '0 0 10px rgba(59,130,246, 0)',
                    '0 0 20px rgba(59,130,246, 0.3)',
                    '0 0 10px rgba(59,130,246, 0)',
                  ],
                }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}>
                  <Sparkles className="size-4 text-primary" />
                </motion.div>
                <span className="text-sm font-medium text-primary">{displayTitle}</span>
              </motion.div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Zap className="size-4 text-primary" />
                <span className="text-sm text-muted-foreground">{Math.round(progress)}% complete</span>
              </div>
              <div className="h-2 w-32 overflow-hidden rounded-full bg-secondary">
                <motion.div
                  className="h-full bg-gradient-to-r from-primary to-accent"
                  style={{ width: `${progress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            </div>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden min-h-0">
          <motion.div
            className="hidden w-56 shrink-0 border-r border-border/50 md:block"
            initial={{ x: -20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            <LoaderFileTree progress={progress} />
          </motion.div>

          <div className="flex flex-1 flex-col overflow-hidden lg:flex-row min-h-0">
            <motion.div
              className="flex-1 p-3"
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              <LoaderCodeEditor progress={progress} variant={variant} />
            </motion.div>

            <motion.div
              className="flex w-full flex-col gap-3 p-3 lg:w-96 min-h-0 overflow-hidden"
              initial={{ x: 20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.4 }}
            >
              <div className="flex-[3] min-h-0 overflow-hidden">
                <LoaderPreviewPanel progress={progress} />
              </div>

              <div className="flex-[2] min-h-0 overflow-hidden">
                <LoaderTerminal progress={progress} variant={variant} />
              </div>
            </motion.div>
          </div>
        </div>

        <footer className="shrink-0 flex items-center justify-between border-t border-border/50 bg-card/30 px-4 py-2 backdrop-blur-sm">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <motion.div
                className="h-2 w-2 rounded-full bg-green-500"
                animate={{ opacity: [1, 0.5, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
              />
              Connected
            </span>
            <span>{displaySubtitle}</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>Spaces: 2</span>
            <span>{variant === 'building' ? 'Build mode' : 'Generate mode'}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
