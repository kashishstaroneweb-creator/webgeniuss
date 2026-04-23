import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

const ThemeToggle = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = savedTheme || (prefersDark ? 'dark' : 'light');
    setTheme(initialTheme);
    document.documentElement.classList.toggle('dark', initialTheme === 'dark');
  }, []);

  const toggleTheme = () => {
    setIsAnimating(true);
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    document.documentElement.classList.toggle('dark', newTheme === 'dark');
    
    // Reset animation state after transition
    setTimeout(() => setIsAnimating(false), 300);
  };

  return (
    <button
      onClick={toggleTheme}
      className="relative group"
      aria-label="Toggle theme"
    >
      {/* Animated toggle switch container */}
      <div className="relative w-10 h-6 rounded-full transition-all duration-200 ease-in-out
                      bg-accent/20 border border-accent/30
                      hover:bg-accent/30
                      active:scale-95">
        
        {/* Toggle circle with icon */}
        <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-all duration-200 ease-in-out
                        flex items-center justify-center
                        bg-accent
                        shadow-sm transform
                        ${theme === 'dark' ? 'translate-x-4' : 'translate-x-0'}
                        ${isAnimating ? 'scale-110' : 'scale-100'}`}>
          
          {/* Icon container with rotation animation */}
          <div className={`transition-all duration-200 ${
            isAnimating ? 'rotate-180 scale-110' : 'rotate-0 scale-100'
          }`}>
            {theme === 'light' ? (
              <Sun className="h-3 w-3 text-accent-foreground" />
            ) : (
              <Moon className="h-3 w-3 text-accent-foreground" />
            )}
          </div>
        </div>
      </div>

      {/* Tooltip */}
      <div className="absolute -bottom-8 left-1/2 transform -translate-x-1/2
                      opacity-0 group-hover:opacity-100 transition-opacity duration-200
                      pointer-events-none whitespace-nowrap
                      bg-card border border-border text-foreground
                      text-xs px-2 py-1 rounded-md shadow-sm">
        {theme === 'light' ? 'Switch to Dark' : 'Switch to Light'}
      </div>
    </button>
  );
};

export default ThemeToggle;

