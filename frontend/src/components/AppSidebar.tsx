import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  User,
  History,
  CreditCard,
  Sparkles,
  ChevronLeft,
  ChevronDown,
  Plus,
  LogOut,
  MoreHorizontal,
} from 'lucide-react';
import { useSidebarStore } from '@/store/sidebarStore';
import { useAuthStore } from '@/store/authStore';
import api from '@/lib/api';

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', href: '/dashboard' },
  { icon: History, label: 'History', href: '/history' },
  { icon: User, label: 'Profile', href: '/profile' },
  { icon: CreditCard, label: 'Billing', href: '/subscription' },
];

const INITIAL_RECENTS = 5;
const SHOW_MORE_COUNT = 5;

interface RecentWebsite {
  id: string;
  websiteName: string;
  prompt?: string;
  createdAt: string;
}

export function AppSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isCollapsed, toggle } = useSidebarStore();
  const { user, logout } = useAuthStore();
  const [recents, setRecents] = useState<RecentWebsite[]>([]);
  const [recentsVisible, setRecentsVisible] = useState(INITIAL_RECENTS);
  const [recentsExpanded, setRecentsExpanded] = useState(true);
  const [recentsLoading, setRecentsLoading] = useState(false);

  useEffect(() => {
    const fetchRecents = async () => {
      setRecentsLoading(true);
      try {
        const res = await api.get('/website/list');
        const list = Array.isArray(res.data) ? res.data : [];
        setRecents(list);
        setRecentsVisible(INITIAL_RECENTS);
      } catch {
        setRecents([]);
      } finally {
        setRecentsLoading(false);
      }
    };
    fetchRecents();
  }, []);

  const visibleRecents = recents.slice(0, recentsVisible);
  const hasMoreRecents = recents.length > recentsVisible;

  const handleShowMoreRecents = () => {
    setRecentsVisible((prev) => prev + SHOW_MORE_COUNT);
  };

  const handleRecentClick = (websiteId: string) => {
    navigate(`/dashboard?website=${websiteId}`);
  };

  const truncateTitle = (title: string, maxLen = 22) => {
    if (!title) return 'New Conversation';
    return title.length > maxLen ? title.slice(0, maxLen) + '...' : title;
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <aside
      className={cn(
        'flex h-full flex-col border border-border/50 glass-panel transition-all duration-300 rounded-3xl overflow-hidden',
        isCollapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Logo */}
      <div className={cn("flex h-16 items-center border-b border-sidebar-border transition-all duration-300", isCollapsed ? "justify-center px-0" : "justify-between px-4")}>
        {!isCollapsed && (
          <Link
            to="/dashboard"
            className="flex items-center gap-2"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent">
              <Sparkles className="h-4 w-4 text-accent-foreground" />
            </div>
            <span className="font-semibold text-sidebar-foreground">WebGenius</span>
          </Link>
        )}
        <button
          type="button"
          onClick={toggle}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            "rounded-md p-1.5 text-muted-foreground transition-all duration-200 hover:bg-sidebar-accent hover:text-sidebar-foreground active:scale-95",
            isCollapsed && "bg-sidebar-accent text-sidebar-foreground"
          )}
        >
          <ChevronLeft
            className={cn(
              'h-4 w-4 transition-transform',
              isCollapsed && 'rotate-180'
            )}
          />
        </button>
      </div>

      {/* New Project Button */}
      <div className="p-3">
        <Link
          to="/dashboard"
          title={isCollapsed ? 'New Project' : undefined}
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 font-medium text-primary-foreground transition-all duration-200 hover:bg-primary/90 active:scale-95',
            isCollapsed ? 'px-2' : 'px-4'
          )}
        >
          <Plus className="h-4 w-4" />
          {!isCollapsed && <span>New Project</span>}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-hidden flex flex-col">
        <div className="space-y-1 px-3 py-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.href;
            return (
              <Link
                key={item.label}
                to={item.href}
                title={isCollapsed ? item.label : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-200',
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
                  isCollapsed && 'justify-center px-2'
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!isCollapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </div>

        {/* Recents */}
        {!isCollapsed && (
          <div className="flex-1 min-h-0 overflow-y-auto border-t border-sidebar-border px-3 py-3">
            <button
              type="button"
              onClick={() => setRecentsExpanded(!recentsExpanded)}
              className="flex w-full items-center gap-2 rounded-lg py-1.5 text-left text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent/50 transition-all duration-200"
            >
              <span>Recents</span>
              <ChevronDown
                className={cn(
                  'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                  !recentsExpanded && 'rotate-[-90deg]'
                )}
              />
            </button>
            {recentsExpanded && (
              <>
                {recentsLoading ? (
                  <p className="py-2 text-xs text-muted-foreground">Loading...</p>
                ) : visibleRecents.length === 0 ? (
                  <p className="py-2 text-xs text-muted-foreground">No recents yet</p>
                ) : (
                  <ul className="mt-1 space-y-0.5">
                    {visibleRecents.map((site) => (
                      <li key={site.id}>
                        <button
                          type="button"
                          onClick={() => handleRecentClick(site.id)}
                          className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm text-sidebar-foreground transition-all duration-200 hover:bg-sidebar-accent/50 active:scale-[0.99]"
                        >
                          <span
                            className="h-8 w-8 shrink-0 rounded-full border-2 border-dashed border-muted-foreground/50 bg-transparent"
                            aria-hidden
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {truncateTitle(site.websiteName || site.prompt || 'New Conversation')}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {recentsExpanded && hasMoreRecents && (
                  <button
                    type="button"
                    onClick={handleShowMoreRecents}
                    className="mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-all duration-200"
                  >
                    <MoreHorizontal className="h-4 w-4 shrink-0" />
                    <span>Show More</span>
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </nav>

      {/* User Section */}
      <div className="border-t border-sidebar-border p-3">
        <div
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2',
            isCollapsed && 'justify-center px-2'
          )}
          title={isCollapsed ? user?.name || 'User' : undefined}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/20 text-sm font-medium text-accent">
            {user?.name ? getInitials(user.name) : 'U'}
          </div>
          {!isCollapsed && (
            <div className="flex-1 overflow-hidden">
              <p className="truncate text-sm font-medium text-sidebar-foreground">
                {user?.name || 'User'}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {user?.subscriptionPlan || 'Free Plan'}
              </p>
            </div>
          )}
        </div>
        {!isCollapsed && (
          <button
            onClick={logout}
            className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-all duration-200 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground active:scale-95"
          >
            <LogOut className="h-4 w-4" />
            <span>Logout</span>
          </button>
        )}
      </div>
    </aside>
  );
}
