import { logger } from "../logger.js";

export interface BotConfig {
  difficulty: "easy" | "medium" | "hard";
  thinkingDelay: number; // ms
}

export abstract class BotAgent {
  protected config: BotConfig;
  protected playerId: string;

  constructor(playerId: string, config: Partial<BotConfig> = {}) {
    this.playerId = playerId;
    this.config = {
      difficulty: config.difficulty || "medium",
      thinkingDelay: config.thinkingDelay || 1000,
    };
  }

  abstract calculateMove(gameState: unknown): unknown;

  async getMove(gameState: unknown): Promise<unknown> {
    // Simulate thinking time
    await this.delay(this.config.thinkingDelay);
    return this.calculateMove(gameState);
  }

  protected delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  protected randomChoice<T>(options: T[]): T {
    return options[Math.floor(Math.random() * options.length)];
  }
}

