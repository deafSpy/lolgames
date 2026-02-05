import { GameType } from "@multiplayer/shared";

export interface GameStats {
  wins: number;
  losses: number;
  draws: number;
  elo: number;
  gamesPlayed: number;
}

export interface GameHistoryEntry {
  id: string;
  gameType: GameType;
  result: "win" | "loss" | "draw" | "aborted";
  opponent: string;
  opponentId?: string;
  date: number;
  duration?: number; // in milliseconds
  eloChange?: number;
}

interface GameHistoryData {
  stats: Record<GameType, GameStats>;
  recentGames: GameHistoryEntry[];
  lastUpdated: number;
}

const STORAGE_KEY = "gameHistory";
const MAX_RECENT_GAMES = 50;

// Default stats for new games
const DEFAULT_STATS: GameStats = {
  wins: 0,
  losses: 0,
  draws: 0,
  elo: 1000, // Starting ELO
  gamesPlayed: 0,
};

// Simple ELO calculation
function calculateEloChange(winnerElo: number, loserElo: number, isDraw: boolean = false): number {
  const k = 32; // K-factor
  const expectedScore = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));

  if (isDraw) {
    return Math.round(k * (0.5 - expectedScore));
  } else {
    return Math.round(k * (1 - expectedScore));
  }
}

class GameHistoryStore {
  private data: GameHistoryData;

  constructor() {
    this.data = this.loadFromStorage();
  }

  private loadFromStorage(): GameHistoryData {
    if (typeof window === "undefined") {
      return {
        stats: {} as Record<GameType, GameStats>,
        recentGames: [],
        lastUpdated: Date.now(),
      };
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Ensure all game types have stats
        const stats = { ...parsed.stats };
        Object.values(GameType).forEach((gameType) => {
          if (!stats[gameType]) {
            stats[gameType] = { ...DEFAULT_STATS };
          }
        });
        return {
          ...parsed,
          stats,
        };
      }
    } catch (error) {
      console.error("Failed to load game history:", error);
    }

    // Return default data
    const stats: Record<GameType, GameStats> = {} as Record<GameType, GameStats>;
    Object.values(GameType).forEach((gameType) => {
      stats[gameType] = { ...DEFAULT_STATS };
    });

    return {
      stats,
      recentGames: [],
      lastUpdated: Date.now(),
    };
  }

  private saveToStorage(): void {
    if (typeof window === "undefined") return;

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch (error) {
      console.error("Failed to save game history:", error);
    }
  }

  // Record a completed game
  recordGame(
    gameType: GameType,
    playerId: string,
    opponentName: string,
    opponentId: string | undefined,
    result: "win" | "loss" | "draw",
    duration?: number
  ): void {
    const gameId = `${gameType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const playerStats = this.data.stats[gameType];
    const opponentStats = this.data.stats[gameType]; // Simplified - in real ELO, we'd track opponent ELO

    // Update stats
    playerStats.gamesPlayed++;
    let eloChange = 0;

    if (result === "win") {
      playerStats.wins++;
      eloChange = calculateEloChange(playerStats.elo, opponentStats.elo);
    } else if (result === "loss") {
      playerStats.losses++;
      eloChange = calculateEloChange(opponentStats.elo, playerStats.elo);
    } else {
      playerStats.draws++;
      eloChange = calculateEloChange(playerStats.elo, opponentStats.elo, true);
    }

    playerStats.elo = Math.max(0, playerStats.elo + eloChange);

    // Add to recent games
    const gameEntry: GameHistoryEntry = {
      id: gameId,
      gameType,
      result,
      opponent: opponentName,
      opponentId,
      date: Date.now(),
      duration,
      eloChange,
    };

    this.data.recentGames.unshift(gameEntry);
    this.data.recentGames = this.data.recentGames.slice(0, MAX_RECENT_GAMES);
    this.data.lastUpdated = Date.now();

    this.saveToStorage();
  }

  // Record an aborted game
  recordAbortedGame(
    gameType: GameType,
    playerId: string,
    opponentName: string,
    opponentId: string | undefined,
    duration?: number
  ): void {
    const gameId = `aborted_${gameType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Add to recent games (but don't update stats for aborted games)
    const gameEntry: GameHistoryEntry = {
      id: gameId,
      gameType,
      result: "aborted",
      opponent: opponentName,
      opponentId,
      date: Date.now(),
      duration,
    };

    this.data.recentGames.unshift(gameEntry);
    this.data.recentGames = this.data.recentGames.slice(0, MAX_RECENT_GAMES);
    this.data.lastUpdated = Date.now();

    this.saveToStorage();
  }

  // Get stats for a specific game type
  getStats(gameType: GameType): GameStats {
    return { ...this.data.stats[gameType] };
  }

  // Get all stats
  getAllStats(): Record<GameType, GameStats> {
    const result: Record<GameType, GameStats> = {} as Record<GameType, GameStats>;
    Object.values(GameType).forEach((gameType) => {
      result[gameType] = { ...this.data.stats[gameType] };
    });
    return result;
  }

  // Get recent games
  getRecentGames(limit: number = 10): GameHistoryEntry[] {
    return this.data.recentGames.slice(0, limit);
  }

  // Clear all data
  clear(): void {
    const stats: Record<GameType, GameStats> = {} as Record<GameType, GameStats>;
    Object.values(GameType).forEach((gameType) => {
      stats[gameType] = { ...DEFAULT_STATS };
    });

    this.data = {
      stats,
      recentGames: [],
      lastUpdated: Date.now(),
    };

    this.saveToStorage();
  }
}

// Create singleton instance
export const gameHistoryStore = new GameHistoryStore();

// Export for convenience
export { gameHistoryStore as default };




