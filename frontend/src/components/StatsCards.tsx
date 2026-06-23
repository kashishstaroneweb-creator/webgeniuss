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
  creditsRemaining = 0,
  avgTimeSaved = '8h',
}: StatsCardsProps) {
  const stats = [
    {
      label: 'Total Projects',
      value: totalProjects.toString(),
      change: '+3 this month',
      icon: Globe,
      accent: true,
    },
    {
      label: 'Generations',
      value: generations.toString(),
      change: '+12 this week',
      icon: Sparkles,
    },
    {
      label: 'Credits Used',
      value: creditsUsed.toString(),
      change: `${creditsRemaining} remaining`,
      icon: Zap,
    },
    {
      label: 'Avg. Time Saved',
      value: avgTimeSaved,
      change: 'Per project',
      icon: TrendingUp,
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 w-full max-w-4xl mx-auto mt-8">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <div
            key={stat.label}
            className={`rounded-xl border p-4 transition-all ${
              stat.accent
                ? 'border-accent/30 bg-accent/5'
                : 'border-border bg-card'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{stat.label}</span>
              <Icon
                className={`h-4 w-4 ${
                  stat.accent ? 'text-accent' : 'text-muted-foreground'
                }`}
              />
            </div>
            <div className="mt-2">
              <span className="text-2xl font-semibold text-foreground">
                {stat.value}
              </span>
              <p className="mt-1 text-xs text-muted-foreground">{stat.change}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
