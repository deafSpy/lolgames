"use client";

import { useState, useEffect } from "react";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/Button";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type AuthMode = "login" | "register";

export function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const { signInWithEmail, registerWithEmail, signInWithGoogle, error, isLoading } = useAuthStore();

  useEffect(() => {
    if (!isOpen) {
      // Reset form when modal closes
      setEmail("");
      setPassword("");
      setDisplayName("");
      setMode("login");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (mode === "login") {
        await signInWithEmail(email, password);
      } else {
        await registerWithEmail(email, password, displayName || undefined);
      }
      onClose();
    } catch (err) {
      // Error is handled by the store
      console.error("Auth error:", err);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      await signInWithGoogle();
      onClose();
    } catch (err) {
      console.error("Google sign in error:", err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-lg bg-surface-800 p-8 shadow-2xl border border-surface-700">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-surface-400 hover:text-surface-200 transition-colors"
          aria-label="Close"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>

        <h2 className="mb-6 text-2xl font-bold text-surface-50">
          {mode === "login" ? "Sign In" : "Create Account"}
        </h2>

        {error && (
          <div className="mb-4 rounded-lg bg-error/20 border border-error/50 p-3 text-sm text-error">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "register" && (
            <div>
              <label htmlFor="displayName" className="block text-sm font-medium text-surface-200">
                Display Name (optional)
              </label>
              <input
                type="text"
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-surface-600 bg-surface-700 px-3 py-2 text-surface-50 placeholder-surface-400 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                placeholder="Your name"
              />
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-surface-200">
              Email
            </label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-1 block w-full rounded-lg border border-surface-600 bg-surface-700 px-3 py-2 text-surface-50 placeholder-surface-400 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-surface-200">
              Password
            </label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="mt-1 block w-full rounded-lg border border-surface-600 bg-surface-700 px-3 py-2 text-surface-50 placeholder-surface-400 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="••••••••"
            />
          </div>

          <Button type="submit" disabled={isLoading} className="w-full">
            {isLoading ? "Loading..." : mode === "login" ? "Sign In" : "Create Account"}
          </Button>
        </form>

        <div className="my-6 flex items-center">
          <div className="flex-1 border-t border-surface-600"></div>
          <span className="px-4 text-sm text-surface-400">or</span>
          <div className="flex-1 border-t border-surface-600"></div>
        </div>

        <Button
          onClick={handleGoogleSignIn}
          disabled={isLoading}
          variant="secondary"
          className="w-full flex items-center justify-center gap-2"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="currentColor"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="currentColor"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="currentColor"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          Continue with Google
        </Button>

        <div className="mt-4 text-center text-sm">
          {mode === "login" ? (
            <p className="text-surface-300">
              Don't have an account?{" "}
              <button
                type="button"
                onClick={() => setMode("register")}
                className="font-medium text-primary-400 hover:text-primary-300 transition-colors"
              >
                Sign up
              </button>
            </p>
          ) : (
            <p className="text-surface-300">
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => setMode("login")}
                className="font-medium text-primary-400 hover:text-primary-300 transition-colors"
              >
                Sign in
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
