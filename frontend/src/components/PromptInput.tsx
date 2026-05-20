import { useState } from 'react';
import { Send, Paperclip, Wand2, Sparkles, Mic, LayoutTemplate } from 'lucide-react';
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
    prompt:
      'Create a polished SaaS landing page with a strong hero, product screenshots, feature sections, pricing cards, testimonials, FAQ, and a conversion-focused call to action. Make it responsive, modern, and trust-building.',
  },
  {
    name: 'Portfolio',
    prompt:
      'Create a personal portfolio website with a memorable hero, about section, selected projects, skills, experience timeline, testimonials, and contact section. Make it refined, responsive, and visually distinctive.',
  },
  {
    name: 'Restaurant',
    prompt:
      'Create a restaurant website with an appetizing hero, menu highlights, chef or story section, opening hours, gallery, reservation call to action, location details, and contact section. Make it warm, elegant, and mobile friendly.',
  },
  {
    name: 'E-commerce',
    prompt:
      'Create an e-commerce storefront with a product-focused hero, category tiles, featured products, reviews, benefits, newsletter signup, cart-style interactions, and a polished responsive layout.',
  },
  {
    name: 'Agency',
    prompt:
      'Create a creative agency website with a bold hero, services, case studies, process section, client logos, testimonials, team section, and contact call to action. Make it premium and conversion-focused.',
  },
  {
    name: 'Dashboard',
    prompt:
      'Create a modern analytics dashboard with stat cards, charts, recent activity, project table, filters, sidebar navigation, and responsive layouts for desktop and mobile.',
  },
  {
    name: 'Event Page',
    prompt:
      'Create an event landing page with a striking hero, date and venue details, speaker lineup, schedule, ticket tiers, sponsors, FAQ, and registration call to action. Make it energetic and responsive.',
  },
];

interface PromptInputProps {
  prompt: string;
  setPrompt: (value: string) => void;
  onGenerate: (overridePrompt?: string) => void;
  framework: 'next' | 'react' | 'html';
  setFramework: (value: 'next' | 'react' | 'html') => void;
  loading?: boolean;
  disabled?: boolean;
}

export function PromptInput({
  prompt,
  setPrompt,
  onGenerate,
  framework,
  setFramework,
  loading = false,
  disabled = false,
}: PromptInputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);

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
        </div>

        {/* Bottom Actions */}
        <div className="flex items-center justify-between px-3 pb-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={disabled || loading}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-all duration-200 hover:bg-secondary hover:text-foreground active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Paperclip className="h-4 w-4" />
              <span className="hidden sm:inline">Attach</span>
            </button>
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
            disabled={!prompt.trim() || loading || disabled}
            className={cn(
              'flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all duration-200',
              prompt.trim() && !loading && !disabled
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
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {templatePresets.map((template) => (
              <button
                key={template.name}
                type="button"
                onClick={() => {
                  setPrompt(template.prompt);
                  setShowTemplates(false);
                }}
                className="rounded-lg border border-border/60 bg-background/60 px-3 py-2.5 text-left transition-all duration-200 hover:border-accent/60 hover:bg-accent/5 active:scale-[0.99]"
              >
                <span className="block text-sm font-medium text-foreground">{template.name}</span>
                <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">
                  {template.prompt}
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
