import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { ChevronDown, ChevronRight, FileCode, FileJson, FileText, Folder } from 'lucide-react';

interface FileItem {
  name: string;
  type: 'file' | 'folder';
  icon?: 'tsx' | 'ts' | 'json' | 'css' | 'md';
  children?: FileItem[];
  isNew?: boolean;
}

const fileStructure: FileItem[] = [
  {
    name: 'app',
    type: 'folder',
    children: [
      { name: 'layout.tsx', type: 'file', icon: 'tsx' },
      { name: 'page.tsx', type: 'file', icon: 'tsx', isNew: true },
      { name: 'globals.css', type: 'file', icon: 'css' },
      {
        name: 'api',
        type: 'folder',
        children: [{ name: 'route.ts', type: 'file', icon: 'ts', isNew: true }],
      },
    ],
  },
  {
    name: 'components',
    type: 'folder',
    children: [
      { name: 'header.tsx', type: 'file', icon: 'tsx', isNew: true },
      { name: 'hero.tsx', type: 'file', icon: 'tsx', isNew: true },
      { name: 'features.tsx', type: 'file', icon: 'tsx', isNew: true },
      { name: 'footer.tsx', type: 'file', icon: 'tsx', isNew: true },
    ],
  },
  {
    name: 'lib',
    type: 'folder',
    children: [{ name: 'utils.ts', type: 'file', icon: 'ts' }],
  },
  { name: 'package.json', type: 'file', icon: 'json' },
  { name: 'tailwind.config.ts', type: 'file', icon: 'ts' },
];

function FileIcon({ icon }: { icon?: string }) {
  const iconClass = 'h-4 w-4 shrink-0';
  switch (icon) {
    case 'tsx':
      return <FileCode className={`${iconClass} text-blue-400`} />;
    case 'ts':
      return <FileCode className={`${iconClass} text-blue-300`} />;
    case 'json':
      return <FileJson className={`${iconClass} text-yellow-400`} />;
    case 'css':
      return <FileText className={`${iconClass} text-pink-400`} />;
    default:
      return <FileText className={`${iconClass} text-muted-foreground`} />;
  }
}

function countItems(items: FileItem[]): number {
  let count = 0;
  for (const item of items) {
    count += 1;
    if (item.children) count += countItems(item.children);
  }
  return count;
}

function FileTreeItem({
  item,
  depth = 0,
  revealIndex,
  currentIndex,
}: {
  item: FileItem;
  depth?: number;
  revealIndex: number;
  currentIndex: { value: number };
}) {
  const [isOpen, setIsOpen] = useState(true);
  const myIndex = currentIndex.value++;
  const isRevealed = myIndex <= revealIndex;

  if (item.type === 'folder') {
    return (
      <motion.div
        initial={{ opacity: 0, x: -10 }}
        animate={isRevealed ? { opacity: 1, x: 0 } : { opacity: 0, x: -10 }}
        transition={{ duration: 0.2 }}
      >
        <button
          onClick={() => setIsOpen((v) => !v)}
          className="flex w-full items-center gap-1.5 py-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          style={{ paddingLeft: `${depth * 12}px` }}
        >
          {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
          <Folder className="h-4 w-4 shrink-0 text-blue-400/80" />
          <span>{item.name}</span>
        </button>
        <AnimatePresence>
          {isOpen && item.children && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {item.children.map((child, i) => (
                <FileTreeItem key={`${child.name}-${i}`} item={child} depth={depth + 1} revealIndex={revealIndex} currentIndex={currentIndex} />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={isRevealed ? { opacity: 1, x: 0 } : { opacity: 0, x: -10 }}
      transition={{ duration: 0.2 }}
      className="flex items-center gap-1.5 py-0.5 text-sm"
      style={{ paddingLeft: `${depth * 12 + 20}px` }}
    >
      <FileIcon icon={item.icon} />
      <span className={item.isNew ? 'text-green-400' : 'text-muted-foreground'}>{item.name}</span>
      {item.isNew ? (
        <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="ml-1 rounded bg-green-500/20 px-1 py-0.5 text-[10px] text-green-400">
          new
        </motion.span>
      ) : null}
    </motion.div>
  );
}

export function LoaderFileTree({ progress }: { progress: number }) {
  const totalItems = countItems(fileStructure);
  const revealIndex = Math.floor((progress / 100) * totalItems);

  return (
    <div className="h-full overflow-hidden rounded-none bg-card/30 backdrop-blur-sm">
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">EXPLORER</span>
      </div>
      <div className="p-2 font-mono text-xs">
        {fileStructure.map((item, i) => (
          <FileTreeItem key={`${item.name}-${i}`} item={item} revealIndex={revealIndex} currentIndex={{ value: 0 }} />
        ))}
      </div>
    </div>
  );
}
