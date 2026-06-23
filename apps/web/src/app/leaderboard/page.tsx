"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";

interface LeaderboardPlayer {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  total_games: number;
}

interface LeaderboardResponse {
  gameType: string;
  limit: number;
  players: LeaderboardPlayer[];
}

const GAME_TABS = [
  { key: "connect4", label: "Connect 4", icon: "🔴" },
  { key: "rps", label: "RPS", icon: "✊" },
  { key: "blackjack", label: "Blackjack", icon: "♠️" },
  { key: "quoridor", label: "Quoridor", icon: "🏃" },
  { key: "sequence", label: "Sequence", icon: "🃏" },
  { key: "splendor", label: "Splendor", icon: "💎" },
  { key: "monopoly_deal", label: "Monopoly Deal", icon: "🏠" },
] as const;

type GameKey = (typeof GAME_TABS)[number]["key"];

function winRate(wins: number, total: number): string {
  if (total === 0) return "—";
  return `${Math.round((wins / total) * 100)}%`;
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-xl">🥇</span>;
  if (rank === 2) return <span className="text-xl">🥈</span>;
  if (rank === 3) return <span className="text-xl">🥉</span>;
  return (
    <span className="text-surface-400 font-mono text-sm w-6 text-center inline-block">{rank}</span>
  );
}

function PlayerAvatar({
  avatarUrl,
  displayName,
}: {
  avatarUrl: string | null;
  displayName: string;
}) {
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  if (avatarUrl) {
    return <img src={avatarUrl} alt={displayName} className="w-8 h-8 rounded-full object-cover" />;
  }
  return (
    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
      {initials}
    </div>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b border-surface-800/50">
      <td className="px-4 py-3">
        <div className="h-4 bg-surface-800 rounded w-6 animate-pulse" />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-surface-800 animate-pulse flex-shrink-0" />
          <div className="h-4 bg-surface-800 rounded w-28 animate-pulse" />
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="h-4 bg-surface-800 rounded w-10 animate-pulse" />
      </td>
      <td className="px-4 py-3">
        <div className="h-4 bg-surface-800 rounded w-10 animate-pulse" />
      </td>
      <td className="px-4 py-3">
        <div className="h-4 bg-surface-800 rounded w-10 animate-pulse" />
      </td>
    </tr>
  );
}

export default function LeaderboardPage() {
  const [activeTab, setActiveTab] = useState<GameKey>("connect4");
  const [players, setPlayers] = useState<LeaderboardPlayer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLeaderboard = useCallback(async (gameKey: GameKey) => {
    setIsLoading(true);
    setError(null);
    try {
      const baseUrl = (process.env.NEXT_PUBLIC_GAME_SERVER_URL ?? "http://localhost:3002")
        .replace("ws://", "http://")
        .replace("wss://", "https://");
      const res = await fetch(`${baseUrl}/leaderboard/${gameKey}?limit=50`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data: LeaderboardResponse = await res.json();
      setPlayers(data.players);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load leaderboard");
      setPlayers([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeaderboard(activeTab);
  }, [activeTab, fetchLeaderboard]);

  const handleTabChange = (key: GameKey) => {
    setActiveTab(key);
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-3xl font-display font-bold mb-1">Leaderboards</h1>
        <p className="text-surface-400 text-sm">
          Top players by ELO rating · Minimum 5 games required
        </p>
      </motion.div>

      {/* Game Tabs */}
      <motion.div
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="mb-6 -mx-4 px-4 overflow-x-auto"
      >
        <div className="flex gap-2 min-w-max pb-2">
          {GAME_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                activeTab === tab.key
                  ? "bg-primary-500/20 text-primary-400 border border-primary-500/30"
                  : "text-surface-400 hover:text-surface-100 hover:bg-surface-800 border border-transparent"
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </motion.div>

      {/* Table Card */}
      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="card overflow-hidden"
      >
        {error ? (
          <div className="p-12 text-center text-surface-400">
            <p className="text-2xl mb-3">⚠️</p>
            <p className="font-medium text-surface-300 mb-1">Failed to load leaderboard</p>
            <p className="text-sm">{error}</p>
            <button
              onClick={() => fetchLeaderboard(activeTab)}
              className="mt-4 btn-ghost text-sm px-4 py-2"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-800 text-surface-400 text-xs uppercase tracking-wider">
                  <th className="px-4 py-3 text-left w-12">#</th>
                  <th className="px-4 py-3 text-left">Player</th>
                  <th className="px-4 py-3 text-right">Wins</th>
                  <th className="px-4 py-3 text-right">Games</th>
                  <th className="px-4 py-3 text-right">Win Rate</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => <SkeletonRow key={i} />)
                ) : players.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-surface-400">
                      <p className="text-3xl mb-3">🏆</p>
                      <p className="font-medium text-surface-300 mb-1">No players yet</p>
                      <p className="text-xs">Play at least 5 games to appear on the leaderboard</p>
                    </td>
                  </tr>
                ) : (
                  players.map((player, idx) => {
                    const rank = idx + 1;
                    const rate = winRate(player.wins, player.total_games);
                    const isTopThree = rank <= 3;
                    return (
                      <tr
                        key={player.user_id}
                        className={`border-b border-surface-800/50 transition-colors hover:bg-surface-800/30 ${
                          isTopThree ? "bg-surface-800/20" : ""
                        }`}
                      >
                        <td className="px-4 py-3 w-12">
                          <RankBadge rank={rank} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <PlayerAvatar
                              avatarUrl={player.avatar_url}
                              displayName={player.display_name}
                            />
                            <span
                              className={`font-medium truncate max-w-[140px] sm:max-w-none ${
                                isTopThree ? "text-surface-100" : "text-surface-200"
                              }`}
                            >
                              {player.display_name}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-surface-200 font-medium">
                          {player.wins}
                        </td>
                        <td className="px-4 py-3 text-right text-surface-400">
                          {player.total_games}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span
                            className={`font-medium ${
                              player.total_games >= 5
                                ? Number(rate.replace("%", "")) >= 60
                                  ? "text-success"
                                  : Number(rate.replace("%", "")) >= 40
                                    ? "text-surface-200"
                                    : "text-error"
                                : "text-surface-500"
                            }`}
                          >
                            {rate}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>

      {!isLoading && players.length > 0 && (
        <p className="text-xs text-surface-600 text-center mt-4">
          Showing top {players.length} players · Ranked by ELO rating
        </p>
      )}
    </div>
  );
}
