import { Room, Client, Delayed } from "@colyseus/core";
import { BaseGameState, GamePlayerSchema, GameType } from "@multiplayer/shared";
import { logger } from "../logger.js";
import { config } from "../config.js";
import { historyService, type ParticipantIdentity } from "../services/historyService.js";
import { lobbyService } from "../services/lobbyService.js";
import { slugService } from "../services/slugService.js";

export interface JoinOptions {
  playerName?: string;
  hostName?: string;
  createdAt?: number;
  vsBot?: boolean;
  browserSessionId?: string;
  userId?: string;
  authProvider?: string;
  // Authoritative seat count for the room. Server-side: provided via the third
  // arg to `gameServer.define(name, klass, { maxPlayers })` in index.ts, which
  // overrides anything a client might send (Colyseus merges
  // `clientOptions, handler.options`, handler wins).
  maxPlayers?: number;
}

export abstract class BaseRoom<TState extends BaseGameState> extends Room<TState> {
  maxClients = 100; // Allow many spectators/late joiners
  autoDispose = false; // Manual disposal
  turnTimer: Delayed | null = null;
  initialPlayers: Set<string> = new Set(); // Players that were in the lobby at game start
  protected playerIdentities: Map<string, ParticipantIdentity> = new Map();
  protected roomSlug: string = ""; // Human-readable room code (e.g., "swift-blue-fox")
  protected hostSessionId: string = ""; // Track the host for kick/bot management
  maxPlayers: number = 2; // Authoritative seat count; set from onCreate options

  protected registerBotIdentity(botId: string, displayName: string): void {
    this.playerIdentities.set(botId, {
      identity: `bot:${botId}`,
      displayName,
      isBot: true,
    });
  }

  abstract initializeGame(): void;
  abstract handleMove(client: Client, data: unknown): void;
  abstract checkWinCondition(): { winner: string | null; isDraw: boolean } | null;

  async onCreate(options: JoinOptions): Promise<void> {
    logger.info({ roomId: this.roomId, options }, "Room created");

    const createdAt = options.createdAt || Date.now();
    const vsBot = options.vsBot || false;
    this.maxPlayers = options.maxPlayers ?? 2;

    // Generate human-readable room slug
    this.roomSlug = await slugService.generateUniqueSlug();
    logger.info({ roomId: this.roomId, roomSlug: this.roomSlug }, "Generated room slug");

    // Set room metadata
    this.setMetadata({
      gameType: (this.roomName?.replace("_bot", "") as GameType) || GameType.CONNECT4,
      hostName: options.hostName || "Unknown",
      createdAt,
      vsBot,
      status: "waiting", // Add status for matchmaking
      roomSlug: this.roomSlug, // Add slug to metadata for frontend access
    });

    // Create lobby in Redis (non-blocking, skipped if Redis unavailable)
    lobbyService
      .createLobby({
        roomId: this.roomId,
        gameType: (this.roomName?.replace("_bot", "") as GameType) || GameType.CONNECT4,
        host: options.hostName || "Unknown",
        hostUserId: options.userId,
        maxPlayers: this.maxPlayers,
        vsBot,
        metadata: {
          roomSlug: this.roomSlug,
        },
      })
      .catch((err) => {
        logger.warn(
          { error: err, roomId: this.roomId },
          "Failed to create lobby in Redis (non-critical)"
        );
      });

    // Set up message handlers
    this.onMessage("move", (client, data) => {
      this.handleMoveMessage(client, data);
    });

    this.onMessage("ready", (client) => {
      this.handleReady(client);
    });

    this.onMessage("surrender", (client) => {
      this.handleSurrender(client);
    });

    this.onMessage("chat", (client, data) => {
      this.broadcast("chat", {
        senderId: client.sessionId,
        senderName: this.state.players.get(client.sessionId)?.displayName || "Unknown",
        content: data.message,
        timestamp: Date.now(),
      });
    });

    // Host controls: Add bot
    this.onMessage("add_bot", (client, data) => {
      this.handleAddBot(client, data);
    });

    // Host controls: Kick player
    this.onMessage("kick_player", (client, data) => {
      this.handleKickPlayer(client, data);
    });

    // Initialize game-specific state
    this.initializeGame();

    // Set room to not auto-dispose - we handle disposal manually
    this.setPrivate(false);
  }

