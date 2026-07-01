import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Unit tests for BUG-15: turn rotation stalls on player 1 in multiplayer
//
// Root cause: SplendorRoom.onJoin() and MonopolyDealRoom.onJoin() both override
// BaseRoom.onJoin() without populating `this.initialPlayers`. When endTurn()
// calls BaseRoom.nextTurn(), the early-exit guard fires:
//   if (initialPlayerIds.length === 0) return;
// leaving currentTurnId permanently set to the first player.
//
// Fix: populate initialPlayers from state.players.keys() in each room's
// startGame() — the same pattern CatanRoom already used.
//
// These tests exercise the nextTurn() logic in isolation via a minimal mock
// that mirrors the BaseRoom implementation exactly.
// ---------------------------------------------------------------------------

// Minimal reproduction of BaseRoom.nextTurn() and startGame()
class MockRoom {
  initialPlayers: Set<string> = new Set();
  currentTurnId = "";

  // Mirrors BaseRoom.nextTurn() exactly
  nextTurn(): void {
    const initialPlayerIds = Array.from(this.initialPlayers);
    if (initialPlayerIds.length === 0) return; // ← the bug gate
    const currentIndex = initialPlayerIds.indexOf(this.currentTurnId);
    const nextIndex = (currentIndex + 1) % initialPlayerIds.length;
    this.currentTurnId = initialPlayerIds[nextIndex];
  }

  // Simulates the buggy startGame (initialPlayers never populated)
  startGameBuggy(playerIds: string[]): void {
    // initialPlayers NOT populated — this was the bug
    this.currentTurnId = playerIds[0];
  }

  // Simulates the fixed startGame (initialPlayers populated from players map)
  startGameFixed(playerIds: string[]): void {
    this.initialPlayers = new Set(playerIds); // ← the fix
    this.currentTurnId = playerIds[0];
  }
}

describe("BUG-15: multiplayer turn rotation", () => {
  describe("root cause: initialPlayers not populated (buggy path)", () => {
    it("nextTurn() returns early and currentTurnId never advances when initialPlayers is empty", () => {
      const room = new MockRoom();
      room.startGameBuggy(["p1", "p2"]);

      expect(room.currentTurnId).toBe("p1");
      expect(room.initialPlayers.size).toBe(0); // bug: empty

      room.nextTurn(); // should advance but can't

      expect(room.currentTurnId).toBe("p1"); // ← stuck on p1 forever
    });

    it("p2 can never take a turn in the buggy path", () => {
      const room = new MockRoom();
      room.startGameBuggy(["p1", "p2"]);

      // Simulate 4 turns — p1 always has it
      for (let i = 0; i < 4; i++) {
        expect(room.currentTurnId).toBe("p1");
        room.nextTurn();
      }
      expect(room.currentTurnId).toBe("p1"); // never changes
    });
  });

  describe("fix: initialPlayers populated in startGame", () => {
    it("currentTurnId advances from p1 to p2 after nextTurn()", () => {
      const room = new MockRoom();
      room.startGameFixed(["p1", "p2"]);

      expect(room.currentTurnId).toBe("p1");
      expect(room.initialPlayers.size).toBe(2);

      room.nextTurn();

      expect(room.currentTurnId).toBe("p2");
    });

    it("turn rotates back to p1 after p2 calls nextTurn()", () => {
      const room = new MockRoom();
      room.startGameFixed(["p1", "p2"]);

      room.nextTurn(); // p1 → p2
      expect(room.currentTurnId).toBe("p2");

      room.nextTurn(); // p2 → p1
      expect(room.currentTurnId).toBe("p1");
    });

    it("plays 4 full turns correctly in 2-player game", () => {
      const room = new MockRoom();
      room.startGameFixed(["p1", "p2"]);

      const expectedOrder = ["p1", "p2", "p1", "p2"];
      for (const expected of expectedOrder) {
        expect(room.currentTurnId).toBe(expected);
        room.nextTurn();
      }
      expect(room.currentTurnId).toBe("p1"); // back to start after 4 turns
    });

    it("rotates correctly in 3-player game (Splendor supports 2-4 players)", () => {
      const room = new MockRoom();
      room.startGameFixed(["p1", "p2", "p3"]);

      const expectedOrder = ["p1", "p2", "p3", "p1", "p2", "p3"];
      for (const expected of expectedOrder) {
        expect(room.currentTurnId).toBe(expected);
        room.nextTurn();
      }
    });

    it("rotates correctly in 4-player game", () => {
      const room = new MockRoom();
      room.startGameFixed(["p1", "p2", "p3", "p4"]);

      const turns = ["p1", "p2", "p3", "p4", "p1"];
      for (let i = 0; i < turns.length - 1; i++) {
        expect(room.currentTurnId).toBe(turns[i]);
        room.nextTurn();
      }
      expect(room.currentTurnId).toBe(turns[turns.length - 1]);
    });

    it("nextTurn() is a no-op when initialPlayers is explicitly empty (safety check)", () => {
      const room = new MockRoom();
      room.currentTurnId = "p1";
      // initialPlayers intentionally left empty

      room.nextTurn(); // should not throw, just return

      expect(room.currentTurnId).toBe("p1"); // unchanged, no crash
    });
  });

  describe("currentTurnId initialised to first player in initialPlayers", () => {
    it("startGameFixed sets currentTurnId to playerIds[0]", () => {
      const room = new MockRoom();
      room.startGameFixed(["alice", "bob"]);

      expect(room.currentTurnId).toBe("alice");
    });

    it("initialPlayers contains all player IDs after startGameFixed", () => {
      const room = new MockRoom();
      room.startGameFixed(["alice", "bob", "charlie"]);

      expect(room.initialPlayers.has("alice")).toBe(true);
      expect(room.initialPlayers.has("bob")).toBe(true);
      expect(room.initialPlayers.has("charlie")).toBe(true);
      expect(room.initialPlayers.size).toBe(3);
    });
  });
});
