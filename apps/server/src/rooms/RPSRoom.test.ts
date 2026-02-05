import { describe, it, expect } from "vitest";

type Choice = "rock" | "paper" | "scissors";

function determineRoundWinner(
  choice1: Choice,
  choice2: Choice,
  player1Id: string,
  player2Id: string
): string {
  if (choice1 === choice2) {
    return ""; // Draw
  }

  const wins: Record<Choice, Choice> = {
    rock: "scissors",
    paper: "rock",
    scissors: "paper",
  };

  if (wins[choice1] === choice2) {
    return player1Id;
  }
  return player2Id;
}

function checkGameWinner(
  player1Score: number,
  player2Score: number,
  targetScore: number,
  roundNumber: number,
  player1Id: string,
  player2Id: string
): { winner: string | null; isDraw: boolean } | null {
  const winsNeeded = targetScore;

  if (player1Score >= winsNeeded) {
    return { winner: player1Id, isDraw: false };
  }
  if (player2Score >= winsNeeded) {
    return { winner: player2Id, isDraw: false };
  }

  const roundsRemaining = 2 * targetScore - roundNumber;

  if (
    player1Score + roundsRemaining < winsNeeded &&
    player2Score + roundsRemaining < winsNeeded
  ) {
    return { winner: null, isDraw: true };
  }

  return null;
}

describe("RPS Game Logic", () => {
  const player1Id = "player1";
  const player2Id = "player2";

  describe("Round winner determination", () => {
    it("rock beats scissors", () => {
      expect(determineRoundWinner("rock", "scissors", player1Id, player2Id)).toBe(player1Id);
      expect(determineRoundWinner("scissors", "rock", player1Id, player2Id)).toBe(player2Id);
    });

    it("scissors beats paper", () => {
      expect(determineRoundWinner("scissors", "paper", player1Id, player2Id)).toBe(player1Id);
      expect(determineRoundWinner("paper", "scissors", player1Id, player2Id)).toBe(player2Id);
    });

    it("paper beats rock", () => {
      expect(determineRoundWinner("paper", "rock", player1Id, player2Id)).toBe(player1Id);
      expect(determineRoundWinner("rock", "paper", player1Id, player2Id)).toBe(player2Id);
    });

    it("same choice is a draw", () => {
      expect(determineRoundWinner("rock", "rock", player1Id, player2Id)).toBe("");
      expect(determineRoundWinner("paper", "paper", player1Id, player2Id)).toBe("");
      expect(determineRoundWinner("scissors", "scissors", player1Id, player2Id)).toBe("");
    });
  });

  describe("Game winner determination (best of 3)", () => {
    const bestOf = 3;

    it("player 1 wins with 2-0", () => {
      const result = checkGameWinner(2, 0, bestOf, 2, player1Id, player2Id);
      expect(result).toEqual({ winner: player1Id, isDraw: false });
    });

    it("player 2 wins with 2-1", () => {
      const result = checkGameWinner(1, 2, bestOf, 3, player1Id, player2Id);
      expect(result).toEqual({ winner: player2Id, isDraw: false });
    });

    it("game continues with 1-1", () => {
      const result = checkGameWinner(1, 1, bestOf, 2, player1Id, player2Id);
      expect(result).toBeNull();
    });

    it("game continues with 0-0", () => {
      const result = checkGameWinner(0, 0, bestOf, 1, player1Id, player2Id);
      expect(result).toBeNull();
    });
  });

  describe("Game winner determination (best of 5)", () => {
    const bestOf = 5;

    it("player 1 wins with 3-0", () => {
      const result = checkGameWinner(3, 0, bestOf, 3, player1Id, player2Id);
      expect(result).toEqual({ winner: player1Id, isDraw: false });
    });

    it("player 2 wins with 3-2", () => {
      const result = checkGameWinner(2, 3, bestOf, 5, player1Id, player2Id);
      expect(result).toEqual({ winner: player2Id, isDraw: false });
    });

    it("game continues with 2-2", () => {
      const result = checkGameWinner(2, 2, bestOf, 4, player1Id, player2Id);
      expect(result).toBeNull();
    });
  });
});

