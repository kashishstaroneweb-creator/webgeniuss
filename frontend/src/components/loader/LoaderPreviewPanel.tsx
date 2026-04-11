import { motion } from 'framer-motion';
import { ExternalLink, Monitor, RefreshCw, Smartphone } from 'lucide-react';
import { useEffect, useRef } from 'react';

function SkeletonBlock({ className }: { className?: string }) {
  return (
    <motion.div
      className={`rounded-lg bg-muted/20 ${className ?? ''}`}
      animate={{ opacity: [0.3, 0.5, 0.3] }}
      transition={{ duration: 1.5, repeat: Infinity }}
    />
  );
}

export function LoaderPreviewPanel({ progress }: { progress: number }) {
  const showNav = progress > 10;
  const showHero = progress > 25;
  const showFeatures = progress > 50;
  const showFooter = progress > 75;

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [showNav, showHero, showFeatures, showFooter]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border/50 bg-card/30 backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-border/50 bg-secondary/30 px-3 py-2">
        <div className="flex items-center gap-1">
          <div className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
          <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/70" />
          <div className="h-2.5 w-2.5 rounded-full bg-green-500/70" />
        </div>

        <div className="flex flex-1 justify-center px-4">
          <div className="flex items-center gap-2 rounded-md bg-background/50 px-3 py-1">
            <div className="h-3 w-3 rounded-full border border-green-500 bg-green-500/20" />
            <span className="text-xs text-muted-foreground">localhost:3000</span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-muted-foreground">
          <Smartphone className="h-4 w-4" />
          <Monitor className="h-4 w-4 text-primary" />
          <RefreshCw className={`h-4 w-4 ${progress < 100 ? 'animate-spin' : ''}`} />
          <ExternalLink className="h-4 w-4" />
        </div>
      </div>

      <div ref={containerRef} className="flex-1 overflow-auto bg-background/80 p-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        <div className="mx-auto max-w-md space-y-4">
          {showNav ? (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between rounded-lg bg-card/50 p-3">
              <div className="h-6 w-20 rounded bg-primary/30" />
              <div className="flex gap-3">
                <div className="h-4 w-12 rounded bg-muted" />
                <div className="h-4 w-12 rounded bg-muted" />
                <div className="h-4 w-12 rounded bg-muted" />
              </div>
              <div className="h-8 w-20 rounded-md bg-primary/50" />
            </motion.div>
          ) : (
            <SkeletonBlock className="h-12" />
          )}

          {showHero ? (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="space-y-4 rounded-lg bg-card/30 p-6 text-center">
              <div className="mx-auto h-8 w-3/4 rounded bg-foreground/20" />
              <div className="mx-auto h-4 w-2/3 rounded bg-muted" />
              <div className="mx-auto h-4 w-1/2 rounded bg-muted" />
              <div className="flex justify-center gap-3 pt-2">
                <div className="h-10 w-28 rounded-md bg-primary/60" />
                <div className="h-10 w-28 rounded-md border border-border bg-transparent" />
              </div>
            </motion.div>
          ) : (
            <SkeletonBlock className="h-48" />
          )}

          {showFeatures ? (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="grid grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="space-y-2 rounded-lg bg-card/30 p-4">
                  <div className="h-8 w-8 rounded-md bg-primary/30" />
                  <div className="h-4 w-20 rounded bg-foreground/20" />
                  <div className="h-3 w-full rounded bg-muted" />
                  <div className="h-3 w-2/3 rounded bg-muted" />
                </div>
              ))}
            </motion.div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((i) => (
                <SkeletonBlock key={i} className="h-28" />
              ))}
            </div>
          )}

          {showFooter ? (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="flex items-center justify-between rounded-lg bg-card/50 p-4">
              <div className="h-4 w-24 rounded bg-muted" />
              <div className="flex gap-3">
                <div className="h-4 w-4 rounded bg-muted" />
                <div className="h-4 w-4 rounded bg-muted" />
                <div className="h-4 w-4 rounded bg-muted" />
              </div>
            </motion.div>
          ) : (
            <SkeletonBlock className="h-14" />
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-border/50 bg-secondary/30 px-3 py-1.5">
        <motion.div className="h-2 w-2 rounded-full bg-green-500" animate={{ opacity: [1, 0.5, 1] }} transition={{ duration: 1, repeat: Infinity }} />
        <span className="text-xs text-muted-foreground">{progress < 100 ? 'Hot reloading...' : 'Ready'}</span>
      </div>
    </div>
  );
}