  onJoin(client: Client, options: JoinOptions): void {
    const existingPlayer = this.state.players.get(client.sessionId);

    if (existingPlayer) {
      // Player reconnected - mark as connected
      existingPlayer.isConnected = true;
      logger.info(
        {
          roomId: this.roomId,
          playerId: client.sessionId,
          displayName: existingPlayer.displayName,
        },
        "Player reconnected"
      );
    } else {
      // New player joining
      const player = new GamePlayerSchema();
      player.id = client.sessionId;
      // Generate guest name with 4-digit random number (e.g., "Guest7382")
      const guestNumber = Math.floor(1000 + Math.random() * 9000);
      player.displayName = options.playerName || `Guest${guestNumber}`;
      player.isReady = false;
      player.isConnected = true;
      player.joinedAt = Date.now();
      player.isBot = false;
      player.isSpectator = this.state.status === "in_progress"; // Spectator if game already started
      player.wasInitialPlayer = !player.isSpectator; // Initial player if joining before game starts
      player.isHost = false; // Will be set below if first player

      // Track a stable identity for history (userId > browserSessionId > sessionId)
      const identity: ParticipantIdentity = {
        identity: options.userId
          ? `user:${options.userId}`
          : options.browserSessionId
            ? `guest:${options.browserSessionId}`
            : `guest:${client.sessionId}`,
        displayName: player.displayName,
        userId: options.userId,
        browserSessionId: options.browserSessionId,
        isBot: false,
      };
      this.playerIdentities.set(client.sessionId, identity);

      logger.info(
        {
          sessionId: client.sessionId,
          identity: identity.identity,
          userId: identity.userId,
          browserSessionId: identity.browserSessionId,
          displayName: identity.displayName,
        },
        "🔍 Player identity registered"
      );

      // Track the first player as the host
      if (this.initialPlayers.size === 0 && this.state.status === "waiting") {
        this.hostSessionId = client.sessionId;
        player.isHost = true;
        logger.info({ roomId: this.roomId, hostSessionId: this.hostSessionId }, "Host assigned");
      }

      // If game hasn't started yet, add to initial players
      if (this.state.status === "waiting") {
        this.initialPlayers.add(client.sessionId);
        logger.info(
          {
            roomId: this.roomId,
            playerId: client.sessionId,
            initialPlayers: Array.from(this.initialPlayers),
            gameStatus: this.state.status,
            isHost: player.isHost,
          },
          "Player added to initialPlayers"
        );
      } else {
        logger.info(
          {
            roomId: this.roomId,
            playerId: client.sessionId,
            initialPlayers: Array.from(this.initialPlayers),
            gameStatus: this.state.status,
          },
          "Player NOT added to initialPlayers (game already started)"
        );
      }

      this.state.players.set(client.sessionId, player);

      logger.info(
        {
          roomId: this.roomId,
          playerId: client.sessionId,
          playerName: player.displayName,
          isSpectator: player.isSpectator,
        },
        "Player joined"
      );

      // Update lobby in Redis: player count for real players, spectator count for spectators
      if (!player.isSpectator) {
        lobbyService.playerJoined(this.roomId).catch((err) => {
          logger.warn({ error: err, roomId: this.roomId }, "Failed to update lobby in Redis");
        });
      } else {
        lobbyService.spectatorJoined(this.roomId).catch((err) => {
          logger.warn(
            { error: err, roomId: this.roomId },
            "Failed to update spectator count in Redis"
          );
        });
      }
    }

    // Send room metadata to the joining client so it knows the human-readable slug
    if (this.roomSlug) {
      client.send("room_info", { roomSlug: this.roomSlug });
    }

    // Room now persists since someone joined it
  }

