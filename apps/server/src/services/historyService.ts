import { GameType } from "@multiplayer/shared";
import { database } from "./database.js";
import { userService } from "./userService.js";
import { logger } from "../logger.js";
import { config } from "../config.js";

export type HistoryResult = "win" | "loss" | "draw" | "aborted";

export interface ParticipantIdentity {
  identity: string;
  displayName: string;
  userId?: string;
  browserSessionId?: string;
  isBot?: boolean;
}

export interface RecordedGameEntry {
  id: string;
  roomId: string;
  gameType: GameType;
  result: HistoryResult;
  opponent: string;
  opponentIds: string[];
  vsBot: boolean;
  endedAt: number;
  durationMs?: number;
}

export interface RecordGamePayload {
  roomId: string;
  roomSlug?: string;
  gameType: GameType;
  winnerId: string | null;
  isDraw: boolean;
  participants: ParticipantIdentity[];
  vsBot?: boolean;
  durationMs?: number;
  totalMoves?: number;
  maxPlayers?: number;
}

// Versioned envelope written to match_event_outbox.payload_json. Bump the
// version when the shape changes and teach the flusher to handle older rows.
export interface OutboxRecordGamePayload extends RecordGamePayload {
  version: 1;
  endedAtIso: string;
}

export type MatchEventType = "disconnect" | "reconnect" | "reconnect_expired";

export interface RecordMatchEventPayload {
  roomId: string;
  roomSlug?: string;
  gameType: GameType;
  eventType: MatchEventType;
  sessionId: string;
  identity?: ParticipantIdentity;
  metadata?: Record<string, unknown>;
}

class HistoryService {
  // In-memory fallback if database is disabled
  private gamesByIdentity: Map<string, RecordedGameEntry[]> = new Map();

  /**
   * Record a game to the database (or in-memory if database is disabled)
   */
  async recordGame(payload: RecordGamePayload): Promise<void> {
    const {
      roomId,
      roomSlug,
      gameType,
      winnerId,
      isDraw,
      participants,
      vsBot = false,
      durationMs,
      totalMoves,
      maxPlayers,
    } = payload;

    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    logger.info("💾 RECORDING GAME TO STORAGE");
    logger.info(
      {
        roomId,
        gameType,
        isDraw,
        vsBot,
        participantCount: participants.length,
        humanPlayers: participants.filter((p) => !p.isBot).length,
        botPlayers: participants.filter((p) => p.isBot).length,
      },
      "Game details"
    );

    // If database is disabled, use in-memory storage
    if (!config.database.enabled) {
      logger.warn("⚠️  Database is DISABLED - saving to IN-MEMORY storage");
      logger.warn("   → This game will be LOST on server restart!");
      this.recordGameInMemory(payload);
      return;
    }

    if (!database.connected) {
      logger.error("❌ Database is NOT CONNECTED - falling back to IN-MEMORY");
      logger.error("   → Check DATABASE_URL in .env");
      logger.error("   → This game will be LOST on server restart!");
      this.recordGameInMemory(payload);
      return;
    }

    logger.info("✓ Database is connected - writing to outbox...");

    // DEA-37: outbox-first. We write a single durable outbox row inside the
    // same tx that closes the game. The background outboxFlusher fans it out
    // into matches/match_participants and updates stats. If the server crashes
    // any time after this tx commits, the row is recovered on next boot.
    const outboxPayload: OutboxRecordGamePayload = {
      version: 1,
      roomId,
      roomSlug,
      gameType,
      winnerId,
      isDraw,
      participants,
      vsBot,
      durationMs,
      totalMoves,
      maxPlayers,
      endedAtIso: new Date().toISOString(),
    };

    try {
      const inserted = await database.transaction(async (client) => {
        const result = await client.query(
          `
          INSERT INTO match_event_outbox (match_id, payload_json)
          VALUES ($1, $2)
          RETURNING id, created_at
          `,
          [roomId, JSON.stringify(outboxPayload)]
        );
        return result.rows[0] as { id: string; created_at: Date };
      });

      logger.info(
        {
          outboxId: inserted.id,
          roomId,
          gameType,
        },
        "✅ Game enqueued to match_event_outbox; flusher will fan out"
      );
    } catch (error) {
      logger.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      logger.error("❌ FAILED TO ENQUEUE GAME TO OUTBOX!");
      logger.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      logger.error({ error, roomId, gameType }, "Outbox enqueue error");
      logger.warn("   → Falling back to IN-MEMORY storage");
      // Fallback to in-memory on database error so a single-tx failure does
      // not lose the game on the client side.
      this.recordGameInMemory(payload);
    }
  }

