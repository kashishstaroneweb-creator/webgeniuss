import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { AppSidebar } from '@/components/AppSidebar';
import { AdminSidebar } from '@/components/AdminSidebar';
import { AppHeader } from '@/components/AppHeader';
import { AuroraBackground } from '@/components/AuroraBackground';
import Login from '@/pages/Login';
import ForgotPassword from '@/pages/ForgotPassword';
import Dashboard from '@/pages/Dashboard';
import Profile from '@/pages/Profile';
import History from '@/pages/History';
import Subscription from '@/pages/Subscription';
import AdminPanel from '@/pages/AdminPanel';

const AuthCallback = () => {
  const [searchParams] = useSearchParams();
  const { setAuth } = useAuthStore();

  useEffect(() => {
    const token = searchParams.get('token');
    if (token) {
      // Fetch user profile with token
      fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/user/profile`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
        .then((res) => res.json())
        .then((user) => {
          setAuth(user, token);
          const isAdmin = user?.roleName === 'superadmin' || user?.roleName === 'admin';
          window.location.href = isAdmin ? '/admin' : '/dashboard';
        })
        .catch(() => {
          window.location.href = '/login';
        });
    }
  }, [searchParams, setAuth]);

  return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
};

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, user } = useAuthStore();
  const isAdmin = user?.roleName === 'superadmin' || user?.roleName === 'admin';

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  if (isAdmin) {
    return <Navigate to="/admin" replace />;
  }

  return <>{children}</>;
};

const AdminRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, isAuthenticated } = useAuthStore();
  const canAccessAdmin = user?.roleName === 'superadmin' || user?.roleName === 'admin';

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  if (!canAccessAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};

const Layout = ({ children }: { children: React.ReactNode }) => {
  return (
    <>
      <AuroraBackground />
      <div className="flex h-screen bg-transparent relative z-10 text-foreground p-4 gap-4">
      <AppSidebar />
      <div className="flex flex-1 flex-col overflow-hidden gap-4">
        <AppHeader />
        <main className="flex-1 overflow-y-auto rounded-3xl relative scrollbar-hide border border-border/50 bg-white/70 dark:bg-black/40 backdrop-blur-xl">
          {children}
        </main>
      </div>
    </div>
    </>
  );
};

const AdminLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <>
      <AuroraBackground />
      <div className="flex h-screen bg-transparent relative z-10 text-foreground p-4 gap-4">
        <AdminSidebar />
        <div className="flex flex-1 flex-col overflow-hidden gap-4">
          <AppHeader creditMode="v0" />
          <main className="flex-1 overflow-y-auto rounded-3xl relative scrollbar-hide border border-border/50 bg-white/70 dark:bg-black/40 backdrop-blur-xl">
            {children}
          </main>
        </div>
      </div>
    </>
  );
};

function App() {
  const { isAuthenticated, user } = useAuthStore();
  const isAdmin = user?.roleName === 'superadmin' || user?.roleName === 'admin';

  useEffect(() => {
    // Initialize theme early to prevent flash and respect system preference.
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = savedTheme || (prefersDark ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', initialTheme === 'dark');
    // Auth is hydrated synchronously in authStore (readStoredAuth) so refresh keeps URL query params.
  }, []);

  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route
          path="/login"
          element={
            isAuthenticated ? (
              <Navigate to={isAdmin ? '/admin' : '/dashboard'} />
            ) : (
              <Login />
            )
          }
        />
        <Route
          path="/forgot-password"
          element={isAuthenticated ? <Navigate to={isAdmin ? '/admin' : '/dashboard'} /> : <ForgotPassword />}
        />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Layout>
                <Dashboard />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <Layout>
                <Profile />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/history"
          element={
            <ProtectedRoute>
              <Layout>
                <History />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/subscription"
          element={
            <ProtectedRoute>
              <Layout>
                <Subscription />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <AdminLayout>
                <AdminPanel />
              </AdminLayout>
            </AdminRoute>
          }
        />
        <Route
          path="/websites"
          element={
            <ProtectedRoute>
              <Navigate to="/history" replace />
            </ProtectedRoute>
          }
        />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
