import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useSidebarStore } from '@/store/sidebarStore';
import api from '@/lib/api';
import Button from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Sparkles, Send, Eye, Code, Monitor, Download, Paperclip, Wand2, Mic, RotateCw, Smartphone, FileText, Image, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import WebsitePreview from '@/components/WebsitePreview';
import { GeneratingLoader } from '@/components/GeneratingLoader';
import { PromptInput, type WebsiteTemplate } from '@/components/PromptInput';
import { StatsCards } from '@/components/StatsCards';
import { RecentProjects } from '@/components/RecentProjects';
import { VoiceVisualizer } from '@/components/VoiceVisualizer';
import { MobilePreviewStudio } from '@/components/MobilePreviewStudio';
import { useVoiceRecognition } from '@/lib/useVoiceRecognition';
import { useVoiceSynthesis } from '@/lib/useVoiceSynthesis';
import { useTypewriter } from '@/lib/useTypewriter';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import JSZip from 'jszip';

const STREAM_API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/**
 * Only used for legacy POST /website/:id/edit (no v0ChatId). Prefer edit-stream for thread edits — no axios wall-clock limit.
 */
const EDIT_SYNC_FALLBACK_TIMEOUT_MS =
  Number(import.meta.env.VITE_WEBSITE_EDIT_TIMEOUT_MS) || 900_000;

function drainSseBlocks(buffer: string): { rest: string; events: { event?: string; data: string }[] } {
  const events: { event?: string; data: string }[] = [];
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  for (const block of parts) {
    let ev: string | undefined;
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) ev = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length) events.push({ event: ev, data: dataLines.join('\n') });
  }
  return { rest, events };
}

function formatGenerationErrorMessage(rawMessage: string): string {
  const raw = (rawMessage || '').trim();
  if (!raw) return 'Failed to generate website';

  try {
    const parsed = JSON.parse(raw) as { error?: { type?: string; message?: string }; message?: string };
    const providerType = parsed.error?.type || '';
    const providerMessage = parsed.error?.message || parsed.message || raw;
    if (/forbidden_error/i.test(providerType)) {
      return `v0 refused this generation request (403 Forbidden${providerMessage ? `: ${providerMessage}` : ''}). Check the backend V0_API_KEY, v0 Platform API access, account plan/credits, and any V0_PLATFORM_MODEL_ID setting.`;
    }
    return providerMessage;
  } catch {
    return raw;
  }
}

interface Component {
  name: string;
  type: string;
  path: string;
  code: string;
  language: string;
}

interface ViteConfig {
  packageJson?: string;
  viteConfig?: string;
  indexHtml?: string;
  mainJs?: string;
  mainJsx?: string;
  styleCss?: string;
}

type WebsiteFramework = 'next' | 'react' | 'html';
type PreviewDevice = 'desktop' | 'mobile';

interface PromptAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  text?: string;
  dataUrl?: string;
}

const inferFrameworkFromWebsite = (site: Partial<GeneratedWebsite> | null | undefined): WebsiteFramework => {
  if (!site) return 'next';
  if (site.framework === 'react' || site.framework === 'next' || site.framework === 'html') return site.framework;
  const hasReactShape = (site.components?.length ?? 0) > 0 || !!(site.viteConfig?.mainJsx || site.viteConfig?.mainJs);
  const hasStaticShape = !!(site.htmlCode || site.cssCode || site.jsCode);
  return hasReactShape ? 'react' : hasStaticShape ? 'html' : 'next';
};

interface GeneratedWebsite {
  id: string;
  userId?: string;
  websiteName: string;
  framework?: WebsiteFramework;
  prompt?: string;
  htmlCode?: string;
  cssCode?: string;
  jsCode?: string;
  components?: Component[];
  viteConfig?: ViteConfig;
  /** v0 Platform chat id (same source as official v0-clone). */
  v0ChatId?: string;
  /** Hosted preview iframe URL from v0 (`demo` / `latestVersion.demoUrl`). */
  v0DemoUrl?: string;
  /** React artifact preview URL from build worker (local Phase 1). */
  reactArtifactUrl?: string;
  reactBuildStatus?: 'queued' | 'building' | 'ready' | 'failed';
  reactBuildLog?: string;
  templateId?: string;
  templateName?: string;
  /** Last sync edit: v0-clone thread continuation vs legacy full-site create. */
  editV0Path?: 'sendMessage' | 'create_fallback';
  createdAt: string;
}


