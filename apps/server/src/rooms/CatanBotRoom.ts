import { Client } from "@colyseus/core";
import { CatanPlayerSchema } from "@multiplayer/shared";
import { CatanRoom } from "./CatanRoom.js";
import type { JoinOptions } from "./BaseRoom.js";
import { CatanBot } from "../bots/CatanBot.js";
import { logger } from "../logger.js";

/**
 * Catan bot room — one human vs one bot opponent.
 */
export class CatanBotRoom extends CatanRoom {
  maxClients = 1; // Only one human; bots are virtual
  private bots: Map<string, CatanBot> = new Map();
  private botCount = 1;

  async onCreate(options: JoinOptions & { botCount?: number }): Promise<void> {
    await super.onCreate(options);
    this.botCount = Math.min(options.botCount || 1, 3);
    logger.info({ roomId: this.roomId, botCount: this.botCount }, "Catan bot room created");
  }

  onJoin(client: Client, options: { playerName?: string }): void {
    super.onJoin(client, options);

    for (let i = 0; i < this.botCount; i++) {
      this.addBot(i);
    }
  }

  private addBot(index: number): void {
    const botId = `catan_bot_${index}`;
    if (this.state.players.has(botId)) return;

    const bot = new CatanPlayerSchema();
    bot.id = botId;
    bot.displayName = `Bot ${index + 1}`;
    bot.isReady = true;
    bot.isConnected = true;
    bot.joinedAt = Date.now();
    bot.isBot = true;
    bot.wood = 0;
    bot.brick = 0;
    bot.wheat = 0;
    bot.sheep = 0;
    bot.ore = 0;
    bot.points = 0;

    this.state.players.set(botId, bot);
    this.bots.set(botId, new CatanBot(botId));
    this.initialPlayers.add(botId);
    this.registerBotIdentity(botId, bot.displayName);

    logger.info({ roomId: this.roomId, botId }, "Bot added to Catan game");
  }

  protected checkStartGame(): void {
    if (this.state.status !== "waiting") return;

    const humanPlayer = Array.from(this.state.players.values()).find(
      (p) => !p.id.startsWith("catan_bot_")
    );

    if (humanPlayer?.isReady) {
      this.startGame();
    }
  }

  protected startGame(): void {
    super.startGame();

    if (this.state.currentTurnId.startsWith("catan_bot_")) {
      this.scheduleBotMove();
    }
  }

  handleMove(client: Client, data: unknown): void {
    super.handleMove(client, data);
    this.scheduleBotMove();
  }

  private scheduleBotMove(): void {
    if (this.state.status !== "in_progress") return;

    const currentId = this.state.currentTurnId;
    if (!currentId.startsWith("catan_bot_")) return;

    const bot = this.bots.get(currentId);
    if (!bot) return;

    const delay = 800 + Math.random() * 600;

    this.clock.setTimeout(async () => {
      if (this.state.status !== "in_progress") return;
      if (this.state.currentTurnId !== currentId) return;

      try {
        const gameState = this.buildGameStateForBot();
        const move = await bot.getMove(gameState);

        if (!move || typeof move !== "object") {
          logger.warn({ botId: currentId, move }, "Catan bot returned invalid move");
          return;
        }

        const fakeClient = {
          sessionId: currentId,
          send: (_type: string, _data: unknown) => {},
        } as Client;

        this.handleMove(fakeClient, move);
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error), botId: currentId },
          "Catan bot move failed"
        );
      }
    }, delay);
  }

  private buildGameStateForBot(): unknown {
    const players = new Map<string, unknown>();
    for (const [id, p] of this.state.players) {
      const player = p as CatanPlayerSchema;
      players.set(id, {
        id: player.id,
        wood: player.wood,
        brick: player.brick,
        wheat: player.wheat,
        sheep: player.sheep,
        ore: player.ore,
        points: player.points,
        roadsBuilt: player.roadsBuilt,
        settlementsBuilt: player.settlementsBuilt,
        citiesBuilt: player.citiesBuilt,
        hasLongestRoad: player.hasLongestRoad,
      });
    }

    const vertices = new Map<string, unknown>();
    for (const [id, v] of this.state.vertices) {
      vertices.set(id, { id: v.id, building: v.building, playerId: v.playerId });
    }

    const edges = new Map<string, unknown>();
    for (const [id, e] of this.state.edges) {
      edges.set(id, { id: e.id, hasRoad: e.hasRoad, playerId: e.playerId });
    }

    return {
      phase: this.state.phase,
      setupRound: this.state.setupRound,
      lastDiceRoll: this.state.lastDiceRoll,
      tiles: Array.from(this.state.tiles).map((t) => ({
        q: t.q,
        r: t.r,
        tileType: t.tileType,
        number: t.number,
        hasRobber: t.hasRobber,
      })),
      vertices,
      edges,
      players,
      currentTurnId: this.state.currentTurnId,
      pointsToWin: this.state.pointsToWin,
    };
  }
}
