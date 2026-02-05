import { Client } from "@colyseus/core";
import {
  BlackjackState,
  BlackjackPlayerSchema,
} from "@multiplayer/shared";
import { BlackjackRoom } from "./BlackjackRoom.js";
import { BlackjackBot } from "../bots/BlackjackBot.js";
import { logger } from "../logger.js";

/**
 * Blackjack bot room - adds AI opponents for tournament play
 */
export class BlackjackBotRoom extends BlackjackRoom {
  maxClients = 1; // Only one human player
  private bots: Map<string, BlackjackBot> = new Map();
  private botCount = 2; // Default 2 bots for 3-player tournament

  onCreate(options: { playerName?: string; hostName?: string; createdAt?: number; vsBot?: boolean; botCount?: number }): void {
    super.onCreate(options);
    this.botCount = Math.min(options.botCount || 2, 3);
    logger.info({ roomId: this.roomId, botCount: this.botCount }, "Blackjack bot room created");
  }

  onJoin(client: Client, options: { playerName?: string }): void {
    super.onJoin(client, options);

    // Add bots after human joins
    for (let i = 0; i < this.botCount; i++) {
      this.addBot(i);
    }
  }

  private addBot(index: number): void {
    const botId = `blackjack_bot_${index}`;
    
    if (this.state.players.has(botId)) return;

    const bot = new BlackjackPlayerSchema();
    bot.id = botId;
    bot.displayName = `Bot ${index + 1}`;
    bot.isReady = true;
    bot.isConnected = true;
    bot.joinedAt = Date.now();
    bot.isBot = true;
    bot.chips = this.state.startingChips;
    bot.secretBet = 0;
    bot.hasPlacedBet = false;
    bot.isEliminated = false;
    bot.isSecretBetRevealed = true;
    bot.currentHandIndex = 0;

    this.state.players.set(botId, bot);
    this.bots.set(botId, new BlackjackBot(botId));
    // Add bot to initial players for turn rotation
    this.initialPlayers.add(botId);
    this.registerBotIdentity(botId, bot.displayName);

    logger.info({ roomId: this.roomId, botId }, "Bot added to Blackjack game");
  }

  protected checkStartGame(): void {
    if (this.state.status !== "waiting") return;
    
    // Only need human player to be ready
    const humanPlayer = Array.from(this.state.players.values()).find(
      p => !p.id.startsWith("blackjack_bot_")
    );

    if (humanPlayer?.isReady) {
      this.startGame();
    }
  }

  protected startGame(): void {
    super.startGame();
    
    // Check if bot needs to act
    this.scheduleBotAction();
  }

  handleMove(client: Client, data: unknown): void {
    super.handleMove(client, data);
    
    // After human move, check if bot needs to act
    this.scheduleBotAction();
  }

  private scheduleBotAction(): void {
    if (this.state.status !== "in_progress") return;

    logger.info({ roomId: this.roomId, phase: this.state.phase, currentTurnId: this.state.currentTurnId }, "Scheduling bot action");

    // Handle betting phase - use currentTurnId for betting order
    if (this.state.phase === "betting") {
      const currentBettor = this.state.currentTurnId;
      if (currentBettor && currentBettor.startsWith("blackjack_bot_")) {
        logger.info({ roomId: this.roomId, botId: currentBettor }, "Scheduling bot bet");
        this.scheduleBotBet(currentBettor);
      } else {
        logger.info({ roomId: this.roomId, currentBettor }, "Not bot's turn to bet or no current bettor");
      }
      return;
    }

    // Handle player turns
    if (this.state.phase === "player_turn") {
      const currentPlayer = this.state.currentTurnId;
      if (currentPlayer && currentPlayer.startsWith("blackjack_bot_")) {
        logger.info({ roomId: this.roomId, botId: currentPlayer }, "Scheduling bot play");
        this.scheduleBotPlay(currentPlayer);
      } else {
        logger.info({ roomId: this.roomId, currentPlayer }, "Not bot's turn to play or no current player");
      }
      return;
    }

    logger.info({ roomId: this.roomId, phase: this.state.phase }, "No bot action needed for current phase");
  }

