import { ReactNode, useRef } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';

interface MobilePreviewStudioProps {
  children: ReactNode;
}

export function MobilePreviewStudio({ children }: MobilePreviewStudioProps) {
  const studioRef = useRef<HTMLDivElement>(null);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const smoothX = useSpring(mouseX, { stiffness: 120, damping: 18, mass: 0.4 });
  const smoothY = useSpring(mouseY, { stiffness: 120, damping: 18, mass: 0.4 });
  const rotateY = useTransform(smoothX, [-1, 1], [-6, 6]);
  const rotateX = useTransform(smoothY, [-1, 1], [5, -5]);

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    mouseX.set(((event.clientX - rect.left) / rect.width - 0.5) * 2);
    mouseY.set(((event.clientY - rect.top) / rect.height - 0.5) * 2);
  };

  const resetPointer = () => {
    mouseX.set(0);
    mouseY.set(0);
  };

  return (
    <div
      ref={studioRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetPointer}
      className="preview-studio relative flex h-full min-h-0 flex-1 items-center justify-center overflow-hidden"
    >
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[34rem] w-[34rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-400/12 blur-3xl" />
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.96 }}
        animate={{ opacity: 1, y: [0, -8, 0] }}
        transition={{
          opacity: { duration: 0.35 },
          y: { duration: 6, repeat: Infinity, ease: 'easeInOut' },
        }}
        style={{ rotateX, rotateY, transformPerspective: 1200 }}
        className="preview-phone relative h-full max-h-[880px] min-h-0 aspect-[320/650] max-w-[min(100%,540px)] overflow-hidden rounded-[46px] border border-white/25 bg-gradient-to-br from-zinc-300/45 via-zinc-950 to-black p-[4px] shadow-[0_42px_110px_rgba(0,0,0,0.75),0_0_80px_rgba(34,197,94,0.22)]"
      >
        <div className="pointer-events-none absolute inset-x-10 top-0 z-40 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent" />
        <div className="pointer-events-none absolute -left-16 top-10 z-40 h-56 w-24 rotate-12 bg-white/15 blur-2xl" />
        <div className="pointer-events-none absolute left-1/2 top-3 z-50 h-7 w-28 -translate-x-1/2 rounded-full border border-white/10 bg-black shadow-lg shadow-black/60" />
        <div className="relative flex h-full min-h-0 overflow-hidden rounded-[41px] bg-black ring-1 ring-white/25">
          <div className="pointer-events-none absolute left-0 right-0 top-0 z-30 flex items-center justify-between px-7 pt-4 text-sm font-semibold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
            <span>9:41</span>
            <div className="relative h-2.5 w-5 rounded-sm border border-white">
              <div className="absolute left-[2px] top-[2px] h-1 w-3 rounded-sm bg-white" />
              <div className="absolute -right-1 top-[3px] h-1 w-0.5 rounded-r bg-white" />
            </div>
          </div>
          {children}
          <div className="pointer-events-none absolute bottom-9 left-1/2 z-30 flex h-9 w-[82%] -translate-x-1/2 items-center justify-center rounded-full border border-white/15 bg-black/55 px-4 text-[11px] font-medium text-white/75 shadow-2xl shadow-black/60 backdrop-blur-md">
            <span className="mr-2 h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.9)]" />
            webgenius preview
          </div>
          <div className="pointer-events-none absolute bottom-3 left-1/2 z-30 h-1.5 w-32 -translate-x-1/2 rounded-full bg-white/80 shadow-[0_1px_8px_rgba(0,0,0,0.5)]" />
        </div>
      </motion.div>
    </div>
  );
}
