import { describe, it, expect, beforeEach, vi } from "vitest";
import { GameType } from "@multiplayer/shared";

// ---------------------------------------------------------------------------
// Fake in-memory Postgres-like database that backs the outbox + matches +
// match_participants tables for this test. It implements just enough of the
// `database` service shape (`connected`, `query`, `queryOne`, `transaction`)
// for historyService + outboxFlusher to exercise the full crash/recovery path
// without a real Postgres.
// ---------------------------------------------------------------------------

interface OutboxRow {
  id: string;
  match_id: string;
  payload_json: any;
  created_at: Date;
  delivered_at: Date | null;
  attempt_count: number;
  last_error: string | null;
  next_attempt_at: Date;
}

interface MatchRow {
  id: string;
  game_type: string;
  room_id: string;
  room_slug: string | null;
  winner_id: string | null;
  is_draw: boolean;
  vs_bot: boolean;
  duration_ms: number | null;
  total_moves: number | null;
  participants_snapshot: any;
  ended_at: Date;
  max_players: number;
}

interface ParticipantRow {
  match_id: string;
  user_id: string;
  result: string;
  elo_before: number | null;
}

interface QueryResult {
  rows: any[];
  rowCount: number;
}

class FakeDb {
  outbox: OutboxRow[] = [];
  matches: MatchRow[] = [];
  participants: ParticipantRow[] = [];

  // Crash hooks: each hook returns truthy to crash the matching query. Cleared
  // between tests.
  crashOn: ((sql: string, params?: any[]) => boolean) | null = null;

  connected = true;

  private execute(sql: string, params: any[] = []): QueryResult {
    if (this.crashOn && this.crashOn(sql, params)) {
      const err = new Error("simulated DB crash");
      (err as any).simulatedCrash = true;
      throw err;
    }

    if (sql.includes("INSERT INTO match_event_outbox")) {
      const [matchId, payloadJson] = params;
      const row: OutboxRow = {
        id: `outbox-${this.outbox.length + 1}`,
        match_id: matchId,
        payload_json: typeof payloadJson === "string" ? JSON.parse(payloadJson) : payloadJson,
        created_at: new Date(),
        delivered_at: null,
        attempt_count: 0,
        last_error: null,
        next_attempt_at: new Date(),
      };
      this.outbox.push(row);
      return { rows: [{ id: row.id, created_at: row.created_at }], rowCount: 1 };
    }

    if (sql.includes("SELECT id, match_id, payload_json")) {
      const now = new Date();
      const limit = Number(params[1] ?? 25);
      const maxAttempts = Number(params[0] ?? 12);
      const rows = this.outbox
        .filter(
          (r) =>
            r.delivered_at === null &&
            r.next_attempt_at.getTime() <= now.getTime() &&
            r.attempt_count < maxAttempts
        )
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
        .slice(0, limit)
        .map((r) => ({
          id: r.id,
          match_id: r.match_id,
          payload_json: r.payload_json,
          created_at: r.created_at,
          attempt_count: r.attempt_count,
        }));
      return { rows, rowCount: rows.length };
    }

    if (sql.includes("SELECT") && sql.includes("undelivered_count")) {
      const undelivered = this.outbox.filter((r) => r.delivered_at === null);
      const oldest =
        undelivered.length === 0
          ? null
          : (Date.now() - Math.min(...undelivered.map((r) => r.created_at.getTime()))) / 1000;
      return {
        rows: [
          {
            undelivered_count: undelivered.length,
            oldest_age_seconds: oldest,
          },
        ],
        rowCount: 1,
      };
    }

    if (sql.includes("INSERT INTO matches")) {
      const [
        id,
        gameType,
        roomId,
        roomSlug,
        winnerId,
        isDraw,
        vsBot,
        durationMs,
        totalMoves,
        snapshot,
        endedAt,
        maxPlayers,
      ] = params;
      if (sql.includes("ON CONFLICT (id) DO NOTHING")) {
        if (this.matches.some((m) => m.id === id)) {
          // simulate ON CONFLICT skipping the insert
          return { rows: [], rowCount: 0 };
        }
      }
      const row: MatchRow = {
        id,
        game_type: gameType,
        room_id: roomId,
        room_slug: roomSlug,
        winner_id: winnerId,
        is_draw: isDraw,
        vs_bot: vsBot,
        duration_ms: durationMs,
        total_moves: totalMoves,
        participants_snapshot: typeof snapshot === "string" ? JSON.parse(snapshot) : snapshot,
        ended_at: new Date(endedAt),
        max_players: maxPlayers ?? 2,
      };
      this.matches.push(row);
      return { rows: [{ id: row.id }], rowCount: 1 };
    }

    if (sql.includes("INSERT INTO match_participants")) {
      const [matchId, userId, result, eloBefore] = params;
      // ON CONFLICT (match_id, user_id) DO NOTHING simulation
      if (
        sql.includes("ON CONFLICT") &&
        this.participants.some((p) => p.match_id === matchId && p.user_id === userId)
      ) {
        return { rows: [], rowCount: 0 };
      }
      this.participants.push({ match_id: matchId, user_id: userId, result, elo_before: eloBefore });
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes("UPDATE match_event_outbox")) {
      const id = params[params.length === 1 ? 0 : 0];
      const row = this.outbox.find((r) => r.id === id);
      if (!row) return { rows: [], rowCount: 0 };
      if (sql.includes("delivered_at = NOW()")) {
        row.delivered_at = new Date();
        // last_error optional second param
        if (params.length === 2) {
          row.last_error = params[1];
        } else {
          row.last_error = null;
        }
      } else if (sql.includes("attempt_count = $2")) {
        row.attempt_count = Number(params[1]);
        row.last_error = String(params[2]);
        const delayMs = Number(params[3]);
        row.next_attempt_at = new Date(Date.now() + delayMs);
      }
      return { rows: [], rowCount: 1 };
    }

    // Anything we don't model — return empty.
    return { rows: [], rowCount: 0 };
  }

