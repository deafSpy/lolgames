"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useAuthStore } from "@/stores/authStore";

interface PlayerStats {
  totalGames: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  gamesAborted: number;
}

export function PlayerStats() {
  const { user } = useAuthStore();
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      if (!user?.id) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_GAME_SERVER_URL?.replace("ws://", "http://").replace("wss://", "https://")}/stats?userId=${user.id}`,
          {
            headers: {
              "Content-Type": "application/json",
            },
          }
        );

        if (!response.ok) {
          throw new Error("Failed to fetch stats");
        }

        const data = await response.json();
        setStats(data);
        setError(null);
      } catch (err) {
        console.error("Error fetching stats:", err);
        setError(err instanceof Error ? err.message : "Failed to load stats");
        // Set default stats on error
        setStats({
          totalGames: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          winRate: 0,
          gamesAborted: 0,
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchStats();
  }, [user?.id]);

  if (isLoading) {
    return (
      <div className="card p-6">
        <h2 className="text-xl font-display font-semibold mb-4">Player Statistics</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 animate-pulse">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="p-4 rounded-xl bg-surface-800">
              <div className="h-4 bg-surface-700 rounded w-20 mb-2"></div>
              <div className="h-8 bg-surface-700 rounded w-12"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const gameTypes = [
    { label: "Connect 4", icon: "🔴" },
    { label: "Rock Paper Scissors", icon: "✊" },
    { label: "Quoridor", icon: "🏃" },
    { label: "Sequence", icon: "🃏" },
    { label: "Catan", icon: "🏝️" },
    { label: "Splendor", icon: "💎" },
    { label: "Monopoly Deal", icon: "🏠" },
    { label: "Blackjack", icon: "♠️" },
  ];

  if (error || !stats) {
    return (
      <div className="card p-6">
        <h2 className="text-xl font-display font-semibold mb-4">Player Statistics</h2>
        <p className="text-surface-400 text-sm mb-4">
          {error || "No statistics available yet. Play some games to see your stats!"}
        </p>
        <h3 className="text-sm font-medium text-surface-400 uppercase tracking-wide mb-3">
          Available Games
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {gameTypes.map((g) => (
            <div key={g.label} className="flex items-center gap-2 p-2 rounded-lg bg-surface-800">
              <span className="text-base">{g.icon}</span>
              <span className="text-xs text-surface-300 truncate">{g.label}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const statCards = [
    {
      label: "Total Games",
      value: stats.totalGames,
      color: "from-blue-500 to-cyan-500",
      icon: "🎮",
    },
    {
      label: "Wins",
      value: stats.wins,
      color: "from-green-500 to-emerald-500",
      icon: "🏆",
    },
    {
      label: "Losses",
      value: stats.losses,
      color: "from-red-500 to-rose-500",
      icon: "❌",
    },
    {
      label: "Draws",
      value: stats.draws,
      color: "from-yellow-500 to-amber-500",
      icon: "🤝",
    },
    {
      label: "Win Rate",
      value: `${stats.winRate}%`,
      color: "from-purple-500 to-pink-500",
      icon: "📊",
    },
    {
      label: "Aborted",
      value: stats.gamesAborted,
      color: "from-gray-500 to-slate-500",
      icon: "⏹️",
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="card p-6"
    >
      <h2 className="text-xl font-display font-semibold mb-4">Player Statistics</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        {statCards.map((stat, index) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.05 * index }}
            className="p-4 rounded-xl bg-surface-800 hover:bg-surface-700 transition-colors"
          >
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-surface-400">{stat.label}</p>
              <span className="text-xl">{stat.icon}</span>
            </div>
            <p className="text-2xl font-bold bg-gradient-to-r bg-clip-text text-transparent ${stat.color}">
              {stat.value}
            </p>
          </motion.div>
        ))}
      </div>

      <h3 className="text-sm font-medium text-surface-400 uppercase tracking-wide mb-3">
        Games Played
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {gameTypes.map((g) => (
          <div key={g.label} className="flex items-center gap-2 p-2 rounded-lg bg-surface-800">
            <span className="text-base">{g.icon}</span>
            <span className="text-xs text-surface-300 truncate">{g.label}</span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
