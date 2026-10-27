import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/lib/api';

type SessionState = {
  token: string | null;
  user: User | null;
  /** The GetGabs account currently being managed. */
  workspaceId: string | null;
  login: (token: string, user: User) => void;
  logout: () => void;
  setWorkspace: (id: string | null) => void;
};

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      workspaceId: null,
      login: (token, user) => set({ token, user }),
      logout: () => set({ token: null, user: null }),
      setWorkspace: (workspaceId) => set({ workspaceId }),
    }),
    { name: 'autoreply-session' },
  ),
);
