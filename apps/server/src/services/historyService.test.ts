import { describe, it, expect, beforeEach, vi } from "vitest";
import { GameType } from "@multiplayer/shared";

// Mutable config so each test can toggle DB on/off
const mockConfig = {
  database: { enabled: false },
  game: { turnTimeLimit: 30000 },
};

vi.mock("../config.js", () => ({
  get config() {
    return mockConfig;
  },
}));

const queryMock = vi.fn();
const transactionMock = vi.fn();
const databaseMock = {
  get connected() {
    return mockConfig.database.enabled;
  },
  query: queryMock,
  transaction: transactionMock,
};

vi.mock("./database.js", () => ({
  database: databaseMock,
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

// Import AFTER mocks are registered
const { historyService } = await import("./historyService.js");

function buildParticipant(opts: {
  userId?: string;
  browserSessionId?: string;
  displayName: string;
  isBot?: boolean;
}) {
  const identity = opts.userId
    ? `user:${opts.userId}`
    : opts.browserSessionId
      ? `guest:${opts.browserSessionId}`
      : `guest:${opts.displayName}`;
  return {
    identity,
    displayName: opts.displayName,
    userId: opts.userId,
    browserSessionId: opts.browserSessionId,
    isBot: opts.isBot ?? false,
  };
}

describe("historyService (in-memory mode, DATABASE_ENABLED=false)", () => {
  beforeEach(() => {
    mockConfig.database.enabled = false;
    queryMock.mockReset();
    transactionMock.mockReset();
    getPlayerStatsMock.mockClear();
    updatePlayerStatsMock.mockClear();
    // Reset in-memory store between tests by creating a fresh require would be ideal,
    // but the singleton is shared. We tag each test with unique session IDs to avoid leakage.
  });

  it("records a Connect 4 win and surfaces both players' history", async () => {
    const winner = buildParticipant({ browserSessionId: "win-p1", displayName: "Alice" });
    const loser = buildParticipant({ browserSessionId: "win-p2", displayName: "Bob" });

    await historyService.recordGame({
      roomId: "room-win-1",
      roomSlug: "swift-blue-fox",
      gameType: GameType.CONNECT4,
      winnerId: winner.identity,
      isDraw: false,
      participants: [winner, loser],
      vsBot: false,
      durationMs: 12_345,
      totalMoves: 22,
    });

    const winnerHistory = await historyService.getRecentGames(null, "win-p1", 10);
    const loserHistory = await historyService.getRecentGames(null, "win-p2", 10);

    expect(winnerHistory.find((g) => g.roomId === "room-win-1")?.result).toBe("win");
    expect(loserHistory.find((g) => g.roomId === "room-win-1")?.result).toBe("loss");
    expect(winnerHistory.find((g) => g.roomId === "room-win-1")?.gameType).toBe(GameType.CONNECT4);
    expect(winnerHistory.find((g) => g.roomId === "room-win-1")?.opponent).toContain("Bob");
    expect(loserHistory.find((g) => g.roomId === "room-win-1")?.opponent).toContain("Alice");
  });

  it("records a Connect 4 draw as 'draw' for both players", async () => {
    const p1 = buildParticipant({ browserSessionId: "draw-p1", displayName: "Cara" });
    const p2 = buildParticipant({ browserSessionId: "draw-p2", displayName: "Dan" });

    await historyService.recordGame({
      roomId: "room-draw-1",
      gameType: GameType.CONNECT4,
      winnerId: null,
      isDraw: true,
      participants: [p1, p2],
    });

    const p1History = await historyService.getRecentGames(null, "draw-p1", 10);
    const p2History = await historyService.getRecentGames(null, "draw-p2", 10);

    expect(p1History.find((g) => g.roomId === "room-draw-1")?.result).toBe("draw");
    expect(p2History.find((g) => g.roomId === "room-draw-1")?.result).toBe("draw");
  });

  it("records a Connect 4 surrender as win for the survivor and loss for the forfeiter", async () => {
    // Surrender path in BaseRoom.handlePlayerForfeit picks the other initial player as winner
    // and calls endGame(winnerId, false). historyService sees the same shape as a normal win.
    const survivor = buildParticipant({ browserSessionId: "surr-p1", displayName: "Eve" });
    const forfeiter = buildParticipant({ browserSessionId: "surr-p2", displayName: "Finn" });

    await historyService.recordGame({
      roomId: "room-surr-1",
      gameType: GameType.CONNECT4,
      winnerId: survivor.identity,
      isDraw: false,
      participants: [survivor, forfeiter],
    });

    const survivorHistory = await historyService.getRecentGames(null, "surr-p1", 10);
    const forfeiterHistory = await historyService.getRecentGames(null, "surr-p2", 10);

    expect(survivorHistory.find((g) => g.roomId === "room-surr-1")?.result).toBe("win");
    expect(forfeiterHistory.find((g) => g.roomId === "room-surr-1")?.result).toBe("loss");
  });

  it("does not throw and falls back cleanly when DATABASE_ENABLED=false", async () => {
    mockConfig.database.enabled = false;
    const p1 = buildParticipant({ browserSessionId: "fallback-p1", displayName: "Greta" });
    const p2 = buildParticipant({ browserSessionId: "fallback-p2", displayName: "Hank" });

    await expect(
      historyService.recordGame({
        roomId: "room-fallback-1",
        gameType: GameType.CONNECT4,
        winnerId: p1.identity,
        isDraw: false,
        participants: [p1, p2],
      })
    ).resolves.not.toThrow();

    expect(transactionMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe("historyService (DB-enabled mode, outbox-first per DEA-37)", () => {
  beforeEach(() => {
    mockConfig.database.enabled = true;
    queryMock.mockReset();
    transactionMock.mockReset();
    getPlayerStatsMock.mockClear();
    updatePlayerStatsMock.mockClear();
  });

  it("writes a single match_event_outbox row inside a tx on Connect 4 win", async () => {
    const recorded: { sql: string; params?: unknown[] }[] = [];
    const clientQuery = vi.fn(async (sql: string, params?: unknown[]) => {
      recorded.push({ sql, params });
      if (sql.includes("INSERT INTO match_event_outbox")) {
        return { rows: [{ id: "outbox-uuid-win", created_at: new Date() }] };
      }
      return { rows: [] };
    });

    transactionMock.mockImplementation(async (cb: (c: any) => Promise<unknown>) => {
      return cb({ query: clientQuery });
    });

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
      roomId: "room-db-win-1",
      roomSlug: "calm-red-owl",
      gameType: GameType.CONNECT4,
      winnerId: winner.userId,
      isDraw: false,
      participants: [winner, loser],
      vsBot: false,
      durationMs: 9_000,
      totalMoves: 18,
      maxPlayers: 2,
    });

    // recordGame writes ONLY the outbox row in its tx now. matches +
    // match_participants are deferred to outboxFlusher.
    const outboxInsert = recorded.find((r) => r.sql.includes("INSERT INTO match_event_outbox"));
    expect(outboxInsert).toBeDefined();
    expect(recorded.find((r) => r.sql.includes("INSERT INTO matches"))).toBeUndefined();
    expect(recorded.find((r) => r.sql.includes("INSERT INTO match_participants"))).toBeUndefined();

    // outbox row carries the room_id as the textual match_id and a versioned
    // payload envelope.
    expect(outboxInsert!.params![0]).toBe("room-db-win-1");
    const payload = JSON.parse(outboxInsert!.params![1] as string);
    expect(payload.version).toBe(1);
    expect(payload.roomId).toBe("room-db-win-1");
    expect(payload.roomSlug).toBe("calm-red-owl");
    expect(payload.gameType).toBe(GameType.CONNECT4);
    expect(payload.winnerId).toBe(winner.userId);
    expect(payload.isDraw).toBe(false);
    expect(payload.vsBot).toBe(false);
    expect(payload.participants).toHaveLength(2);
    expect(payload.endedAtIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // DEA-14-P1-B: the authoritative seat count for the game type flows
    // through the outbox payload and lands on matches.max_players.
    expect(payload.maxPlayers).toBe(2);

    // Player stats are NOT updated from recordGame anymore — that's the
    // flusher's job once the matches row exists.
    expect(updatePlayerStatsMock).not.toHaveBeenCalled();
  });

  it("writes is_draw=true into the outbox payload on Connect 4 draw", async () => {
    const recorded: { sql: string; params?: unknown[] }[] = [];
    const clientQuery = vi.fn(async (sql: string, params?: unknown[]) => {
      recorded.push({ sql, params });
      if (sql.includes("INSERT INTO match_event_outbox")) {
        return { rows: [{ id: "outbox-uuid-draw", created_at: new Date() }] };
      }
      return { rows: [] };
    });
    transactionMock.mockImplementation(async (cb: (c: any) => Promise<unknown>) => {
      return cb({ query: clientQuery });
    });

    const p1 = {
      identity: "user:33333333-3333-3333-3333-333333333333",
      displayName: "Kira",
      userId: "33333333-3333-3333-3333-333333333333",
      isBot: false,
    };
    const p2 = {
      identity: "user:44444444-4444-4444-4444-444444444444",
      displayName: "Leo",
      userId: "44444444-4444-4444-4444-444444444444",
      isBot: false,
    };

    await historyService.recordGame({
      roomId: "room-db-draw-1",
      gameType: GameType.CONNECT4,
      winnerId: null,
      isDraw: true,
      participants: [p1, p2],
    });

    const outboxInsert = recorded.find((r) => r.sql.includes("INSERT INTO match_event_outbox"))!;
    const payload = JSON.parse(outboxInsert.params![1] as string);
    expect(payload.isDraw).toBe(true);
    expect(payload.winnerId).toBeNull();
  });

  it("includes bot participants in the outbox payload (flusher skips them)", async () => {
    const recorded: { sql: string; params?: unknown[] }[] = [];
    const clientQuery = vi.fn(async (sql: string, params?: unknown[]) => {
      recorded.push({ sql, params });
      if (sql.includes("INSERT INTO match_event_outbox")) {
        return { rows: [{ id: "outbox-uuid-bot", created_at: new Date() }] };
      }
      return { rows: [] };
    });
    transactionMock.mockImplementation(async (cb: (c: any) => Promise<unknown>) => {
      return cb({ query: clientQuery });
    });

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
      roomId: "room-db-bot-1",
      gameType: GameType.CONNECT4,
      winnerId: human.userId,
      isDraw: false,
      participants: [human, bot],
      vsBot: true,
    });

    const outboxInsert = recorded.find((r) => r.sql.includes("INSERT INTO match_event_outbox"))!;
    const payload = JSON.parse(outboxInsert.params![1] as string);
    expect(payload.vsBot).toBe(true);
    expect(payload.participants).toHaveLength(2);
    expect(payload.participants.some((p: any) => p.isBot)).toBe(true);

    // recordGame is intentionally pure-write — stats updates happen later in
    // the flusher (and only for non-bot games).
    expect(updatePlayerStatsMock).not.toHaveBeenCalled();
  });

  it("forwards maxPlayers=4 through the outbox payload for a 4-player game", async () => {
    // DEA-14-P1-B acceptance: a created room with maxPlayers=4 (Sequence /
    // Splendor / Quoridor-4p in Phase 2) writes max_players=4 to matches via
    // the outbox. We assert on the payload here; the flusher INSERT is covered
    // by outboxFlusher's own apply path.
    const recorded: { sql: string; params?: unknown[] }[] = [];
    const clientQuery = vi.fn(async (sql: string, params?: unknown[]) => {
      recorded.push({ sql, params });
      if (sql.includes("INSERT INTO match_event_outbox")) {
        return { rows: [{ id: "outbox-uuid-4p", created_at: new Date() }] };
      }
      return { rows: [] };
    });
    transactionMock.mockImplementation(async (cb: (c: any) => Promise<unknown>) => {
      return cb({ query: clientQuery });
    });

    const players = [
      {
        identity: "user:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        displayName: "P1",
        userId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        isBot: false,
      },
      {
        identity: "user:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        displayName: "P2",
        userId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        isBot: false,
      },
      {
        identity: "user:cccccccc-cccc-cccc-cccc-cccccccccccc",
        displayName: "P3",
        userId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        isBot: false,
      },
      {
        identity: "user:dddddddd-dddd-dddd-dddd-dddddddddddd",
        displayName: "P4",
        userId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
        isBot: false,
      },
    ];

    await historyService.recordGame({
      roomId: "room-4p-1",
      roomSlug: "bold-green-stag",
      gameType: GameType.SEQUENCE,
      winnerId: players[0].userId,
      isDraw: false,
      participants: players,
      vsBot: false,
      maxPlayers: 4,
    });

    const outboxInsert = recorded.find((r) => r.sql.includes("INSERT INTO match_event_outbox"))!;
    const payload = JSON.parse(outboxInsert.params![1] as string);
    expect(payload.maxPlayers).toBe(4);
    expect(payload.gameType).toBe(GameType.SEQUENCE);
    expect(payload.participants).toHaveLength(4);
  });

  it("falls back to in-memory storage without throwing if the outbox write throws", async () => {
    transactionMock.mockImplementation(async () => {
      throw new Error("simulated DB failure");
    });

    const p1 = buildParticipant({ browserSessionId: "err-p1", displayName: "Nora" });
    const p2 = buildParticipant({ browserSessionId: "err-p2", displayName: "Oli" });

    await expect(
      historyService.recordGame({
        roomId: "room-db-err-1",
        gameType: GameType.CONNECT4,
        winnerId: p1.identity,
        isDraw: false,
        participants: [p1, p2],
      })
    ).resolves.not.toThrow();
  });
});
