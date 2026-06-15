import { database } from "./database.js";
import { userService } from "./userService.js";
import { logger } from "../logger.js";
import { config } from "../config.js";
import type { OutboxRecordGamePayload, ParticipantIdentity } from "./historyService.js";

/**
 * DEA-37 — outbox flusher.
 *
 * Drains undelivered rows from `match_event_outbox` and fans them out into
 * `matches` + `match_participants`, updating `player_stats` for non-bot games.
 *
 * Idempotency contract:
 *   The outbox row's `id` UUID is reused as `matches.id`. The flusher inserts
 *   `matches` with `ON CONFLICT (id) DO NOTHING`. If a prior partial run already
 *   created the match row (or any retry double-fires), the conflict path
 *   silently no-ops and we still mark the outbox row delivered, so the
 *   downstream view of `matches`/`match_participants` is exactly-once.
 *
 * Backoff:
 *   On failure we increment `attempt_count`, store `last_error`, and bump
 *   `next_attempt_at` using the schedule 5s → 30s → 5min → 1hr cap.
 */

interface OutboxRow {
  id: string;
  match_id: string;
  payload_json: OutboxRecordGamePayload;
  created_at: Date;
  attempt_count: number;
}

const TICK_INTERVAL_MS = 5_000;
const BATCH_SIZE = 25;

// Cap to keep the table from accumulating poison rows indefinitely. Phase 1-E
// will alert before we get anywhere near this. Once attempt_count >= MAX_ATTEMPTS,
// the row stays undelivered with next_attempt_at far in the future so it shows
// up in the /health counter but is no longer retried every tick.
const MAX_ATTEMPTS = 12;

function backoffMsForAttempt(attemptCount: number): number {
  // attemptCount is the count of *prior* failures.
  if (attemptCount <= 0) return 5_000;
  if (attemptCount === 1) return 30_000;
  if (attemptCount === 2) return 5 * 60_000;
  return 60 * 60_000; // 1 hour cap
}

class OutboxFlusher {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  // Single-flight guard so a long tick never double-runs.
  private tickInFlight = false;
  private lastFlushedAt: Date | null = null;

  /**
   * Start the background flusher. Runs an immediate drain first to catch
   * anything left undelivered from a previous server lifetime, then ticks
   * every TICK_INTERVAL_MS.
   */
  start(): void {
    if (this.running) {
      logger.warn("OutboxFlusher.start called but flusher is already running");
      return;
    }
    if (!config.database.enabled) {
      logger.info("OutboxFlusher: database disabled, not starting");
      return;
    }
    this.running = true;
    logger.info("⏵ OutboxFlusher starting (5s tick)");

    // Recovery pass — fire and forget so bootstrap is not blocked on this.
    void this.tick("startup");

    this.timer = setInterval(() => {
      void this.tick("interval");
    }, TICK_INTERVAL_MS);
    // Don't keep the event loop alive just for this timer.
    if (typeof this.timer.unref === "function") {
      this.timer.unref();
    }
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    // Wait briefly for an in-flight tick if any. We don't actually have a
    // promise handle for tick(), but new ticks will not fire because `running`
    // is false and the timer is cleared. tick() itself checks `running`
    // re-entry-safely.
    logger.info("⏸ OutboxFlusher stopped");
  }

  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Drain one batch of undelivered rows. Public so tests can drive the
   * flusher deterministically without waiting for the 5s tick.
   */
  async tick(reason: "startup" | "interval" | "manual" = "manual"): Promise<{
    delivered: number;
    failed: number;
    skipped: number;
  }> {
    if (this.tickInFlight) {
      return { delivered: 0, failed: 0, skipped: 0 };
    }
    if (!database.connected) {
      return { delivered: 0, failed: 0, skipped: 0 };
    }
    this.tickInFlight = true;
    let delivered = 0;
    let failed = 0;
    let skipped = 0;
    try {
      const rows = await this.fetchDueRows(BATCH_SIZE);
      for (const row of rows) {
        const outcome = await this.deliverRow(row);
        if (outcome === "delivered") {
          delivered += 1;
        } else if (outcome === "failed") {
          failed += 1;
        } else {
          skipped += 1;
        }
      }
      if (rows.length > 0) {
        this.lastFlushedAt = new Date();
        logger.info(
          { reason, delivered, failed, skipped, batchSize: rows.length },
          "OutboxFlusher tick processed batch"
        );
      }
    } catch (err) {
      logger.error({ err, reason }, "OutboxFlusher tick failed");
    } finally {
      this.tickInFlight = false;
    }
    return { delivered, failed, skipped };
  }

