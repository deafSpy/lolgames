import { GameType } from "@multiplayer/shared";
import { redisService } from "./redis.js";
import { logger } from "../logger.js";

// Import for pub/sub notifications (circular dependency resolved via lazy import)
let publishLobbyUpdate:
  | ((event: {
      type: "created" | "updated" | "deleted" | "full_refresh";
      roomId?: string;
      lobby?: unknown;
    }) => Promise<void>)
  | null = null;

// Lazy load to avoid circular dependency
const getPublishFunction = async () => {
  if (!publishLobbyUpdate) {
    const module = await import("../routes/lobby-stream.js");
    publishLobbyUpdate = module.publishLobbyUpdate;
  }
  return publishLobbyUpdate;
};

interface LobbyData {
  roomId: string;
  gameType: GameType;
  host: string;
  hostUserId?: string;
  currentPlayers: number;
  maxPlayers: number;
  spectatorCount: number;
  status: "waiting" | "starting" | "in-progress";
  vsBot: boolean;
  createdAt: string;
  metadata?: Record<string, any>;
}

interface CreateLobbyOptions {
  roomId: string;
  gameType: GameType;
  host: string;
  hostUserId?: string;
  maxPlayers: number;
  vsBot?: boolean;
  metadata?: Record<string, any>;
  ttl?: number; // Time to live in seconds (default: 1 hour)
}

/**
 * Redis Lobby Service
 *
 * Architecture:
 * - HASH for lobby details: lobby:{roomId} -> JSON
 * - SET for game type index: lobbies:{gameType} -> [roomId1, roomId2, ...]
 *
 * Benefits:
 * - Instant lobby lookup (O(1))
 * - Fast filtering by game type
 * - Auto-cleanup with TTL
 * - No database pollution with temporary data
 */
class LobbyService {
  private readonly LOBBY_PREFIX = "lobby:";
  private readonly LOBBIES_INDEX_PREFIX = "lobbies:";
  private readonly DEFAULT_TTL = 3600; // 1 hour