  async onLeave(client: Client, consented: boolean): Promise<void> {
    const player = this.state.players.get(client.sessionId);

    if (!player) {
      this.scheduleEmptyRoomDisposal();
      return;
    }

    const identity = this.playerIdentities.get(client.sessionId);
    logger.info(
      {
        roomId: this.roomId,
        playerId: client.sessionId,
        consented,
        gameStatus: this.state.status,
      },
      "Player left"
    );

    // Consented leave or game already over → remove immediately.
    if (consented || this.state.status === "finished") {
      this.state.players.delete(client.sessionId);

      if (this.state.status === "in_progress" && consented) {
        this.handlePlayerForfeit(client.sessionId);
      }

      if (!player.isSpectator && this.state.status === "waiting") {
        lobbyService.playerLeft(this.roomId).catch((err) => {
          logger.warn({ error: err, roomId: this.roomId }, "Failed to update lobby in Redis");
        });
      }

      this.scheduleEmptyRoomDisposal();
      return;
    }

    // Spectators or pre-game disconnects: just drop the player; don't hold the seat.
    if (player.isSpectator || this.state.status !== "in_progress") {
      this.state.players.delete(client.sessionId);
      if (player.isSpectator) {
        lobbyService.spectatorLeft(this.roomId).catch((err) => {
          logger.warn(
            { error: err, roomId: this.roomId },
            "Failed to update spectator count in Redis"
          );
        });
      } else if (this.state.status === "waiting") {
        lobbyService.playerLeft(this.roomId).catch((err) => {
          logger.warn({ error: err, roomId: this.roomId }, "Failed to update lobby in Redis");
        });
      }
      this.scheduleEmptyRoomDisposal();
      return;
    }

    // In-progress, non-consented drop for an initial player: hold the seat
    // open for RECONNECT_TIMEOUT seconds so the client can resume the same
    // sessionId via client.reconnect(reconnectionToken).
    player.isConnected = false;
    const reconnectSeconds = Math.max(1, Math.floor(config.game.reconnectTimeout / 1000));
    logger.info(
      {
        roomId: this.roomId,
        sessionId: client.sessionId,
        displayName: player.displayName,
        identity: identity?.identity,
        userId: identity?.userId,
        reconnectWindowSec: reconnectSeconds,
      },
      "Reconnect window opened"
    );

    historyService
      .recordMatchEvent({
        roomId: this.roomId,
        roomSlug: this.roomSlug,
        gameType: (this.roomName?.replace("_bot", "") as GameType) || GameType.CONNECT4,
        eventType: "disconnect",
        sessionId: client.sessionId,
        identity: identity,
        metadata: { reconnectWindowSec: reconnectSeconds },
      })
      .catch((err) => {
        logger.warn({ err, roomId: this.roomId }, "Failed to record disconnect event");
      });

    try {
      await this.allowReconnection(client, reconnectSeconds);
      // onJoin() runs again with the same sessionId; isConnected is flipped
      // back to true there. Just log + emit the reconnect event here.
      logger.info(
        {
          roomId: this.roomId,
          sessionId: client.sessionId,
          displayName: player.displayName,
          identity: identity?.identity,
        },
        "Reconnect succeeded"
      );

      historyService
        .recordMatchEvent({
          roomId: this.roomId,
          roomSlug: this.roomSlug,
          gameType: (this.roomName?.replace("_bot", "") as GameType) || GameType.CONNECT4,
          eventType: "reconnect",
          sessionId: client.sessionId,
          identity: identity,
        })
        .catch((err) => {
          logger.warn({ err, roomId: this.roomId }, "Failed to record reconnect event");
        });
    } catch {
      // Window expired (or the player consented during it) → forfeit so the
      // game doesn't hang. Connect 4 policy: opponent wins on expiry.
      logger.info(
        {
          roomId: this.roomId,
          sessionId: client.sessionId,
          displayName: player.displayName,
          identity: identity?.identity,
          reconnectWindowSec: reconnectSeconds,
        },
        "Reconnect window expired, forfeiting"
      );

      historyService
        .recordMatchEvent({
          roomId: this.roomId,
          roomSlug: this.roomSlug,
          gameType: (this.roomName?.replace("_bot", "") as GameType) || GameType.CONNECT4,
          eventType: "reconnect_expired",
          sessionId: client.sessionId,
          identity: identity,
          metadata: { reconnectWindowSec: reconnectSeconds },
        })
        .catch((err) => {
          logger.warn({ err, roomId: this.roomId }, "Failed to record reconnect_expired event");
        });

      if (this.state.status === "in_progress") {
        this.state.players.delete(client.sessionId);
        await this.handlePlayerForfeit(client.sessionId);
      } else {
        this.state.players.delete(client.sessionId);
      }
      this.scheduleEmptyRoomDisposal();
    }
  }

  protected scheduleEmptyRoomDisposal(): void {
    // Don't dispose rooms that have ever had initial players (they should persist for reconnection)
    // Only dispose rooms that were created but never had anyone join them
    const hasHadInitialPlayers = this.initialPlayers.size > 0;

    if (!hasHadInitialPlayers) {
      // Room was created but no one ever joined - dispose it
      logger.info(
        { roomId: this.roomId },
        "Room was created but never had players, disposing immediately"
      );
      this.disconnect();
    }
    // If the room has had initial players, keep it alive for potential reconnections
  }

  async onDispose(): Promise<void> {
    this.clearTurnTimer();
    logger.info({ roomId: this.roomId }, "Room disposed");
  }

