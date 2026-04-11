import { Bell, Search, Command } from 'lucide-react';
import Button from '@/components/ui/Button';
import ThemeToggle from '@/components/ThemeToggle';
import { useAuthStore } from '@/store/authStore';

export function AppHeader() {
  const { user } = useAuthStore();

  return (
    <header className="flex h-16 items-center justify-between border border-border/50 glass-panel px-6 rounded-3xl shrink-0">
      {/* Search */}
      <div className="flex flex-1 items-center gap-4">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search projects..."
            className="h-10 w-full rounded-lg border border-border bg-input pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground transition-all duration-200 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1 text-xs text-muted-foreground">
            <Command className="h-3 w-3" />
            <span>K</span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="relative text-muted-foreground hover:text-foreground"
        >
          <Bell className="h-5 w-5" />
          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-accent" />
        </Button>
        <div className="h-8 w-px bg-border" />
        <Button
          variant="outline"
          size="sm"
          className="gap-2 border-border bg-transparent transition-all duration-200"
        >
          <span className="h-2 w-2 rounded-full bg-accent" />
          <span>5 Credits</span>
        </Button>
        <ThemeToggle />
      </div>
    </header>
  );
}
