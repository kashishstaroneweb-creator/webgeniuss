import { Link, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { 
  LayoutDashboard, 
  User, 
  History, 
  CreditCard, 
  LogOut,
  Sparkles,
  Menu,
  X
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Button from '@/components/ui/Button';

const Sidebar = () => {
  const location = useLocation();
  const { logout } = useAuthStore();
  const { isCollapsed, toggle } = useSidebarStore();

  const menuItems = [
    { path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/profile', icon: User, label: 'Profile' },
    { path: '/history', icon: History, label: 'History' },
    { path: '/subscription', icon: CreditCard, label: 'Subscription' },
  ];

  return (
    <div className={cn(
      "h-screen border-r bg-card flex flex-col transition-all duration-300",
      isCollapsed ? "w-20" : "w-64"
    )}>
      <div className={cn("p-4 border-b", isCollapsed && "p-4")}>
        <div className={cn(
          "flex items-center gap-2",
          isCollapsed ? "flex-col justify-center" : "justify-between"
        )}>
          <Sparkles className="h-6 w-6 text-primary flex-shrink-0" />
          {!isCollapsed && <h1 className="text-xl font-bold">WebGenius</h1>}
          <Button
            variant="ghost"
            size="sm"
            onClick={toggle}
            className={cn(
              "h-8 w-8 p-0",
              isCollapsed && "mt-2"
            )}
            title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
          >
            {isCollapsed ? (
              <Menu className="h-4 w-4" />
            ) : (
              <X className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
      <nav className={cn("flex-1 p-4 space-y-2", isCollapsed && "flex flex-col items-center")}>
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                'flex items-center gap-3 rounded-lg transition-colors',
                isCollapsed 
                  ? 'justify-center w-12 h-12 p-0'
                  : 'px-4 py-3',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-accent hover:text-accent-foreground'
              )}
              title={isCollapsed ? item.label : undefined}
            >
              <Icon className="h-5 w-5 flex-shrink-0" />
              {!isCollapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>
      <div className={cn("p-4 border-t", isCollapsed && "flex justify-center")}>
        <button
          onClick={logout}
          className={cn(
            "flex items-center gap-3 rounded-lg transition-colors hover:bg-destructive hover:text-destructive-foreground",
            isCollapsed 
              ? 'justify-center w-12 h-12 p-0'
              : 'px-4 py-3 w-full'
          )}
          title={isCollapsed ? "Logout" : undefined}
        >
          <LogOut className="h-5 w-5 flex-shrink-0" />
          {!isCollapsed && <span>Logout</span>}
        </button>
      </div>
    </div>
  );
};

export default Sidebar;

