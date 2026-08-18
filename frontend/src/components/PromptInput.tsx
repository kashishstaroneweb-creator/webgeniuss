import { useRef, useState } from 'react';
import { Check, Eye, Send, Paperclip, Wand2, Sparkles, Mic, LayoutTemplate, FileText, Image, X, Layers3, Monitor } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useVoiceRecognition } from '@/lib/useVoiceRecognition';
import { VoiceVisualizer } from '@/components/VoiceVisualizer';
import WebsitePreview from '@/components/WebsitePreview';

const suggestions = [
  'A modern SaaS landing page with clean light theme',
  'E-commerce product page with reviews',
  'Dashboard with analytics charts',
  'Portfolio website with animations',
];

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export interface WebsiteTemplate {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  category?: string;
  tags?: string[];
  framework?: 'next' | 'react' | 'html';
  prompt?: string;
  thumbnailUrl?: string;
  htmlCode?: string;
  cssCode?: string;
  jsCode?: string;
  components?: Array<{ name: string; type: string; path: string; code: string; language: string }>;
  viteConfig?: {
    packageJson?: string;
    viteConfig?: string;
    indexHtml?: string;
    mainJs?: string;
    mainJsx?: string;
    styleCss?: string;
  };
  v0DemoUrl?: string;
  reactArtifactUrl?: string;
  reactBuildStatus?: 'queued' | 'building' | 'ready' | 'failed';
  isFeatured?: boolean;
  isPremium?: boolean;
}

function normalizePreviewUrl(url?: string) {
  if (!url) return undefined;
  if (url.startsWith('/preview-artifacts')) return `${API_URL}${url}`;
  return url;
}