  private scheduleBotBet(botId: string): void {
    const bot = this.bots.get(botId);
    if (!bot) return;

    const delay = 400 + Math.random() * 300;
    
    this.clock.setTimeout(async () => {
      if (this.state.phase !== "betting") return;
      if (this.state.currentTurnId !== botId) return;

      try {
        logger.info({ roomId: this.roomId, botId }, "Bot calculating bet move");
        const gameState = this.buildGameStateForBot();
        const move = await bot.getMove(gameState) as { action: string; amount: number; isSecret: boolean };
        logger.info({ roomId: this.roomId, botId, move }, "Bot calculated bet move");

        this.executeBotBet(botId, move);
        this.scheduleBotAction();
      } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error), botId }, "Bot bet failed");
        // Place minimum bet on error
        this.executeBotBet(botId, { action: "bet", amount: this.state.minBet, isSecret: false });
        this.scheduleBotAction();
      }
    }, delay);
  }

  private scheduleBotPlay(botId: string): void {
    const bot = this.bots.get(botId);
    if (!bot) return;

    const delay = 500 + Math.random() * 400;
    
    this.clock.setTimeout(async () => {
      if (this.state.phase !== "player_turn") return;
      if (this.state.currentTurnId !== botId) return;

      try {
        logger.info({ roomId: this.roomId, botId }, "Bot calculating play move");
        const gameState = this.buildGameStateForBot();
        const move = await bot.getMove(gameState) as { action: string };
        logger.info({ roomId: this.roomId, botId, move }, "Bot calculated play move");

        this.executeBotPlay(botId, move);
        this.scheduleBotAction();
      } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error), botId }, "Bot play failed");
        // Stand on error
        this.executeBotPlay(botId, { action: "stand" });
        this.scheduleBotAction();
      }
    }, delay);
  }

  private buildGameStateForBot(): unknown {
    const players = new Map<string, unknown>();
    
    for (const [id, player] of this.state.players) {
      const p = player as BlackjackPlayerSchema;
      const currentBet = p.hands.length > 0 ? p.hands[0].bet : 0;
      players.set(id, {
        id: p.id,
        chips: p.chips,
        hands: Array.from(p.hands).map(h => ({
          id: `hand_${id}`,
          cards: Array.from(h.cards).map(c => ({
            suit: c.suit,
            rank: c.rank,
            value: this.getCardValue(c.rank),
            hidden: !c.faceUp,
          })),
          bet: h.bet,
          value: h.value,
          isBusted: h.isBusted,
          isBlackjack: h.isBlackjack,
          isStanding: h.isStanding,
          isDoubledDown: h.isDoubled,
          isSplit: h.isSplit,
          insuranceBet: p.insuranceBet,
          result: "",
        })),
        currentBet,
        isSecretBet: p.secretBet > 0 && !p.isSecretBetRevealed,
        hasBet: p.hasPlacedBet,
        isEliminated: p.isEliminated,
        handsWon: 0,
        handsLost: 0,
        handsPushed: 0,
      });
    }

    return {
      phase: this.state.phase,
      currentTurnId: this.state.currentTurnId,
      players,
      dealerHand: Array.from(this.state.dealerHand).map(c => ({
        suit: c.suit,
        rank: c.rank,
        value: this.getCardValue(c.rank),
        hidden: !c.faceUp,
      })),
      dealerValue: this.state.dealerValue,
      handNumber: this.state.handNumber,
      eliminationHands: Array.from(this.state.eliminationHands),
      minBet: this.state.minBet,
      maxBet: this.state.maxBet,
      currentBettorId: this.state.currentTurnId, // Use currentTurnId for betting
      currentHandIndex: 0, // First hand by default
    };
  }

  private getCardValue(rank: string): number {
    if (rank === "A") return 11;
    if (["K", "Q", "J"].includes(rank)) return 10;
    return parseInt(rank) || 0;
  }

  private executeBotBet(botId: string, move: { action: string; amount: number; isSecret: boolean }): void {
    logger.info({ roomId: this.roomId, botId, move }, "Executing bot bet");

    const player = this.state.players.get(botId) as BlackjackPlayerSchema;
    if (!player) {
      logger.error({ roomId: this.roomId, botId }, "Bot player not found for betting");
      return;
    }

    const fakeClient = {
      sessionId: botId,
      send: (_type: string, _data: unknown) => {},
    } as Client;

    // Validate bet amount
    const betAmount = Math.max(
      this.state.minBet,
      Math.min(move.amount, player.chips, this.state.maxBet)
    );

    logger.info({ roomId: this.roomId, botId, betAmount }, "Bot placing bet");

    // Use parent's bet handling
    (this as BlackjackRoom).handleMove(fakeClient, {
      action: "place_bet",
      amount: betAmount,
      isSecret: move.isSecret || false,
    });
  }

  private executeBotPlay(botId: string, move: { action: string }): void {
    logger.info({ roomId: this.roomId, botId, move }, "Executing bot play");

    const player = this.state.players.get(botId) as BlackjackPlayerSchema;
    if (!player) {
      logger.error({ roomId: this.roomId, botId }, "Bot player not found for playing");
      return;
    }

    const fakeClient = {
      sessionId: botId,
      send: (_type: string, _data: unknown) => {},
    } as Client;

    // Map bot actions to room actions
    let roomAction = move.action;
    if (move.action === "double") {
      roomAction = "double_down";
    }

    logger.info({ roomId: this.roomId, botId, roomAction }, "Bot executing action");

    // Execute the action
    (this as BlackjackRoom).handleMove(fakeClient, { action: roomAction });
  }
}
