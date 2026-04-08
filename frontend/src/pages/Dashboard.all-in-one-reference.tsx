/**
 * All-in-one dashboard reference file.
 * This file contains Dashboard.tsx and its reusable component code in one place.
 * Note: This is a reference file for reading/editing convenience.
 */

import Dashboard from './Dashboard';

export default Dashboard;

/*
================================================================================
SOURCE: frontend/src/pages/Dashboard.tsx
================================================================================
See: ./Dashboard.tsx

================================================================================
SOURCE: frontend/src/components/PromptInput.tsx
================================================================================
import { useState } from 'react';
import { Send, Paperclip, Wand2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import Button from '@/components/ui/Button';

const suggestions = [
  'A modern SaaS landing page with dark theme',
  'E-commerce product page with reviews',
  'Dashboard with analytics charts',
  'Portfolio website with animations',
];

interface PromptInputProps {
  prompt: string;
  setPrompt: (value: string) => void;
  onGenerate: () => void;
  loading?: boolean;
  disabled?: boolean;
}

export function PromptInput({ prompt, setPrompt, onGenerate, loading = false, disabled = false }: PromptInputProps) {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div
        className={cn(
          'relative rounded-2xl border bg-card p-1 transition-all duration-300',
          isFocused ? 'border-accent shadow-lg shadow-accent/10' : 'border-border'
        )}
      >
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

================================================================================
SOURCE: frontend/src/components/StatsCards.tsx
================================================================================
import { Sparkles, Globe, Zap, TrendingUp } from 'lucide-react';

interface StatsCardsProps {
  totalProjects?: number;
  generations?: number;
  creditsUsed?: number;
  creditsRemaining?: number;
  avgTimeSaved?: string;
}

export function StatsCards({
  totalProjects = 0,
  generations = 0,
  creditsUsed = 0,
  creditsRemaining = 5,
  avgTimeSaved = '8h',
}: StatsCardsProps) {
  const stats = [
    { label: 'Total Projects', value: totalProjects.toString(), change: '+3 this month', icon: Globe, accent: true },
    { label: 'Generations', value: generations.toString(), change: '+12 this week', icon: Sparkles },
    { label: 'Credits Used', value: creditsUsed.toString(), change: `${creditsRemaining} remaining`, icon: Zap },
    { label: 'Avg. Time Saved', value: avgTimeSaved, change: 'Per project', icon: TrendingUp },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 w-full max-w-4xl mx-auto mt-8">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <div
            key={stat.label}
            className={`rounded-xl border p-4 transition-all ${stat.accent ? 'border-accent/30 bg-accent/5' : 'border-border bg-card'}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{stat.label}</span>
              <Icon className={`h-4 w-4 ${stat.accent ? 'text-accent' : 'text-muted-foreground'}`} />
            </div>
            <div className="mt-2">
              <span className="text-2xl font-semibold text-foreground">{stat.value}</span>
              <p className="mt-1 text-xs text-muted-foreground">{stat.change}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

================================================================================
SOURCE: frontend/src/components/RecentProjects.tsx
================================================================================
import { ExternalLink, MoreHorizontal, Clock, Globe } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import api from '@/lib/api';

interface Project {
  id: string;
  websiteName: string;
  createdAt: string;
  status?: string;
}

const gradients = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
];

const getTimeAgo = (dateString: string) => {
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffInSeconds < 60) return 'Just now';
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} minutes ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hours ago`;
  if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)} days ago`;
  return date.toLocaleDateString();
};

export function RecentProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const response = await api.get('/website/list');
        const websites = response.data || [];
        const recent = websites
          .sort((a: Project, b: Project) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 6)
          .map((website: Project, index: number) => ({ ...website, thumbnail: gradients[index % gradients.length] }));
        setProjects(recent);
      } catch (error) {
        console.error('Failed to fetch projects:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchProjects();
  }, []);

  if (loading) return <div className="mt-12 w-full max-w-4xl mx-auto"><h2 className="text-lg font-semibold text-foreground">Recent Projects</h2></div>;
  if (projects.length === 0) return <div className="mt-12 w-full max-w-4xl mx-auto"><p className="text-muted-foreground">No projects yet.</p></div>;

  return (
    <div className="mt-12 w-full max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-foreground">Recent Projects</h2>
        <Link to="/history" className="text-sm text-muted-foreground hover:text-accent transition-colors">View all</Link>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <div key={project.id} className="group relative rounded-xl border border-border bg-card p-4 transition-all hover:border-accent/50">
            <div className="mb-4 h-32 w-full rounded-lg" style={{ background: (project as any).thumbnail || gradients[0] }} />
            <div className="space-y-2">
              <div className="flex items-start justify-between">
                <h3 className="font-medium text-foreground">{project.websiteName}</h3>
                <button type="button" className="rounded-md p-1 text-muted-foreground opacity-0 transition-all hover:bg-secondary hover:text-foreground group-hover:opacity-100">
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </div>
              <p className="text-sm text-muted-foreground">Generated website</p>
              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock className="h-3 w-3" /><span>{getTimeAgo(project.createdAt)}</span></div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs bg-accent/20 text-accent"><Globe className="h-3 w-3" />Published</span>
                  <Link to="/history" className="rounded-md p-1 text-muted-foreground transition-all duration-200 hover:bg-secondary hover:text-foreground active:scale-95">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

================================================================================
SOURCE: frontend/src/components/GeneratingLoader.tsx
================================================================================
import React, { useState, useEffect } from 'react';

const COOL_GIF = 'https://media1.tenor.com/m/LSDeBe2JAfoAAAAd/cat-coding.gif';

const CODE_LINES = [
  { text: 'const website = await ai.generate();', type: 'js' },
  { text: '<div className="your-site">...</div>', type: 'html' },
  { text: '.hero { background: var(--accent); }', type: 'css' },
  { text: '// Our AI (and this legend) are on it 🐱', type: 'comment' },
];

export interface GeneratingLoaderProps {
  title?: string;
  subtitle?: string;
  variant?: 'generating' | 'building';
}

export function GeneratingLoader({ title, subtitle, variant = 'generating' }: GeneratingLoaderProps) {
  const [codeIndex, setCodeIndex] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setCodeIndex((i) => (i + 1) % CODE_LINES.length), 1200);
    return () => clearInterval(t);
  }, []);

  const displayTitle = title ?? (variant === 'building' ? 'Building preview...' : 'Generating your website...');
  const displaySubtitle = subtitle ?? (variant === 'building' ? 'Running npm install & vite build' : 'Our AI is crafting your site with care');

  return (
    <div className="flex-1 flex items-center justify-center min-h-[380px] p-4">
      <div className="text-center space-y-6 max-w-lg mx-auto">
        <div className="flex justify-center [isolation:isolate]">
          <img src={COOL_GIF} alt="Cat coding" className="w-[320px] h-auto max-h-[220px] object-contain drop-shadow-2xl mix-blend-multiply" />
        </div>
        <div className="rounded-xl bg-[#0d1117] border border-border overflow-hidden text-left">
          <div className="px-3 py-2.5 font-mono text-xs min-h-[44px] flex items-center">
            <span className="text-muted-foreground select-none">$ </span>
            <span className="inline-block ml-1 text-green-400">{CODE_LINES[codeIndex].text}</span>
          </div>
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-semibold">{displayTitle}</h3>
          <p className="text-sm text-muted-foreground">{displaySubtitle}</p>
        </div>
      </div>
    </div>
  );
}

================================================================================
SOURCE: frontend/src/components/ui/Button.tsx
================================================================================
import { ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'destructive' | 'secondary' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon' | 'icon-sm' | 'icon-lg';
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    return (
      <button
        data-slot="button"
        className={cn('inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-200', className)}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';
export default Button;

================================================================================
SOURCE: frontend/src/components/ui/Card.tsx
================================================================================
import { HTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';

const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} data-slot="card" className={cn('bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm', className)} {...props} />
));
Card.displayName = 'Card';

const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} data-slot="card-header" className={cn('grid auto-rows-min items-start gap-2 px-6', className)} {...props} />
));
CardHeader.displayName = 'CardHeader';

const CardTitle = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLHeadingElement>>(({ className, ...props }, ref) => (
  <div ref={ref} data-slot="card-title" className={cn('leading-none font-semibold', className)} {...props} />
));
CardTitle.displayName = 'CardTitle';

const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} data-slot="card-content" className={cn('px-6', className)} {...props} />
));
CardContent.displayName = 'CardContent';

export { Card, CardHeader, CardTitle, CardContent };

================================================================================
SOURCE: frontend/src/components/WebsitePreview.tsx
================================================================================
See: ../components/WebsitePreview.tsx
*/
