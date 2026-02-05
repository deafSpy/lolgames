"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/Button";
import { GameHistory } from "@/components/profile/GameHistory";
import { AuthModal } from "@/components/auth/AuthModal";

export default function ProfilePage() {
  const router = useRouter();
  const { user, load, isLoading } = useAuthStore();
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  useEffect(() => {
    load();
  }, [load]);

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="animate-pulse space-y-8">
          <div className="card p-6">
            <div className="flex items-center gap-6">
              <div className="w-24 h-24 rounded-2xl bg-surface-800"></div>
              <div className="flex-1 space-y-3">
                <div className="h-8 bg-surface-800 rounded w-48"></div>
                <div className="h-4 bg-surface-800 rounded w-32"></div>
              </div>
            </div>
          </div>
          <div className="card p-5">
            <div className="h-64 bg-surface-800 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  const displayName = user?.displayName || user?.email || "Guest";
  const isGuest = !user;
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <>
      <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />
      
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Profile Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="card p-6 mb-8"
        >
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
            {/* Avatar */}
            <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center text-white text-3xl font-bold">
              {initials}
            </div>

            {/* Info */}
            <div className="flex-1 text-center sm:text-left">
              <h1 className="text-2xl font-display font-bold">{displayName}</h1>
              <p className="text-surface-400 text-sm mt-1">
                {isGuest ? "Guest Account" : "Registered Player"}
              </p>
              {user?.email && (
                <p className="text-surface-500 text-xs mt-1">{user.email}</p>
              )}
              {user?.provider && (
                <p className="text-surface-500 text-xs mt-1 capitalize">
                  Signed in via {user.provider === "password" ? "Email" : user.provider}
                </p>
              )}
            </div>

            {/* Actions */}
            {isGuest && (
              <div className="flex flex-col gap-2">
                <Button 
                  variant="primary" 
                  size="sm"
                  onClick={() => setIsAuthModalOpen(true)}
                >
                  Create Account
                </Button>
                <p className="text-xs text-surface-500 text-center">Keep your stats forever</p>
              </div>
            )}
          </div>
        </motion.div>

        {/* Game History */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <GameHistory />
        </motion.div>

        {/* Info Section for Guests */}
        {isGuest && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mt-8 card p-6 border-2 border-primary-500/20"
          >
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-primary-500/20 flex items-center justify-center">
                <svg className="w-6 h-6 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-lg mb-2">Playing as Guest</h3>
                <p className="text-surface-400 text-sm mb-4">
                  Your game history is saved for this browser session only. Create an account to:
                </p>
                <ul className="space-y-2 text-sm text-surface-300 mb-4">
                  <li className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Keep your game history across devices
                  </li>
                  <li className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Track stats and achievements
                  </li>
                  <li className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Compete on leaderboards
                  </li>
                </ul>
                <Button 
                  variant="primary"
                  onClick={() => setIsAuthModalOpen(true)}
                >
                  Create Free Account
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </>
  );
}

