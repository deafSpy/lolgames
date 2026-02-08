"use client";

import { useEffect, useState } from "react";
import { GameType } from "@multiplayer/shared";
import { fetchHistory, type RemoteHistoryEntry } from "@/lib/history";
import { useAuthStore } from "@/stores/authStore";

const GAME_TYPE_LABELS: Record<GameType, string> = {
  [GameType.CONNECT4]: "Connect 4",
  [GameType.RPS]: "Rock Paper Scissors",
  [GameType.QUORIDOR]: "Quoridor",
  [GameType.SEQUENCE]: "Sequence",
  [GameType.CATAN]: "Catan",
  [GameType.SPLENDOR]: "Splendor",
  [GameType.MONOPOLY_DEAL]: "Monopoly Deal",
  [GameType.BLACKJACK]: "Blackjack",
};

function ResultBadge({ result }: { result: RemoteHistoryEntry["result"] }) {
  const styles = {
    win: "bg-success/20 text-success border border-success/50",
    loss: "bg-error/20 text-error border border-error/50",
    draw: "bg-warning/20 text-warning border border-warning/50",
    aborted: "bg-surface-600/20 text-surface-400 border border-surface-600/50",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[result]}`}
    >
      {result.charAt(0).toUpperCase() + result.slice(1)}
    </span>
  );
}

function formatDuration(ms?: number): string {
  if (!ms) return "—";
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

export function GameHistory() {
  const [games, setGames] = useState<RemoteHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { token } = useAuthStore();

  useEffect(() => {
    const loadHistory = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const history = await fetchHistory(token);
        setGames(history);
      } catch (err) {
        console.error("Failed to load history:", err);
        setError(err instanceof Error ? err.message : "Failed to load game history");
      } finally {
        setIsLoading(false);
      }
    };

    loadHistory();
  }, [token]);

  if (isLoading) {
    return (
      <div className="rounded-lg bg-surface-800 border border-surface-700 p-6 shadow-lg">
        <h2 className="mb-4 text-xl font-bold text-surface-50">Recent Games</h2>
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="h-20 rounded-lg bg-surface-700"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-surface-800 border border-surface-700 p-6 shadow-lg">
        <h2 className="mb-4 text-xl font-bold text-surface-50">Recent Games</h2>
        <div className="rounded-lg bg-error/20 border border-error/50 p-4 text-sm text-error">
          {error}
        </div>
      </div>
    );
  }

  if (games.length === 0) {
    return (
      <div className="rounded-lg bg-surface-800 border border-surface-700 p-6 shadow-lg">
        <h2 className="mb-4 text-xl font-bold text-surface-50">Recent Games</h2>
        <div className="text-center py-8">
          <svg
            className="mx-auto h-12 w-12 text-surface-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-surface-200">No games yet</h3>
          <p className="mt-1 text-sm text-surface-400">
            Start playing to see your game history here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-surface-800 border border-surface-700 p-6 shadow-lg">
      <h2 className="mb-4 text-xl font-bold text-surface-50">Recent Games (Last 10)</h2>
      <div className="space-y-3">
        {games.map((game) => (
          <div
            key={game.id}
            className="rounded-lg border border-surface-700 bg-surface-750 p-4 hover:border-surface-600 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="font-semibold text-surface-50">
                    {GAME_TYPE_LABELS[game.gameType] || game.gameType}
                  </h3>
                  {game.vsBot && (
                    <span className="inline-flex items-center rounded-full bg-accent/20 border border-accent/50 px-2 py-0.5 text-xs font-medium text-accent">
                      vs Bot
                    </span>
                  )}
                </div>
                <p className="text-sm text-surface-300">vs {game.opponent}</p>
                <div className="mt-2 flex items-center gap-4 text-xs text-surface-400">
                  <span>{formatDate(game.endedAt)}</span>
                  {game.durationMs && <span>Duration: {formatDuration(game.durationMs)}</span>}
                </div>
              </div>
              <ResultBadge result={game.result} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
