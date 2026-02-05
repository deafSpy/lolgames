import { describe, it, expect } from "vitest";
import { GameType, GameStatus, PlayerStatus, RPSChoice, Connect4Cell } from "./index.js";

describe("GameType enum", () => {
  it("should have correct values", () => {
    expect(GameType.CONNECT4).toBe("connect4");
    expect(GameType.SEQUENCE).toBe("sequence");
    expect(GameType.QUORIDOR).toBe("quoridor");
    expect(GameType.ROCK_PAPER_SCISSORS).toBe("rps");
  });
});

describe("GameStatus enum", () => {
  it("should have correct statuses", () => {
    expect(GameStatus.WAITING).toBe("waiting");
    expect(GameStatus.IN_PROGRESS).toBe("in_progress");
    expect(GameStatus.FINISHED).toBe("finished");
    expect(GameStatus.CANCELLED).toBe("cancelled");
  });
});

describe("PlayerStatus enum", () => {
  it("should have correct statuses", () => {
    expect(PlayerStatus.CONNECTED).toBe("connected");
    expect(PlayerStatus.DISCONNECTED).toBe("disconnected");
    expect(PlayerStatus.SPECTATING).toBe("spectating");
  });
});

describe("RPSChoice enum", () => {
  it("should have rock, paper, scissors", () => {
    expect(RPSChoice.ROCK).toBe("rock");
    expect(RPSChoice.PAPER).toBe("paper");
    expect(RPSChoice.SCISSORS).toBe("scissors");
  });
});

describe("Connect4Cell enum", () => {
  it("should have correct cell values", () => {
    expect(Connect4Cell.EMPTY).toBe(0);
    expect(Connect4Cell.PLAYER_1).toBe(1);
    expect(Connect4Cell.PLAYER_2).toBe(2);
  });
});

