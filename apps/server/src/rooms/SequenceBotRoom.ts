import { Client } from "@colyseus/core";
import {
  SequenceState,
  SequencePlayer,
  SequenceCard,
} from "@multiplayer/shared";
import { SequenceRoom } from "./SequenceRoom.js";
import { SequenceBot } from "../bots/SequenceBot.js";
import { logger } from "../logger.js";

/**
 * Sequence bot room - adds AI opponents to the game
 */
export class SequenceBotRoom extends SequenceRoom {
  maxClients = 1; // Only one human player
  private bots: Map<string, SequenceBot> = new Map();
  private botCount = 1;

  onCreate(options: { playerName?: string; hostName?: string; createdAt?: number; vsBot?: boolean; botCount?: number }): void {
    super.onCreate(options);
    this.botCount = Math.min(options.botCount || 1, 3);
    logger.info({ roomId: this.roomId, botCount: this.botCount }, "Sequence bot room created");
  }

  onJoin(client: Client, options: { playerName?: string }): void {
    super.onJoin(client, options);

    // Add bots after human joins
    for (let i = 0; i < this.botCount; i++) {
      this.addBot(i);
    }
  }

  private addBot(index: number): void {
    const botId = `sequence_bot_${index}`;
    
    if (this.state.players.has(botId)) return;

    const bot = new SequencePlayer();
    bot.id = botId;
    bot.displayName = `Bot ${index + 1}`;
    bot.isReady = true;
    bot.isConnected = true;
    bot.joinedAt = Date.now();
    bot.isBot = true;
    
    // Alternate teams
    const playerCount = this.state.players.size;
    bot.teamId = playerCount % 2;

    this.state.players.set(botId, bot);
    this.bots.set(botId, new SequenceBot(botId));
    // Add bot to initial players for turn rotation
    this.initialPlayers.add(botId);
    this.registerBotIdentity(botId, bot.displayName);

    logger.info({ roomId: this.roomId, botId, teamId: bot.teamId }, "Bot added to Sequence game");
  }

  protected checkStartGame(): void {
    if (this.state.status !== "waiting") return;
    
    // Only need human player to be ready
    const humanPlayer = Array.from(this.state.players.values()).find(
      p => !p.id.startsWith("sequence_bot_")
    );

    if (humanPlayer?.isReady) {
      this.startGame();
    }
  }

  protected startGame(): void {
    super.startGame();
    
    // If bot goes first, schedule its move
    if (this.state.currentTurnId.startsWith("sequence_bot_")) {
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
    if (!currentId.startsWith("sequence_bot_")) return;

    const bot = this.bots.get(currentId);
    if (!bot) return;

    const delay = 700 + Math.random() * 500;
    
    this.clock.setTimeout(async () => {
      if (this.state.status !== "in_progress") return;
      if (this.state.currentTurnId !== currentId) return;

      try {
        const gameState = this.buildGameStateForBot();
        const move = await bot.getMove(gameState) as { cardIndex: number; boardX: number; boardY: number };
        
        this.executeBotMove(currentId, move);
        
        // Schedule next bot move if needed
        this.scheduleBotMove();
      } catch (error) {
        logger.error({ error, botId: currentId }, "Bot move failed");
        // Make a random valid move
        this.makeRandomMove(currentId);
        this.scheduleBotMove();
      }
    }, delay);
  }

  private buildGameStateForBot(): unknown {
    const players = new Map<string, unknown>();
    
    for (const [id, player] of this.state.players) {
      const p = player as SequencePlayer;
      players.set(id, {
        id: p.id,
        teamId: p.teamId,
        hand: Array.from(p.hand).map(c => ({
          rank: c.rank,
          suit: c.suit,
        })),
      });
    }

    return {
      currentTurnId: this.state.currentTurnId,
      players,
      chips: Array.from(this.state.chips).map(c => ({
        x: c.x,
        y: c.y,
        teamId: c.teamId,
        isPartOfSequence: c.isPartOfSequence,
      })),
      team1Sequences: this.state.team1Sequences,
      team2Sequences: this.state.team2Sequences,
    };
  }

  private executeBotMove(
    botId: string,
    move: { cardIndex: number; boardX: number; boardY: number }
  ): void {
    const player = this.state.players.get(botId) as SequencePlayer;
    if (!player) return;

    const fakeClient = {
      sessionId: botId,
      send: (_type: string, _data: unknown) => {},
    } as Client;

    // Use parent's move handler
    (this as SequenceRoom).handleMove(fakeClient, {
      cardIndex: move.cardIndex,
      boardX: move.boardX,
      boardY: move.boardY,
    });
  }

  private makeRandomMove(botId: string): void {
    const player = this.state.players.get(botId) as SequencePlayer;
    if (!player || player.hand.length === 0) return;

    // Standard Sequence board layout
    const BOARD_LAYOUT: string[][] = [
      ["FREE", "2S", "3S", "4S", "5S", "6S", "7S", "8S", "9S", "FREE"],
      ["6C", "5C", "4C", "3C", "2C", "AH", "KH", "QH", "10H", "10S"],
      ["7C", "AS", "2D", "3D", "4D", "5D", "6D", "7D", "9H", "QS"],
      ["8C", "KS", "6C", "5C", "4C", "3C", "2C", "8D", "8H", "KS"],
      ["9C", "QS", "7C", "6H", "5H", "4H", "AH", "9D", "7H", "AS"],
      ["10C", "10S", "8C", "7H", "2H", "3H", "KH", "10D", "6H", "2D"],
      ["QC", "9S", "9C", "8H", "9H", "10H", "QH", "QD", "5H", "3D"],
      ["KC", "8S", "10C", "QC", "KC", "AC", "AD", "KD", "4H", "4D"],
      ["AC", "7S", "6S", "5S", "4S", "3S", "2S", "2H", "3H", "5D"],
      ["FREE", "AD", "KD", "QD", "10D", "9D", "8D", "7D", "6D", "FREE"],
    ];

    for (let cardIndex = 0; cardIndex < player.hand.length; cardIndex++) {
      const card = player.hand[cardIndex] as SequenceCard;
      const suitChar = card.suit === "hearts" ? "H" : 
                       card.suit === "diamonds" ? "D" : 
                       card.suit === "clubs" ? "C" : "S";
      const cardStr = `${card.rank}${suitChar}`;

      for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
          if (BOARD_LAYOUT[y][x] === cardStr) {
            const occupied = this.state.chips.some(c => c.x === x && c.y === y);
            if (!occupied) {
              this.executeBotMove(botId, { cardIndex, boardX: x, boardY: y });
              return;
            }
          }
        }
      }
    }
  }
}
