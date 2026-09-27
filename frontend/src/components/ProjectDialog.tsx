import { useEffect, useRef, type ReactNode } from 'react';

export function ProjectDialog({ title, busy, onClose, children }: {
  title: string; busy: boolean; onClose: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog ref={ref} aria-labelledby="project-dialog-title"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
      className="w-[calc(100%-2rem)] max-w-md rounded-xl border border-border bg-card p-6 text-foreground shadow-xl backdrop:bg-black/60">
      <h2 id="project-dialog-title" className="mb-4 text-xl font-semibold">{title}</h2>
      {children}
    </dialog>
  );
}