  protected async handleMoveMessage(client: Client, data: unknown): Promise<void> {
    // Reject moves from spectators with a clear error
    const movingPlayer = this.state.players.get(client.sessionId);
    if (movingPlayer?.isSpectator) {
      client.send("error", { message: "Spectators cannot make moves" });
      return;
    }

    // Validate it's the player's turn
    if (this.state.status !== "in_progress") {
      client.send("error", { message: "Game is not in progress" });
      return;
    }

    logger.info(
      {
        roomId: this.roomId,
        clientId: client.sessionId,
        currentTurnId: this.state.currentTurnId,
        status: this.state.status,
      },
      "Handling move"
    );

    if (this.state.currentTurnId !== client.sessionId) {
      client.send("error", { message: "Not your turn" });
      return;
    }

    // Clear turn timer
    this.clearTurnTimer();

    // Delegate to game-specific handler
    this.handleMove(client, data);

    // Check for win condition
    const result = this.checkWinCondition();
    if (result) {
      await this.endGame(result.winner, result.isDraw);
    }
  }

  protected handleReady(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (player && this.state.status === "waiting") {
      player.isReady = true;
      logger.info({ roomId: this.roomId, playerId: client.sessionId }, "Player ready");

      // Check if all players are ready to start
      this.checkStartGame();
    }
  }

  protected handleSurrender(client: Client): void {
    if (this.state.status !== "in_progress") {
      return;
    }

    logger.info({ roomId: this.roomId, playerId: client.sessionId }, "Player surrendered");
    this.handlePlayerForfeit(client.sessionId);
  }

  protected checkStartGame(): void {
    if (this.state.status !== "waiting") return;

    // Need all seats filled before the game can start
    if (this.clients.length < this.maxPlayers) return;

    const allReady = Array.from(this.state.players.values()).every((p) => p.isReady);
    logger.info(
      {
        roomId: this.roomId,
        clients: this.clients.length,
        allReady,
        initialPlayers: Array.from(this.initialPlayers),
        players: Array.from(this.state.players.values()).map((p) => ({
          id: p.id,
          isReady: p.isReady,
          isBot: p.isBot,
        })),
      },
      "Checking if game should start"
    );

    if (allReady) {
      // Lock in initial players and start game
      this.startGame();
    }
  }

  protected startGame(): void {
    this.state.status = "in_progress";
    this.state.turnTimeLimit = config.game.turnTimeLimit;

    // Update metadata to reflect game has started (for matchmaking)
    this.setMetadata({
      ...this.metadata,
      status: "in_progress",
    });

    // Mark game as started in Redis (handoff point - lobby stays for spectators)
    lobbyService.startGame(this.roomId).catch((err) => {
      logger.warn({ error: err, roomId: this.roomId }, "Failed to update lobby status in Redis");
    });

    // Randomly select first player from initial players only
    const initialPlayerIds = Array.from(this.initialPlayers);
    const firstPlayer = initialPlayerIds[Math.floor(Math.random() * initialPlayerIds.length)];
    this.state.currentTurnId = firstPlayer;
    this.state.turnStartedAt = Date.now();

    logger.info(
      {
        roomId: this.roomId,
        firstPlayer,
        initialPlayers: initialPlayerIds,
        allPlayers: Array.from(this.state.players.keys()),
        currentTurnId: this.state.currentTurnId,
        playerDetails: Array.from(this.state.players.values()).map((p) => ({
          id: p.id,
          sessionId: "N/A",
          displayName: p.displayName,
        })),
      },
      "Game started"
    );

    this.broadcast("game_started", { firstPlayer });

    // Start turn timer
    this.startTurnTimer();
  }

  protected nextTurn(): void {
    this.clearTurnTimer();

    // Only cycle through initial players
    const initialPlayerIds = Array.from(this.initialPlayers);
    if (initialPlayerIds.length === 0) return;
    const currentIndex = initialPlayerIds.indexOf(this.state.currentTurnId);
    const nextIndex = (currentIndex + 1) % initialPlayerIds.length;
    const previousTurnId = this.state.currentTurnId;
    this.state.currentTurnId = initialPlayerIds[nextIndex];
    this.state.turnStartedAt = Date.now();

    logger.info(
      {
        roomId: this.roomId,
        previousTurnId,
        currentTurnId: this.state.currentTurnId,
        initialPlayers: initialPlayerIds,
        turnIndex: { current: currentIndex, next: nextIndex },
      },
      "Turn switched"
    );

    // Start turn timer for next player
    this.startTurnTimer();
  }

