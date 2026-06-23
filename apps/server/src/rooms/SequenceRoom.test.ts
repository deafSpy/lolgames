// ─── DEA-69: 4-player breadth smoke for SequenceRoom ───────────────────────
// Verifies that SequenceRoom correctly:
//   - Assigns alternating teams (0,1,0,1) as players join
//   - Locks the room when maxPlayers seats are filled
//   - Does NOT lock before maxPlayers clients have joined
//   - Deals the correct hand size for 4 players (5 cards each)
//   - checkStartGame blocks until all maxPlayers seats are filled

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../services/lobbyService.js", () => ({
  lobbyService: {
    createLobby: vi.fn(async () => undefined),
    deleteLobby: vi.fn(async () => undefined),
    playerJoined: vi.fn(async () => undefined),
    playerLeft: vi.fn(async () => undefined),
    startGame: vi.fn(async () => undefined),
  },
}));

vi.mock("../services/slugService.js", () => ({
  slugService: {
    generateUniqueSlug: vi.fn(async () => "bold-red-tiger"),
  },
}));

vi.mock("../services/historyService.js", () => ({
  historyService: {
    recordGame: vi.fn(async () => undefined),
    recordMatchEvent: vi.fn(async () => undefined),
    getRecentGames: vi.fn(async () => []),
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

vi.mock("../config.js", () => ({
  config: {
    game: {
      turnTimeLimit: 30000,
      reconnectTimeout: 60000,
      roomDisposeTimeout: 60000,
    },
    database: { enabled: false },
    redis: { enabled: false },
  },
}));

const { SequenceRoom } = await import("./SequenceRoom.js");

/** Stub room.clients.length without touching the real ClientArray */
function stubClientsLength(room: InstanceType<typeof SequenceRoom>, count: number) {
  Object.defineProperty(room, "clients", {
    get: () => ({ length: count }),
    configurable: true,
  });
}

/**
 * Stub Colyseus internals so lock() and setMetadata() don't crash.
 * listing.updateOne is called by lock(); listing.metadata by setMetadata's
 * spread of this.metadata.
 */
function stubColyseusInternals(room: InstanceType<typeof SequenceRoom>) {
  (room as any).listing = {
    metadata: {},
    updateOne: vi.fn(async () => {}),
  };
  (room as any).clock = {
    setTimeout: vi.fn(() => ({ clear: () => {} })),
    clear: vi.fn(),
  };
}

function makeSequenceRoom(maxPlayers = 4) {
  const room = new SequenceRoom();
  room.maxPlayers = maxPlayers;
  room.initializeGame();
  stubClientsLength(room, 0);
  stubColyseusInternals(room);
  return room;
}

describe("SequenceRoom 4-player breadth smoke (DEA-69)", () => {
  it("assigns alternating teams as 4 players join", () => {
    const room = makeSequenceRoom(4);

    for (let i = 0; i < 4; i++) {
      stubClientsLength(room, i + 1);
      room.onJoin({ sessionId: `sess-${i}` } as any, { playerName: `P${i}` });
    }

    expect(room.state.players.size).toBe(4);
    const players = Array.from(room.state.players.values()) as any[];
    expect(players[0].teamId).toBe(0);
    expect(players[1].teamId).toBe(1);
    expect(players[2].teamId).toBe(0);
    expect(players[3].teamId).toBe(1);
  });

  it("does not lock before maxPlayers clients join", () => {
    const room = makeSequenceRoom(4);
    const lockSpy = vi.spyOn(room as any, "lock").mockResolvedValue(undefined);

    for (let i = 0; i < 3; i++) {
      stubClientsLength(room, i + 1);
      room.onJoin({ sessionId: `sess-${i}` } as any, { playerName: `P${i}` });
    }

    expect(lockSpy).not.toHaveBeenCalled();
  });

  it("locks when the 4th player joins a 4-player room", () => {
    const room = makeSequenceRoom(4);
    const lockSpy = vi.spyOn(room as any, "lock").mockResolvedValue(undefined);

    for (let i = 0; i < 4; i++) {
      stubClientsLength(room, i + 1);
      room.onJoin({ sessionId: `sess-${i}` } as any, { playerName: `P${i}` });
    }

    expect(lockSpy).toHaveBeenCalledTimes(1);
  });

  it("locks a 2-player Sequence room when 2nd player joins", () => {
    const room = makeSequenceRoom(2);
    const lockSpy = vi.spyOn(room as any, "lock").mockResolvedValue(undefined);

    stubClientsLength(room, 1);
    room.onJoin({ sessionId: "p1" } as any, { playerName: "P1" });
    expect(lockSpy).not.toHaveBeenCalled();

    stubClientsLength(room, 2);
    room.onJoin({ sessionId: "p2" } as any, { playerName: "P2" });
    expect(lockSpy).toHaveBeenCalledTimes(1);
  });

  it("deals 5 cards to each of 4 players on startGame", () => {
    const room = makeSequenceRoom(4);

    for (let i = 0; i < 4; i++) {
      stubClientsLength(room, i + 1);
      room.onJoin({ sessionId: `sess-${i}` } as any, { playerName: `P${i}` });
    }

    // Stub Colyseus framework calls triggered by startGame
    vi.spyOn(room as any, "setMetadata").mockImplementation(() => {});
    vi.spyOn(room as any, "broadcast").mockImplementation(() => {});
    vi.spyOn(room as any, "clock", "get").mockReturnValue({
      setTimeout: vi.fn(() => ({})),
    });

    (room as any).startGame();

    const players = Array.from(room.state.players.values()) as any[];
    expect(players).toHaveLength(4);
    for (const p of players) {
      expect((p as any).hand.length).toBe(5);
    }
  });

  it("checkStartGame does not start with fewer than maxPlayers clients", () => {
    const room = makeSequenceRoom(4);
    const startSpy = vi.spyOn(room as any, "startGame").mockImplementation(() => {});

    // 2 players join and mark ready — not enough for a 4-player room
    stubClientsLength(room, 2);
    room.onJoin({ sessionId: "p1" } as any, { playerName: "P1" });
    room.onJoin({ sessionId: "p2" } as any, { playerName: "P2" });
    (room.state.players.get("p1") as any).isReady = true;
    (room.state.players.get("p2") as any).isReady = true;

    (room as any).checkStartGame();

    expect(startSpy).not.toHaveBeenCalled();
  });
});
