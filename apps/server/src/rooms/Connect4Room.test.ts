import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Service mocks for the reconnect-smoke suite ────────────────────────────
// These are hoisted to the top of the file by Vitest so any module that imports
// the real services during ESM evaluation gets the stubbed version. The pure
// win-detection tests below don't touch these, so the mocks are inert there.
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
    generateUniqueSlug: vi.fn(async () => "swift-blue-fox"),
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

// Test the Connect4 win detection logic
const COLS = 7;
const ROWS = 6;

function checkHorizontalWin(board: number[], player: number): boolean {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col <= COLS - 4; col++) {
      const idx = row * COLS + col;
      if (
        board[idx] === player &&
        board[idx + 1] === player &&
        board[idx + 2] === player &&
        board[idx + 3] === player
      ) {
        return true;
      }
    }
  }
  return false;
}

function checkVerticalWin(board: number[], player: number): boolean {
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row <= ROWS - 4; row++) {
      const idx = row * COLS + col;
      if (
        board[idx] === player &&
        board[idx + COLS] === player &&
        board[idx + COLS * 2] === player &&
        board[idx + COLS * 3] === player
      ) {
        return true;
      }
    }
  }
  return false;
}

function checkDiagonalWin(board: number[], player: number): boolean {
  // Bottom-left to top-right
  for (let row = 3; row < ROWS; row++) {
    for (let col = 0; col <= COLS - 4; col++) {
      const idx = row * COLS + col;
      if (
        board[idx] === player &&
        board[idx - COLS + 1] === player &&
        board[idx - COLS * 2 + 2] === player &&
        board[idx - COLS * 3 + 3] === player
      ) {
        return true;
      }
    }
  }

  // Top-left to bottom-right
  for (let row = 0; row <= ROWS - 4; row++) {
    for (let col = 0; col <= COLS - 4; col++) {
      const idx = row * COLS + col;
      if (
        board[idx] === player &&
        board[idx + COLS + 1] === player &&
        board[idx + COLS * 2 + 2] === player &&
        board[idx + COLS * 3 + 3] === player
      ) {
        return true;
      }
    }
  }

  return false;
}

function checkWin(board: number[], player: number): boolean {
  return (
    checkHorizontalWin(board, player) ||
    checkVerticalWin(board, player) ||
    checkDiagonalWin(board, player)
  );
}

function isBoardFull(board: number[]): boolean {
  return board.slice(0, COLS).every((cell) => cell !== 0);
}

describe("Connect4 Win Detection", () => {
  let board: number[];

  beforeEach(() => {
    board = new Array(42).fill(0);
  });

  describe("Horizontal wins", () => {
    it("should detect horizontal win in bottom row", () => {
      // Place 4 in a row at bottom
      board[35] = 1; // row 5, col 0
      board[36] = 1; // row 5, col 1
      board[37] = 1; // row 5, col 2
      board[38] = 1; // row 5, col 3

      expect(checkHorizontalWin(board, 1)).toBe(true);
      expect(checkHorizontalWin(board, 2)).toBe(false);
    });

    it("should detect horizontal win in middle row", () => {
      board[17] = 2; // row 2, col 3
      board[18] = 2; // row 2, col 4
      board[19] = 2; // row 2, col 5
      board[20] = 2; // row 2, col 6

      expect(checkHorizontalWin(board, 2)).toBe(true);
    });

    it("should not detect horizontal win with only 3", () => {
      board[35] = 1;
      board[36] = 1;
      board[37] = 1;

      expect(checkHorizontalWin(board, 1)).toBe(false);
    });
  });

  describe("Vertical wins", () => {
    it("should detect vertical win", () => {
      board[0] = 1; // row 0, col 0
      board[7] = 1; // row 1, col 0
      board[14] = 1; // row 2, col 0
      board[21] = 1; // row 3, col 0

      expect(checkVerticalWin(board, 1)).toBe(true);
    });

    it("should not detect vertical win with gap", () => {
      board[0] = 1;
      board[7] = 1;
      board[14] = 2; // different player
      board[21] = 1;

      expect(checkVerticalWin(board, 1)).toBe(false);
    });
  });

  describe("Diagonal wins", () => {
    it("should detect diagonal win (top-left to bottom-right)", () => {
      board[0] = 1; // row 0, col 0
      board[8] = 1; // row 1, col 1
      board[16] = 1; // row 2, col 2
      board[24] = 1; // row 3, col 3

      expect(checkDiagonalWin(board, 1)).toBe(true);
    });

    it("should detect diagonal win (bottom-left to top-right)", () => {
      board[21] = 2; // row 3, col 0
      board[15] = 2; // row 2, col 1
      board[9] = 2; // row 1, col 2
      board[3] = 2; // row 0, col 3

      expect(checkDiagonalWin(board, 2)).toBe(true);
    });
  });

  describe("Combined win check", () => {
    it("should detect win for player 1", () => {
      board[35] = 1;
      board[36] = 1;
      board[37] = 1;
      board[38] = 1;

      expect(checkWin(board, 1)).toBe(true);
      expect(checkWin(board, 2)).toBe(false);
    });
  });

  describe("Board full (draw)", () => {
    it("should detect full board", () => {
      for (let i = 0; i < 42; i++) {
        board[i] = (i % 2) + 1;
      }

      expect(isBoardFull(board)).toBe(true);
    });

    it("should not detect full board with empty cells", () => {
      for (let i = 0; i < 41; i++) {
        board[i] = (i % 2) + 1;
      }
      board[0] = 0; // One empty cell in top row

      expect(isBoardFull(board)).toBe(false);
    });
  });
});

