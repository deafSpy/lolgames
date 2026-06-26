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

// ─── StrictMode dedup smoke (DEA-120) ──────────────────────────────────────
// Verifies that the browserSessionId ghost-slot eviction in BaseRoom.onJoin
// prevents P2 from being forced to spectator when React StrictMode's double-
// mount causes P1 to join twice with different sessionIds.
//
// Reproduction path (without fix):
//   1. P1 joins (sessionId1) → initialPlayers = {sid1}
//   2. StrictMode cleanup fires a non-consented pre-game leave → state.players
//      loses sid1 but initialPlayers still has it (ghost slot)
//   3. Second mount: P1 joins again (sessionId2) → initialPlayers = {sid1,sid2}
//   4. P2 joins: seatsAreFull = 2 >= 2 → P2 becomes Spectator (BUG)
//
// With the fix step 3 evicts sid1 from initialPlayers before adding sid2 so
// P2 can always claim the second seat.

describe("BaseRoom StrictMode double-mount dedup (DEA-120)", () => {
  it("evicts the ghost slot and lets P2 join as Player 2", () => {
    const room = makeRoomWithGame();
    const p1First: FakeClient = { sessionId: "sess-p1-first" };
    const p1Second: FakeClient = { sessionId: "sess-p1-second" };
    const p2: FakeClient = { sessionId: "sess-p2" };

    // --- mount 1: P1 joins ---
    room.onJoin(p1First as any, {
      playerName: "Alice",
      browserSessionId: "browser-alice",
    });

    expect(room.initialPlayers.size).toBe(1);
    expect(room.initialPlayers.has("sess-p1-first")).toBe(true);

    // Simulate StrictMode cleanup: non-consented pre-game leave removes the
    // player from state.players but the ghost remains in initialPlayers (this
    // is the existing onLeave behavior for the waiting-state path).
    room.state.players.delete("sess-p1-first");
    // initialPlayers is NOT cleaned up — that's the bug scenario.
    expect(room.initialPlayers.size).toBe(1);

    // --- mount 2: same browserSessionId, new sessionId ---
    room.onJoin(p1Second as any, {
      playerName: "Alice",
      browserSessionId: "browser-alice",
    });

    // Ghost slot must have been evicted; only the new sessionId should be present.
    expect(room.initialPlayers.size).toBe(1);
    expect(room.initialPlayers.has("sess-p1-first")).toBe(false);
    expect(room.initialPlayers.has("sess-p1-second")).toBe(true);

    const alicePlayer = room.state.players.get("sess-p1-second")!;
    expect(alicePlayer).toBeDefined();
    expect(alicePlayer.isSpectator).toBe(false);
    expect(alicePlayer.isHost).toBe(true); // only player → host

    // --- P2 joins ---
    room.onJoin(p2 as any, {
      playerName: "Bob",
      browserSessionId: "browser-bob",
    });

    expect(room.initialPlayers.size).toBe(2);
    const bobPlayer = room.state.players.get("sess-p2")!;
    expect(bobPlayer).toBeDefined();
    expect(bobPlayer.isSpectator).toBe(false);
  });

  it("does not evict when the prior sessionId is still connected", () => {
    const room = makeRoomWithGame();
    const p1: FakeClient = { sessionId: "sess-p1" };
    const intruder: FakeClient = { sessionId: "sess-intruder" };

    // P1 joins and stays connected.
    room.onJoin(p1 as any, { playerName: "Alice", browserSessionId: "browser-alice" });

    expect(room.initialPlayers.has("sess-p1")).toBe(true);
    // state.players still has p1 (they are connected)
    expect(room.state.players.has("sess-p1")).toBe(true);

    // A second connection attempt with the same browserSessionId while the
    // first connection is still alive must NOT evict the existing slot.
    // (This guards against a race where two tabs share a browserSessionId.)
    room.onJoin(intruder as any, { playerName: "Alice2", browserSessionId: "browser-alice" });

    // Original slot is intact; intruder should be marked spectator (seats full
    // for a 2-player game is seatsAreFull if maxPlayers is still default 2 and
    // only one seat used — actually size=1 < 2 so intruder gets a seat too.
    // The important assertion is that the original player was NOT evicted.)
    expect(room.state.players.has("sess-p1")).toBe(true);
    expect(room.initialPlayers.has("sess-p1")).toBe(true);
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
