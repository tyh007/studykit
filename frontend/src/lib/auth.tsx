import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { authApi, setAuthToken, getAuthToken } from './api';
import { db } from './db';
import { triggerSync } from './sync';
import { useStore } from '../store/useStore';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  token: string | null;
  workspace_id: string | null;
  loading: boolean;
  error: string | null;
}

interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, display_name?: string) => Promise<void>;
  logout: () => void;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const STORAGE_KEY = 'studykit_auth';

function loadStoredAuth(): { token: string; workspace_id: string } | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function storeAuth(token: string, workspace_id: string) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, workspace_id }));
}

function clearStoredAuth() {
  localStorage.removeItem(STORAGE_KEY);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    workspace_id: null,
    loading: true,
    error: null,
  });

  // Restore session on mount
  useEffect(() => {
    const stored = loadStoredAuth();
    if (stored?.token) {
      setAuthToken(stored.token);
      authApi.me()
        .then((res) => {
          setState({
            user: res.user,
            token: stored.token,
            workspace_id: stored.workspace_id,
            loading: false,
            error: null,
          });
          // Trigger sync after restoring session
          if (stored.workspace_id) {
            triggerSync(stored.workspace_id).catch(() => {});
          }
        })
        .catch(() => {
          // Token expired or invalid — clear everything
          clearStoredAuth();
          setAuthToken(null);
          useStore.getState().resetStore();
          setState({ user: null, token: null, workspace_id: null, loading: false, error: null });
        });
    } else {
      setState((s) => ({ ...s, loading: false }));
    }
  }, []);

  // Clear local Dexie cache to prevent data leakage between users
  const clearLocalCache = useCallback(async () => {
    try {
      const tables = db.tables.map(t => t.name);
      await Promise.all(tables.map(name => (db as any)[name]?.clear()));
    } catch (err) {
      console.warn('Failed to clear local cache:', err);
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      // Clear old cache before switching user
      await clearLocalCache();
      
      const res = await authApi.login(email, password);
      setAuthToken(res.token);
      storeAuth(res.token, res.workspace_id);
      setState({
        user: { ...res.user, created_at: new Date().toISOString() },
        token: res.token,
        workspace_id: res.workspace_id,
        loading: false,
        error: null,
      });
      // Trigger sync after login
      if (res.workspace_id) {
        triggerSync(res.workspace_id).catch(() => {});
      }
    } catch (err: any) {
      setState((s) => ({ ...s, loading: false, error: err.message }));
      throw err;
    }
  }, [clearLocalCache]);

  const register = useCallback(async (email: string, password: string, display_name?: string) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      // Clear old cache before switching user
      await clearLocalCache();
      
      const res = await authApi.register(email, password, display_name);
      setAuthToken(res.token);
      storeAuth(res.token, res.workspace_id);
      setState({
        user: { ...res.user, created_at: new Date().toISOString() },
        token: res.token,
        workspace_id: res.workspace_id,
        loading: false,
        error: null,
      });
      // Trigger sync after register
      if (res.workspace_id) {
        triggerSync(res.workspace_id).catch(() => {});
      }
    } catch (err: any) {
      setState((s) => ({ ...s, loading: false, error: err.message }));
      throw err;
    }
  }, [clearLocalCache]);

  const logout = useCallback(() => {
    setAuthToken(null);
    clearStoredAuth();
    // Keep device ID so notes can be restored on re-login
    // localStorage.removeItem('studykit_device_id');
    // Clear Zustand store state (but preserve deviceId)
    const currentDeviceId = useStore.getState().deviceId;
    useStore.getState().resetStore();
    useStore.setState({ deviceId: currentDeviceId });
    // Don't delete Dexie database — we keep notes locally.
    // If switching users, login/register will call clearLocalCache() instead.
    setState({ user: null, token: null, workspace_id: null, loading: false, error: null });
  }, []);

  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: null }));
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout, clearError }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