  protected startTurnTimer(): void {
    // Timer is now display-only (no auto-forfeit), so we don't set a server-side timeout.
    // The client displays the timer based on turnStartedAt and turnTimeLimit.
    // Players can continue thinking without automatic forfeiture.
    this.clearTurnTimer();
  }

  protected clearTurnTimer(): void {
    if (this.turnTimer) {
      this.turnTimer.clear();
      this.turnTimer = null;
    }
  }

  protected handleTurnTimeout(): void {
    // No-op: Timer is now display-only, no auto-forfeit on timeout.
    // This method is kept for potential future use or custom room overrides.
    if (this.state.status !== "in_progress") return;

    const currentPlayerId = this.state.currentTurnId;
    logger.info(
      { roomId: this.roomId, playerId: currentPlayerId },
      "Turn timeout (display only, no forfeit)"
    );
  }

  protected async endGame(winnerId: string | null, isDraw: boolean): Promise<void> {
    this.clearTurnTimer();
    this.state.status = "finished";
    this.state.winnerId = winnerId || "";
    this.state.isDraw = isDraw;

    // Update metadata to reflect game has finished (for matchmaking)
    this.setMetadata({
      ...this.metadata,
      status: "finished",
    });

    // Delete lobby from Redis (game is over, no more spectators needed)
    lobbyService.deleteLobby(this.roomId).catch((err) => {
      logger.warn({ error: err, roomId: this.roomId }, "Failed to delete lobby from Redis");
    });

    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    logger.info("🏁 GAME ENDED");
    logger.info(
      {
        roomId: this.roomId,
        gameType: this.roomName,
        winnerId,
        isDraw,
        vsBot: Boolean(this.metadata?.vsBot),
        initialPlayers: Array.from(this.initialPlayers).length,
      },
      "Game result"
    );

    this.broadcast("game_ended", { winnerId, isDraw });

    // Record history for all participants (including bots)
    try {
      const participants: ParticipantIdentity[] = Array.from(this.initialPlayers).map(
        (playerId) => {
          const playerSchema = this.state.players.get(playerId);
          const identity = this.playerIdentities.get(playerId);
          return {
            identity: identity?.identity || `guest:${playerId}`,
            userId: identity?.userId,
            browserSessionId: identity?.browserSessionId,
            displayName: playerSchema?.displayName || identity?.displayName || "Player",
            isBot: playerSchema?.isBot || identity?.isBot || false,
          };
        }
      );

      logger.info("📋 Participants:");
      participants.forEach((p) => {
        logger.info(`   ${p.isBot ? "🤖" : "👤"} ${p.displayName} (userId: ${p.userId || "N/A"})`);
      });

      const durationMs = this.metadata?.createdAt
        ? Date.now() - (this.metadata.createdAt as number)
        : undefined;

      // Get total moves if the game tracks it
      const totalMoves = (this.state as any).moveCount || (this.state as any).roundNumber || null;

      // Map winnerId (sessionId) to userId for database storage
      let winnerUserId: string | null = null;
      if (winnerId) {
        const winnerIdentity = this.playerIdentities.get(winnerId);
        winnerUserId = winnerIdentity?.userId || null;
        logger.info(
          `🏆 Winner: ${winnerIdentity?.displayName || "Unknown"} (userId: ${winnerUserId || "N/A"})`
        );
      }

      const normalizedGameType =
        (this.roomName?.replace("_bot", "") as GameType) || GameType.CONNECT4;

      logger.info("💾 Calling historyService.recordGame...");

      // recordGame is now async
      await historyService.recordGame({
        roomId: this.roomId,
        roomSlug: this.roomSlug,
        gameType: normalizedGameType,
        winnerId: winnerUserId,
        isDraw,
        participants,
        vsBot: Boolean(this.metadata?.vsBot),
        durationMs,
        totalMoves,
        maxPlayers: this.maxPlayers,
      });
    } catch (error) {
      logger.error(error, "Failed to record game history");
    }

    // Dispose room after a delay
    this.clock.setTimeout(() => {
      this.disconnect();
    }, 10000);
  }

  protected async handlePlayerForfeit(forfeitPlayerId: string): Promise<void> {
    // Only consider initial players for determining winner
    const initialPlayerIds = Array.from(this.initialPlayers);
    const winnerId = initialPlayerIds.find((id) => id !== forfeitPlayerId) || null;
    await this.endGame(winnerId, false);
  }

