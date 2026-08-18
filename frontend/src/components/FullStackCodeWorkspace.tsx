import { useEffect, useState, type ReactNode } from 'react';
import { Braces, Database, Loader2, Monitor, Play, Server, Square, Terminal } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import backendGeneratorApi from '@/lib/backendGeneratorApi';
import { cn } from '@/lib/utils';
import Button from './ui/Button';

interface GeneratedFile { path: string; content: string }

interface FullStackProject {
  id: string;
  backendFiles?: GeneratedFile[];
  backendStatus?: 'generated' | 'installing' | 'running' | 'stopped' | 'failed';
  backendLogs?: string;
  backendPreviewUrl?: string;
}

export function FullStackCodeWorkspace({
  project,
  children,
  onProjectUpdate,
}: {
  project: FullStackProject;
  children: ReactNode;
  onProjectUpdate?: (updates: Partial<FullStackProject>) => void;
}) {
  const isFullStack = !!project.backendFiles?.length;
  const [workspace, setWorkspace] = useState<'frontend' | 'backend'>('frontend');
  const [fileIndex, setFileIndex] = useState(0);
  const [status, setStatus] = useState(project.backendStatus || 'generated');
  const [logs, setLogs] = useState(project.backendLogs || '');
  const [runtimeLoading, setRuntimeLoading] = useState(false);

  useEffect(() => {
    setStatus(project.backendStatus || 'generated');
    setLogs(project.backendLogs || '');
    setFileIndex(0);
    setWorkspace('frontend');
  }, [project.id, project.backendStatus, project.backendLogs]);

  if (!isFullStack) return <>{children}</>;

  const files = project.backendFiles || [];
  const activeFile = files[fileIndex] || files[0];
  const runAction = async (action: 'start' | 'stop') => {
    setRuntimeLoading(true);
    try {
      const response = await backendGeneratorApi.post(`/fullstack/${project.id}/backend/${action}`);
      setStatus(response.data.backendStatus);
      setLogs(response.data.backendLogs || '');
      onProjectUpdate?.(response.data);
    } catch (error: any) {
      setLogs(error.response?.data?.message || error.message || `Unable to ${action} backend`);
      setStatus('failed');
    } finally {
      setRuntimeLoading(false);
    }
  };

  const languageFor = (path: string) => path.endsWith('.json') ? 'json' : path.endsWith('.env.example') ? 'bash' : 'javascript';
  const statusColor = status === 'running' ? 'bg-emerald-400' : status === 'failed' ? 'bg-red-400' : status === 'installing' ? 'bg-amber-400 animate-pulse' : 'bg-zinc-400';

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/70 bg-background/40">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-3 py-2">
        <div className="flex rounded-lg border bg-background/70 p-1">
          <button onClick={() => setWorkspace('frontend')} className={cn('inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium', workspace === 'frontend' ? 'bg-accent text-accent-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
            <Monitor className="h-4 w-4" /> Frontend <span className="rounded-full bg-black/10 px-1.5 text-[10px]">v0</span>
          </button>
          <button onClick={() => setWorkspace('backend')} className={cn('inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium', workspace === 'backend' ? 'bg-emerald-500 text-white shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
            <Server className="h-4 w-4" /> Backend <span className="rounded-full bg-black/10 px-1.5 text-[10px]">OpenAI</span>
          </button>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={cn('h-2.5 w-2.5 rounded-full', statusColor)} />
          <span className="capitalize">{status}</span>
          <span className="hidden sm:inline">• JSON datastore</span>
          {status === 'running' ? (
            <Button variant="outline" size="sm" onClick={() => runAction('stop')} disabled={runtimeLoading} className="h-8 gap-1.5"><Square className="h-3.5 w-3.5" /> Stop</Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => runAction('start')} disabled={runtimeLoading} className="h-8 gap-1.5">{runtimeLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Start API</Button>
          )}
        </div>
      </div>

      {workspace === 'frontend' ? <div className="flex min-h-0 flex-1 flex-col">{children}</div> : (
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[13rem_minmax(0,1fr)]">
          <aside className="border-b bg-zinc-950/95 text-zinc-300 md:border-b-0 md:border-r">
            <div className="border-b border-white/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">backend/</div>
            {files.map((file, index) => (
              <button key={file.path} onClick={() => setFileIndex(index)} className={cn('flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/5', fileIndex === index && 'bg-emerald-500/15 text-emerald-300')}>
                {file.path === 'data.json' ? <Database className="h-4 w-4" /> : file.path.endsWith('.json') ? <Braces className="h-4 w-4" /> : <Server className="h-4 w-4" />}
                {file.path}
              </button>
            ))}
            <div className="mx-3 mt-4 rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3 text-xs leading-relaxed text-emerald-100/70">
              <Database className="mb-2 h-4 w-4 text-emerald-300" />
              <strong className="text-emerald-200">MVP datastore</strong><br />Records are read from and written to <code>data.json</code>. No external database is used.
            </div>
          </aside>
          <div className="flex min-h-0 min-w-0 flex-col bg-[#1e1e1e]">
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-xs text-zinc-400"><span>{activeFile?.path}</span><span>Node.js + Express</span></div>
            <div className="min-h-0 flex-1 overflow-auto">
              <SyntaxHighlighter language={languageFor(activeFile?.path || '')} style={vscDarkPlus} customStyle={{ margin: 0, minHeight: '100%', fontSize: '0.82rem', lineHeight: 1.6 }} showLineNumbers>
                {activeFile?.content || ''}
              </SyntaxHighlighter>
            </div>
            {logs && <details className="border-t border-white/10 bg-black/40 text-zinc-300"><summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs"><Terminal className="h-3.5 w-3.5" /> Runtime logs</summary><pre className="max-h-36 overflow-auto whitespace-pre-wrap px-3 pb-3 text-[11px] text-zinc-400">{logs.slice(-6000)}</pre></details>}
          </div>
        </div>
      )}
    </div>
  );
}
