import { BotAgent, BotConfig } from "./BotAgent.js";

type Choice = "rock" | "paper" | "scissors";

interface RPSState {
  roundNumber: number;
  player1Id: string;
  player2Id: string;
  player1Choice: string;
  player2Choice: string;
  phase: string;
}

interface MoveHistory {
  myChoice: Choice;
  opponentChoice: Choice;
  iWon: boolean;
}

const CHOICES: Choice[] = ["rock", "paper", "scissors"];
const BEATS: Record<Choice, Choice> = {
  rock: "scissors",
  paper: "rock",
  scissors: "paper",
};
const BEATEN_BY: Record<Choice, Choice> = {
  rock: "paper",
  paper: "scissors",
  scissors: "rock",
};

/**
 * RPS Bot - uses a balanced strategy combining randomness with pattern recognition
 * No difficulty levels - all bots use the same strategy
 */
export class RPSBot extends BotAgent {
  private moveHistory: MoveHistory[] = [];
  private opponentHistory: Choice[] = [];

  constructor(playerId: string, config: Partial<BotConfig> = {}) {
    super(playerId, {
      ...config,
      difficulty: "medium", // Always use same difficulty
      thinkingDelay: config.thinkingDelay || 500,
    });
  }

  calculateMove(_gameState: RPSState): { choice: Choice } {
    // Use balanced strategy - mix of randomness and pattern recognition
    const choice = this.balancedMove();
    return { choice };
  }

  // Record opponent's choice for learning
  recordOpponentChoice(choice: Choice, myChoice: Choice): void {
    this.opponentHistory.push(choice);
    this.moveHistory.push({
      myChoice,
      opponentChoice: choice,
      iWon: BEATS[myChoice] === choice,
    });
  }

  /**
   * Balanced strategy:
   * - First few rounds: random choice
   * - After enough data: frequency analysis with some randomness
   */
  private balancedMove(): Choice {
    // First few rounds are random
    if (this.opponentHistory.length < 3) {
      return this.randomChoice(CHOICES);
    }

    // 30% chance to play random (prevents being too predictable)
    if (Math.random() < 0.3) {
      return this.randomChoice(CHOICES);
    }

    // Count opponent's recent choices with recency bias
    const weights: Record<Choice, number> = { rock: 0, paper: 0, scissors: 0 };
    const recentCount = Math.min(8, this.opponentHistory.length);

    for (let i = 0; i < recentCount; i++) {
      const idx = this.opponentHistory.length - 1 - i;
      const weight = recentCount - i; // More recent = higher weight
      weights[this.opponentHistory[idx]] += weight;
    }

    // Find highest weighted
    let predicted: Choice = "rock";
    let maxWeight = 0;
    for (const choice of CHOICES) {
      if (weights[choice] > maxWeight) {
        maxWeight = weights[choice];
        predicted = choice;
      }
    }

    // Play what beats the predicted choice
    return BEATEN_BY[predicted];
  }
}