  query = vi.fn(async (sql: string, params?: any[]) => {
    const result = this.execute(sql, params ?? []);
    return result.rows;
  });

  queryOne = vi.fn(async (sql: string, params?: any[]) => {
    const result = this.execute(sql, params ?? []);
    return result.rows[0] ?? null;
  });

  transaction = vi.fn(async (cb: (client: any) => Promise<unknown>) => {
    const client = {
      query: async (sql: string, params?: any[]) => this.execute(sql, params ?? []),
    };
    return cb(client);
  });
}

const fakeDb = new FakeDb();

const mockConfig = {
  database: { enabled: true },
  game: { turnTimeLimit: 30000 },
};

vi.mock("../config.js", () => ({
  get config() {
    return mockConfig;
  },
}));

vi.mock("./database.js", () => ({
  database: fakeDb,
}));

const getPlayerStatsMock = vi.fn(async () => ({ elo: 1000 }));
const updatePlayerStatsMock = vi.fn(async () => undefined);

vi.mock("./userService.js", () => ({
  userService: {
    getPlayerStats: getPlayerStatsMock,
    updatePlayerStats: updatePlayerStatsMock,
  },
}));

vi.mock("../logger.js", () => ({
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

// Import AFTER mocks are registered. Both modules share the same fakeDb.
const { historyService } = await import("./historyService.js");
const { outboxFlusher } = await import("./outboxFlusher.js");

function resetFakeDb() {
  fakeDb.outbox = [];
  fakeDb.matches = [];
  fakeDb.participants = [];
  fakeDb.crashOn = null;
  fakeDb.connected = true;
  fakeDb.query.mockClear();
  fakeDb.queryOne.mockClear();
  fakeDb.transaction.mockClear();
}

describe("outboxFlusher — crash safety (DEA-37)", () => {
  beforeEach(() => {
    mockConfig.database.enabled = true;
    resetFakeDb();
    getPlayerStatsMock.mockClear();
    updatePlayerStatsMock.mockClear();
  });

  it("survives a server crash between recordGame and the flusher fan-out", async () => {
    // ---- Step 1: a Connect 4 game finishes. recordGame writes the outbox row. ----
    const winner = {
      identity: "user:11111111-1111-1111-1111-111111111111",
      displayName: "Ivy",
      userId: "11111111-1111-1111-1111-111111111111",
      isBot: false,
    };
    const loser = {
      identity: "user:22222222-2222-2222-2222-222222222222",
      displayName: "Jon",
      userId: "22222222-2222-2222-2222-222222222222",
      isBot: false,
    };

    await historyService.recordGame({
      roomId: "room-crash-1",
      roomSlug: "calm-blue-fox",
      gameType: GameType.CONNECT4,
      winnerId: winner.userId,
      isDraw: false,
      participants: [winner, loser],
      vsBot: false,
      durationMs: 9_000,
      totalMoves: 18,
    });

    // The outbox row is durable. matches has NOT been written yet.
    expect(fakeDb.outbox).toHaveLength(1);
    expect(fakeDb.outbox[0].delivered_at).toBeNull();
    expect(fakeDb.outbox[0].payload_json.roomId).toBe("room-crash-1");
    expect(fakeDb.matches).toHaveLength(0);
    expect(fakeDb.participants).toHaveLength(0);

    // ---- Step 2: simulate a crash on the matches insert during the flusher. ----
    fakeDb.crashOn = (sql) => sql.includes("INSERT INTO matches");
    const failed = await outboxFlusher.tick("manual");
    expect(failed.failed).toBe(1);
    expect(failed.delivered).toBe(0);

    // Outbox row still undelivered, with the failure recorded.
    expect(fakeDb.outbox[0].delivered_at).toBeNull();
    expect(fakeDb.outbox[0].attempt_count).toBe(1);
    expect(fakeDb.outbox[0].last_error).toContain("simulated DB crash");

    // matches is still empty — no half-state leaked through the failed tx.
    expect(fakeDb.matches).toHaveLength(0);

    // The first retry is gated by the backoff schedule (5s after first
    // failure); rewind next_attempt_at so the next tick is allowed to run.
    fakeDb.outbox[0].next_attempt_at = new Date(Date.now() - 1000);

    // ---- Step 3: restart with a working DB and re-run the flusher. ----
    fakeDb.crashOn = null;
    const recovered = await outboxFlusher.tick("startup");
    expect(recovered.delivered).toBe(1);
    expect(recovered.failed).toBe(0);

    // matches row materializes; outbox row marked delivered.
    expect(fakeDb.matches).toHaveLength(1);
    expect(fakeDb.matches[0].room_id).toBe("room-crash-1");
    expect(fakeDb.matches[0].game_type).toBe(GameType.CONNECT4);
    expect(fakeDb.matches[0].winner_id).toBe(winner.userId);
    expect(fakeDb.outbox[0].delivered_at).not.toBeNull();
    expect(fakeDb.outbox[0].last_error).toBeNull();

    // Participants written for both human players; stats updated once per
    // human (non-bot game).
    expect(fakeDb.participants).toHaveLength(2);
    const resultsByUser = new Map(fakeDb.participants.map((p) => [p.user_id, p.result]));
    expect(resultsByUser.get(winner.userId)).toBe("win");
    expect(resultsByUser.get(loser.userId)).toBe("loss");
    expect(updatePlayerStatsMock).toHaveBeenCalledTimes(2);
  });

  it("is exactly-once across duplicate ticks (matches.id collision short-circuits the fan-out)", async () => {
    const human = {
      identity: "user:55555555-5555-5555-5555-555555555555",
      displayName: "Mia",
      userId: "55555555-5555-5555-5555-555555555555",
      isBot: false,
    };
    const bot = {
      identity: "bot:botid",
      displayName: "Connect Bot",
      isBot: true,
    };

    await historyService.recordGame({
      roomId: "room-idemp-1",
      gameType: GameType.CONNECT4,
      winnerId: human.userId,
      isDraw: false,
      participants: [human, bot],
      vsBot: true,
    });

    // First tick: delivers cleanly.
    const first = await outboxFlusher.tick("manual");
    expect(first.delivered).toBe(1);
    expect(fakeDb.matches).toHaveLength(1);
    expect(fakeDb.participants).toHaveLength(1);

    // Simulate a worst-case scenario: the outbox row was never marked
    // delivered (e.g. the UPDATE crashed). Re-run the flusher.
    fakeDb.outbox[0].delivered_at = null;
    fakeDb.outbox[0].next_attempt_at = new Date(Date.now() - 1000);

    const second = await outboxFlusher.tick("manual");
    // No new matches/participants rows; no double stats update.
    expect(fakeDb.matches).toHaveLength(1);
    expect(fakeDb.participants).toHaveLength(1);
    // vs-bot game — never updates stats.
    expect(updatePlayerStatsMock).not.toHaveBeenCalled();
    // The second pass marks the outbox row delivered without re-applying.
    expect(fakeDb.outbox[0].delivered_at).not.toBeNull();
    // delivered count includes the no-op apply because matches still mapped
    // to the same outbox id (conflict path is success).
    expect(second.delivered).toBe(1);
  });

  it("getHealth reports undelivered count and oldest age", async () => {
    const p1 = {
      identity: "user:77777777-7777-7777-7777-777777777777",
      displayName: "Pat",
      userId: "77777777-7777-7777-7777-777777777777",
      isBot: false,
    };
    const p2 = {
      identity: "user:88888888-8888-8888-8888-888888888888",
      displayName: "Quinn",
      userId: "88888888-8888-8888-8888-888888888888",
      isBot: false,
    };

    await historyService.recordGame({
      roomId: "room-health-1",
      gameType: GameType.CONNECT4,
      winnerId: p1.userId,
      isDraw: false,
      participants: [p1, p2],
    });

    // Backdate the outbox row so the "oldest age" surfaces a non-zero value.
    fakeDb.outbox[0].created_at = new Date(Date.now() - 7_000);

    const health = await outboxFlusher.getHealth();
    expect(health.enabled).toBe(true);
    expect(health.undeliveredCount).toBe(1);
    expect(health.oldestUndeliveredAgeSeconds).not.toBeNull();
    expect(health.oldestUndeliveredAgeSeconds!).toBeGreaterThanOrEqual(5);
  });

  it("getHealth short-circuits when DATABASE_ENABLED=false", async () => {
    mockConfig.database.enabled = false;
    const health = await outboxFlusher.getHealth();
    expect(health.enabled).toBe(false);
    expect(health.undeliveredCount).toBe(0);
    expect(health.oldestUndeliveredAgeSeconds).toBeNull();
  });

  it("persists max_players from the outbox payload onto the matches row (DEA-14-P1-B)", async () => {
    // A 2-player connect4 game lands with max_players=2.
    await historyService.recordGame({
      roomId: "room-mp-2p",
      gameType: GameType.CONNECT4,
      winnerId: "11111111-1111-1111-1111-111111111111",
      isDraw: false,
      participants: [
        {
          identity: "user:11111111-1111-1111-1111-111111111111",
          displayName: "P1",
          userId: "11111111-1111-1111-1111-111111111111",
          isBot: false,
        },
        {
          identity: "user:22222222-2222-2222-2222-222222222222",
          displayName: "P2",
          userId: "22222222-2222-2222-2222-222222222222",
          isBot: false,
        },
      ],
      maxPlayers: 2,
    });

    // A 4-player sequence game lands with max_players=4.
    await historyService.recordGame({
      roomId: "room-mp-4p",
      gameType: GameType.SEQUENCE,
      winnerId: "33333333-3333-3333-3333-333333333333",
      isDraw: false,
      participants: [
        {
          identity: "user:33333333-3333-3333-3333-333333333333",
          displayName: "P3",
          userId: "33333333-3333-3333-3333-333333333333",
          isBot: false,
        },
        {
          identity: "user:44444444-4444-4444-4444-444444444444",
          displayName: "P4",
          userId: "44444444-4444-4444-4444-444444444444",
          isBot: false,
        },
      ],
      maxPlayers: 4,
    });

    const tick = await outboxFlusher.tick("manual");
    expect(tick.delivered).toBe(2);

    const twoPlayer = fakeDb.matches.find((m) => m.room_id === "room-mp-2p");
    const fourPlayer = fakeDb.matches.find((m) => m.room_id === "room-mp-4p");
    expect(twoPlayer?.max_players).toBe(2);
    expect(fourPlayer?.max_players).toBe(4);
  });

  it("falls back to max_players=2 when the outbox payload omits it (legacy rows)", async () => {
    // Simulate an older payload that pre-dates DEA-14-P1-B (no maxPlayers field).
    await historyService.recordGame({
      roomId: "room-mp-legacy",
      gameType: GameType.CONNECT4,
      winnerId: "55555555-5555-5555-5555-555555555555",
      isDraw: false,
      participants: [
        {
          identity: "user:55555555-5555-5555-5555-555555555555",
          displayName: "P5",
          userId: "55555555-5555-5555-5555-555555555555",
          isBot: false,
        },
        {
          identity: "user:66666666-6666-6666-6666-666666666666",
          displayName: "P6",
          userId: "66666666-6666-6666-6666-666666666666",
          isBot: false,
        },
      ],
      // maxPlayers intentionally omitted
    });

    const tick = await outboxFlusher.tick("manual");
    expect(tick.delivered).toBe(1);
    const row = fakeDb.matches.find((m) => m.room_id === "room-mp-legacy");
    expect(row?.max_players).toBe(2);
  });
});
