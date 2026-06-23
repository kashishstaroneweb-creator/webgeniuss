import { create } from 'zustand';

interface User {
  id: string;
  name: string;
  email: string;
  subscriptionPlan: string;
  roleName?: string;
  creditsBalance?: number;
  creditsUsed?: number;
  accountStatus?: string;
  themePreference?: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  setAuth: (user: User, token: string) => void;
  logout: () => void;
  updateUser: (user: Partial<User>) => void;
}

/** Read session synchronously so the first paint after refresh is already authenticated (keeps ?website= etc.). */
function readStoredAuth(): Pick<AuthState, 'user' | 'token' | 'isAuthenticated'> {
  if (typeof window === 'undefined') {
    return { user: null, token: null, isAuthenticated: false };
  }
  try {
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');
    if (token && userStr) {
      const user = JSON.parse(userStr) as User;
      return { user, token, isAuthenticated: true };
    }
  } catch {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  }
  return { user: null, token: null, isAuthenticated: false };
}

export const useAuthStore = create<AuthState>((set) => ({
  ...readStoredAuth(),
  setAuth: (user, token) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    set({ user, token, isAuthenticated: true });
  },
  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    set({ user: null, token: null, isAuthenticated: false });
  },
  updateUser: (updatedUser) =>
    set((state) => {
      const user = state.user ? { ...state.user, ...updatedUser } : null;
      if (user) localStorage.setItem('user', JSON.stringify(user));
      return { user };
    }),
}));

