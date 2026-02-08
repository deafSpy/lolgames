import { Room, Client, Delayed } from "@colyseus/core";
import { BaseGameState, GamePlayerSchema, GameType } from "@multiplayer/shared";
import { logger } from "../logger.js";
import { config } from "../config.js";
import { historyService, type ParticipantIdentity } from "../services/historyService.js";

export interface JoinOptions {
  playerName?: string;
  hostName?: string;
  createdAt?: number;
  vsBot?: boolean;
  browserSessionId?: string;
  userId?: string;
  authProvider?: string;
}

export abstract class BaseRoom<TState extends BaseGameState> extends Room<TState> {
  maxClients = 100; // Allow many spectators/late joiners
  autoDispose = false; // Manual disposal
  turnTimer: Delayed | null = null;
  initialPlayers: Set<string> = new Set(); // Players that were in the lobby at game start
  protected playerIdentities: Map<string, ParticipantIdentity> = new Map();

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

  onCreate(options: JoinOptions): void {
    logger.info({ roomId: this.roomId, options }, "Room created");

    // Set room metadata
    this.setMetadata({
      gameType: this.roomName,
      hostName: options.hostName || "Unknown",
      createdAt: options.createdAt || Date.now(),
      vsBot: options.vsBot || false,
      status: "waiting", // Add status for matchmaking
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

      // If game hasn't started yet, add to initial players
      if (this.state.status === "waiting") {
        this.initialPlayers.add(client.sessionId);
        logger.info(
          {
            roomId: this.roomId,
            playerId: client.sessionId,
            initialPlayers: Array.from(this.initialPlayers),
            gameStatus: this.state.status,
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
    }

    // Room now persists since someone joined it
  }

  onLeave(client: Client, consented: boolean): void {
    const player = this.state.players.get(client.sessionId);

    if (player) {
      logger.info({ roomId: this.roomId, playerId: client.sessionId, consented }, "Player left");

      if (consented || this.state.status === "finished") {
        // Player intentionally left or game is over
        this.state.players.delete(client.sessionId);

        // If game was in progress and player left intentionally, forfeit
        if (this.state.status === "in_progress" && consented) {
          this.handlePlayerForfeit(client.sessionId);
        }
      } else {
        // Player disconnected - mark as disconnected but keep their data
        player.isConnected = false;
        logger.info(
          { roomId: this.roomId, playerId: client.sessionId },
          "Player marked as disconnected"
        );
      }
    }

    // Schedule disposal if room becomes empty
    this.scheduleEmptyRoomDisposal();

    // Rooms are never locked - spectators can always join
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

    // Need at least 2 players ready
    if (this.clients.length < 2) return;

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
        gameType: normalizedGameType,
        winnerId: winnerUserId,
        isDraw,
        participants,
        vsBot: Boolean(this.metadata?.vsBot),
        durationMs,
        totalMoves,
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
}
