import { Client } from "@colyseus/core";
import {
  SplendorState,
  SplendorPlayerSchema,
} from "@multiplayer/shared";
import { SplendorRoom } from "./SplendorRoom.js";
import { SplendorBot } from "../bots/SplendorBot.js";
import { logger } from "../logger.js";

/**
 * Splendor bot room - adds AI opponents to the game
 */
export class SplendorBotRoom extends SplendorRoom {
  maxClients = 1; // Only one human player
  private bots: Map<string, SplendorBot> = new Map();
  private botCount = 1; // Number of bots to add

  onCreate(options: { playerName?: string; hostName?: string; createdAt?: number; vsBot?: boolean; botCount?: number }): void {
    super.onCreate(options);
    this.botCount = options.botCount || 1;
    logger.info({ roomId: this.roomId, botCount: this.botCount }, "Splendor bot room created");
  }

  onJoin(client: Client, options: { playerName?: string }): void {
    super.onJoin(client, options);

    // Add bots after human joins
    for (let i = 0; i < this.botCount; i++) {
      this.addBot(i);
    }
  }

  private addBot(index: number): void {
    const botId = `splendor_bot_${index}`;
    
    if (this.state.players.has(botId)) return;

    const bot = new SplendorPlayerSchema();
    bot.id = botId;
    bot.displayName = `Bot ${index + 1}`;
    bot.isReady = true;
    bot.isConnected = true;
    bot.joinedAt = Date.now();
    bot.isBot = true;
    bot.gemWhite = 0;
    bot.gemBlue = 0;
    bot.gemGreen = 0;
    bot.gemRed = 0;
    bot.gemBlack = 0;
    bot.gemGold = 0;
    bot.points = 0;

    this.state.players.set(botId, bot);
    this.bots.set(botId, new SplendorBot(botId));
    // Add bot to initial players for turn rotation
    this.initialPlayers.add(botId);
    this.registerBotIdentity(botId, bot.displayName);

    logger.info({ roomId: this.roomId, botId }, "Bot added to Splendor game");
  }

  protected checkStartGame(): void {
    if (this.state.status !== "waiting") return;
    
    // Only need human player to be ready
    const humanPlayer = Array.from(this.state.players.values()).find(
      p => !p.id.startsWith("splendor_bot_")
    );

    if (humanPlayer?.isReady) {
      this.startGame();
    }
  }

  protected startGame(): void {
    super.startGame();
    
    // If bot goes first, schedule its move
    if (this.state.currentTurnId.startsWith("splendor_bot_")) {
      this.scheduleBotMove();
    }
  }

  handleMove(client: Client, data: unknown): void {
    super.handleMove(client, data);
    
    // After human move, check if next player is a bot
    this.scheduleBotMove();
  }

