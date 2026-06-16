import { useRef, useState } from 'react';
import { Send, Paperclip, Wand2, Sparkles, Mic, LayoutTemplate, FileText, Image, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useVoiceRecognition } from '@/lib/useVoiceRecognition';
import { VoiceVisualizer } from '@/components/VoiceVisualizer';

const suggestions = [
  'A modern SaaS landing page with clean light theme',
  'E-commerce product page with reviews',
  'Dashboard with analytics charts',
  'Portfolio website with animations',
];

const templatePresets = [
  {
    name: 'SaaS Landing',
    theme: 'from-sky-500 via-emerald-400 to-lime-300',
    prompt:
      'Create a polished SaaS landing page with a strong hero, product screenshots, feature sections, pricing cards, testimonials, FAQ, and a conversion-focused call to action. Make it responsive, modern, and trust-building.',
  },
  {
    name: 'Portfolio',
    theme: 'from-fuchsia-500 via-violet-500 to-cyan-300',
    prompt:
      'Create a personal portfolio website with a memorable hero, about section, selected projects, skills, experience timeline, testimonials, and contact section. Make it refined, responsive, and visually distinctive.',
  },
  {
    name: 'Restaurant',
    theme: 'from-amber-400 via-red-400 to-rose-500',
    prompt:
      'Create a restaurant website with an appetizing hero, menu highlights, chef or story section, opening hours, gallery, reservation call to action, location details, and contact section. Make it warm, elegant, and mobile friendly.',
  },
  {
    name: 'E-commerce',
    theme: 'from-emerald-400 via-teal-400 to-blue-500',
    prompt:
      'Create an e-commerce storefront with a product-focused hero, category tiles, featured products, reviews, benefits, newsletter signup, cart-style interactions, and a polished responsive layout.',
  },
  {
    name: 'Agency',
    theme: 'from-orange-400 via-pink-500 to-indigo-500',
    prompt:
      'Create a creative agency website with a bold hero, services, case studies, process section, client logos, testimonials, team section, and contact call to action. Make it premium and conversion-focused.',
  },
  {
    name: 'Dashboard',
    theme: 'from-green-400 via-emerald-500 to-slate-700',
    prompt:
      'Create a modern analytics dashboard with stat cards, charts, recent activity, project table, filters, sidebar navigation, and responsive layouts for desktop and mobile.',
  },
  {
    name: 'Event Page',
    theme: 'from-yellow-300 via-orange-400 to-purple-500',
    prompt:
      'Create an event landing page with a striking hero, date and venue details, speaker lineup, schedule, ticket tiers, sponsors, FAQ, and registration call to action. Make it energetic and responsive.',
  },
];

function TemplatePreview({ theme, variant }: { theme: string; variant: string }) {
  const isDashboard = variant === 'Dashboard';
  const isEcommerce = variant === 'E-commerce';
  const isPortfolio = variant === 'Portfolio';

  return (
    <div className="relative h-32 overflow-hidden rounded-xl border border-white/10 bg-zinc-950 shadow-inner">
      <div className={`absolute inset-0 bg-gradient-to-br ${theme} opacity-75`} />
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

        {isDashboard ? (
          <div className="grid flex-1 grid-cols-[0.7fr_1fr] gap-2">
            <div className="rounded-lg bg-black/35 p-2">
              <div className="mb-2 h-2 w-10 rounded bg-white/45" />
              <div className="space-y-1.5">
                <div className="h-1.5 rounded bg-white/25" />
                <div className="h-1.5 rounded bg-white/25" />
                <div className="h-1.5 w-2/3 rounded bg-white/25" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-white/25" />
              <div className="rounded-lg bg-white/20" />
              <div className="col-span-2 rounded-lg bg-black/25" />
            </div>
          </div>
        ) : isEcommerce ? (
          <div className="grid flex-1 grid-cols-3 gap-2">
            {[0, 1, 2].map((item) => (
              <div key={item} className="rounded-lg bg-white/24 p-1.5">
                <div className="mb-2 aspect-square rounded-md bg-black/25" />
                <div className="h-1.5 rounded bg-white/50" />
              </div>
            ))}
          </div>
        ) : isPortfolio ? (
          <div className="flex flex-1 items-end gap-3">
            <div className="h-16 w-16 rounded-2xl bg-white/65" />
            <div className="flex-1 space-y-2 pb-2">
              <div className="h-3 w-4/5 rounded-full bg-white/85" />
              <div className="h-2 w-3/5 rounded-full bg-white/45" />
              <div className="h-7 w-20 rounded-full bg-black/35" />
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col justify-end">
            <div className="mb-2 h-4 w-3/4 rounded-full bg-white/85" />
            <div className="mb-4 h-2 w-1/2 rounded-full bg-white/45" />
            <div className="grid grid-cols-3 gap-2">
              <div className="h-8 rounded-lg bg-white/25" />
              <div className="h-8 rounded-lg bg-white/20" />
              <div className="h-8 rounded-lg bg-white/25" />
            </div>
          </div>
        )}
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
  attachments?: { id: string; name: string; type?: string; size: number; dataUrl?: string }[];
  onAttachFiles?: (files: FileList) => void;
  onRemoveAttachment?: (id: string) => void;
  loading?: boolean;
  disabled?: boolean;
}

export function PromptInput({
  prompt,
  setPrompt,
  onGenerate,
  framework,
  setFramework,
  attachments = [],
  onAttachFiles,
  onRemoveAttachment,
  loading = false,
  disabled = false,
}: PromptInputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
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
            </div>
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
            {templatePresets.map((template) => (
              <button
                key={template.name}
                type="button"
                onClick={() => {
                  setPrompt(template.prompt);
                  setShowTemplates(false);
                }}
                className="group overflow-hidden rounded-2xl border border-border/60 bg-background/60 p-2 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/60 hover:bg-accent/5 hover:shadow-xl hover:shadow-emerald-950/20 active:scale-[0.99]"
              >
                <TemplatePreview theme={template.theme} variant={template.name} />
                <span className="mt-2 flex items-center justify-between px-1">
                  <span className="text-sm font-medium text-foreground">{template.name}</span>
                  <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300 opacity-0 transition-opacity group-hover:opacity-100">
                    Use
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

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