// ─── Reconnect smoke (DEA-36) ───────────────────────────────────────────────
// Verifies BaseRoom.onJoin's reconnect contract: a client coming back with the
// same sessionId after a refresh-style drop must reuse its existing
// GamePlayerSchema entry, flip `isConnected` back to true, and must not
// duplicate the player or shuffle player1Id / player2Id assignments.
//
// This is the server-side guarantee the issue calls out:
//   - browser refresh → client.reconnect(token) on the web side
//   - tab background → foreground → same flow
// Both ultimately hit BaseRoom.onJoin with the original sessionId. We exercise
// that branch directly without standing up a Colyseus matchmaker, which keeps
// the test fast and hermetic.

// Imported AFTER vi.mock() hoists the service stubs above.
const { Connect4Room } = await import("./Connect4Room.js");

interface FakeClient {
  sessionId: string;
}

function makeRoomWithGame() {
  const room = new Connect4Room();
  // initializeGame() just constructs Connect4State and sets status=waiting.
  // It doesn't touch listing/metadata, so it's safe to call standalone.
  room.initializeGame();
  return room;
}

describe("Connect4Room reconnect smoke (BaseRoom.onJoin re-entry)", () => {
  it("re-uses the existing player on second onJoin with the same sessionId", () => {
    const room = makeRoomWithGame();
    const alice: FakeClient = { sessionId: "sess-alice" };

    // First join — fresh player.
    room.onJoin(alice as any, { playerName: "Alice", browserSessionId: "browser-alice" });

    expect(room.state.players.size).toBe(1);
    const before = room.state.players.get(alice.sessionId)!;
    expect(before.displayName).toBe("Alice");
    expect(before.isConnected).toBe(true);
    expect(before.isHost).toBe(true);
    expect(room.state.player1Id).toBe(alice.sessionId);

    // Simulate the disconnect window opened by onLeave(non-consented):
    // BaseRoom flips isConnected = false but keeps the entry alive while
    // allowReconnection runs.
    before.isConnected = false;

    // Refresh-style reconnect — Colyseus calls onJoin again with the same
    // sessionId. The reconnect branch must reuse the same schema entry.
    room.onJoin(alice as any, {
      playerName: "Alice (rejoined)",
      browserSessionId: "browser-alice",
    });

    expect(room.state.players.size).toBe(1);
    const after = room.state.players.get(alice.sessionId)!;
    expect(after).toBe(before); // same instance, not a duplicate
    expect(after.isConnected).toBe(true);
    // displayName must NOT be overwritten by the reconnect payload.
    expect(after.displayName).toBe("Alice");
    // Role assignment must not be re-shuffled.
    expect(room.state.player1Id).toBe(alice.sessionId);
    expect(room.state.player2Id).toBe("");
  });

  it("preserves player1Id/player2Id roles when player 2 reconnects mid-game", () => {
    const room = makeRoomWithGame();
    const alice: FakeClient = { sessionId: "sess-alice" };
    const bob: FakeClient = { sessionId: "sess-bob" };

    room.onJoin(alice as any, { playerName: "Alice" });
    room.onJoin(bob as any, { playerName: "Bob" });

    expect(room.state.player1Id).toBe(alice.sessionId);
    expect(room.state.player2Id).toBe(bob.sessionId);

    // Simulate game starting, then Bob drops mid-game.
    room.state.status = "in_progress";
    const bobPlayer = room.state.players.get(bob.sessionId)!;
    bobPlayer.isConnected = false;

    // Bob's browser refreshes → client.reconnect(token) → onJoin again.
    room.onJoin(bob as any, { playerName: "Bob" });

    expect(room.state.players.size).toBe(2);
    expect(room.state.players.get(bob.sessionId)).toBe(bobPlayer);
    expect(bobPlayer.isConnected).toBe(true);
    // Critical: roles must not flip even though `players.size === 2` when the
    // post-super branch in Connect4Room.onJoin runs.
    expect(room.state.player1Id).toBe(alice.sessionId);
    expect(room.state.player2Id).toBe(bob.sessionId);
  });

  it("treats a returning sessionId as a reconnect even after game start", () => {
    const room = makeRoomWithGame();
    const alice: FakeClient = { sessionId: "sess-alice" };
    const bob: FakeClient = { sessionId: "sess-bob" };

    room.onJoin(alice as any, { playerName: "Alice" });
    room.onJoin(bob as any, { playerName: "Bob" });

    // Lock both as initial players, then start the game.
    room.state.status = "in_progress";

    const aliceBefore = room.state.players.get(alice.sessionId)!;
    aliceBefore.isConnected = false;

    // Re-entry while the game is in_progress — must NOT mark Alice as a
    // spectator (that flag is only set on a fresh join). The existing-player
    // branch in BaseRoom.onJoin short-circuits before the spectator check.
    room.onJoin(alice as any, { playerName: "Alice" });

    const aliceAfter = room.state.players.get(alice.sessionId)!;
    expect(aliceAfter).toBe(aliceBefore);
    expect(aliceAfter.isSpectator).toBe(false);
    expect(aliceAfter.isConnected).toBe(true);
  });
});
