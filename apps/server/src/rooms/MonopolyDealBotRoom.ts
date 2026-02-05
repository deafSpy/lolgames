import { Client } from "@colyseus/core";
import {
  MonopolyDealState,
  MonopolyDealPlayerSchema,
} from "@multiplayer/shared";
import { MonopolyDealRoom } from "./MonopolyDealRoom.js";
import { MonopolyDealBot } from "../bots/MonopolyDealBot.js";
import { logger } from "../logger.js";

/**
 * Monopoly Deal bot room - adds AI opponents to the game
 */
export class MonopolyDealBotRoom extends MonopolyDealRoom {
  maxClients = 1; // Only one human player
  private bots: Map<string, MonopolyDealBot> = new Map();
  private botCount = 1;

  onCreate(options: { playerName?: string; hostName?: string; createdAt?: number; vsBot?: boolean; botCount?: number }): void {
    super.onCreate(options);
    this.botCount = Math.min(options.botCount || 1, 3); // Max 3 bots
    logger.info({ roomId: this.roomId, botCount: this.botCount }, "Monopoly Deal bot room created");
  }

  onJoin(client: Client, options: { playerName?: string }): void {
    super.onJoin(client, options);

    // Add bots after human joins
    for (let i = 0; i < this.botCount; i++) {
      this.addBot(i);
    }
  }

  private addBot(index: number): void {
    const botId = `monopoly_bot_${index}`;
    
    if (this.state.players.has(botId)) return;

    const bot = new MonopolyDealPlayerSchema();
    bot.id = botId;
    bot.displayName = `Bot ${index + 1}`;
    bot.isReady = true;
    bot.isConnected = true;
    bot.joinedAt = Date.now();
    bot.isBot = true;
    bot.actionsRemaining = 0;

    this.state.players.set(botId, bot);
    this.bots.set(botId, new MonopolyDealBot(botId));
    // Add bot to initial players for turn rotation
    this.initialPlayers.add(botId);
    this.registerBotIdentity(botId, bot.displayName);

    logger.info({ roomId: this.roomId, botId }, "Bot added to Monopoly Deal game");
  }

  protected checkStartGame(): void {
    if (this.state.status !== "waiting") return;
    
    // Only need human player to be ready
    const humanPlayer = Array.from(this.state.players.values()).find(
      p => !p.id.startsWith("monopoly_bot_")
    );

    if (humanPlayer?.isReady) {
      this.startGame();
    }
  }

  protected startGame(): void {
    super.startGame();
    
    // If bot goes first, schedule its move
    if (this.state.currentTurnId.startsWith("monopoly_bot_")) {
      this.scheduleBotMove();
    }
  }

  handleMove(client: Client, data: unknown): void {
    super.handleMove(client, data);
    
    // After human move, check if bot needs to respond or take turn
    this.scheduleBotMove();
  }

  private scheduleBotMove(): void {
    if (this.state.status !== "in_progress") return;
    
    // Check if a bot needs to respond
    if (this.state.phase === "response" && this.state.activeResponderId.startsWith("monopoly_bot_")) {
      this.scheduleBotResponse();
      return;
    }
    
    // Check if current player is a bot
    const currentId = this.state.currentTurnId;
    if (!currentId.startsWith("monopoly_bot_")) return;

    const bot = this.bots.get(currentId);
    if (!bot) return;

    const delay = 600 + Math.random() * 400;
    
    this.clock.setTimeout(async () => {
      if (this.state.status !== "in_progress") return;
      if (this.state.currentTurnId !== currentId) return;

      try {
        const gameState = this.buildGameStateForBot();
        const move = await bot.getMove(gameState);
        this.executeBotMove(currentId, move as Record<string, unknown>);
        
        // Schedule next bot action
        this.scheduleBotMove();
      } catch (error) {
        logger.error({ error, botId: currentId }, "Bot move failed");
        // Pass turn on error
        this.forceEndTurn(currentId);
        this.scheduleBotMove();
      }
    }, delay);
  }

