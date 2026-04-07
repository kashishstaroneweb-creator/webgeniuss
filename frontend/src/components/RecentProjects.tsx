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
        // Get the 6 most recent projects
        const recent = websites
          .sort((a: Project, b: Project) => 
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          )
          .slice(0, 6)
          .map((website: Project, index: number) => ({
            ...website,
            thumbnail: gradients[index % gradients.length],
          }));
        setProjects(recent);
      } catch (error) {
        console.error('Failed to fetch projects:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchProjects();
  }, []);

  if (loading) {
    return (
      <div className="mt-12 w-full max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-foreground">Recent Projects</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-xl border border-border bg-card p-4 animate-pulse"
            >
              <div className="mb-4 h-32 w-full rounded-lg bg-muted" />
              <div className="h-4 bg-muted rounded w-3/4 mb-2" />
              <div className="h-3 bg-muted rounded w-1/2" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="mt-12 w-full max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-foreground">Recent Projects</h2>
          <Link
            to="/history"
            className="text-sm text-muted-foreground hover:text-accent transition-colors"
          >
            View all
          </Link>
        </div>
        <div className="text-center py-12 text-muted-foreground">
          <p>No projects yet. Create your first website!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-12 w-full max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-foreground">Recent Projects</h2>
        <Link
          to="/history"
          className="text-sm text-muted-foreground hover:text-accent transition-colors"
        >
          View all
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <div
            key={project.id}
            className="group relative rounded-xl border border-border bg-card p-4 transition-all hover:border-accent/50 hover:shadow-lg hover:shadow-accent/5"
          >
            {/* Thumbnail */}
            <div
              className="mb-4 h-32 w-full rounded-lg"
              style={{ background: (project as any).thumbnail || gradients[0] }}
            />

            {/* Content */}
            <div className="space-y-2">
              <div className="flex items-start justify-between">
                <h3 className="font-medium text-foreground">{project.websiteName}</h3>
                <button
                  type="button"
                  className="rounded-md p-1 text-muted-foreground opacity-0 transition-all hover:bg-secondary hover:text-foreground group-hover:opacity-100"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </div>
              <p className="text-sm text-muted-foreground">Generated website</p>

              {/* Footer */}
              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span>{getTimeAgo(project.createdAt)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs bg-accent/20 text-accent">
                    <Globe className="h-3 w-3" />
                    Published
                  </span>
                  <Link
                    to="/history"
                    className="rounded-md p-1 text-muted-foreground transition-all duration-200 hover:bg-secondary hover:text-foreground active:scale-95"
                  >
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