  /**
   * In-memory storage fallback (original implementation)
   */
  private recordGameInMemory(payload: RecordGamePayload): void {
    const { roomId, gameType, winnerId, isDraw, participants, vsBot = false, durationMs } = payload;
    const endedAt = Date.now();

    participants.forEach((participant) => {
      const opponentNames = participants
        .filter((p) => p.identity !== participant.identity)
        .map((p) => p.displayName || "Opponent");
      const opponentIds = participants
        .filter((p) => p.identity !== participant.identity)
        .map((p) => p.identity);

      const result: HistoryResult = isDraw
        ? "draw"
        : winnerId === participant.identity || winnerId === participant.userId
          ? "win"
          : "loss";

      const entry: RecordedGameEntry = {
        id: `${roomId}-${participant.identity}-${endedAt}`,
        roomId,
        gameType,
        result,
        opponent: opponentNames.join(", ") || "Unknown",
        opponentIds,
        vsBot,
        endedAt,
        durationMs,
      };

      const existing = this.gamesByIdentity.get(participant.identity) || [];
      const updated = [entry, ...existing].slice(0, 50);
      this.gamesByIdentity.set(participant.identity, updated);
    });
  }

  /**
   * Get recent games for a user (from database or in-memory)
   * @param userId - The user's UUID (if authenticated)
   * @param browserSessionId - The browser session ID (for guests or authenticated users who played as guest)
   * @param limit - Maximum number of games to return
   * @param cursor - ISO timestamp cursor for pagination (get games before this timestamp)
   */
  async getRecentGames(
    userId: string | null,
    browserSessionId: string | null,
    limit = 10,
    cursor?: string
  ): Promise<RecordedGameEntry[]> {
    logger.info({ userId, browserSessionId, limit, cursor }, "Getting recent games");

    // If database is disabled, use in-memory storage (fallback to old identity format)
    if (!config.database.enabled || !database.connected) {
      const identity = userId
        ? `user:${userId}`
        : browserSessionId
          ? `guest:${browserSessionId}`
          : null;
      const games = identity ? this.gamesByIdentity.get(identity) || [] : [];
      logger.info({ identity, gameCount: games.length }, "Returning in-memory games");
      return games.slice(0, limit);
    }

    try {
      logger.info({ userId, browserSessionId }, "Querying database for games");

      // Optimized query: Use participants_snapshot instead of 4-table join
      // This is MUCH faster as we read from a single JSONB column instead of joining multiple tables
      // Uses cursor-based pagination for infinite scroll (much better than OFFSET)
      const queryParams: any[] = [userId, browserSessionId];
      let cursorCondition = "";

      if (cursor) {
        // Cursor pagination: get games BEFORE this timestamp
        cursorCondition = "AND m.ended_at < $3";
        queryParams.push(cursor);
        queryParams.push(limit);
      } else {
        queryParams.push(limit);
      }

      const matches = await database.query<{
        match_id: string;
        room_id: string;
        game_type: GameType;
        is_draw: boolean;
        vs_bot: boolean;
        ended_at: Date;
        duration_ms: number;
        result: HistoryResult;
        participants_snapshot: any;
      }>(
        `
        SELECT 
          m.id as match_id,
          m.room_id,
          m.game_type,
          m.is_draw,
          m.vs_bot,
          m.ended_at,
          m.duration_ms,
          mp.result,
          m.participants_snapshot
        FROM matches m
        JOIN match_participants mp ON m.id = mp.match_id
        JOIN users u ON mp.user_id = u.id
        WHERE (
          ($1::uuid IS NOT NULL AND u.id = $1) 
          OR ($2::text IS NOT NULL AND u.browser_session_id = $2)
        )
        ${cursorCondition}
        ORDER BY m.ended_at DESC
        LIMIT $${queryParams.length}
      `,
        queryParams
      );

      logger.info(
        { userId, browserSessionId, matchCount: matches.length },
        "Database query returned matches"
      );

      // Convert to RecordedGameEntry format
      // Extract opponent names from participants_snapshot (much faster than joins!)
      return matches.map((match) => {
        const participants = match.participants_snapshot || [];
        const opponentNames = participants
          .filter((p: any) => p.userId !== userId && !p.isBot)
          .map((p: any) => p.displayName)
          .join(", ");

        return {
          id: match.match_id,
          roomId: match.room_id,
          gameType: match.game_type,
          result: match.result,
          opponent: opponentNames || (match.vs_bot ? "Bot" : "Unknown"),
          opponentIds: [], // Not needed for display
          vsBot: match.vs_bot,
          endedAt: new Date(match.ended_at).getTime(),
          durationMs: match.duration_ms,
        };
      });
    } catch (error) {
      logger.error({ error, userId, browserSessionId }, "Failed to get recent games from database");
      // Fallback to in-memory
      const identity = userId
        ? `user:${userId}`
        : browserSessionId
          ? `guest:${browserSessionId}`
          : null;
      const games = identity ? this.gamesByIdentity.get(identity) || [] : [];
      return games.slice(0, limit);
    }
  }