  private scheduleBotMove(): void {
    if (this.state.status !== "in_progress") return;
    
    const currentId = this.state.currentTurnId;
    if (!currentId.startsWith("splendor_bot_")) return;

    const bot = this.bots.get(currentId);
    if (!bot) return;

    // Add delay to make it feel more natural
    const delay = 800 + Math.random() * 500;
    
    this.clock.setTimeout(async () => {
      if (this.state.status !== "in_progress") return;
      if (this.state.currentTurnId !== currentId) return;

      try {
        // Build game state for bot
        const gameState = this.buildGameStateForBot();
        const move = await bot.getMove(gameState);
        
        if (!move || typeof move !== 'object') {
          logger.error({ botId: currentId, move }, "Bot returned invalid move");
          this.nextTurn();
          this.scheduleBotMove();
          return;
        }
        
        // Execute bot move
        this.executeBotMove(currentId, move as Record<string, unknown>);
        
        // Check if next player is also a bot
        this.scheduleBotMove();
      } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error), botId: currentId }, "Bot move failed");
        // Skip bot turn on error
        this.nextTurn();
        this.scheduleBotMove();
      }
    }, delay);
  }

  private buildGameStateForBot(): unknown {
    const players = new Map<string, unknown>();
    
    for (const [id, player] of this.state.players) {
      const p = player as SplendorPlayerSchema;
      players.set(id, {
        id: p.id,
        gemWhite: p.gemWhite,
        gemBlue: p.gemBlue,
        gemGreen: p.gemGreen,
        gemRed: p.gemRed,
        gemBlack: p.gemBlack,
        gemGold: p.gemGold,
        points: p.points,
        cards: Array.from(p.cards).map(c => ({
          id: c.id,
          tier: c.tier,
          gemType: c.gemType,
          points: c.points,
          costWhite: c.costWhite,
          costBlue: c.costBlue,
          costGreen: c.costGreen,
          costRed: c.costRed,
          costBlack: c.costBlack,
        })),
        reservedCards: Array.from(p.reserved).map(c => ({
          id: c.id,
          tier: c.tier,
          gemType: c.gemType,
          points: c.points,
          costWhite: c.costWhite,
          costBlue: c.costBlue,
          costGreen: c.costGreen,
          costRed: c.costRed,
          costBlack: c.costBlack,
        })),
      });
    }

    return {
      bankWhite: this.state.bankWhite,
      bankBlue: this.state.bankBlue,
      bankGreen: this.state.bankGreen,
      bankRed: this.state.bankRed,
      bankBlack: this.state.bankBlack,
      bankGold: this.state.bankGold,
      tier1Cards: Array.from(this.state.tier1Cards).map(c => ({
        id: c.id,
        tier: c.tier,
        gemType: c.gemType,
        points: c.points,
        costWhite: c.costWhite,
        costBlue: c.costBlue,
        costGreen: c.costGreen,
        costRed: c.costRed,
        costBlack: c.costBlack,
      })),
      tier2Cards: Array.from(this.state.tier2Cards).map(c => ({
        id: c.id,
        tier: c.tier,
        gemType: c.gemType,
        points: c.points,
        costWhite: c.costWhite,
        costBlue: c.costBlue,
        costGreen: c.costGreen,
        costRed: c.costRed,
        costBlack: c.costBlack,
      })),
      tier3Cards: Array.from(this.state.tier3Cards).map(c => ({
        id: c.id,
        tier: c.tier,
        gemType: c.gemType,
        points: c.points,
        costWhite: c.costWhite,
        costBlue: c.costBlue,
        costGreen: c.costGreen,
        costRed: c.costRed,
        costBlack: c.costBlack,
      })),
      nobles: Array.from(this.state.nobles).map(n => ({
        id: n.id,
        points: n.points,
        reqWhite: n.reqWhite,
        reqBlue: n.reqBlue,
        reqGreen: n.reqGreen,
        reqRed: n.reqRed,
        reqBlack: n.reqBlack,
      })),
      players,
      currentTurnId: this.state.currentTurnId,
      phase: this.state.phase,
    };
  }

  private executeBotMove(botId: string, move: Record<string, unknown>): void {
    const player = this.state.players.get(botId) as SplendorPlayerSchema;
    if (!player) {
      logger.warn({ botId }, "Bot player not found during move execution");
      this.nextTurn();
      return;
    }

    // Ensure move has an action
    if (!move.action || typeof move.action !== 'string') {
      logger.warn({ botId, move }, "Bot move missing action");
      this.nextTurn();
      return;
    }

    // Create a fake client for the bot
    const fakeClient = {
      sessionId: botId,
      send: (_type: string, _data: unknown) => {
        // Bot doesn't need to receive messages
      },
    } as Client;

    // Call the appropriate handler based on the move action
    switch (move.action) {
      case "take_gems":
        this.handleBotTakeGems(fakeClient, player, move);
        break;
      case "buy_card":
        this.handleBotBuyCard(fakeClient, player, move);
        break;
      case "reserve_card":
        this.handleBotReserveCard(fakeClient, player, move);
        break;
      case "discard_gems":
        this.handleBotDiscardGems(fakeClient, player, move);
        break;
      case "select_noble":
        this.handleBotSelectNoble(fakeClient, player, move);
        break;
      default:
        logger.warn({ botId, action: move.action }, "Unknown bot action, passing turn");
        this.nextTurn();
    }
  }

  // Override parent methods to handle bot moves
  private handleBotTakeGems(_client: Client, player: SplendorPlayerSchema, move: Record<string, unknown>): void {
    const gems = move.gems as Record<string, number>;
    
    // Apply gems
    for (const [gem, amount] of Object.entries(gems)) {
      const gemKey = `gem${gem.charAt(0).toUpperCase() + gem.slice(1)}` as keyof SplendorPlayerSchema;
      const bankKey = `bank${gem.charAt(0).toUpperCase() + gem.slice(1)}` as keyof typeof this.state;
      
      if (typeof player[gemKey] === 'number' && typeof this.state[bankKey] === 'number') {
        (player[gemKey] as number) += amount;
        (this.state[bankKey] as number) -= amount;
      }
    }

    this.broadcast("gems_taken", { playerId: player.id, gems });
    
    // Check if need to discard
    const totalGems = player.gemWhite + player.gemBlue + player.gemGreen + player.gemRed + player.gemBlack + player.gemGold;
    if (totalGems > 10) {
      this.state.phase = "discard_gems";
      // Bot will handle discard on next scheduled move
    } else {
      this.checkNobleVisit(player);
    }
  }

  private handleBotBuyCard(_client: Client, player: SplendorPlayerSchema, move: Record<string, unknown>): void {
    const cardId = move.cardId as string;
    
    // Find card in tiers or reserved
    let card: SplendorPlayerSchema['cards'][0] | null = null;
    let tier = 0;
    let fromReserved = false;
    
    for (const c of this.state.tier1Cards) {
      if (c.id === cardId) { card = c; tier = 1; break; }
    }
    if (!card) {
      for (const c of this.state.tier2Cards) {
        if (c.id === cardId) { card = c; tier = 2; break; }
      }
    }
    if (!card) {
      for (const c of this.state.tier3Cards) {
        if (c.id === cardId) { card = c; tier = 3; break; }
      }
    }
    if (!card) {
      for (const c of player.reserved) {
        if (c.id === cardId) { card = c; fromReserved = true; break; }
      }
    }

    if (!card) {
      this.nextTurn();
      return;
    }

    // Pay for card (simplified - just deduct gems)
    this.payForCard(player, card);
    
    // Add card to player's collection
    player.cards.push(card);
    player.points += card.points;

    // Remove from source
    if (fromReserved) {
      const idx = Array.from(player.reserved).findIndex(c => c.id === cardId);
      if (idx >= 0) player.reserved.splice(idx, 1);
    } else {
      // Remove card from display and refill from deck (same as parent class)
      const tierCards = tier === 1 ? this.state.tier1Cards : tier === 2 ? this.state.tier2Cards : this.state.tier3Cards;
      const cardIdx = Array.from(tierCards).findIndex(c => c.id === cardId);
      if (cardIdx >= 0) {
        tierCards.splice(cardIdx, 1);
        this.refillTier(tier as 1 | 2 | 3);
      }
    }

    this.broadcast("card_bought", { playerId: player.id, cardId, tier });
    this.checkNobleVisit(player);
  }

  private handleBotReserveCard(_client: Client, player: SplendorPlayerSchema, move: Record<string, unknown>): void {
    const cardId = move.cardId as string;
    const tier = move.tier as number;

    // Find and remove card from table
    let card: SplendorPlayerSchema['cards'][0] | null = null;
    const tierCards = tier === 1 ? this.state.tier1Cards : tier === 2 ? this.state.tier2Cards : this.state.tier3Cards;

    for (let i = 0; i < tierCards.length; i++) {
      if (tierCards[i].id === cardId) {
        card = tierCards[i];
        tierCards.splice(i, 1);
        break;
      }
    }

    if (!card) {
      this.nextTurn();
      return;
    }

    player.reserved.push(card);

    // Give gold if available
    if (this.state.bankGold > 0) {
      player.gemGold++;
      this.state.bankGold--;
    }

    // Refill from deck (same as parent class)
    this.refillTier(tier as 1 | 2 | 3);

    this.broadcast("card_reserved", { playerId: player.id, cardId, tier });
    this.checkNobleVisit(player);
  }

  private handleBotDiscardGems(_client: Client, player: SplendorPlayerSchema, move: Record<string, unknown>): void {
    const gems = move.gems as Record<string, number>;
    
    for (const [gem, amount] of Object.entries(gems)) {
      const gemKey = `gem${gem.charAt(0).toUpperCase() + gem.slice(1)}` as keyof SplendorPlayerSchema;
      const bankKey = `bank${gem.charAt(0).toUpperCase() + gem.slice(1)}` as keyof typeof this.state;
      
      if (typeof player[gemKey] === 'number' && typeof this.state[bankKey] === 'number') {
        (player[gemKey] as number) -= amount;
        (this.state[bankKey] as number) += amount;
      }
    }

    this.state.phase = "take_gems";
    this.broadcast("gems_discarded", { playerId: player.id, gems });
    this.checkNobleVisit(player);
  }

  private handleBotSelectNoble(_client: Client, player: SplendorPlayerSchema, move: Record<string, unknown>): void {
    const nobleId = move.nobleId as string;
    
    const nobleIdx = Array.from(this.state.nobles).findIndex(n => n.id === nobleId);
    if (nobleIdx >= 0) {
      const noble = this.state.nobles[nobleIdx];
      player.points += noble.points;
      this.state.nobles.splice(nobleIdx, 1);
    }

    this.state.phase = "take_gems";
    this.broadcast("noble_visited", { playerId: player.id, nobleId });
    
    // Check win condition
    const result = this.checkWinCondition();
    if (result) {
      this.endGame(result.winner, result.isDraw);
      return;
    }
    
    this.nextTurn();
  }

  private payForCard(player: SplendorPlayerSchema, card: SplendorPlayerSchema['cards'][0]): void {
    // Get bonuses
    const bonuses: Record<string, number> = { white: 0, blue: 0, green: 0, red: 0, black: 0 };
    for (const c of player.cards) {
      bonuses[c.gemType]++;
    }

    const costs: Array<[string, number]> = [
      ["white", card.costWhite],
      ["blue", card.costBlue],
      ["green", card.costGreen],
      ["red", card.costRed],
      ["black", card.costBlack],
    ];

    let goldUsed = 0;
    for (const [gem, cost] of costs) {
      const effectiveCost = Math.max(0, cost - bonuses[gem]);
      const gemKey = `gem${gem.charAt(0).toUpperCase() + gem.slice(1)}` as keyof SplendorPlayerSchema;
      const bankKey = `bank${gem.charAt(0).toUpperCase() + gem.slice(1)}` as keyof typeof this.state;
      
      const available = player[gemKey] as number;
      const toPay = Math.min(available, effectiveCost);
      (player[gemKey] as number) -= toPay;
      (this.state[bankKey] as number) += toPay;
      
      const remaining = effectiveCost - toPay;
      if (remaining > 0) {
        goldUsed += remaining;
      }
    }

    if (goldUsed > 0) {
      player.gemGold -= goldUsed;
      this.state.bankGold += goldUsed;
    }
  }


  private checkNobleVisit(player: SplendorPlayerSchema): void {
    // Get bonuses
    const bonuses: Record<string, number> = { white: 0, blue: 0, green: 0, red: 0, black: 0 };
    for (const c of player.cards) {
      bonuses[c.gemType]++;
    }

    // Check if player qualifies for any noble
    const qualifiedNobles = Array.from(this.state.nobles).filter(n =>
      bonuses.white >= n.reqWhite &&
      bonuses.blue >= n.reqBlue &&
      bonuses.green >= n.reqGreen &&
      bonuses.red >= n.reqRed &&
      bonuses.black >= n.reqBlack
    );

    if (qualifiedNobles.length > 1) {
      this.state.phase = "select_noble";
      // Bot will handle selection on next scheduled move
    } else if (qualifiedNobles.length === 1) {
      const noble = qualifiedNobles[0];
      player.points += noble.points;
      const idx = Array.from(this.state.nobles).findIndex(n => n.id === noble.id);
      if (idx >= 0) this.state.nobles.splice(idx, 1);
      this.broadcast("noble_visited", { playerId: player.id, nobleId: noble.id });
      
      const result = this.checkWinCondition();
      if (result) {
        this.endGame(result.winner, result.isDraw);
        return;
      }
      this.nextTurn();
    } else {
      const result = this.checkWinCondition();
      if (result) {
        this.endGame(result.winner, result.isDraw);
        return;
      }
      this.nextTurn();
    }
  }
}
