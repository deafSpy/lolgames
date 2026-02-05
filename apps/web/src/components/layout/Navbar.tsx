"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { useAuthStore } from "@/stores/authStore";
import { AuthModal } from "@/components/auth/AuthModal";
import { UserMenu } from "@/components/auth/UserMenu";

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/lobby", label: "Lobby" },
  { href: "/profile", label: "Profile" },
];

export function Navbar() {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const { user, load, isLoading } = useAuthStore();

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />
    <motion.header
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="sticky top-0 z-50 glass border-b border-surface-800/50"
    >
      <nav className="container mx-auto px-4 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center">
            <span className="text-white font-bold text-sm">M</span>
          </div>
          <span className="font-display font-bold text-lg hidden sm:block">
            Multiplayer Games
          </span>
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center gap-1">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                pathname === link.href
                  ? "text-primary-400 bg-primary-500/10"
                  : "text-surface-400 hover:text-surface-100 hover:bg-surface-800"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* User Actions */}
        <div className="flex items-center gap-3">
          {!isLoading && (
            <>
              {user ? (
                <>
                  <div className="hidden sm:block text-sm text-surface-400">
                    <span className="text-surface-200 font-medium">{user.displayName || user.email}</span>
                  </div>
                  <UserMenu />
                </>
              ) : (
                <>
                  <div className="hidden sm:block text-sm text-surface-400">
                    Playing as <span className="text-surface-200 font-medium">Guest</span>
                  </div>
                  <button 
                    onClick={() => setIsAuthModalOpen(true)}
                    className="btn-ghost text-sm px-3 py-1.5"
                  >
                    Sign In
                  </button>
                </>
              )}
            </>
          )}

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="md:hidden p-2 rounded-lg hover:bg-surface-800 transition-colors"
            aria-label="Toggle menu"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              {isMobileMenuOpen ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              )}
            </svg>
          </button>
        </div>
      </nav>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="md:hidden border-t border-surface-800/50"
        >
          <div className="container mx-auto px-4 py-4 flex flex-col gap-2">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setIsMobileMenuOpen(false)}
                className={`px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                  pathname === link.href
                    ? "text-primary-400 bg-primary-500/10"
                    : "text-surface-400 hover:text-surface-100 hover:bg-surface-800"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </motion.div>
      )}
    </motion.header>
    </>
  );
}

