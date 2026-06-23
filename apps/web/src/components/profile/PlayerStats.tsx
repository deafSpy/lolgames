"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useAuthStore } from "@/stores/authStore";

interface GameStat {
  game_type: string;
  wins: number;
  losses: number;
  draws: number;
  total_games: number;
  elo: number;
}

interface StatsResponse {
  user: { id: string; displayName: string; isAnonymous: boolean };
  stats: GameStat[];
  streaks: { current: number; longest: number };
}

const GAME_META: Record<string, { label: string; icon: string }> = {
  connect4: { label: "Connect 4", icon: "🔴" },
  rps: { label: "Rock Paper Scissors", icon: "✊" },
  quoridor: { label: "Quoridor", icon: "🏃" },
  sequence: { label: "Sequence", icon: "🃏" },
  catan: { label: "Catan", icon: "🏝️" },
  splendor: { label: "Splendor", icon: "💎" },
  monopoly_deal: { label: "Monopoly Deal", icon: "🏠" },
  blackjack: { label: "Blackjack", icon: "♠️" },
};

export function PlayerStats() {
  const { user } = useAuthStore();
  const [data, setData] = useState<StatsResponse | null>(null);
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
        const baseUrl = process.env.NEXT_PUBLIC_GAME_SERVER_URL?.replace(
          "ws://",
          "http://"
        ).replace("wss://", "https://");
        const response = await fetch(`${baseUrl}/stats?userId=${user.id}`);

        if (!response.ok) throw new Error("Failed to fetch stats");

        const json: StatsResponse = await response.json();
        setData(json);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load stats");
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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 animate-pulse">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="p-4 rounded-xl bg-surface-800">
              <div className="h-3 bg-surface-700 rounded w-16 mb-3"></div>
              <div className="h-7 bg-surface-700 rounded w-10"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const activeSats = data?.stats.filter((s) => s.total_games > 0) ?? [];

  if (error || activeSats.length === 0) {
    return (
      <div className="card p-6">
        <h2 className="text-xl font-display font-semibold mb-4">Player Statistics</h2>
        <p className="text-surface-400 text-sm">
          {error ?? "No statistics yet. Play some games to see your stats!"}
        </p>
      </div>
    );
  }

  const totalGames = activeSats.reduce((sum, s) => sum + s.total_games, 0);
  const totalWins = activeSats.reduce((sum, s) => sum + s.wins, 0);
  const winRate = totalGames > 0 ? Math.round((totalWins / totalGames) * 100) : 0;
  const favouriteEntry = activeSats.reduce((best, s) =>
    s.total_games > best.total_games ? s : best
  );
  const favourite = GAME_META[favouriteEntry.game_type] ?? {
    label: favouriteEntry.game_type,
    icon: "🎮",
  };
  const streaks = data?.streaks ?? { current: 0, longest: 0 };

  const statCards = [
    {
      label: "Total Games",
      value: String(totalGames),
      icon: "🎮",
      accent: "border-blue-500/30",
    },
    {
      label: "Win Rate",
      value: `${winRate}%`,
      icon: "📊",
      accent: "border-purple-500/30",
    },
    {
      label: "Favourite Game",
      value: favourite.label,
      icon: favourite.icon,
      accent: "border-green-500/30",
      compact: true,
    },
    {
      label: "Current Streak",
      value: String(streaks.current),
      icon: "🔥",
      accent: "border-orange-500/30",
    },
    {
      label: "Longest Streak",
      value: String(streaks.longest),
      icon: "⚡",
      accent: "border-yellow-500/30",
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

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        {statCards.map((stat, index) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.05 * index }}
            className={`p-4 rounded-xl bg-surface-800 border ${stat.accent} hover:bg-surface-700 transition-colors`}
          >
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-surface-400 leading-tight">{stat.label}</p>
              <span className="text-base shrink-0 ml-1">{stat.icon}</span>
            </div>
            <p
              className={`font-bold text-white leading-tight ${
                stat.compact ? "text-sm" : "text-2xl"
              }`}
            >
              {stat.value}
            </p>
          </motion.div>
        ))}
      </div>

      {activeSats.length > 1 && (
        <>
          <h3 className="text-xs font-medium text-surface-400 uppercase tracking-wide mb-3">
            By Game
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {activeSats.map((s) => {
              const meta = GAME_META[s.game_type] ?? { label: s.game_type, icon: "🎮" };
              const rate = s.total_games > 0 ? Math.round((s.wins / s.total_games) * 100) : 0;
              return (
                <div
                  key={s.game_type}
                  className="flex items-center gap-2 p-2 rounded-lg bg-surface-800"
                >
                  <span className="text-base shrink-0">{meta.icon}</span>
                  <div className="min-w-0">
                    <p className="text-xs text-surface-300 truncate">{meta.label}</p>
                    <p className="text-xs text-surface-500">
                      {s.total_games}g · {rate}%
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </motion.div>
  );
}
