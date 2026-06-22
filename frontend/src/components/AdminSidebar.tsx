import { Link, useSearchParams } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  ChevronLeft,
  Coins,
  LayoutTemplate,
  LogOut,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { useSidebarStore } from '@/store/sidebarStore';

const adminNavItems = [
  { icon: BarChart3, label: 'Overview', tab: 'overview' },
  { icon: Users, label: 'Users', tab: 'users' },
  { icon: Activity, label: 'Generations', tab: 'generations' },
  { icon: Coins, label: 'Credit Ledger', tab: 'ledger' },
  { icon: LayoutTemplate, label: 'Templates', tab: 'templates' },
] as const;

export function AdminSidebar() {
  const [searchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'overview';
  const { isCollapsed, toggle } = useSidebarStore();
  const { user, logout } = useAuthStore();

  const initials = (user?.name || 'Admin')
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <aside
      className={cn(
        'flex h-full flex-col overflow-hidden rounded-3xl border border-border/50 glass-panel transition-all duration-300',
        isCollapsed ? 'w-16' : 'w-64',
      )}
    >
      <div className={cn('flex h-16 items-center border-b border-sidebar-border transition-all duration-300', isCollapsed ? 'justify-center px-0' : 'justify-between px-4')}>
        {!isCollapsed && (
          <Link to="/admin" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent">
              <ShieldCheck className="h-4 w-4 text-accent-foreground" />
            </div>
            <span className="font-semibold text-sidebar-foreground">WebGenius</span>
          </Link>
        )}
        <button
          type="button"
          onClick={toggle}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'rounded-md p-1.5 text-muted-foreground transition-all duration-200 hover:bg-sidebar-accent hover:text-sidebar-foreground active:scale-95',
            isCollapsed && 'bg-sidebar-accent text-sidebar-foreground',
          )}
        >
          <ChevronLeft className={cn('h-4 w-4 transition-transform', isCollapsed && 'rotate-180')} />
        </button>
      </div>

      <div className="p-3">
        <Link
          to="/admin?tab=templates"
          title={isCollapsed ? 'Create Template' : undefined}
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 font-medium text-primary-foreground transition-all duration-200 hover:bg-primary/90 active:scale-95',
            isCollapsed ? 'px-2' : 'px-4',
          )}
        >
          <Sparkles className="h-4 w-4" />
          {!isCollapsed && <span>Create Template</span>}
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2">
        <div className="space-y-1">
          {adminNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.tab || (!searchParams.get('tab') && item.tab === 'overview');
            return (
              <Link
                key={item.tab}
                to={item.tab === 'overview' ? '/admin' : `/admin?tab=${item.tab}`}
                title={isCollapsed ? item.label : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-200',
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
                  isCollapsed && 'justify-center px-2',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!isCollapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <div
          className={cn('flex items-center gap-3 rounded-lg px-3 py-2', isCollapsed && 'justify-center px-2')}
          title={isCollapsed ? user?.name || 'Admin' : undefined}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/20 text-sm font-medium text-accent">
            {initials || 'A'}
          </div>
          {!isCollapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-sidebar-foreground">{user?.name || 'Admin'}</p>
              <p className="truncate text-xs text-muted-foreground">{user?.roleName || 'admin'}</p>
            </div>
          )}
        </div>
        {!isCollapsed && (
          <button
            type="button"
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
