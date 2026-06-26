// ─── DEA-69: 4-player breadth smoke for SequenceRoom ───────────────────────
// Verifies that SequenceRoom correctly:
//   - Assigns alternating teams (0,1,0,1) as players join
//   - Locks the room when maxPlayers seats are filled
//   - Does NOT lock before maxPlayers clients have joined
//   - Deals the correct hand size for 4 players (5 cards each)
//   - checkStartGame blocks until all maxPlayers seats are filled

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { SequenceChip } from "@multiplayer/shared";

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

// ─── DEA-200: BUG-13 — turn management and gameplay fixes ────────────────────
describe("SequenceRoom turn management (DEA-200)", () => {
  function make2PlayerRoom() {
    const room = makeSequenceRoom(2);
    stubClientsLength(room, 2);
    room.onJoin({ sessionId: "p1" } as any, { playerName: "P1" });
    room.onJoin({ sessionId: "p2" } as any, { playerName: "P2" });
    vi.spyOn(room as any, "setMetadata").mockImplementation(() => {});
    vi.spyOn(room as any, "broadcast").mockImplementation(() => {});
    vi.spyOn(room as any, "clock", "get").mockReturnValue({
      setTimeout: vi.fn(() => ({})),
    });
    (room as any).startGame();
    return room;
  }

  it("initialPlayers is populated so currentTurnId is set after startGame", () => {
    const room = make2PlayerRoom();
    expect(["p1", "p2"]).toContain(room.state.currentTurnId);
  });

  it("turn advances to the other player after a valid move", () => {
    const room = make2PlayerRoom();

    const firstTurn = room.state.currentTurnId;
    const firstPlayer = room.state.players.get(firstTurn) as any;

    // Find a card in hand and a matching board cell
    const card = firstPlayer.hand[0];
    const cardStr = `${card.rank}${card.suit.charAt(0).toUpperCase()}`;

    // Build board layout reference (copy from SequenceRoom)
    const BOARD: string[][] = [
      ["FREE", "2S", "3S", "4S", "5S", "6S", "7S", "8S", "9S", "FREE"],
      ["6C", "5C", "4C", "3C", "2C", "AH", "KH", "QH", "10H", "10S"],
      ["7C", "AS", "2D", "3D", "4D", "5D", "6D", "7D", "9H", "QS"],
      ["8C", "KS", "6C", "5C", "4C", "3C", "2C", "8D", "8H", "KS"],
      ["9C", "QS", "7C", "6H", "5H", "4H", "AH", "9D", "7H", "AS"],
      ["10C", "10S", "8C", "7H", "2H", "3H", "KH", "10D", "6H", "2D"],
      ["QC", "9S", "9C", "8H", "9H", "10H", "QH", "QD", "5H", "3D"],
      ["KC", "8S", "10C", "QC", "KC", "AC", "AD", "KD", "4H", "4D"],
      ["AC", "7S", "6S", "5S", "4S", "3S", "2S", "2H", "3H", "5D"],
      ["FREE", "AD", "KD", "QD", "10D", "9D", "8D", "7D", "6D", "FREE"],
    ];

    let boardX = -1,
      boardY = -1;
    outer: for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        if (BOARD[y][x] === cardStr) {
          boardX = x;
          boardY = y;
          break outer;
        }
      }
    }

    // Skip if no board cell found for this card (shouldn't happen but guard)
    if (boardX === -1) return;

    (room as any).handleMove({ sessionId: firstTurn, send: vi.fn() } as any, {
      cardIndex: 0,
      boardX,
      boardY,
    });

    const secondTurn = room.state.currentTurnId;
    expect(secondTurn).not.toBe(firstTurn);
    expect(["p1", "p2"]).toContain(secondTurn);
  });

  it("rejects a move to an occupied board position", () => {
    const room = make2PlayerRoom();
    const firstTurn = room.state.currentTurnId;
    const firstPlayer = room.state.players.get(firstTurn) as any;

    const card = firstPlayer.hand[0];
    const cardStr = `${card.rank}${card.suit.charAt(0).toUpperCase()}`;
    const BOARD: string[][] = [
      ["FREE", "2S", "3S", "4S", "5S", "6S", "7S", "8S", "9S", "FREE"],
      ["6C", "5C", "4C", "3C", "2C", "AH", "KH", "QH", "10H", "10S"],
      ["7C", "AS", "2D", "3D", "4D", "5D", "6D", "7D", "9H", "QS"],
      ["8C", "KS", "6C", "5C", "4C", "3C", "2C", "8D", "8H", "KS"],
      ["9C", "QS", "7C", "6H", "5H", "4H", "AH", "9D", "7H", "AS"],
      ["10C", "10S", "8C", "7H", "2H", "3H", "KH", "10D", "6H", "2D"],
      ["QC", "9S", "9C", "8H", "9H", "10H", "QH", "QD", "5H", "3D"],
      ["KC", "8S", "10C", "QC", "KC", "AC", "AD", "KD", "4H", "4D"],
      ["AC", "7S", "6S", "5S", "4S", "3S", "2S", "2H", "3H", "5D"],
      ["FREE", "AD", "KD", "QD", "10D", "9D", "8D", "7D", "6D", "FREE"],
    ];
    let boardX = -1,
      boardY = -1;
    outer: for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        if (BOARD[y][x] === cardStr) {
          boardX = x;
          boardY = y;
          break outer;
        }
      }
    }
    if (boardX === -1) return;

    // Place chip manually to occupy position
    const chip = new SequenceChip();
    chip.x = boardX;
    chip.y = boardY;
    chip.teamId = 1;
    room.state.chips.push(chip);

    const errorSend = vi.fn();
    (room as any).handleMove({ sessionId: firstTurn, send: errorSend } as any, {
      cardIndex: 0,
      boardX,
      boardY,
    });

    expect(errorSend).toHaveBeenCalledWith(
      "error",
      expect.objectContaining({ message: "Position already occupied" })
    );
    // Turn should not have advanced
    expect(room.state.currentTurnId).toBe(firstTurn);
  });

  it("rejects a move on FREE corner", () => {
    const room = make2PlayerRoom();
    const firstTurn = room.state.currentTurnId;
    const errorSend = vi.fn();
    (room as any).handleMove({ sessionId: firstTurn, send: errorSend } as any, {
      cardIndex: 0,
      boardX: 0,
      boardY: 0,
    });
    expect(errorSend).toHaveBeenCalledWith(
      "error",
      expect.objectContaining({ message: "Cannot play on free corners" })
    );
  });

  it("spectators added after seats are full do not get dealt cards", () => {
    const room = makeSequenceRoom(2);
    stubClientsLength(room, 2);
    room.onJoin({ sessionId: "p1" } as any, { playerName: "P1" });
    room.onJoin({ sessionId: "p2" } as any, { playerName: "P2" });
    // Third client joins as spectator
    stubClientsLength(room, 3);
    room.onJoin({ sessionId: "spec" } as any, { playerName: "Spectator" });

    vi.spyOn(room as any, "setMetadata").mockImplementation(() => {});
    vi.spyOn(room as any, "broadcast").mockImplementation(() => {});
    vi.spyOn(room as any, "clock", "get").mockReturnValue({ setTimeout: vi.fn(() => ({})) });
    (room as any).startGame();

    const spec = room.state.players.get("spec") as any;
    expect(spec.isSpectator).toBe(true);
    expect(spec.hand.length).toBe(0);
  });
});
