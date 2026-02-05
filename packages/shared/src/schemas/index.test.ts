import { describe, it, expect } from "vitest";
import { Connect4State, RPSState } from "./index.js";
import { GamePlayerSchema } from "@multiplayer/shared";

describe("Connect4State", () => {
  it("should initialize with empty board", () => {
    const state = new Connect4State();
    expect(state.board.length).toBe(42);
    expect(state.board.every((cell) => cell === 0)).toBe(true);
  });

  it("should have waiting status by default", () => {
    const state = new Connect4State();
    expect(state.status).toBe("waiting");
  });

  it("should initialize move count to 0", () => {
    const state = new Connect4State();
    expect(state.moveCount).toBe(0);
  });
});

describe("RPSState", () => {
  it("should initialize with round 1", () => {
    const state = new RPSState();
    expect(state.roundNumber).toBe(1);
  });

  it("should default to best of 3", () => {
    const state = new RPSState();
    expect(state.targetScore).toBe(3);
  });

  it("should start in commit phase", () => {
    const state = new RPSState();
    expect(state.phase).toBe("commit");
  });

  it("should have no committed choices initially", () => {
    const state = new RPSState();
    expect(state.player1Committed).toBe(false);
    expect(state.player2Committed).toBe(false);
  });
});

describe("GamePlayerSchema", () => {
  it("should have default values", () => {
    const player = new GamePlayerSchema();
    expect(player.id).toBe("");
    expect(player.displayName).toBe("");
    expect(player.isReady).toBe(false);
    expect(player.isConnected).toBe(true);
  });
});

