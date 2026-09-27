import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2, Rocket } from 'lucide-react';
import api from '@/lib/api';
import Button from '@/components/ui/Button';
import { ProjectDialog } from '@/components/ProjectDialog';

interface Deployment {
  id: string;
  projectName: string;
  status: string;
  url?: string;
  message?: string;
  createdAt: string;
}
interface DeploymentInfo { configured: boolean; requiresBackendUrl: boolean; deployment: Deployment | null }
const active = (status?: string) => !!status && ['SUBMITTING', 'QUEUED', 'INITIALIZING', 'BUILDING'].includes(status);
const labels: Record<string, string> = { SUBMITTING: 'Submitting', QUEUED: 'Queued', INITIALIZING: 'Preparing build', BUILDING: 'Building', READY: 'Ready', ERROR: 'Failed', CANCELED: 'Canceled', UNKNOWN: 'Check Vercel dashboard' };
const message = (error: unknown) => {
  const value = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  return typeof value === 'string' ? value : 'Could not contact the deployment service. Refresh the status before trying again.';
};

export function VercelDeployButton({ websiteId, websiteName, framework, disabled }: {
  websiteId: string; websiteName: string; framework?: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<DeploymentInfo | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [backendUrl, setBackendUrl] = useState('');
  const [refresh, setRefresh] = useState(0);
  const submitting = useRef(false);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const { data } = await api.get<DeploymentInfo>(`/website/${websiteId}/vercel`, { signal: controller.signal, timeout: 55_000 });
        setInfo(data); setError('');
        if (active(data.deployment?.status)) timer = setTimeout(poll, 5000);
      } catch (cause) { if (!controller.signal.aborted) setError(message(cause)); }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [open, websiteId, refresh]);

  const deploy = async () => {
    if (submitting.current || !info?.configured || active(info.deployment?.status)) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      const { data } = await api.post<Deployment>(`/website/${websiteId}/vercel`, { ...(backendUrl.trim() ? { backendUrl: backendUrl.trim() } : {}) }, { timeout: 120_000 });
      setInfo((current) => current ? { ...current, deployment: data } : current);
      setRefresh((value) => value + 1);
    } catch (cause) {
      setError(message(cause));
      // Require an explicit status refresh after a failed/ambiguous submission.
      setInfo(null);
    } finally { submitting.current = false; setBusy(false); }
  };

  return <>
    <Button variant="outline" size="sm" disabled={disabled} onClick={() => setOpen(true)} title="Deploy frontend to Vercel"><Rocket className="h-4 w-4" /><span>Deploy</span></Button>
    {open && <ProjectDialog title="Deploy to Vercel" busy={busy} onClose={() => setOpen(false)}>
      <p className="text-sm leading-6 text-muted-foreground">Publish <strong className="text-foreground">{websiteName}</strong> to the configured Vercel account. {framework === 'next' ? 'This uses the latest completed source from its v0 chat.' : 'This uses the saved frontend code.'}</p>
      {!info && !error && <p role="status" className="mt-4 flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Checking deployment settings...</p>}
      {info && !info.configured && <p className="mt-4 rounded-lg border border-border p-3 text-sm">Vercel is not connected yet. Ask your administrator to configure the backend Vercel token and optional team ID.</p>}
      {info?.requiresBackendUrl && <label className="mt-5 block text-sm font-medium">Hosted backend base URL
        <input type="url" value={backendUrl} onChange={(event) => setBackendUrl(event.target.value)} disabled={busy || active(info.deployment?.status)} placeholder="https://your-backend.example.com" className="mt-2 w-full rounded-lg border border-border bg-background p-2 text-sm" />
        <span className="mt-2 block text-xs font-normal leading-5 text-muted-foreground">Only the frontend is deployed here. Enter your running backend's HTTPS base URL, without the trailing /api. Requests to /api will be forwarded to that backend.</span>
      </label>}
      {info?.deployment && <div role="status" className="mt-5 rounded-lg border border-border p-3">
        <p className="flex items-center gap-2 text-sm font-medium">{active(info.deployment.status) && <Loader2 className="h-4 w-4 animate-spin" />}{labels[info.deployment.status] || info.deployment.status}</p>
        <p className="mt-1 text-xs text-muted-foreground">{new Date(info.deployment.createdAt).toLocaleString()}</p>
        {info.deployment.message && <p className="mt-2 text-sm text-muted-foreground">{info.deployment.message}</p>}
        {info.deployment.status === 'READY' && info.deployment.url && <a className="mt-3 inline-flex items-center gap-2 break-all text-sm text-accent underline" href={info.deployment.url} target="_blank" rel="noopener noreferrer">Open deployed website <ExternalLink className="h-4 w-4" /></a>}
      </div>}
      {error && <p role="alert" className="mt-4 text-sm text-red-500">{error}</p>}
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={() => setRefresh((value) => value + 1)}>Refresh status</Button>
        <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Close</Button>
        <Button disabled={busy || !info?.configured || active(info?.deployment?.status) || (!!info?.requiresBackendUrl && !backendUrl.trim())} onClick={() => void deploy()}>{busy ? 'Submitting...' : info?.deployment ? 'Deploy again' : 'Deploy frontend'}</Button>
      </div>
    </ProjectDialog>}
  </>;
}
