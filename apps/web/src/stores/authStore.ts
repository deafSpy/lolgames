"use client";

import { create } from "zustand";
import { getClient } from "@/lib/colyseus";

export interface AuthUser {
  id?: string;
  email?: string;
  displayName?: string;
  provider?: string;
  verified?: boolean;
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (email: string, password: string, displayName?: string) => Promise<void>;
  signOut: () => Promise<void>;
}

function getAuthClient() {
  const client = getClient();
  // colyseus.js augments Client with auth when @colyseus/auth is available
  // We guard for environments where it might not be loaded yet.
  if (!(client as any).auth) {
    throw new Error("Auth module is not available on the Colyseus client");
  }
  return (client as any).auth as {
    token?: string;
    registerWithEmailAndPassword: (email: string, password: string, options?: Record<string, unknown>) => Promise<AuthUser>;
    signInWithEmailAndPassword: (email: string, password: string) => Promise<AuthUser>;
    signInWithProvider: (provider: string) => Promise<AuthUser>;
    getUserData: () => Promise<AuthUser>;
    signOut: () => void;
  };
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isLoading: false,
  error: null,

  load: async () => {
    set({ isLoading: true, error: null });
    try {
      const auth = getAuthClient();
      const user = await auth.getUserData();
      set({ user, token: auth.token || null, isLoading: false });
    } catch (error) {
      console.warn("Auth load failed, continuing as guest", error);
      set({ user: null, token: null, isLoading: false });
    }
  },

  signInWithGoogle: async () => {
    set({ isLoading: true, error: null });
    try {
      const auth = getAuthClient();
      const user = await auth.signInWithProvider("google");
      set({ user, token: auth.token || null, isLoading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to sign in with Google";
      set({ error: message, isLoading: false });
    }
  },

  signInWithEmail: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const auth = getAuthClient();
      const user = await auth.signInWithEmailAndPassword(email, password);
      set({ user, token: auth.token || null, isLoading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to sign in";
      set({ error: message, isLoading: false });
    }
  },

  registerWithEmail: async (email, password, displayName) => {
    set({ isLoading: true, error: null });
    try {
      const auth = getAuthClient();
      const user = await auth.registerWithEmailAndPassword(email, password, { displayName });
      set({ user, token: auth.token || null, isLoading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to register";
      set({ error: message, isLoading: false });
    }
  },

  signOut: async () => {
    try {
      const auth = getAuthClient();
      auth.signOut();
    } catch (error) {
      console.warn("Sign out failed", error);
    }
    set({ user: null, token: null });
  },
}));