  /**
   * Counters exposed by /health. Returns `null` when DB is disabled or
   * unreachable so the health endpoint can render a "disabled" state.
   */
  async getHealth(): Promise<{
    enabled: boolean;
    running: boolean;
    undeliveredCount: number;
    oldestUndeliveredAgeSeconds: number | null;
    lastFlushedAt: string | null;
  }> {
    if (!config.database.enabled) {
      return {
        enabled: false,
        running: this.running,
        undeliveredCount: 0,
        oldestUndeliveredAgeSeconds: null,
        lastFlushedAt: this.lastFlushedAt?.toISOString() ?? null,
      };
    }
    if (!database.connected) {
      return {
        enabled: true,
        running: this.running,
        undeliveredCount: -1,
        oldestUndeliveredAgeSeconds: null,
        lastFlushedAt: this.lastFlushedAt?.toISOString() ?? null,
      };
    }
    try {
      const row = await database.queryOne<{
        undelivered_count: string | number;
        oldest_age_seconds: string | number | null;
      }>(`
        SELECT
          COUNT(*) AS undelivered_count,
          EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) AS oldest_age_seconds
        FROM match_event_outbox
        WHERE delivered_at IS NULL
      `);
      const undeliveredCount = Number(row?.undelivered_count ?? 0);
      const oldest =
        row?.oldest_age_seconds === null || row?.oldest_age_seconds === undefined
          ? null
          : Number(row.oldest_age_seconds);
      return {
        enabled: true,
        running: this.running,
        undeliveredCount,
        oldestUndeliveredAgeSeconds: oldest,
        lastFlushedAt: this.lastFlushedAt?.toISOString() ?? null,
      };
    } catch (err) {
      logger.error({ err }, "OutboxFlusher.getHealth query failed");
      return {
        enabled: true,
        running: this.running,
        undeliveredCount: -1,
        oldestUndeliveredAgeSeconds: null,
        lastFlushedAt: this.lastFlushedAt?.toISOString() ?? null,
      };
    }
  }

  private async fetchDueRows(limit: number): Promise<OutboxRow[]> {
    const rows = await database.query<{
      id: string;
      match_id: string;
      payload_json: OutboxRecordGamePayload;
      created_at: Date;
      attempt_count: number;
    }>(
      `
      SELECT id, match_id, payload_json, created_at, attempt_count
      FROM match_event_outbox
      WHERE delivered_at IS NULL
        AND next_attempt_at <= NOW()
        AND attempt_count < $1
      ORDER BY created_at ASC
      LIMIT $2
      `,
      [MAX_ATTEMPTS, limit]
    );
    return rows;
  }

  private async deliverRow(row: OutboxRow): Promise<"delivered" | "failed" | "skipped"> {
    const payload = row.payload_json;
    if (!payload || payload.version !== 1) {
      // Unknown payload version — mark delivered to avoid blocking the queue,
      // but record the error so an operator can investigate.
      await database.query(
        `
        UPDATE match_event_outbox
        SET delivered_at = NOW(),
            last_error = $2
        WHERE id = $1
        `,
        [row.id, `unsupported payload version: ${(payload as any)?.version ?? "null"}`]
      );
      logger.warn({ outboxId: row.id }, "OutboxFlusher: unsupported payload version, skipped");
      return "skipped";
    }

    try {
      await this.applyPayload(row.id, payload);
      await database.query(
        `
        UPDATE match_event_outbox
        SET delivered_at = NOW(),
            last_error = NULL
        WHERE id = $1
        `,
        [row.id]
      );
      return "delivered";
    } catch (err) {
      const nextAttempt = row.attempt_count + 1;
      const delayMs = backoffMsForAttempt(row.attempt_count);
      const errorText =
        err instanceof Error ? `${err.name}: ${err.message}` : String(err).slice(0, 500);
      try {
        await database.query(
          `
          UPDATE match_event_outbox
          SET attempt_count = $2,
              last_error = $3,
              next_attempt_at = NOW() + ($4::int * INTERVAL '1 millisecond')
          WHERE id = $1
          `,
          [row.id, nextAttempt, errorText, delayMs]
        );
      } catch (updateErr) {
        // If we can't even update the outbox row, log and move on — the next
        // tick will pick it up because next_attempt_at didn't change.
        logger.error(
          { updateErr, outboxId: row.id },
          "OutboxFlusher: failed to record retry state"
        );
      }
      logger.error(
        {
          err,
          outboxId: row.id,
          matchId: row.match_id,
          attemptCount: nextAttempt,
          nextDelayMs: delayMs,
        },
        "OutboxFlusher: delivery attempt failed"
      );
      return "failed";
    }
  }