function TemplatePreview({ template }: { template: WebsiteTemplate }) {
  const hostedUrl = normalizePreviewUrl(template.reactArtifactUrl || template.v0DemoUrl);
  const theme = template.isFeatured
    ? 'from-emerald-400 via-cyan-400 to-sky-500'
    : 'from-zinc-700 via-emerald-500 to-teal-300';

  return (
    <div className="relative h-32 overflow-hidden rounded-xl border border-white/10 bg-zinc-950 shadow-inner">
      {template.thumbnailUrl ? (
        <img src={template.thumbnailUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : hostedUrl ? (
        <iframe
          src={hostedUrl}
          title={`${template.name} thumbnail`}
          className="absolute left-0 top-0 h-[400%] w-[400%] origin-top-left border-0 bg-white"
          style={{ transform: 'scale(0.25)' }}
          sandbox="allow-scripts allow-same-origin"
          tabIndex={-1}
        />
      ) : (
        <div className={`absolute inset-0 bg-gradient-to-br ${theme} opacity-75`} />
      )}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(255,255,255,0.55),transparent_24%),linear-gradient(to_bottom,rgba(0,0,0,0.1),rgba(0,0,0,0.62))]" />
      <div className="relative z-10 flex h-full flex-col p-3">
        <div className="mb-3 flex items-center justify-between">
          <div className="h-2.5 w-16 rounded-full bg-white/80" />
          <div className="flex gap-1">
            <span className="h-2 w-2 rounded-full bg-white/45" />
            <span className="h-2 w-2 rounded-full bg-white/45" />
            <span className="h-2 w-2 rounded-full bg-white/45" />
          </div>
        </div>

        {!hostedUrl && !template.thumbnailUrl ? (
          <div className="flex flex-1 flex-col justify-end">
            <div className="mb-2 h-4 w-3/4 rounded-full bg-white/85" />
            <div className="mb-4 h-2 w-1/2 rounded-full bg-white/45" />
            <div className="grid grid-cols-3 gap-2">
              <div className="h-8 rounded-lg bg-white/25" />
              <div className="h-8 rounded-lg bg-white/20" />
              <div className="h-8 rounded-lg bg-white/25" />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface PromptInputProps {
  prompt: string;
  setPrompt: (value: string) => void;
  onGenerate: (overridePrompt?: string) => void;
  framework: 'next' | 'react' | 'html';
  setFramework: (value: 'next' | 'react' | 'html') => void;
  fullStackMode?: boolean;
  setFullStackMode?: (value: boolean) => void;
  attachments?: { id: string; name: string; type?: string; size: number; dataUrl?: string }[];
  onAttachFiles?: (files: FileList) => void;
  onRemoveAttachment?: (id: string) => void;
  templates?: WebsiteTemplate[];
  selectedTemplate?: WebsiteTemplate | null;
  onSelectTemplate?: (template: WebsiteTemplate) => void;
  onClearTemplate?: () => void;
  loading?: boolean;
  disabled?: boolean;
}

export function PromptInput({
  prompt,
  setPrompt,
  onGenerate,
  framework,
  setFramework,
  fullStackMode = false,
  setFullStackMode,
  attachments = [],
  onAttachFiles,
  onRemoveAttachment,
  templates = [],
  selectedTemplate,
  onSelectTemplate,
  onClearTemplate,
  loading = false,
  disabled = false,
}: PromptInputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<WebsiteTemplate | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canGenerate = prompt.trim().length > 0 || attachments.some((file) => !!file.dataUrl);

  const handleVoiceEnd = (finalTranscript: string) => {
    // When Voice recognition ends, if we have text we auto-generate
    const trimmed = finalTranscript.trim();
    if (trimmed && !loading && !disabled) {
      onGenerate(trimmed);
    }
  };

  const { isListening, toggleListening } = useVoiceRecognition({
    onTranscriptChange: (text) => setPrompt(text),
    onEnd: handleVoiceEnd,
  });

  return (
    <div className="w-full max-w-3xl mx-auto">
      {/* Main Input Card */}
      <div
        className={cn(
          'relative rounded-[24px] border glass-card p-1 transition-all duration-300',
          isFocused ? 'border-accent shadow-lg shadow-accent/10' : 'border-border/50'
        )}
      >
        {/* Textarea */}
        <div className="relative">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder="Describe the website you want to create..."
            rows={4}
            disabled={disabled || loading}
            className="w-full resize-none rounded-xl bg-transparent px-4 py-4 text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
          />
          {attachments.length > 0 && (
            <div className="px-3 pb-2">
              <div className="flex flex-wrap gap-1.5 rounded-xl border border-emerald-400/15 bg-black/10 p-2 dark:bg-black/25">
                {attachments.map((file) =>
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
                        onClick={() => onRemoveAttachment?.(file.id)}
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
                      {file.type?.startsWith('image/') ? (
                        <Image className="h-3 w-3 shrink-0 text-emerald-300" />
                      ) : (
                        <FileText className="h-3 w-3 shrink-0 text-emerald-300" />
                      )}
                      <span className="max-w-[150px] truncate">{file.name}</span>
                      <span className="text-[10px] text-emerald-100/45">{Math.max(1, Math.round(file.size / 1024))}KB</span>
                      <button
                        type="button"
                        onClick={() => onRemoveAttachment?.(file.id)}
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
          {selectedTemplate ? (
            <div className="px-3 pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-sm">
                <span className="min-w-0 text-emerald-100">
                  Using template: <span className="font-medium">{selectedTemplate.name}</span>
                </span>
                <button
                  type="button"
                  onClick={onClearTemplate}
                  className="rounded-lg px-2 py-1 text-xs text-emerald-100/70 transition hover:bg-emerald-400/10 hover:text-white"
                >
                  Remove
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* Bottom Actions */}
        <div className="flex items-center justify-between px-3 pb-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || loading}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-all duration-200 hover:bg-secondary hover:text-foreground active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Paperclip className="h-4 w-4" />
              <span className="hidden sm:inline">Attach</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.txt,.md,.json,.csv,.html,.css,.js,.jsx,.ts,.tsx,.svg,.xml,.yml,.yaml"
              className="hidden"
              onChange={(event) => {
                if (event.target.files?.length) onAttachFiles?.(event.target.files);
                event.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => setShowTemplates((open) => !open)}
              disabled={disabled || loading}
              aria-pressed={showTemplates}
              className={cn(
                'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed',
                showTemplates
                  ? 'bg-accent/10 text-accent'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              )}
            >
              <Wand2 className="h-4 w-4" />
              <span className="hidden sm:inline">Templates</span>
            </button>
            <button
              type="button"
              onClick={toggleListening}
              disabled={disabled || loading}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed",
                isListening 
                  ? "bg-red-500/10 text-red-500 hover:bg-red-500/20" 
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              {isListening ? (
                <VoiceVisualizer isListening={isListening} />
              ) : (
                <>
                  <Mic className="h-4 w-4" />
                  <span className="hidden sm:inline">Voice</span>
                </>
              )}
            </button>
            <div className="flex items-center rounded-xl border border-border/70 bg-background/50 p-0.5 shadow-sm">
              <button
                type="button"
                onClick={() => setFullStackMode?.(false)}
                disabled={disabled || loading}
                aria-pressed={!fullStackMode}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all disabled:opacity-50',
                  !fullStackMode ? 'bg-secondary text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Monitor className="h-3.5 w-3.5" /> Frontend
              </button>
              <button
                type="button"
                onClick={() => {
                  setFullStackMode?.(true);
                  setFramework('react');
                }}
                disabled={disabled || loading}
                aria-pressed={fullStackMode}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all disabled:opacity-50',
                  fullStackMode
                    ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                )}
              >
                <Layers3 className="h-3.5 w-3.5" /> Full stack
              </button>
            </div>
            {!fullStackMode && <div className="flex items-center rounded-xl border border-border/70 bg-background/50 p-0.5 shadow-sm">
              <button
                type="button"
                onClick={() => setFramework('next')}
                disabled={disabled || loading}
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
                disabled={disabled || loading}
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
                disabled={disabled || loading}
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
            </div>}
          </div>

          <button
            type="button"
            onClick={() => onGenerate()}
            disabled={!canGenerate || loading || disabled}
            className={cn(
              'flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all duration-200',
              canGenerate && !loading && !disabled
                ? 'btn-gradient-border text-foreground hover:text-accent dark:text-green-300 dark:hover:text-green-200 active:scale-95'
                : 'bg-secondary text-muted-foreground cursor-not-allowed'
            )}
          >
            {loading ? (
              <>
                <Sparkles className="h-4 w-4 animate-spin text-green-400" />
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

      {showTemplates && !loading && !disabled && (
        <div className="mt-4 rounded-2xl border border-border/60 bg-card/80 p-3 shadow-sm">
          <div className="mb-3 flex items-center gap-2 px-1 text-sm font-medium text-foreground">
            <LayoutTemplate className="h-4 w-4 text-accent" />
            Choose a starting template
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templates.length === 0 ? (
              <div className="col-span-full rounded-xl border border-dashed border-border/70 bg-background/40 p-5 text-center text-sm text-muted-foreground">
                No published templates yet. Admins can publish generated websites as templates from the admin panel.
              </div>
            ) : templates.map((template) => (
              <div
                key={template.id}
                className={cn(
                  'group overflow-hidden rounded-2xl border bg-background/60 p-2 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/60 hover:bg-accent/5 hover:shadow-xl hover:shadow-emerald-950/20',
                  selectedTemplate?.id === template.id ? 'border-emerald-400/60 ring-1 ring-emerald-400/30' : 'border-border/60',
                )}
              >
                <button type="button" onClick={() => setPreviewTemplate(template)} className="block w-full text-left">
                  <TemplatePreview template={template} />
                </button>
                <span className="mt-2 flex items-center justify-between px-1">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">{template.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{template.category || template.framework || 'Website'}</span>
                  </span>
                  <span className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setPreviewTemplate(template)}
                      className="rounded-lg border border-border/60 p-1.5 text-muted-foreground transition hover:border-accent/50 hover:text-foreground"
                      title="Preview template"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectTemplate?.(template);
                        if (template.framework) setFramework(template.framework);
                        setShowTemplates(false);
                      }}
                      className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 p-1.5 text-emerald-300 transition hover:bg-emerald-400/15"
                      title="Use template"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {previewTemplate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-foreground">{previewTemplate.name}</h2>
                <p className="truncate text-xs text-muted-foreground">{previewTemplate.description || previewTemplate.category || 'Template preview'}</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onSelectTemplate?.(previewTemplate);
                    if (previewTemplate.framework) setFramework(previewTemplate.framework);
                    setPreviewTemplate(null);
                    setShowTemplates(false);
                  }}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-400"
                >
                  <Check className="h-4 w-4" />
                  Use Template
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewTemplate(null)}
                  className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 bg-background p-3">
              <WebsitePreview
                html={previewTemplate.htmlCode}
                css={previewTemplate.cssCode}
                js={previewTemplate.jsCode}
                components={previewTemplate.components}
                viteConfig={previewTemplate.viteConfig}
                websiteName={previewTemplate.name}
                prompt={previewTemplate.prompt || previewTemplate.description}
                v0DemoUrl={previewTemplate.v0DemoUrl}
                artifactUrl={previewTemplate.reactArtifactUrl}
                className="h-full"
              />
            </div>
          </div>
        </div>
      ) : null}

      {/* Suggestions */}
      {!loading && !disabled && (
        <div className="mt-4 flex flex-wrap gap-2">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => setPrompt(suggestion)}
              className="rounded-full border border-border/50 glass-panel px-4 py-2 text-sm text-muted-foreground transition-all duration-200 hover:border-accent/50 hover:bg-background/20 hover:text-foreground active:scale-95"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
