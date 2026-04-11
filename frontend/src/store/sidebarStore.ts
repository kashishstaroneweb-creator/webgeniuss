import { create } from 'zustand';

interface SidebarState {
  isCollapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  toggle: () => void;
}

export const useSidebarStore = create<SidebarState>((set) => ({
  isCollapsed: true,
  setCollapsed: (collapsed) => set({ isCollapsed: collapsed }),
  toggle: () => set((state) => ({ isCollapsed: !state.isCollapsed })),
}));




