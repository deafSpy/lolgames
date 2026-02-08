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

interface RecordGamePayload {
  roomId: string;
  gameType: GameType;
  winnerId: string | null;
  isDraw: boolean;
  participants: ParticipantIdentity[];
  vsBot?: boolean;
  durationMs?: number;
  totalMoves?: number;
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
      gameType,
      winnerId,
      isDraw,
      participants,
      vsBot = false,
      durationMs,
      totalMoves,
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

    logger.info("✓ Database is connected - saving to PostgreSQL...");

    try {
      await database.transaction(async (client) => {
        // Step 1: Insert match record
        const matchResult = await client.query(
          `
          INSERT INTO matches (game_type, room_id, winner_id, is_draw, vs_bot, duration_ms, total_moves, ended_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
          RETURNING id
        `,
          [
            gameType,
            roomId,
            winnerId || null,
            isDraw,
            vsBot,
            durationMs || null,
            totalMoves || null,
          ]
        );

        const matchId = matchResult.rows[0].id;

        // Step 2: Insert participants and update stats
        logger.info(`📝 Processing ${participants.length} participants...`);

        for (const participant of participants) {
          logger.info(
            {
              displayName: participant.displayName,
              userId: participant.userId,
              isBot: participant.isBot,
              identity: participant.identity,
            },
            "Processing participant"
          );

          // Skip bots for database records (they don't have user IDs)
          if (participant.isBot) {
            logger.info("   → Skipping bot participant");
            continue;
          }

          const userId = participant.userId;
          if (!userId) {
            logger.warn(
              { participant },
              "   → Participant has no userId, skipping database record"
            );
            continue;
          }

          // Determine result for this participant
          const result: HistoryResult = isDraw
            ? "draw"
            : winnerId === userId || winnerId === participant.identity
              ? "win"
              : "loss";

          logger.info({ userId, result }, "   → Saving participant with result");

          // Get current stats for ELO tracking
          const stats = await userService.getPlayerStats(userId, gameType);

          // Insert participant record
          await client.query(
            `
            INSERT INTO match_participants (match_id, user_id, result, elo_before)
            VALUES ($1, $2, $3, $4)
          `,
            [matchId, userId, result, stats.elo]
          );

          logger.info("   ✓ Participant saved to match_participants");

          // Update player stats (don't update for bot games to prevent ELO inflation)
          if (!vsBot) {
            await userService.updatePlayerStats(userId, gameType, result);
            logger.info("   ✓ Player stats updated");
          } else {
            logger.info("   → Skipping stats update for bot game");
          }
        }

        logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        logger.info("✅ GAME SAVED TO DATABASE!");
        logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        logger.info(
          {
            matchId,
            roomId,
            gameType,
            participantCount: participants.filter((p) => !p.isBot).length,
          },
          "Database record details"
        );
        logger.info("   → Check Supabase Table Editor");
        logger.info("   → Table: matches");
        logger.info(`   → Match ID: ${matchId}`);
      });
    } catch (error) {
      logger.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      logger.error("❌ FAILED TO SAVE GAME TO DATABASE!");
      logger.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      logger.error({ error, roomId, gameType }, "Database save error");
      logger.warn("   → Falling back to IN-MEMORY storage");
      // Fallback to in-memory on database error
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
   */
  async getRecentGames(
    userId: string | null,
    browserSessionId: string | null,
    limit = 10
  ): Promise<RecordedGameEntry[]> {
    logger.info({ userId, browserSessionId, limit }, "Getting recent games");

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

      // Query matches from database - search by userId OR browserSessionId
      const matches = await database.query<{
        match_id: string;
        room_id: string;
        game_type: GameType;
        is_draw: boolean;
        vs_bot: boolean;
        ended_at: Date;
        duration_ms: number;
        result: HistoryResult;
        opponent_names: string;
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
          string_agg(DISTINCT u2.display_name, ', ') as opponent_names
        FROM matches m
        JOIN match_participants mp ON m.id = mp.match_id
        JOIN users u ON mp.user_id = u.id
        LEFT JOIN match_participants mp2 ON m.id = mp2.match_id AND mp2.user_id != mp.user_id
        LEFT JOIN users u2 ON mp2.user_id = u2.id
        WHERE (
          ($1::uuid IS NOT NULL AND u.id = $1) 
          OR ($2::text IS NOT NULL AND u.browser_session_id = $2)
        )
        GROUP BY m.id, m.room_id, m.game_type, m.is_draw, m.vs_bot, m.ended_at, m.duration_ms, mp.result, mp.user_id
        ORDER BY m.ended_at DESC
        LIMIT $3
      `,
        [userId, browserSessionId, limit]
      );

      logger.info(
        { userId, browserSessionId, matchCount: matches.length },
        "Database query returned matches"
      );

      // Convert to RecordedGameEntry format
      return matches.map((match) => ({
        id: match.match_id,
        roomId: match.room_id,
        gameType: match.game_type,
        result: match.result,
        opponent: match.opponent_names || "Unknown",
        opponentIds: [], // Not needed for display
        vsBot: match.vs_bot,
        endedAt: new Date(match.ended_at).getTime(),
        durationMs: match.duration_ms,
      }));
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
}

export const historyService = new HistoryService();