  private scheduleBotResponse(): void {
    const responderId = this.state.activeResponderId;
    const bot = this.bots.get(responderId);
    if (!bot) return;

    const delay = 400 + Math.random() * 300;
    
    this.clock.setTimeout(async () => {
      if (this.state.phase !== "response") return;
      if (this.state.activeResponderId !== responderId) return;

      try {
        const gameState = this.buildGameStateForBot();
        const move = await bot.getMove(gameState);
        this.executeBotResponse(responderId, move as Record<string, unknown>);
        
        // Check if another bot needs to respond or take turn
        this.scheduleBotMove();
      } catch (error) {
        logger.error({ error, botId: responderId }, "Bot response failed");
        // Accept action on error
        this.executeBotResponse(responderId, { type: "respond", response: "accept" });
        this.scheduleBotMove();
      }
    }, delay);
  }

  private buildGameStateForBot(): unknown {
    const players = new Map<string, unknown>();
    
    for (const [id, player] of this.state.players) {
      const p = player as MonopolyDealPlayerSchema;
      players.set(id, {
        id: p.id,
        hand: Array.from(p.hand).map(c => ({
          id: c.id,
          cardType: c.cardType,
          value: c.value,
          name: c.name,
          actionType: c.actionType,
          color: c.color,
          colors: c.colors ? Array.from(c.colors) : undefined,
        })),
        bank: Array.from(p.bank).map(c => ({
          id: c.id,
          cardType: c.cardType,
          value: c.value,
          name: c.name,
        })),
        propertySets: Array.from(p.propertySets).map((ps, idx) => ({
          id: `set_${id}_${idx}`,
          color: ps.color,
          cards: Array.from(ps.cards).map(c => ({
            id: c.id,
            cardType: c.cardType,
            value: c.value,
            name: c.name,
            color: c.color,
          })),
          isComplete: ps.isComplete,
          hasHouse: ps.hasHouse,
          hasHotel: ps.hasHotel,
        })),
        actionsRemaining: p.actionsRemaining,
      });
    }

    return {
      phase: this.state.phase,
      currentTurnId: this.state.currentTurnId,
      players,
      actionStack: Array.from(this.state.actionStack).map(a => ({
        id: a.id,
        type: a.actionType,
        sourcePlayerId: a.sourcePlayerId,
        targetPlayerId: a.targetPlayerId,
        amount: a.amount,
        resolved: a.status === "resolved",
        cardId: a.cardId,
      })),
      activeResponderId: this.state.activeResponderId,
      discardPile: Array.from(this.state.discardPile).map(c => ({
        id: c.id,
        cardType: c.cardType,
        value: c.value,
        name: c.name,
      })),
    };
  }

  private executeBotMove(botId: string, move: Record<string, unknown>): void {
    const fakeClient = {
      sessionId: botId,
      send: (_type: string, _data: unknown) => {},
    } as Client;

    // Construct proper move data for parent's handleMove
    const moveData: Record<string, unknown> = { type: move.type };
    
    if (move.cardIndex !== undefined) moveData.cardIndex = move.cardIndex;
    if (move.targetColor) moveData.targetColor = move.targetColor;
    if (move.targetPlayerId) moveData.targetPlayerId = move.targetPlayerId;
    if (move.targetSetId) moveData.targetSetId = move.targetSetId;

    this.handleMove(fakeClient, moveData);
  }

  private executeBotResponse(botId: string, move: Record<string, unknown>): void {
    const fakeClient = {
      sessionId: botId,
      send: (_type: string, _data: unknown) => {},
    } as Client;

    const response = move.response as string;
    const responseData: Record<string, unknown> = { type: "respond", response };
    
    if (response === "just_say_no" && move.cardId) {
      responseData.cardId = move.cardId;
    } else if (response === "pay" && move.cardIds) {
      responseData.cardIds = move.cardIds;
    }

    this.handleMove(fakeClient, responseData);
  }

  private forceEndTurn(botId: string): void {
    const fakeClient = {
      sessionId: botId,
      send: (_type: string, _data: unknown) => {},
    } as Client;

    this.handleMove(fakeClient, { type: "pass" });
  }

  // Use parent's handleMove directly - no private method wrappers needed
}
