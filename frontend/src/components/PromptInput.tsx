import { useState } from 'react';
import { Send, Paperclip, Wand2, Sparkles, Mic } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useVoiceRecognition } from '@/lib/useVoiceRecognition';
import { VoiceVisualizer } from '@/components/VoiceVisualizer';

const suggestions = [
  'A modern SaaS landing page with clean light theme',
  'E-commerce product page with reviews',
  'Dashboard with analytics charts',
  'Portfolio website with animations',
];

interface PromptInputProps {
  prompt: string;
  setPrompt: (value: string) => void;
  onGenerate: (overridePrompt?: string) => void;
  framework: 'next' | 'react';
  setFramework: (value: 'next' | 'react') => void;
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
              disabled={disabled || loading}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-all duration-200 hover:bg-secondary hover:text-foreground active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
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
            <div className="flex items-center rounded-lg border border-border/60 bg-background/30 p-0.5">
              <button
                type="button"
                onClick={() => setFramework('next')}
                disabled={disabled || loading}
                className={cn(
                  'rounded-md px-2 py-1 text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed',
                  framework === 'next'
                    ? 'bg-accent/20 text-accent'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                )}
              >
                Next.js
              </button>
              <button
                type="button"
                onClick={() => setFramework('react')}
                disabled={disabled || loading}
                className={cn(
                  'rounded-md px-2 py-1 text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed',
                  framework === 'react'
                    ? 'bg-accent/20 text-accent'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                )}
              >
                React
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
