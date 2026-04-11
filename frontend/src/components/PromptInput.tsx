import { useState } from 'react';
import { Send, Paperclip, Wand2, Sparkles, Mic, MicOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import Button from '@/components/ui/Button';
import { useVoiceRecognition } from '@/lib/useVoiceRecognition';

const suggestions = [
  'A modern SaaS landing page with dark theme',
  'E-commerce product page with reviews',
  'Dashboard with analytics charts',
  'Portfolio website with animations',
];

interface PromptInputProps {
  prompt: string;
  setPrompt: (value: string) => void;
  onGenerate: (overridePrompt?: string) => void;
  loading?: boolean;
  disabled?: boolean;
}

export function PromptInput({ prompt, setPrompt, onGenerate, loading = false, disabled = false }: PromptInputProps) {
  const [isFocused, setIsFocused] = useState(false);

  const handleVoiceEnd = (finalTranscript: string) => {
    // When Voice recognition ends, if we have text we auto-generate
    const trimmed = finalTranscript.trim();
    if (trimmed && !loading && !disabled) {
      onGenerate(trimmed);
    }
  };

  const { isListening, toggleListening, transcript } = useVoiceRecognition({
    onTranscriptChange: (text) => {
      // Append the incoming voice text to whatever prompt was already there, separated by a space maybe?
      // Since transcript represents the session, we should probably set prompt to text if they are speaking instead of typing,
      // But standard approach: just overwrite or append? The hook's transcript is the full transcribed text for the session.
      // Easiest is to overwrite current prompt with transcript if voice is active. To allow typing before speaking, 
      // we'd have to manage it more carefully. Let's just set the prompt to the current transcript for simplicity.
      setPrompt(text);
    },
    onEnd: handleVoiceEnd,
    continuous: false // Wait, if continuous is false, it stops after one phrase. We can set it to false for simple commands.
  });

  return (
    <div className="w-full max-w-3xl mx-auto">
      {/* Main Input Card */}
      <div
        className={cn(
          'relative rounded-2xl border bg-card p-1 transition-all duration-300',
          isFocused ? 'border-accent shadow-lg shadow-accent/10' : 'border-border'
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
              <Mic className={cn("h-4 w-4", isListening && "animate-pulse")} />
              <span className="hidden sm:inline">{isListening ? "Listening..." : "Voice"}</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onGenerate}
            disabled={!prompt.trim() || loading || disabled}
            className={cn(
              'flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all duration-200',
              prompt.trim() && !loading && !disabled
                ? 'bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95'
                : 'bg-secondary text-muted-foreground cursor-not-allowed'
            )}
          >
            {loading ? (
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

      {/* Suggestions */}
      {!loading && !disabled && (
        <div className="mt-4 flex flex-wrap gap-2">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => setPrompt(suggestion)}
              className="rounded-full border border-border bg-card/50 px-4 py-2 text-sm text-muted-foreground transition-all duration-200 hover:border-accent/50 hover:bg-card hover:text-foreground active:scale-95"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