const Dashboard = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const websiteIdFromUrl = searchParams.get('website');
  const prevWebsiteIdFromUrlRef = useRef<string | null>(null);
  const generatedWebsiteRef = useRef<GeneratedWebsite | null>(null);
  const { user, updateUser } = useAuthStore();
  const { setCollapsed } = useSidebarStore();
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [websiteName, setWebsiteName] = useState('');
  const [framework, setFramework] = useState<WebsiteFramework>('next');
  const [generatedWebsite, setGeneratedWebsite] = useState<GeneratedWebsite | null>(null);
  const [showCodeView, setShowCodeView] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>('desktop');
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('component-0');
  const [activeComponentIndex, setActiveComponentIndex] = useState(0);
  const [stats, setStats] = useState(() => ({
    totalProjects: 0,
    generations: 0,
    creditsUsed: Number(user?.creditsUsed ?? 0),
    creditsRemaining: Number(user?.creditsBalance ?? 0),
  }));
  const [loadingHistoryWebsite, setLoadingHistoryWebsite] = useState(false);
  /** Steps for left-panel processing status: thinking → generating files → done */
  const [generationStep, setGenerationStep] = useState<'thinking' | 'generating' | 'done'>('thinking');
  /** Add-on prompt for editing the current website in the same chat */
  const [addOnPrompt, setAddOnPrompt] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [rebuildLoading, setRebuildLoading] = useState(false);
  const [promptAttachments, setPromptAttachments] = useState<PromptAttachment[]>([]);
  const [editAttachments, setEditAttachments] = useState<PromptAttachment[]>([]);
  const [templates, setTemplates] = useState<WebsiteTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<WebsiteTemplate | null>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);

  const voice = useVoiceSynthesis();

  const handleVoiceEditEnd = (finalTranscript: string) => {
    const trimmed = finalTranscript.trim();
    if (trimmed && !editLoading && !loading) {
      handleEdit(trimmed);
    }
  };

  const { isListening: isEditListening, toggleListening: toggleEditListening } = useVoiceRecognition({
    onTranscriptChange: (text) => setAddOnPrompt(text),
    onEnd: handleVoiceEditEnd,
  });

  const { displayed: displayedWebsiteName } = useTypewriter(
    generatedWebsite?.websiteName ?? ''
  );

  generatedWebsiteRef.current = generatedWebsite;

  const syncWebsiteIdToUrl = (id: string) => {
    if (!id?.trim()) return;
    setSearchParams({ website: id }, { replace: true });
  };

  const showSplitView = isGenerating || loadingHistoryWebsite || generatedWebsite !== null;

  const refreshCurrentUser = async () => {
    try {
      const res = await api.get('/user/profile');
      updateUser({
        creditsBalance: Number(res.data?.creditsBalance ?? 0),
        creditsUsed: Number(res.data?.creditsUsed ?? 0),
        subscriptionPlan: res.data?.subscriptionPlan,
        accountStatus: res.data?.accountStatus,
      });
    } catch (error) {
      console.error('Failed to refresh user credits:', error);
    }
  };

  /** Chat messages derived from prompt (original + [Edit] lines) for v0-style chat UI */
  const chatMessages = useMemo(() => {
    if (!generatedWebsite?.prompt) return [];
    const parts = generatedWebsite.prompt.split(/\n\[Edit\]\s*/).map((s) => s.trim()).filter(Boolean);
    return parts;
  }, [generatedWebsite?.prompt]);

  const editSuggestions = [
    'Make the header background light blue',
    'Add a contact form below the hero',
    'Change the hero title to Welcome',
    'Add a footer with social links',
  ];

  const isReadableAttachment = (file: File) => {
    const lower = file.name.toLowerCase();
    return (
      file.type.startsWith('text/') ||
      /\.(txt|md|json|csv|html|css|js|jsx|ts|tsx|svg|xml|yml|yaml)$/i.test(lower)
    );
  };

  const isImageAttachment = (file: File) => {
    return file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
  };

  const readFileAsDataUrl = (file: File): Promise<string | undefined> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : undefined);
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(file);
    });
  };

  const getV0ImageAttachments = (attachments: PromptAttachment[]) => {
    return attachments
      .filter((file) => file.dataUrl?.startsWith('data:image/'))
      .slice(0, 4)
      .map((file) => ({ url: file.dataUrl as string }));
  };

  const readAttachments = async (files: FileList): Promise<PromptAttachment[]> => {
    const selected = Array.from(files).slice(0, 8);
    const maxImageBytes = 5 * 1024 * 1024;
    return Promise.all(
      selected.map(async (file) => {
        let text: string | undefined;
        let dataUrl: string | undefined;
        if (isReadableAttachment(file)) {
          try {
            text = (await file.text()).slice(0, 12000);
          } catch {
            text = undefined;
          }
        }
        if (isImageAttachment(file) && file.size <= maxImageBytes) {
          dataUrl = await readFileAsDataUrl(file);
        }
        return {
          id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          type: file.type || 'unknown',
          size: file.size,
          text,
          dataUrl,
        };
      }),
    );
  };

  const appendAttachmentContext = (basePrompt: string, attachments: PromptAttachment[]) => {
    if (attachments.length === 0) return basePrompt;
    const context = attachments
      .map((file, index) => {
        const header = `Attachment ${index + 1}: ${file.name} (${file.type}, ${Math.round(file.size / 1024)} KB)`;
        if (file.dataUrl) {
          return `${header}\nImage reference attached. Use it as the visual/layout/style reference for the website.`;
        }
        return file.text
          ? `${header}\nContent:\n${file.text}`
          : `${header}\nContent was not read in-browser. Treat this as a named visual/reference asset from the user.`;
      })
      .join('\n\n---\n\n');
    return `${basePrompt.trim()}\n\nUse these attached files as context/reference:\n\n${context}`;
  };

  const handlePromptAttachFiles = async (files: FileList) => {
    const next = await readAttachments(files);
    setPromptAttachments((current) => [...current, ...next]);
  };

  const handleEditAttachFiles = async (files: FileList) => {
    const next = await readAttachments(files);
    setEditAttachments((current) => [...current, ...next]);
  };

  // Advance generation step for "processing" feel (v0-style) while loading
  useEffect(() => {
    if (!isGenerating && !loadingHistoryWebsite) {
      if (generatedWebsite) setGenerationStep('done');
      else setGenerationStep('thinking');
      return;
    }
    setGenerationStep('thinking');
    const t = setTimeout(() => setGenerationStep('generating'), 2000);
    return () => clearTimeout(t);
  }, [isGenerating, loadingHistoryWebsite]);
  useEffect(() => {
    if (generatedWebsite) setGenerationStep('done');
  }, [generatedWebsite]);

  useEffect(() => {
    let cancelled = false;
    const loadTemplates = async () => {
      try {
        const res = await api.get('/templates');
        if (!cancelled) setTemplates(Array.isArray(res.data) ? res.data : []);
      } catch (err) {
        if (!cancelled) console.error('Failed to load templates:', err);
      }
    };
    void loadTemplates();
    return () => {
      cancelled = true;
    };
  }, []);

  // Leaving ?website= (e.g. sidebar "New project") must clear deep-linked state — URL and UI stay in sync
  useEffect(() => {
    const prev = prevWebsiteIdFromUrlRef.current;
    prevWebsiteIdFromUrlRef.current = websiteIdFromUrl;
    if (prev && !websiteIdFromUrl) {
      setGeneratedWebsite(null);
      setPrompt('');
      setWebsiteName('');
      setAddOnPrompt('');
      setShowCodeView(false);
      setIsGenerating(false);
      setLoading(false);
      setLoadingHistoryWebsite(false);
      setEditLoading(false);
      setActiveTab('component-0');
      setActiveComponentIndex(0);
    }
  }, [websiteIdFromUrl]);

  // Load website from history when ?website=id is in URL (e.g. from sidebar Recents click)
  useEffect(() => {
    if (!websiteIdFromUrl) return;
    // Just generated/edited this id — URL was synced; avoid refetch + loading flash (ref = latest id without adding to deps)
    if (generatedWebsiteRef.current?.id === websiteIdFromUrl) return;
    let cancelled = false;
    const loadHistoryWebsite = async () => {
      setLoadingHistoryWebsite(true);
      try {
        const res = await api.get(`/website/${websiteIdFromUrl}`);
        if (cancelled) return;
        const data = res.data;
        setGeneratedWebsite({
          id: data.id,
          userId: data.userId,
          websiteName: data.websiteName || '',
          framework: inferFrameworkFromWebsite(data),
          prompt: data.prompt,
          htmlCode: data.htmlCode,
          cssCode: data.cssCode,
          jsCode: data.jsCode,
          components: data.components,
          viteConfig: data.viteConfig,
          v0ChatId: data.v0ChatId,
          v0DemoUrl: data.v0DemoUrl,
          reactArtifactUrl: data.reactArtifactUrl,
          reactBuildStatus: data.reactBuildStatus,
          reactBuildLog: data.reactBuildLog,
          templateId: data.templateId,
          templateName: data.templateName,
          createdAt: data.createdAt,
        });
        setPrompt(data.prompt || '');
        setWebsiteName(data.websiteName || '');
        setFramework(inferFrameworkFromWebsite(data));
        setCollapsed(true);
      } catch (err) {
        if (!cancelled) console.error('Failed to load website from history:', err);
      } finally {
        if (!cancelled) setLoadingHistoryWebsite(false);
      }
    };
    loadHistoryWebsite();
    return () => {
      cancelled = true;
    };
  }, [websiteIdFromUrl, setCollapsed]);

  useEffect(() => {
    // Fetch stats
    const fetchStats = async () => {
      try {
        const response = await api.get('/website/list');
        const websites = response.data || [];
        setStats((current) => ({
          totalProjects: websites.length,
          generations: websites.length,
          creditsUsed: current.creditsUsed,
          creditsRemaining: current.creditsRemaining,
        }));
      } catch (error) {
        console.error('Failed to fetch stats:', error);
      }
    };
    fetchStats();
  }, [generatedWebsite]);

  useEffect(() => {
    setStats((current) => ({
      ...current,
      creditsUsed: Number(user?.creditsUsed ?? 0),
      creditsRemaining: Number(user?.creditsBalance ?? 0),
    }));
  }, [user?.creditsBalance, user?.creditsUsed]);

  // Artifact preview pipeline polling: React builds async; HTML publishes quickly but can still report status.
  useEffect(() => {
    if (!generatedWebsite?.id) return;
    if (generatedWebsite.framework !== 'react' && generatedWebsite.framework !== 'html') return;
    if (generatedWebsite.reactBuildStatus === 'ready' || generatedWebsite.reactBuildStatus === 'failed') return;

    let cancelled = false;
    const websiteId = generatedWebsite.id;

    const poll = async () => {
      try {
        const res = await api.get(`/website/${websiteId}`);
        if (cancelled) return;
        const data = res.data;
        console.log('[PreviewArtifactPoll] status tick:', {
          websiteId,
          reactBuildStatus: data.reactBuildStatus || null,
          reactArtifactUrl: data.reactArtifactUrl || null,
        });
        setGeneratedWebsite((prev) => {
          if (!prev || prev.id !== websiteId) return prev;
          return {
            ...prev,
            ...data,
            id: data.id || prev.id,
            framework: inferFrameworkFromWebsite(data),
          };
        });
      } catch {
        console.warn('[PreviewArtifactPoll] status fetch failed, retrying...', { websiteId });
      }
    };

    void poll();
    const timer = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [generatedWebsite?.id, generatedWebsite?.framework, generatedWebsite?.reactBuildStatus]);

  // Format JSON code with proper indentation
  const formatJson = (jsonString: string): string => {
    if (!jsonString) return '';
    try {
      // Try to parse and format JSON
      const parsed = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
      return JSON.stringify(parsed, null, 2);
    } catch (e) {
      // If parsing fails, return as-is
      return jsonString;
    }
  };

  // Format code with proper indentation and line breaks
  const formatCode = (code: string, type: 'html' | 'css' | 'js'): string => {
    if (!code) return '';
    
    // If code already has multiple lines, return as is (it's already formatted)
    if (code.split('\n').length > 1) {
      return code;
    }
    
    // If code is on a single line, add basic formatting
    let formatted = code;
    
    if (type === 'html') {
      // Add line breaks between HTML tags
      formatted = formatted.replace(/>\s*</g, '>\n<');
    } else if (type === 'css') {
      // Add line breaks after semicolons and braces
      formatted = formatted
        .replace(/;\s*/g, ';\n')
        .replace(/\{\s*/g, '{\n')
        .replace(/\}\s*/g, '\n}\n');
    } else if (type === 'js') {
      // Add line breaks after semicolons, braces, and commas
      formatted = formatted
        .replace(/;\s*/g, ';\n')
        .replace(/\{\s*/g, '{\n')
        .replace(/\}\s*/g, '\n}\n')
        .replace(/,\s*/g, ',\n');
    }
    
    // Add basic indentation
    const lines = formatted.split('\n');
    let indentLevel = 0;
    const indentSize = 2;
    
    formatted = lines.map(line => {
      const trimmed = line.trim();
      if (!trimmed) return '';
      
      // Decrease indent for closing tags/braces
      if (trimmed.startsWith('</') || trimmed === '}') {
        indentLevel = Math.max(0, indentLevel - 1);
      }
      
      const indented = ' '.repeat(indentLevel * indentSize) + trimmed;
      
      // Increase indent for opening tags/braces
      if ((trimmed.startsWith('<') && !trimmed.startsWith('</') && !trimmed.endsWith('/>') && !trimmed.includes('</')) || 
          trimmed.endsWith('{')) {
        indentLevel++;
      }
      
      return indented;
    }).filter(line => line.trim().length > 0).join('\n');
    
    return formatted;
  };

  const handleGenerate = async (overridePrompt?: string) => {
    const imageAttachments = getV0ImageAttachments(promptAttachments);
    const finalPrompt =
      (overridePrompt || prompt).trim() ||
      (imageAttachments.length > 0
        ? 'Create a complete website based on the attached image reference. Match its layout, visual style, spacing, colors, and content hierarchy as closely as possible while making the result responsive and production-ready.'
        : '');
    if (!finalPrompt.trim() && imageAttachments.length === 0) {
      alert('Please enter a prompt or attach an image reference');
      return;
    }
    const promptForRequest = appendAttachmentContext(finalPrompt, promptAttachments);

    setLoading(true);
    setIsGenerating(true);
    setGeneratedWebsite(null);
    setShowCodeView(false);
    setActiveTab('html');
    
    // Announce start of generation
    voice.speak("I'm on it. Generating your website now.");
    
    try {
      // Check if token exists
      const token = localStorage.getItem('token');
      if (!token) {
        alert('You are not authenticated. Please login again.');
        window.location.href = '/login';
        return;
      }

      console.log('Making website generation request...', {
        prompt: promptForRequest.substring(0, 50) + '...',
        websiteName,
        tokenLength: token.length
      });

      const currentUserId = (user as any)?.id ?? (user as any)?._id;
      const websiteNameFinal = websiteName || `Website ${Date.now()}`;

      const streamRes = await fetch(`${STREAM_API_BASE}/website/generate-stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          prompt: promptForRequest,
          displayPrompt: finalPrompt,
          websiteName: websiteNameFinal,
          framework,
          attachments: imageAttachments,
          templateId: selectedTemplate?.id,
          ...(currentUserId && { userId: currentUserId }),
        }),
      });

      if (!streamRes.ok) {
        const errBody = await streamRes.json().catch(() => ({} as { message?: string; providerError?: string }));
        const err = new Error(
          formatGenerationErrorMessage(errBody.message || `Generation failed (${streamRes.status})`)
        );
        (err as any).status = streamRes.status;
        (err as any).errorData = errBody;
        throw err;
      }

      const reader = streamRes.body?.getReader();
      if (!reader) {
        throw new Error('No response body from generate-stream');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let saved: GeneratedWebsite | null = null;
      let streamError: string | null = null;
      let finalizeHint: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: true });
        const { rest, events } = drainSseBlocks(buffer);
        buffer = rest;
        for (const e of events) {
          if (e.event === 'website-saved') {
            try {
              saved = JSON.parse(e.data) as GeneratedWebsite;
            } catch {
              streamError = 'Invalid website-saved payload';
            }
          } else if (e.event === 'website-error') {
            try {
              const j = JSON.parse(e.data) as { message?: string };
              streamError = formatGenerationErrorMessage(j.message || 'website-error');
            } catch {
              streamError = 'website-error';
            }
          } else if (e.event === 'finalize-required') {
            try {
              const j = JSON.parse(e.data) as { message?: string };
              finalizeHint = j.message || null;
            } catch {
              finalizeHint = 'finalize-required';
            }
          }
        }
        if (done) break;
      }

      if (streamError) {
        throw new Error(streamError);
      }
      if (!saved) {
        throw new Error(
          finalizeHint ||
            'Stream ended without a saved website. If the v0 UI showed a chat id, call POST /website/finalize-v0-chat with that id.',
        );
      }

      console.log('Website generated successfully!', saved);
      
      voice.speak("Your website is ready.");
      
      console.log('Code lengths:', {
        html: saved.htmlCode?.length || 0,
        css: saved.cssCode?.length || 0,
        js: saved.jsCode?.length || 0,
        viteMain: (saved.viteConfig?.mainJsx || saved.viteConfig?.mainJs)?.length || 0,
        components: saved.components?.length ?? 0,
      });

      setGeneratedWebsite(saved);
      setPromptAttachments([]);
      setFramework(inferFrameworkFromWebsite(saved));
      if (saved.id) syncWebsiteIdToUrl(saved.id);
      void refreshCurrentUser();
      // Keep prompt and websiteName visible on the left for "generate again"
      // Automatically collapse sidebar when website is generated
      setCollapsed(true);
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message || 'Failed to generate website';
      const status = error.response?.status || error.status;
      const errorData = error.response?.data || error.errorData;
      
      console.error('Website generation error:', {
        status,
        message: errorMessage,
        errorData,
        token: localStorage.getItem('token') ? `exists (${localStorage.getItem('token')?.substring(0, 20)}...)` : 'missing',
        url: error.config?.url,
        method: error.config?.method,
        headers: error.config?.headers
      });
      
      if (status === 401) {
        const detailedError = errorData?.message || errorMessage;
        alert(`Authentication Error (401):\n\n${detailedError}\n\nThis usually means:\n- Your token has expired\n- Your token is invalid\n- You need to login again\n\nRedirecting to login...`);
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        useAuthStore.getState().logout();
        setTimeout(() => {
          window.location.href = '/login';
        }, 2000);
      } else {
        alert(`Error (${status || 'Unknown'}): ${errorMessage}`);
      }
    } finally {
      setLoading(false);
      setIsGenerating(false);
    }
  };

  const handleEdit = async (overridePrompt?: string) => {
    const imageAttachments = getV0ImageAttachments(editAttachments);
    const finalPrompt =
      (overridePrompt || addOnPrompt).trim() ||
      (imageAttachments.length > 0
        ? 'Update this website using the attached image reference. Match its layout, visual style, spacing, colors, and content hierarchy as closely as possible while preserving the existing project intent.'
        : '');
    if (!generatedWebsite?.id || (!finalPrompt.trim() && imageAttachments.length === 0)) return;
    const finalPromptWithAttachments = appendAttachmentContext(finalPrompt, editAttachments);
    setEditLoading(true);
    const token = localStorage.getItem('token');
    if (!token) {
      alert('You are not authenticated. Please login again.');
      window.location.href = '/login';
      setEditLoading(false);
      return;
    }

    const websiteId = generatedWebsite.id;
    const editPrompt = finalPromptWithAttachments.trim();
    const applySaved = (saved: GeneratedWebsite) => {
      const nextId = saved.id || websiteId;
      setGeneratedWebsite({ ...saved, id: nextId });
      setFramework(inferFrameworkFromWebsite(saved));
      setAddOnPrompt('');
      setEditAttachments([]);
      if (nextId) syncWebsiteIdToUrl(nextId);
      void refreshCurrentUser();
    };

    voice.speak("Got it, applying your changes.");

    try {
      const streamRes = await fetch(`${STREAM_API_BASE}/website/${websiteId}/edit-stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          editPrompt,
          displayEditPrompt: finalPrompt,
          framework,
          attachments: imageAttachments,
        }),
      });

      // No v0 thread: backend only supports sync full-site edit
      if (streamRes.status === 422) {
        const res = await api.post<GeneratedWebsite & { message?: string }>(
          `/website/${websiteId}/edit`,
          { editPrompt, displayEditPrompt: finalPrompt, framework, attachments: imageAttachments },
          { timeout: EDIT_SYNC_FALLBACK_TIMEOUT_MS }
        );
        applySaved({ ...res.data, id: res.data.id || websiteId });
        return;
      }

      if (!streamRes.ok) {
        const errBody = await streamRes.json().catch(() => ({} as { message?: string }));
        throw new Error(errBody.message || `Edit failed (${streamRes.status})`);
      }

      const reader = streamRes.body?.getReader();
      if (!reader) throw new Error('No response body from edit-stream');

      const decoder = new TextDecoder();
      let buffer = '';
      let saved: GeneratedWebsite | null = null;
      let streamError: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: true });
        const { rest, events } = drainSseBlocks(buffer);
        buffer = rest;
        for (const e of events) {
          if (e.event === 'website-saved') {
            try {
              saved = JSON.parse(e.data) as GeneratedWebsite;
            } catch {
              streamError = 'Invalid website-saved payload';
            }
          } else if (e.event === 'website-error') {
            try {
              const j = JSON.parse(e.data) as { message?: string };
              streamError = j.message || 'website-error';
            } catch {
              streamError = 'website-error';
            }
          }
        }
        if (done) break;
      }

      if (streamError) throw new Error(streamError);
      if (!saved) {
        throw new Error('Edit stream ended without saving. Try again or use a smaller change.');
      }
      voice.speak("Changes applied successfully.");
      applySaved(saved);
    } catch (error: any) {
      const isTimeout =
        error.code === 'ECONNABORTED' || /timeout of \d+ms exceeded/i.test(String(error.message || ''));
      const base = error.response?.data?.message || error.message || 'Failed to apply changes';
      const msg = isTimeout
        ? `${base}\n\nTip: regenerate once so edits use streaming, or raise VITE_WEBSITE_EDIT_TIMEOUT_MS / HTTP_SERVER_TIMEOUT_MS for legacy (no v0 chat id) edits.`
        : base;
      alert(msg);
    } finally {
      setEditLoading(false);
    }
  };

  const handleRebuildPreview = async () => {
    if (!generatedWebsite?.id || rebuildLoading) return;
    setRebuildLoading(true);
    try {
      await api.post(`/website/${generatedWebsite.id}/rebuild-preview`);
      const res = await api.get(`/website/${generatedWebsite.id}`);
      const data = res.data;
      setGeneratedWebsite((prev) =>
        prev
          ? {
              ...prev,
              ...data,
              id: data.id || prev.id,
              framework: inferFrameworkFromWebsite(data),
            }
          : prev,
      );
    } catch (error) {
      console.error('Failed to rebuild preview:', error);
      alert('Failed to rebuild preview. Please try again.');
    } finally {
      setRebuildLoading(false);
    }
  };

  const handleDownloadZip = async () => {
    if (!generatedWebsite) return;

    try {
      const zip = new JSZip();
      const folderName = generatedWebsite.websiteName.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'website';
      const vc = generatedWebsite.viteConfig;
      const mainEntry = vc?.mainJsx || vc?.mainJs || '';
      const hasVitePayload =
        !!mainEntry ||
        !!(vc?.styleCss && vc.styleCss.trim()) ||
        (generatedWebsite.components && generatedWebsite.components.length > 0);

      if (hasVitePayload) {
        const root = zip.folder(folderName) || zip;
        const src = root.folder('src');
        if (mainEntry) src?.file('main.jsx', mainEntry);
        if (vc?.styleCss) src?.file('style.css', vc.styleCss);
        if (vc?.indexHtml) root.file('index.html', vc.indexHtml);
        if (vc?.viteConfig) root.file('vite.config.js', vc.viteConfig);
        if (vc?.packageJson) root.file('package.json', vc.packageJson);
        generatedWebsite.components?.forEach((c) => {
          const rel = (c.path || `components/${c.name}.jsx`).replace(/^src\//, '');
          const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
          const base = rel.includes('/') ? rel.slice(rel.lastIndexOf('/') + 1) : rel;
          const folder = dir ? src?.folder(dir) : src;
          folder?.file(base, c.code || '');
        });
      } else {
        const htmlFolder = zip.folder('HTML');
        const cssFolder = zip.folder('CSS');
        const jsFolder = zip.folder('JavaScript');
        htmlFolder?.file('index.html', generatedWebsite.htmlCode || '');
        cssFolder?.file('styles.css', generatedWebsite.cssCode || '');
        jsFolder?.file('script.js', generatedWebsite.jsCode || '');
      }

      // Generate zip file
      const blob = await zip.generateAsync({ type: 'blob' });
      
      // Create download link
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${folderName}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error creating zip file:', error);
      alert('Failed to create zip file. Please try again.');
    }
  };

  return (
    <div className="flex-1 h-full flex flex-col relative">
      {!showSplitView ? (
        // Reference design layout - before generation
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-6 py-10">
            {/* Hero Section */}
            <div className="mb-10 text-center">
              <div className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 py-1.5 text-sm text-accent mb-4">
                <Sparkles className="h-4 w-4" />
                <span>AI-Powered Website Generation</span>
              </div>
              <h1 className="text-4xl font-bold tracking-tight text-foreground md:text-5xl">
                What do you want to{' '}
                <span className="text-accent">build</span> today?
              </h1>
              <p className="mt-4 text-lg text-muted-foreground max-w-xl mx-auto text-balance">
                Describe your vision and let AI generate a stunning website in seconds. No coding required.
              </p>
            </div>

            {/* Prompt Input */}
            <div className="mb-8">
              <div className="mb-4 w-full max-w-3xl mx-auto">
                <label className="text-sm font-medium mb-2 block text-foreground text-center">Website Name</label>
                <div className="flex justify-center">
                  <input
                    type="text"
                    value={websiteName}
                    onChange={(e) => setWebsiteName(e.target.value)}
                    placeholder="My Awesome Website"
                    className="w-full max-w-md px-4 py-2 rounded-lg border border-border bg-input text-foreground placeholder:text-muted-foreground transition-all duration-200 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              </div>
              <PromptInput
                prompt={prompt}
                setPrompt={setPrompt}
                onGenerate={handleGenerate}
                framework={framework}
                setFramework={setFramework}
                attachments={promptAttachments}
                onAttachFiles={handlePromptAttachFiles}
                onRemoveAttachment={(id) =>
                  setPromptAttachments((current) => current.filter((file) => file.id !== id))
                }
                loading={loading}
                templates={templates}
                selectedTemplate={selectedTemplate}
                onSelectTemplate={(template) => {
                  setSelectedTemplate(template);
                  if (!prompt.trim()) {
                    setPrompt(`Customize this ${template.name} template for my business.`);
                  }
                }}
                onClearTemplate={() => setSelectedTemplate(null)}
              />
            </div>

            {/* Stats */}
            <StatsCards
              totalProjects={stats.totalProjects}
              generations={stats.generations}
              creditsUsed={stats.creditsUsed}
              creditsRemaining={stats.creditsRemaining}
            />

            {/* Recent Projects */}
            <RecentProjects />
          </div>
        </div>
      ) : (
        // Split view after generation starts – left: same input + processing status (v0-style)
        <div className="flex-1 flex flex-col lg:flex-row gap-6 p-4 sm:p-6 lg:p-8 overflow-hidden h-full">
          {/* Left Side – Input stays visible + 3-line processing status */}
          <div className="w-full lg:w-2/5 min-w-0 flex flex-col space-y-6 overflow-y-auto lg:pr-4 h-full">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold mb-1">
                {generatedWebsite
                  ? <>{displayedWebsiteName}<span className="animate-pulse text-green-400">|</span></>
                  : loadingHistoryWebsite
                    ? 'Loading...'
                    : 'Generating your website'}
              </h1>
              <p className="text-muted-foreground text-sm">
                {generatedWebsite
                  ? 'Edit the prompt below to generate again.'
                  : loadingHistoryWebsite
                    ? 'Loading your project from history.'
                    : 'Your prompt is being processed. Preview will appear on the right.'}
              </p>
            </div>

            {/* Website Name + Describe your website – only while generating/loading; removed once website is generated */}
            {!generatedWebsite && (
              <div className="space-y-3">
                <label className="text-sm font-medium block">Website Name</label>
                <input
                  type="text"
                  value={websiteName}
                  onChange={(e) => setWebsiteName(e.target.value)}
                  placeholder="My Awesome Website"
                  disabled={loading}
                  className="w-full px-4 py-2 rounded-lg border border-border bg-input text-foreground placeholder:text-muted-foreground transition-all duration-200 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60"
                />
                <label className="text-sm font-medium block">Describe your website</label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g., Create a modern landing page for a tech startup..."
                  disabled={loading}
                  rows={4}
                  className="w-full px-4 py-3 rounded-lg border border-border bg-input text-foreground placeholder:text-muted-foreground resize-none transition-all duration-200 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60"
                />
              </div>
            )}

            {/* After generation: only chat (Original + edits) + add-on input */}
            {generatedWebsite && (
              <div className="space-y-3">
                {/* Chat message history (v0-style) */}
                {chatMessages.length > 0 && (
                  <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                    {chatMessages.map((msg, i) => (
                      <div
                        key={i}
                        className="rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-sm text-foreground"
                      >
                        <span className="text-muted-foreground text-xs font-medium">
                          {i === 0 ? 'Original' : `Edit ${i}`}
                        </span>
                        <p className="mt-1 break-words">{msg}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Same input as dashboard: Attach, Templates, Generate */}
                {!generatedWebsite.v0ChatId?.trim() && (
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    This project has no v0 chat id yet (e.g. older saves). The next edit sends the full site to the model;
                    after a successful edit, thread-style edits apply automatically if a chat id is stored.
                  </p>
                )}

                <div
                  className={cn(
                    'relative rounded-2xl border bg-card p-1 transition-all duration-300',
                    'border-border'
                  )}
                >
                  <div className="relative">
                    <textarea
                      value={addOnPrompt}
                      onChange={(e) => setAddOnPrompt(e.target.value)}
                      placeholder="Describe changes... e.g., Make the header blue, add a contact form"
                      disabled={editLoading || loading}
                      rows={3}
                      className="w-full resize-none rounded-xl bg-transparent px-4 py-4 text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    />
                    {editAttachments.length > 0 && (
                      <div className="px-3 pb-2">
                        <div className="flex flex-wrap gap-1.5 rounded-xl border border-emerald-400/15 bg-black/25 p-2">
                          {editAttachments.map((file) =>
                            file.dataUrl ? (
                              <span
                                key={file.id}
                                className="group relative h-24 w-24 overflow-hidden rounded-xl border border-emerald-400/25 bg-black/25 text-xs text-emerald-100 shadow-sm transition-all hover:border-emerald-300/60"
                              >
                                <img
                                  src={file.dataUrl}
                                  alt=""
                                  className="h-full w-full object-cover"
                                />
                                <span className="absolute inset-x-0 bottom-0 bg-black/65 px-2 py-1 text-[10px] leading-tight backdrop-blur-sm">
                                  <span className="block truncate">{file.name}</span>
                                  <span className="text-emerald-100/60">{Math.max(1, Math.round(file.size / 1024))}KB</span>
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setEditAttachments((current) => current.filter((item) => item.id !== file.id))}
                                  className="absolute right-1 top-1 rounded-full bg-black/65 p-1 text-emerald-100/80 backdrop-blur-sm transition hover:bg-red-500/80 hover:text-white"
                                  aria-label={`Remove ${file.name}`}
                                  title={`Remove ${file.name}`}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </span>
                            ) : (
                              <span
                                key={file.id}
                                className="group inline-flex max-w-full items-center gap-1.5 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-xs text-emerald-100 transition-all hover:border-emerald-300/50 hover:bg-emerald-400/15"
                              >
                                {file.type.startsWith('image/') ? (
                                  <Image className="h-3 w-3 shrink-0 text-emerald-300" />
                                ) : (
                                  <FileText className="h-3 w-3 shrink-0 text-emerald-300" />
                                )}
                                <span className="max-w-[140px] truncate">{file.name}</span>
                                <span className="text-[10px] text-emerald-100/45">{Math.max(1, Math.round(file.size / 1024))}KB</span>
                                <button
                                  type="button"
                                  onClick={() => setEditAttachments((current) => current.filter((item) => item.id !== file.id))}
                                  className="rounded-full p-0.5 text-emerald-100/55 transition hover:bg-red-500/15 hover:text-red-200"
                                  aria-label={`Remove ${file.name}`}
                                  title={`Remove ${file.name}`}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </span>
                            ),
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="space-y-3 px-3 pb-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => editFileInputRef.current?.click()}
                        disabled={editLoading || loading}
                        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-all duration-200 hover:bg-secondary hover:text-foreground active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Paperclip className="h-4 w-4" />
                        <span className="hidden sm:inline">Attach</span>
                      </button>
                      <input
                        ref={editFileInputRef}
                        type="file"
                        multiple
                        accept="image/*,.txt,.md,.json,.csv,.html,.css,.js,.jsx,.ts,.tsx,.svg,.xml,.yml,.yaml"
                        className="hidden"
                        onChange={(event) => {
                          if (event.target.files?.length) void handleEditAttachFiles(event.target.files);
                          event.target.value = '';
                        }}
                      />
                      <button
                        type="button"
                        disabled={editLoading || loading}
                        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-all duration-200 hover:bg-secondary hover:text-foreground active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Wand2 className="h-4 w-4" />
                        <span className="hidden sm:inline">Templates</span>
                      </button>
                      <button
                        type="button"
                        onClick={toggleEditListening}
                        disabled={editLoading || loading}
                        className={cn(
                          "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed",
                          isEditListening 
                            ? "bg-red-500/10 text-red-500 hover:bg-red-500/20" 
                            : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                        )}
                      >
                        {isEditListening ? (
                          <VoiceVisualizer isListening={isEditListening} />
                        ) : (
                          <>
                            <Mic className="h-4 w-4" />
                            <span className="hidden sm:inline">Voice</span>
                          </>
                        )}
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex shrink-0 items-center rounded-xl border border-border/70 bg-background/50 p-0.5 shadow-sm">
                        <button
                          type="button"
                          onClick={() => setFramework('next')}
                          disabled={editLoading || loading}
                          aria-pressed={framework === 'next'}
                          className={cn(
                            'rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed',
                            framework === 'next'
                              ? 'border border-accent/40 bg-accent text-accent-foreground shadow-md shadow-accent/20'
                              : 'border border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground'
                          )}
                        >
                          Next.js
                        </button>
                        <button
                          type="button"
                          onClick={() => setFramework('react')}
                          disabled={editLoading || loading}
                          aria-pressed={framework === 'react'}
                          className={cn(
                            'rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed',
                            framework === 'react'
                              ? 'border border-accent/40 bg-accent text-accent-foreground shadow-md shadow-accent/20'
                              : 'border border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground'
                          )}
                        >
                          React
                        </button>
                        <button
                          type="button"
                          onClick={() => setFramework('html')}
                          disabled={editLoading || loading}
                          aria-pressed={framework === 'html'}
                          className={cn(
                            'rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed',
                            framework === 'html'
                              ? 'border border-accent/40 bg-accent text-accent-foreground shadow-md shadow-accent/20'
                              : 'border border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground'
                          )}
                        >
                          HTML
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleEdit()}
                        disabled={(!addOnPrompt.trim() && !editAttachments.some((file) => !!file.dataUrl)) || editLoading || loading}
                        className={cn(
                          'ml-auto flex shrink-0 items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all duration-200',
                          (addOnPrompt.trim() || editAttachments.some((file) => !!file.dataUrl)) && !editLoading && !loading
                            ? 'btn-gradient-border text-foreground hover:text-accent dark:text-green-300 dark:hover:text-green-200 active:scale-95'
                            : 'bg-secondary text-muted-foreground cursor-not-allowed'
                        )}
                      >
                        {editLoading ? (
                          <>
                            <Sparkles className="h-4 w-4 animate-pulse" />
                            <span>Generating...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-4 w-4" />
                            <span>Generate</span>
                            <Send className="h-4 w-4" />
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Suggestions (same style as dashboard) */}
                {!editLoading && !loading && (
                  <div className="flex flex-wrap gap-2">
                    {editSuggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => setAddOnPrompt(suggestion)}
                        className="rounded-full border border-border bg-card/50 px-4 py-2 text-sm text-muted-foreground transition-all duration-200 hover:border-accent/50 hover:bg-card hover:text-foreground active:scale-95"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Processing status – 3 lines (v0-style) */}
            <Card className="border-accent/30 bg-accent/5">
              <CardContent className="pt-4 pb-4 space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  {generationStep === 'done' ? (
                    <span className="text-green-500">✓</span>
                  ) : generationStep === 'thinking' ? (
                    <span className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <span className="text-green-500">✓</span>
                  )}
                  <span className={generationStep === 'thinking' && !generatedWebsite ? 'text-foreground font-medium' : 'text-muted-foreground'}>
                    {generationStep === 'done' ? 'Thinking' : 'Thinking...'}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  {generationStep === 'done' || generationStep === 'generating' ? (
                    generationStep === 'done' ? (
                      <span className="text-green-500">✓</span>
                    ) : (
                      <span className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                    )
                  ) : (
                    <span className="w-4 h-4 rounded-full border border-muted-foreground/40" />
                  )}
                  <span className={(generationStep === 'generating' && !generatedWebsite) || generationStep === 'done' ? 'text-foreground font-medium' : 'text-muted-foreground'}>
                    {generationStep === 'done' ? 'Files generated' : generationStep === 'generating' ? 'Generating files...' : 'Generating files'}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  {(() => {
                    const hostedPreview = !!(
                      (generatedWebsite?.v0DemoUrl || generatedWebsite?.reactArtifactUrl) &&
                      !showCodeView
                    );
                    const usesArtifactPipeline =
                      generatedWebsite?.framework === 'react' || generatedWebsite?.framework === 'html';
                    const isArtifactPending =
                      usesArtifactPipeline &&
                      (generatedWebsite?.reactBuildStatus === 'queued' ||
                        generatedWebsite?.reactBuildStatus === 'building');
                    const previewReady =
                      !!generatedWebsite &&
                      !showCodeView &&
                      !isArtifactPending &&
                      ((usesArtifactPipeline && hostedPreview) ||
                        (!usesArtifactPipeline &&
                          (hostedPreview ||
                            !!(generatedWebsite.components?.length || generatedWebsite.viteConfig?.mainJsx || generatedWebsite.viteConfig?.mainJs || generatedWebsite.htmlCode))));
                    return (
                      <>
                        {previewReady ? (
                          <span className="text-green-500">✓</span>
                        ) : (
                          <span className="w-4 h-4 rounded-full border border-muted-foreground/40" />
                        )}
                        <span className={previewReady ? 'text-foreground font-medium' : 'text-muted-foreground'}>
                          {previewReady
                            ? hostedPreview
                              ? 'Preview ready (hosted)'
                              : 'Preview ready'
                            : isArtifactPending
                              ? generatedWebsite?.framework === 'html'
                                ? 'Publishing static preview...'
                                : 'Building React preview...'
                              : 'Rendering preview...'}
                        </span>
                      </>
                    );
                  })()}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Side - Preview Section */}
          <div className="w-full lg:w-3/5 min-w-0 flex flex-col overflow-hidden h-full">
            <Card
              className={cn(
                'flex-1 flex flex-col overflow-hidden h-full',
                generatedWebsite && !showCodeView && previewDevice === 'mobile' &&
                  'mobile-preview-shell border-0 bg-transparent shadow-none rounded-none py-0 gap-3'
              )}
            >
              <CardHeader
                className={cn(
                  'flex-shrink-0',
                  generatedWebsite && !showCodeView && previewDevice === 'mobile' && 'px-0 pt-0'
                )}
              >
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <CardTitle
                    className={cn(
                      'flex min-w-0 items-center gap-2 text-base',
                      generatedWebsite && !showCodeView && previewDevice === 'mobile' && 'hidden'
                    )}
                  >
                    {generatedWebsite ? (
                      <>
                        <Monitor className="h-5 w-5 shrink-0" />
                        <span className="truncate">{generatedWebsite.websiteName}</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-5 w-5 shrink-0 animate-pulse" />
                        <span>{loadingHistoryWebsite ? 'Loading...' : 'Generating...'}</span>
                      </>
                    )}
                  </CardTitle>
                  {generatedWebsite && (
                    <div className="flex w-full flex-wrap items-center gap-2 xl:w-auto xl:justify-end">
                      {(generatedWebsite.framework === 'react' || generatedWebsite.framework === 'html') && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleRebuildPreview}
                          disabled={rebuildLoading}
                          className={cn(
                            'gap-2',
                            !showCodeView && previewDevice === 'mobile' && 'hidden'
                          )}
                          title="Rebuild preview from saved code (no extra v0 credits)"
                        >
                          <RotateCw className={`h-4 w-4 ${rebuildLoading ? 'animate-spin' : ''}`} />
                          <span className="hidden 2xl:inline">{rebuildLoading ? 'Rebuilding...' : 'Rebuild Preview'}</span>
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDownloadZip}
                        className={cn(
                          'gap-2',
                          !showCodeView && previewDevice === 'mobile' && 'hidden'
                        )}
                        title="Download as ZIP"
                      >
                        <Download className="h-4 w-4" />
                        <span className="hidden 2xl:inline">Download ZIP</span>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setShowCodeView(!showCodeView);
                          if (!showCodeView) {
                            if (generatedWebsite.components && generatedWebsite.components.length > 0) {
                              setActiveTab('component-0');
                              setActiveComponentIndex(0);
                            } else {
                            setActiveTab('html');
                            }
                          }
                        }}
                        className={cn(
                          'gap-2',
                          !showCodeView && previewDevice === 'mobile' && 'hidden'
                        )}
                      >
                        {showCodeView ? (
                          <>
                            <Eye className="h-4 w-4" />
                            <span className="hidden 2xl:inline">View Preview</span>
                          </>
                        ) : (
                          <>
                            <Code className="h-4 w-4" />
                            <span className="hidden 2xl:inline">View Code</span>
                          </>
                        )}
                      </Button>
                      <div
                        className={cn(
                          'ml-auto flex items-center rounded-full border border-border/70 bg-background/70 p-1 shadow-inner xl:ml-0',
                          !showCodeView && previewDevice === 'mobile' && 'mx-auto'
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => setPreviewDevice('desktop')}
                          aria-pressed={previewDevice === 'desktop'}
                          title="Show desktop preview"
                          className={cn(
                            'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-all',
                            previewDevice === 'desktop'
                              ? 'bg-accent text-accent-foreground shadow-sm shadow-accent/20'
                              : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                          )}
                        >
                          <Monitor className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">Desktop</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewDevice('mobile')}
                          aria-pressed={previewDevice === 'mobile'}
                          title="Show mobile preview"
                          className={cn(
                            'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-all',
                            previewDevice === 'mobile'
                              ? 'bg-accent text-accent-foreground shadow-sm shadow-accent/20'
                              : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                          )}
                        >
                          <Smartphone className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">Mobile</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent
                className={cn(
                  'flex-1 overflow-hidden flex flex-col pt-6 min-w-0',
                  generatedWebsite && !showCodeView && previewDevice === 'mobile' && 'px-0 pt-2'
                )}
              >
                {(loading || loadingHistoryWebsite) && !generatedWebsite ? (
                  <GeneratingLoader />
                ) : generatedWebsite ? (
                  // Generated Content
                  <div className="flex-1 overflow-hidden flex flex-col min-w-0">
                    {showCodeView ? (
                      // Code View - Component-based or Legacy
                      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                        {generatedWebsite.components && generatedWebsite.components.length > 0 ? (
                          // Component-based tabs
                          <>
                            <div className="flex border-b bg-muted/30 overflow-x-auto">
                              {generatedWebsite.components.map((component, index) => (
                                <button
                                  key={index}
                                  onClick={() => {
                                    setActiveTab(`component-${index}`);
                                    setActiveComponentIndex(index);
                                  }}
                                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                                    activeTab === `component-${index}`
                                      ? 'border-accent text-accent bg-background'
                                      : 'border-transparent text-muted-foreground hover:text-foreground'
                                  }`}
                                >
                                  {component.path.split('/').pop()}
                                </button>
                              ))}
                              {generatedWebsite.viteConfig?.styleCss && (
                                <button
                                  onClick={() => setActiveTab('style')}
                                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                                    activeTab === 'style'
                                      ? 'border-accent text-accent bg-background'
                                      : 'border-transparent text-muted-foreground hover:text-foreground'
                                  }`}
                                >
                                  style.css
                                </button>
                              )}
                              {(generatedWebsite.viteConfig?.mainJs || generatedWebsite.viteConfig?.mainJsx) && (
                                <button
                                  onClick={() => setActiveTab('main')}
                                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                                    activeTab === 'main'
                                      ? 'border-accent text-accent bg-background'
                                      : 'border-transparent text-muted-foreground hover:text-foreground'
                                  }`}
                                >
                                  {generatedWebsite.viteConfig?.mainJsx ? 'main.jsx' : 'main.js'}
                                </button>
                              )}
                              {generatedWebsite.viteConfig?.indexHtml && (
                                <button
                                  onClick={() => setActiveTab('index')}
                                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                                    activeTab === 'index'
                                      ? 'border-accent text-accent bg-background'
                                      : 'border-transparent text-muted-foreground hover:text-foreground'
                                  }`}
                                >
                                  index.html
                                </button>
                              )}
                              {generatedWebsite.viteConfig?.viteConfig && (
                                <button
                                  onClick={() => setActiveTab('vite')}
                                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                                    activeTab === 'vite'
                                      ? 'border-accent text-accent bg-background'
                                      : 'border-transparent text-muted-foreground hover:text-foreground'
                                  }`}
                                >
                                  vite.config.js
                                </button>
                              )}
                              {generatedWebsite.viteConfig?.packageJson && (
                                <button
                                  onClick={() => setActiveTab('package')}
                                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                                    activeTab === 'package'
                                      ? 'border-accent text-accent bg-background'
                                      : 'border-transparent text-muted-foreground hover:text-foreground'
                                  }`}
                                >
                                  package.json
                                </button>
                              )}
                            </div>
                            <div className="flex-1 overflow-auto min-w-0">
                              <div className="rounded-lg overflow-hidden border h-full">
                                {activeTab.startsWith('component-') && (
                                  <SyntaxHighlighter
                                    language={generatedWebsite.components[activeComponentIndex]?.language === 'jsx' ? 'jsx' : 'javascript'}
                                    style={vscDarkPlus}
                                    customStyle={{
                                      margin: 0,
                                      borderRadius: 0,
                                      fontSize: '0.875rem',
                                      lineHeight: '1.6',
                                      height: '100%',
                                      minHeight: '100%',
                                      padding: '1rem',
                                      whiteSpace: 'pre',
                                      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
                                    }}
                                    showLineNumbers
                                    wrapLines={false}
                                    wrapLongLines={false}
                                    PreTag="pre"
                                    codeTagProps={{
                                      style: {
                                        whiteSpace: 'pre',
                                        wordBreak: 'normal',
                                        overflowWrap: 'normal',
                                      }
                                    }}
                                  >
                                    {generatedWebsite.components[activeComponentIndex]?.code || ''}
                                  </SyntaxHighlighter>
                                )}
                                {activeTab === 'style' && generatedWebsite.viteConfig?.styleCss && (
                                  <SyntaxHighlighter
                                    language="css"
                                    style={vscDarkPlus}
                                    customStyle={{
                                      margin: 0,
                                      borderRadius: 0,
                                      fontSize: '0.875rem',
                                      lineHeight: '1.6',
                                      height: '100%',
                                      minHeight: '100%',
                                      padding: '1rem',
                                      whiteSpace: 'pre',
                                      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
                                    }}
                                    showLineNumbers
                                    wrapLines={false}
                                    wrapLongLines={false}
                                    PreTag="pre"
                                    codeTagProps={{
                                      style: {
                                        whiteSpace: 'pre',
                                        wordBreak: 'normal',
                                        overflowWrap: 'normal',
                                      }
                                    }}
                                  >
                                    {formatCode(generatedWebsite.viteConfig.styleCss, 'css')}
                                  </SyntaxHighlighter>
                                )}
                                {activeTab === 'main' && (generatedWebsite.viteConfig?.mainJs || generatedWebsite.viteConfig?.mainJsx) && (
                                  <SyntaxHighlighter
                                    language={generatedWebsite.viteConfig?.mainJsx ? 'jsx' : 'javascript'}
                                    style={vscDarkPlus}
                                    customStyle={{
                                      margin: 0,
                                      borderRadius: 0,
                                      fontSize: '0.875rem',
                                      lineHeight: '1.6',
                                      height: '100%',
                                      minHeight: '100%',
                                      padding: '1rem',
                                      whiteSpace: 'pre',
                                      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
                                    }}
                                    showLineNumbers
                                    wrapLines={false}
                                    wrapLongLines={false}
                                    PreTag="pre"
                                    codeTagProps={{
                                      style: {
                                        whiteSpace: 'pre',
                                        wordBreak: 'normal',
                                        overflowWrap: 'normal',
                                      }
                                    }}
                                  >
                                    {formatCode(generatedWebsite.viteConfig.mainJsx || generatedWebsite.viteConfig.mainJs || '', 'js')}
                                  </SyntaxHighlighter>
                                )}
                                {activeTab === 'index' && generatedWebsite.viteConfig?.indexHtml && (
                                  <SyntaxHighlighter
                                    language="html"
                                    style={vscDarkPlus}
                                    customStyle={{
                                      margin: 0,
                                      borderRadius: 0,
                                      fontSize: '0.875rem',
                                      lineHeight: '1.6',
                                      height: '100%',
                                      minHeight: '100%',
                                      padding: '1rem',
                                      whiteSpace: 'pre',
                                      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
                                    }}
                                    showLineNumbers
                                    wrapLines={false}
                                    wrapLongLines={false}
                                    PreTag="pre"
                                    codeTagProps={{
                                      style: {
                                        whiteSpace: 'pre',
                                        wordBreak: 'normal',
                                        overflowWrap: 'normal',
                                      }
                                    }}
                                  >
                                    {formatCode(generatedWebsite.viteConfig.indexHtml, 'html')}
                                  </SyntaxHighlighter>
                                )}
                                {activeTab === 'vite' && generatedWebsite.viteConfig?.viteConfig && (
                                  <SyntaxHighlighter
                                    language="javascript"
                                    style={vscDarkPlus}
                                    customStyle={{
                                      margin: 0,
                                      borderRadius: 0,
                                      fontSize: '0.875rem',
                                      lineHeight: '1.6',
                                      height: '100%',
                                      minHeight: '100%',
                                      padding: '1rem',
                                      whiteSpace: 'pre',
                                      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
                                    }}
                                    showLineNumbers
                                    wrapLines={false}
                                    wrapLongLines={false}
                                    PreTag="pre"
                                    codeTagProps={{
                                      style: {
                                        whiteSpace: 'pre',
                                        wordBreak: 'normal',
                                        overflowWrap: 'normal',
                                      }
                                    }}
                                  >
                                    {formatCode(generatedWebsite.viteConfig.viteConfig, 'js')}
                                  </SyntaxHighlighter>
                                )}
                                {activeTab === 'package' && generatedWebsite.viteConfig?.packageJson && (
                                  <SyntaxHighlighter
                                    language="json"
                                    style={vscDarkPlus}
                                    customStyle={{
                                      margin: 0,
                                      borderRadius: 0,
                                      fontSize: '0.875rem',
                                      lineHeight: '1.6',
                                      height: '100%',
                                      minHeight: '100%',
                                      padding: '1rem',
                                      whiteSpace: 'pre',
                                      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
                                    }}
                                    showLineNumbers
                                    wrapLines={false}
                                    wrapLongLines={false}
                                    PreTag="pre"
                                    codeTagProps={{
                                      style: {
                                        whiteSpace: 'pre',
                                        wordBreak: 'normal',
                                        overflowWrap: 'normal',
                                      }
                                    }}
                                  >
                                    {formatJson(generatedWebsite.viteConfig.packageJson)}
                                  </SyntaxHighlighter>
                                )}
                              </div>
                            </div>
                          </>
                        ) : (
                          // Legacy HTML/CSS/JS tabs
                          <>
                        <div className="flex border-b bg-muted/30">
                          <button
                            onClick={() => setActiveTab('html')}
                            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                              activeTab === 'html'
                                ? 'border-accent text-accent bg-background'
                                : 'border-transparent text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            index.html
                          </button>
                          <button
                            onClick={() => setActiveTab('css')}
                            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                              activeTab === 'css'
                                ? 'border-accent text-accent bg-background'
                                : 'border-transparent text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            styles.css
                          </button>
                          <button
                            onClick={() => setActiveTab('js')}
                            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                              activeTab === 'js'
                                ? 'border-accent text-accent bg-background'
                                : 'border-transparent text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            script.js
                          </button>
                        </div>
                        <div className="flex-1 overflow-auto min-w-0">
                          <div className="rounded-lg overflow-hidden border h-full">
                            {activeTab === 'html' && (
                              <SyntaxHighlighter
                                language="html"
                                style={vscDarkPlus}
                                customStyle={{
                                  margin: 0,
                                  borderRadius: 0,
                                  fontSize: '0.875rem',
                                  lineHeight: '1.6',
                                  height: '100%',
                                  minHeight: '100%',
                                  padding: '1rem',
                                  whiteSpace: 'pre',
                                  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
                                }}
                                showLineNumbers
                                wrapLines={false}
                                wrapLongLines={false}
                                PreTag="pre"
                                codeTagProps={{
                                  style: {
                                    whiteSpace: 'pre',
                                    wordBreak: 'normal',
                                    overflowWrap: 'normal',
                                  }
                                }}
                              >
                                    {formatCode(generatedWebsite.htmlCode || '', 'html')}
                              </SyntaxHighlighter>
                            )}
                            {activeTab === 'css' && (
                              <SyntaxHighlighter
                                language="css"
                                style={vscDarkPlus}
                                customStyle={{
                                  margin: 0,
                                  borderRadius: 0,
                                  fontSize: '0.875rem',
                                  lineHeight: '1.6',
                                  height: '100%',
                                  minHeight: '100%',
                                  padding: '1rem',
                                  whiteSpace: 'pre',
                                  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
                                }}
                                showLineNumbers
                                wrapLines={false}
                                wrapLongLines={false}
                                PreTag="pre"
                                codeTagProps={{
                                  style: {
                                    whiteSpace: 'pre',
                                    wordBreak: 'normal',
                                    overflowWrap: 'normal',
                                  }
                                }}
                              >
                                    {formatCode(generatedWebsite.cssCode || '', 'css')}
                              </SyntaxHighlighter>
                            )}
                            {activeTab === 'js' && (
                              <SyntaxHighlighter
                                language="javascript"
                                style={vscDarkPlus}
                                customStyle={{
                                  margin: 0,
                                  borderRadius: 0,
                                  fontSize: '0.875rem',
                                  lineHeight: '1.6',
                                  height: '100%',
                                  minHeight: '100%',
                                  padding: '1rem',
                                  whiteSpace: 'pre',
                                  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
                                }}
                                showLineNumbers
                                wrapLines={false}
                                wrapLongLines={false}
                                PreTag="pre"
                                codeTagProps={{
                                  style: {
                                    whiteSpace: 'pre',
                                    wordBreak: 'normal',
                                    overflowWrap: 'normal',
                                  }
                                }}
                              >
                                    {formatCode(generatedWebsite.jsCode || '', 'js')}
                              </SyntaxHighlighter>
                            )}
                          </div>
                        </div>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="flex-1 overflow-hidden h-full flex flex-col min-h-0 min-w-0">
                        {(() => {
                          const usesArtifactPipeline =
                            generatedWebsite.framework === 'react' || generatedWebsite.framework === 'html';
                          const artifactPending =
                            usesArtifactPipeline &&
                            (generatedWebsite.reactBuildStatus === 'queued' ||
                              generatedWebsite.reactBuildStatus === 'building');
                          const showPreviewLoader = editLoading || rebuildLoading || artifactPending;

                          if (showPreviewLoader) {
                            const isHtml = generatedWebsite.framework === 'html';
                            return (
                              <GeneratingLoader
                                variant="building"
                                title={
                                  artifactPending
                                    ? isHtml
                                      ? 'Publishing preview...'
                                      : 'Building preview...'
                                    : editLoading
                                      ? 'Applying edit...'
                                      : isHtml
                                        ? 'Publishing preview...'
                                        : 'Building preview...'
                                }
                                subtitle={
                                  artifactPending
                                    ? isHtml
                                      ? 'Uploading static preview artifact'
                                      : 'Running npm install, Vite build, and artifact upload'
                                    : editLoading
                                      ? 'Updating project files from your edit'
                                      : isHtml
                                        ? 'Uploading static preview artifact'
                                        : 'Running npm install, Vite build, and artifact upload'
                                }
                              />
                            );
                          }

                          if (
                            usesArtifactPipeline &&
                            generatedWebsite.reactBuildStatus === 'failed' &&
                            !generatedWebsite.reactArtifactUrl &&
                            !generatedWebsite.v0DemoUrl
                          ) {
                            return (
                              <div className="h-full min-h-[600px] border rounded-xl p-6 bg-muted/20 overflow-auto">
                                <h3 className="text-lg font-semibold mb-2">Preview build failed</h3>
                                <p className="text-sm">
                                  Status: <span className="font-medium">{generatedWebsite.reactBuildStatus}</span>
                                </p>
                                <div className="mt-4">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleRebuildPreview}
                                    disabled={rebuildLoading}
                                    className="gap-2"
                                    title="Rebuild preview from saved code (no extra v0 credits)"
                                  >
                                    <RotateCw className={`h-4 w-4 ${rebuildLoading ? 'animate-spin' : ''}`} />
                                    {rebuildLoading ? 'Rebuilding...' : 'Rebuild Preview'}
                                  </Button>
                                </div>
                                {generatedWebsite.reactBuildLog ? (
                                  <pre className="mt-4 text-xs bg-background border rounded p-3 whitespace-pre-wrap">
                                    {generatedWebsite.reactBuildLog.slice(-4000)}
                                  </pre>
                                ) : null}
                              </div>
                            );
                          }

                          return (
                            previewDevice === 'mobile' ? (
                              <MobilePreviewStudio
                              >
                                <WebsitePreview
                                  html={generatedWebsite.htmlCode}
                                  css={generatedWebsite.cssCode}
                                  js={generatedWebsite.jsCode}
                                  components={generatedWebsite.components}
                                  viteConfig={generatedWebsite.viteConfig}
                                  websiteName={generatedWebsite.websiteName}
                                  v0DemoUrl={generatedWebsite.v0DemoUrl}
                                  artifactUrl={generatedWebsite.reactArtifactUrl}
                                  prompt={generatedWebsite.prompt}
                                  className="h-full min-h-0 rounded-none border-0 shadow-none"
                                  hideToolbar
                                  deviceMode="mobile"
                                />
                              </MobilePreviewStudio>
                            ) : (
                              <WebsitePreview
                                html={generatedWebsite.htmlCode}
                                css={generatedWebsite.cssCode}
                                js={generatedWebsite.jsCode}
                                components={generatedWebsite.components}
                                viteConfig={generatedWebsite.viteConfig}
                                websiteName={generatedWebsite.websiteName}
                                v0DemoUrl={generatedWebsite.v0DemoUrl}
                                artifactUrl={generatedWebsite.reactArtifactUrl}
                                prompt={generatedWebsite.prompt}
                                className="h-full min-h-[600px]"
                              />
                            )
                          );
                        })()}
                      </div>
                    )}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;