  // In-memory fallback for the match_events log when the DB is offline. Bounded
  // ring so this can't grow without limit during a long degraded run.
  private matchEventsInMemory: Array<{
    roomId: string;
    roomSlug?: string;
    gameType: GameType;
    eventType: MatchEventType;
    sessionId: string;
    identity?: ParticipantIdentity;
    metadata?: Record<string, unknown>;
    eventAt: string;
  }> = [];

  async recordMatchEvent(payload: RecordMatchEventPayload): Promise<void> {
    const { roomId, roomSlug, gameType, eventType, sessionId, identity, metadata } = payload;

    logger.info(
      {
        roomId,
        roomSlug,
        gameType,
        eventType,
        sessionId,
        identityKey: identity?.identity,
        userId: identity?.userId,
        browserSessionId: identity?.browserSessionId,
      },
      "Match event"
    );

    if (!config.database.enabled || !database.connected) {
      this.matchEventsInMemory.push({
        roomId,
        roomSlug,
        gameType,
        eventType,
        sessionId,
        identity,
        metadata,
        eventAt: new Date().toISOString(),
      });
      // Cap the in-memory buffer.
      if (this.matchEventsInMemory.length > 2000) {
        this.matchEventsInMemory.splice(0, this.matchEventsInMemory.length - 2000);
      }
      return;
    }

    try {
      await database.query(
        `INSERT INTO match_events (
            room_id, room_slug, game_type, event_type,
            session_id, user_id, browser_session_id,
            display_name, metadata, event_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [
          roomId,
          roomSlug ?? null,
          gameType,
          eventType,
          sessionId,
          identity?.userId ?? null,
          identity?.browserSessionId ?? null,
          identity?.displayName ?? null,
          metadata ? JSON.stringify(metadata) : null,
        ]
      );
    } catch (err) {
      logger.error({ err, roomId, sessionId, eventType }, "Failed to insert match_event");
    }
  }

  getInMemoryMatchEvents(): ReadonlyArray<{
    roomId: string;
    roomSlug?: string;
    gameType: GameType;
    eventType: MatchEventType;
    sessionId: string;
    identity?: ParticipantIdentity;
    metadata?: Record<string, unknown>;
    eventAt: string;
  }> {
    return this.matchEventsInMemory;
  }
}

export const historyService = new HistoryService();