  /**
   * Create a new lobby
   */
  async createLobby(options: CreateLobbyOptions): Promise<void> {
    const {
      roomId,
      gameType,
      host,
      hostUserId,
      maxPlayers,
      vsBot = false,
      metadata = {},
      ttl = this.DEFAULT_TTL,
    } = options;

    if (!redisService.connected) {
      logger.warn("Redis not connected, skipping lobby creation");
      return;
    }

    const lobbyData: LobbyData = {
      roomId,
      gameType,
      host,
      hostUserId,
      currentPlayers: 1,
      maxPlayers,
      spectatorCount: 0,
      status: "waiting",
      vsBot,
      createdAt: new Date().toISOString(),
      metadata,
    };

    try {
      const lobbyKey = `${this.LOBBY_PREFIX}${roomId}`;
      const indexKey = `${this.LOBBIES_INDEX_PREFIX}${gameType}`;

      // Get Redis client (null if not connected)
      const client = redisService.getClient();
      if (!client) {
        logger.debug({ roomId }, "Redis not available, skipping lobby creation");
        return;
      }

      // Store lobby data as string with TTL
      await client.set(lobbyKey, JSON.stringify(lobbyData), "EX", ttl);

      // Add to game type index (SET)
      await client.sadd(indexKey, roomId);

      logger.info({ roomId, gameType, host }, "✓ Lobby created in Redis");

      // Publish lobby creation event
      const publish = await getPublishFunction();
      await publish({ type: "created", roomId, lobby: lobbyData });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : error, roomId, gameType },
        "Failed to create lobby in Redis (non-critical)"
      );
    }
  }

  /**
   * Get a specific lobby by room ID
   */
  async getLobby(roomId: string): Promise<LobbyData | null> {
    if (!redisService.connected) {
      return null;
    }

    try {
      const lobbyKey = `${this.LOBBY_PREFIX}${roomId}`;
      const client = redisService.getClient();
      if (!client) {
        return null;
      }

      const data = await client.get(lobbyKey);

      if (!data) {
        return null;
      }

      return JSON.parse(data) as LobbyData;
    } catch (error) {
      // Redis not connected - this is expected and non-critical
      return null;
    }
  }

  /**
   * Get all lobbies for a specific game type
   */
  async getLobbiesByGameType(gameType: GameType): Promise<LobbyData[]> {
    if (!redisService.connected) {
      return [];
    }

    try {
      const indexKey = `${this.LOBBIES_INDEX_PREFIX}${gameType}`;
      const client = redisService.getClient();
      if (!client) {
        return [];
      }

      const roomIds = await client.smembers(indexKey);

      if (roomIds.length === 0) {
        return [];
      }

      // Fetch all lobby data in parallel
      const lobbies = await Promise.all(
        roomIds.map(async (roomId) => {
          const lobby = await this.getLobby(roomId);
          return lobby;
        })
      );

      // Filter out null results and expired lobbies
      return lobbies.filter((lobby): lobby is LobbyData => lobby !== null);
    } catch (error) {
      // Redis not connected - this is expected and non-critical
      return [];
    }
  }

  /**
   * Get all active lobbies across all game types
   */
  async getAllLobbies(): Promise<LobbyData[]> {
    if (!redisService.connected) {
      return [];
    }

    try {
      // Get all lobby keys using pattern matching
      const client = redisService.getClient();
      if (!client) {
        return [];
      }

      const keys = await client.keys(`${this.LOBBY_PREFIX}*`);

      if (keys.length === 0) {
        return [];
      }

      // Fetch all lobby data in parallel
      const lobbies = await Promise.all(
        keys.map(async (key) => {
          const roomId = key.replace(this.LOBBY_PREFIX, "");
          return this.getLobby(roomId);
        })
      );

      return lobbies.filter((lobby): lobby is LobbyData => lobby !== null);
    } catch (error) {
      // Redis not connected - this is expected and non-critical
      return [];
    }
  }

  /**
   * Update lobby data (e.g., player count, status)
   */
  async updateLobby(roomId: string, updates: Partial<LobbyData>): Promise<void> {
    if (!redisService.connected) {
      return;
    }

    try {
      const lobby = await this.getLobby(roomId);
      if (!lobby) {
        logger.warn({ roomId }, "Lobby not found for update");
        return;
      }

      const updatedLobby = { ...lobby, ...updates };
      const lobbyKey = `${this.LOBBY_PREFIX}${roomId}`;

      // Get remaining TTL and preserve it
      const client = redisService.getClient();
      if (!client) {
        return;
      }

      const ttl = await client.ttl(lobbyKey);
      const ttlToUse = ttl > 0 ? ttl : this.DEFAULT_TTL;

      await client.set(lobbyKey, JSON.stringify(updatedLobby), "EX", ttlToUse);

      logger.info({ roomId, updates }, "✓ Lobby updated in Redis");

      // Publish lobby update event
      const publish = await getPublishFunction();
      await publish({ type: "updated", roomId, lobby: updatedLobby });
    } catch (error) {
      // Redis not connected - this is expected and non-critical
      logger.debug({ roomId }, "Skipped lobby update (Redis unavailable)");
    }
  }

  /**
   * Increment player count when someone joins
   */
  async playerJoined(roomId: string): Promise<void> {
    const lobby = await this.getLobby(roomId);
    if (!lobby) {
      return;
    }

    await this.updateLobby(roomId, {
      currentPlayers: lobby.currentPlayers + 1,
    });
  }

  /**
   * Decrement player count when someone leaves
   */
  async playerLeft(roomId: string): Promise<void> {
    const lobby = await this.getLobby(roomId);
    if (!lobby) {
      return;
    }

    const newPlayerCount = Math.max(0, lobby.currentPlayers - 1);

    // If no players left, delete the lobby
    if (newPlayerCount === 0) {
      await this.deleteLobby(roomId);
    } else {
      await this.updateLobby(roomId, {
        currentPlayers: newPlayerCount,
      });
    }
  }

  /**
   * Increment spectator count when a spectator joins
   */
  async spectatorJoined(roomId: string): Promise<void> {
    const lobby = await this.getLobby(roomId);
    if (!lobby) {
      return;
    }

    await this.updateLobby(roomId, {
      spectatorCount: (lobby.spectatorCount ?? 0) + 1,
    });
  }

  /**
   * Decrement spectator count when a spectator leaves
   */
  async spectatorLeft(roomId: string): Promise<void> {
    const lobby = await this.getLobby(roomId);
    if (!lobby) {
      return;
    }

    await this.updateLobby(roomId, {
      spectatorCount: Math.max(0, (lobby.spectatorCount ?? 0) - 1),
    });
  }

  /**
   * Delete a lobby (called when game starts or is cancelled)
   */
  async deleteLobby(roomId: string): Promise<void> {
    if (!redisService.connected) {
      return;
    }

    try {
      const lobby = await this.getLobby(roomId);
      if (!lobby) {
        return;
      }

      const lobbyKey = `${this.LOBBY_PREFIX}${roomId}`;
      const indexKey = `${this.LOBBIES_INDEX_PREFIX}${lobby.gameType}`;

      // Remove from Redis
      const client = redisService.getClient();
      if (!client) {
        return;
      }

      await client.del(lobbyKey);

      // Remove from game type index
      await client.srem(indexKey, roomId);

      logger.info({ roomId, gameType: lobby.gameType }, "✓ Lobby deleted from Redis");

      // Publish lobby deletion event
      const publish = await getPublishFunction();
      await publish({ type: "deleted", roomId });
    } catch (error) {
      // Redis not connected - this is expected and non-critical
      logger.debug({ roomId }, "Skipped lobby deletion (Redis unavailable)");
    }
  }

  /**
   * Mark lobby as started (game in progress)
   * This is the handoff point - lobby moves from Redis to PostgreSQL
   */
  async startGame(roomId: string): Promise<void> {
    await this.updateLobby(roomId, { status: "in-progress" });

    // Note: We keep the lobby in Redis for spectators
    // It will auto-expire after TTL
    // The actual match record is saved to PostgreSQL via historyService.recordGame()
    logger.info({ roomId }, "✓ Game started, lobby still in Redis for spectators");
  }

  /**
   * Clean up expired lobbies (optional, Redis TTL handles this automatically)
   * This is mainly for manual cleanup or testing
   */
  async cleanupExpiredLobbies(): Promise<void> {
    if (!redisService.connected) {
      return;
    }

    try {
      const allLobbies = await this.getAllLobbies();
      const now = new Date();

      for (const lobby of allLobbies) {
        const createdAt = new Date(lobby.createdAt);
        const ageInHours = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);

        // Clean up lobbies older than 2 hours (double the default TTL as safety margin)
        if (ageInHours > 2) {
          await this.deleteLobby(lobby.roomId);
          logger.info({ roomId: lobby.roomId, ageInHours }, "Cleaned up expired lobby");
        }
      }
    } catch (error) {
      // Redis not connected - this is expected and non-critical
      logger.debug("Skipped lobby cleanup (Redis unavailable)");
    }
  }
}

export const lobbyService = new LobbyService();