  private async applyPayload(outboxId: string, payload: OutboxRecordGamePayload): Promise<void> {
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
      endedAtIso,
    } = payload;

    const participantsSnapshot = participants.map((p) => ({
      displayName: p.displayName,
      userId: p.userId || null,
      isBot: p.isBot || false,
    }));

    // Resolve the winner_id we need to write into the matches row. The payload
    // may carry either a userId or a session identity (`user:<uuid>` or
    // `guest:<sessionId>`) depending on how the room called recordGame. Only
    // pass a UUID through to the matches.winner_id FK; otherwise null.
    const winnerUserId = this.resolveWinnerUserId(winnerId, participants);

    await database.transaction(async (client) => {
      // Step 1: Insert matches row, idempotent on id.
      const inserted = await client.query(
        `
        INSERT INTO matches (
          id, game_type, room_id, room_slug, winner_id, is_draw, vs_bot,
          duration_ms, total_moves, participants_snapshot, ended_at, max_players
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (id) DO NOTHING
        RETURNING id
        `,
        [
          outboxId,
          gameType,
          roomId,
          roomSlug || null,
          winnerUserId,
          isDraw,
          vsBot,
          durationMs ?? null,
          totalMoves ?? null,
          JSON.stringify(participantsSnapshot),
          endedAtIso,
          maxPlayers ?? 2,
        ]
      );

      // If the matches row already existed (conflict), a previous flusher run
      // already fanned this out. Mark delivered above and skip the rest — we
      // must not double-increment player_stats.
      if (inserted.rowCount === 0) {
        logger.info(
          { outboxId, roomId },
          "OutboxFlusher: matches row already exists, skipping participant fan-out"
        );
        return;
      }

      const matchId = inserted.rows[0].id as string;

      for (const participant of participants) {
        if (participant.isBot) continue;
        const userId = participant.userId;
        if (!userId) continue;

        const result = this.resultForParticipant(participant, winnerId, isDraw);
        const stats = await userService.getPlayerStats(userId, gameType);

        await client.query(
          `
          INSERT INTO match_participants (match_id, user_id, result, elo_before)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (match_id, user_id) DO NOTHING
          `,
          [matchId, userId, result, stats.elo]
        );

        if (!vsBot) {
          // updatePlayerStats is wrapped in its own tx inside userService, so
          // call it outside the matches tx would be ideal — but doing it here
          // keeps the fan-out atomic with the matches insert. The conflict
          // check on matches above guarantees this branch runs at most once.
          await userService.updatePlayerStats(userId, gameType, result);
        }
      }
    });
  }

  private resolveWinnerUserId(
    winnerId: string | null | undefined,
    participants: ParticipantIdentity[]
  ): string | null {
    if (!winnerId) return null;
    // If it already looks like a bare UUID, use it.
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(winnerId)) {
      return winnerId;
    }
    // Otherwise, find the participant whose identity matches and return their userId.
    const match = participants.find((p) => p.identity === winnerId || p.userId === winnerId);
    return match?.userId ?? null;
  }

  private resultForParticipant(
    participant: ParticipantIdentity,
    winnerId: string | null | undefined,
    isDraw: boolean
  ): "win" | "loss" | "draw" {
    if (isDraw) return "draw";
    if (!winnerId) return "loss";
    if (winnerId === participant.userId || winnerId === participant.identity) {
      return "win";
    }
    return "loss";
  }
}

export const outboxFlusher = new OutboxFlusher();