  /**
   * Host Control: Add a bot to the lobby
   * Only works before game starts
   */
  protected handleAddBot(client: Client, data: { difficulty?: string; name?: string }): void {
    // Verify caller is host
    if (client.sessionId !== this.hostSessionId) {
      client.send("error", { message: "Only the host can add bots" });
      logger.warn({ roomId: this.roomId, clientId: client.sessionId }, "Non-host tried to add bot");
      return;
    }

    // Only allow adding bots before game starts
    if (this.state.status !== "waiting") {
      client.send("error", { message: "Cannot add bots after game starts" });
      return;
    }

    // Generate bot ID and name
    const botId = `bot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const botName = data.name || `Bot ${this.state.players.size + 1}`;
    const difficulty = data.difficulty || "Medium";

    // Create bot player
    const bot = new GamePlayerSchema();
    bot.id = botId;
    bot.displayName = botName;
    bot.isBot = true;
    bot.isReady = true; // Bots are always ready
    bot.isConnected = true;
    bot.joinedAt = Date.now();
    bot.isSpectator = false;
    bot.wasInitialPlayer = true;
    bot.isHost = false;

    // Add to players and initial players
    this.state.players.set(botId, bot);
    this.initialPlayers.add(botId);

    // Register bot identity
    this.registerBotIdentity(botId, botName);

    logger.info(
      {
        roomId: this.roomId,
        botId,
        botName,
        difficulty,
        totalPlayers: this.state.players.size,
      },
      "Bot added to lobby"
    );

    // Broadcast to all clients
    this.broadcast("bot_added", {
      botId,
      botName,
      difficulty,
    });

    // Update lobby in Redis
    lobbyService.playerJoined(this.roomId).catch((err) => {
      logger.warn({ error: err, roomId: this.roomId }, "Failed to update lobby after bot add");
    });
  }

  /**
   * Host Control: Kick a player from the lobby
   * Only works before game starts
   */
  protected handleKickPlayer(client: Client, data: { playerId: string }): void {
    // Verify caller is host
    if (client.sessionId !== this.hostSessionId) {
      client.send("error", { message: "Only the host can kick players" });
      logger.warn(
        { roomId: this.roomId, clientId: client.sessionId },
        "Non-host tried to kick player"
      );
      return;
    }

    // Only allow kicking before game starts
    if (this.state.status !== "waiting") {
      client.send("error", { message: "Cannot kick players after game starts" });
      return;
    }

    const { playerId } = data;

    // Cannot kick yourself (the host)
    if (playerId === this.hostSessionId) {
      client.send("error", { message: "Cannot kick yourself" });
      return;
    }

    const player = this.state.players.get(playerId);
    if (!player) {
      client.send("error", { message: "Player not found" });
      return;
    }

    // Handle bot kick (just remove from state)
    if (player.isBot) {
      this.state.players.delete(playerId);
      this.initialPlayers.delete(playerId);
      this.playerIdentities.delete(playerId);

      logger.info(
        {
          roomId: this.roomId,
          kickedPlayerId: playerId,
          playerName: player.displayName,
          isBot: true,
        },
        "Bot kicked from lobby"
      );

      this.broadcast("player_kicked", {
        playerId,
        playerName: player.displayName,
        isBot: true,
      });

      // Update lobby in Redis
      lobbyService.playerLeft(this.roomId).catch((err) => {
        logger.warn({ error: err, roomId: this.roomId }, "Failed to update lobby after bot kick");
      });

      return;
    }

    // Handle human player kick (disconnect their socket)
    const targetClient = Array.from(this.clients).find((c) => c.sessionId === playerId);
    if (targetClient) {
      logger.info(
        {
          roomId: this.roomId,
          kickedPlayerId: playerId,
          playerName: player.displayName,
          isBot: false,
        },
        "Player kicked from lobby"
      );

      // Notify the kicked player
      targetClient.send("kicked", {
        reason: "You were removed from the lobby by the host",
      });

      // Broadcast to others
      this.broadcast(
        "player_kicked",
        {
          playerId,
          playerName: player.displayName,
          isBot: false,
        },
        { except: targetClient }
      );

      // Disconnect the client
      targetClient.leave(1000); // Normal closure

      // Update lobby in Redis
      lobbyService.playerLeft(this.roomId).catch((err) => {
        logger.warn(
          { error: err, roomId: this.roomId },
          "Failed to update lobby after player kick"
        );
      });
    }
  }
}
