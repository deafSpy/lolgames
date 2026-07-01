import { Room, Client, Delayed } from "@colyseus/core";
import { BaseGameState, GamePlayerSchema, GameType } from "@multiplayer/shared";
import { logger } from "../logger.js";
import { config } from "../config.js";
import { historyService, type ParticipantIdentity } from "../services/historyService.js";
import { lobbyService } from "../services/lobbyService.js";
import { slugService } from "../services/slugService.js";
import { BotTurnWatchdog } from "./BotTurnWatchdog.js";
import type { BotAgent } from "../bots/BotAgent.js";

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
  private botWatchdog: BotTurnWatchdog = new BotTurnWatchdog(
    (cb, ms) => {
      const delayed = this.clock.setTimeout(cb, ms);
      return { clear: () => delayed.clear() };
    },
    (botId) => {
      if (this.state.status !== "in_progress") return;
      if (this.state.currentTurnId !== botId) return;
      logger.warn(
        { roomId: this.roomId, botId, timeoutMs: config.game.botTurnTimeoutMs },
        "Bot turn watchdog: timeout — force-advancing turn"
      );
      this.nextTurn();
    },
    (botId, count) => {
      logger.error(
        { roomId: this.roomId, botId, consecutiveTurns: count },
        "Bot turn watchdog: same bot exceeded max consecutive turns — force-advancing turn"
      );
    },
    {
      timeoutMs: config.game.botTurnTimeoutMs,
      maxConsecutiveTurns: config.game.botMaxConsecutiveTurns,
    }
  );
  // Maps browserSessionId → sessionId for the current initialPlayer slot.
  // Used to evict ghost slots left behind by React StrictMode double-mount:
  // StrictMode cleanup sends a non-consented leave during the waiting phase,
  // removing the player from state.players but leaving initialPlayers untouched.
  // When the same browserSessionId re-joins, we detect and clear the stale slot
  // so seatsAreFull is computed correctly.
  protected browserSessionToInitialPlayer: Map<string, string> = new Map();
  protected roomSlug: string = ""; // Human-readable room code (e.g., "swift-blue-fox")
  protected hostSessionId: string = ""; // Track the host for kick/bot management
  maxPlayers: number = 2; // Authoritative seat count; set from onCreate options
  // Lobby bots: agents for bots added to a human room via the host UI.
  // Game room subclasses populate this via createLobbyBotAgent().
  protected lobbyBotAgents: Map<string, BotAgent> = new Map();

  protected registerBotIdentity(botId: string, displayName: string): void {
    this.playerIdentities.set(botId, {
      identity: `bot:${botId}`,
      displayName,
      isBot: true,
    });
  }

  protected isBot(playerId: string): boolean {
    return (
      this.playerIdentities.get(playerId)?.isBot === true ||
      this.state.players.get(playerId)?.isBot === true
    );
  }

  /**
   * Factory hook: creates the player schema for a lobby bot.
   * Game rooms that use a sub-schema (e.g. SequencePlayer, SplendorPlayerSchema)
   * must override this to return the correct subclass instance so that
   * game-specific fields (hand, teamId, etc.) are included on the wire.
   * Common fields (id, displayName, isBot, etc.) are set by handleAddBot after this.
   */
  protected createLobbyBotPlayerSchema(
    _botId: string,
    _botName: string,
    _difficulty: string
  ): GamePlayerSchema {
    return new GamePlayerSchema();
  }

  /**
   * Factory hook for lobby-bot support. Game room subclasses override this to
   * return the appropriate bot agent when a host adds a bot to a human lobby.
   * Returns null by default (no bot moves will be scheduled).
   */
  protected createLobbyBotAgent(_botId: string, _difficulty: string): BotAgent | null {
    return null;
  }

  /**
   * Scheduling hook called whenever the current turn transitions to a lobby bot.
   * Game room subclasses override this to kick off bot move logic using the
   * agent stored in `this.lobbyBotAgents`.
   */
  protected scheduleLobbyBotMoveIfNeeded(): void {}

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

      // StrictMode dedup: React StrictMode fires effects twice in dev. The
      // first-mount cleanup sends a non-consented leave during the waiting
      // phase, which removes the player from state.players but leaves their
      // slot in initialPlayers (the pre-game path skips allowReconnection).
      // On the second mount, the same browserSessionId re-joins with a new
      // sessionId. Without this check, initialPlayers accumulates two entries
      // for the same human, filling all seats before P2 can join.
      //
      // Extended case: when the waiting-state reconnect window is open, the
      // old session IS still in state.players (isConnected=false). A fresh
      // join with the same browserSessionId but a new sessionId must evict
      // the disconnected slot so seatsAreFull is not inflated by 1.
      if (options.browserSessionId) {
        const priorSessionId = this.browserSessionToInitialPlayer.get(options.browserSessionId);
        if (priorSessionId) {
          const priorPlayer = this.state.players.get(priorSessionId);
          const priorIsGone = !priorPlayer;
          const priorIsDisconnected = priorPlayer && !priorPlayer.isConnected;
          if (priorIsGone || priorIsDisconnected) {
            this.initialPlayers.delete(priorSessionId);
            this.playerIdentities.delete(priorSessionId);
            this.browserSessionToInitialPlayer.delete(options.browserSessionId);
            // If the old slot is still in state (allowReconnection window open), remove it
            // so the dangling window closes cleanly and the seat is freed.
            if (priorIsDisconnected) {
              this.state.players.delete(priorSessionId);
            }
            logger.info(
              {
                roomId: this.roomId,
                priorSessionId,
                newSessionId: client.sessionId,
                browserSessionId: options.browserSessionId,
                reason: priorIsGone ? "session_gone" : "session_disconnected",
              },
              "Dedup: evicted ghost initialPlayer slot"
            );
          }
        }
      }

      // Spectator if game already in progress OR all game seats are already claimed
      const seatsAreFull = this.initialPlayers.size >= this.maxPlayers;

      // Reject spectators attempting to join a waiting room — they can only
      // spectate games that have already started.
      if (this.state.status === "waiting" && seatsAreFull) {
        throw new Error("Room is full. You can only spectate games that have already started.");
      }

      player.isSpectator = this.state.status === "in_progress";
      player.wasInitialPlayer = !player.isSpectator;
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

      // Track the first non-spectator player as the host
      if (
        !player.isSpectator &&
        this.initialPlayers.size === 0 &&
        this.state.status === "waiting"
      ) {
        this.hostSessionId = client.sessionId;
        player.isHost = true;
        logger.info({ roomId: this.roomId, hostSessionId: this.hostSessionId }, "Host assigned");
      }

      // Only real players (non-spectators, pre-game) go into initialPlayers
      if (!player.isSpectator && this.state.status === "waiting") {
        this.initialPlayers.add(client.sessionId);
        // Record browserSessionId → sessionId so we can evict ghost slots on re-join
        if (options.browserSessionId) {
          this.browserSessionToInitialPlayer.set(options.browserSessionId, client.sessionId);
        }
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
            isSpectator: player.isSpectator,
          },
          "Player NOT added to initialPlayers (spectator or game already started)"
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

    // Delay room_info by 250 ms so it arrives AFTER the JOIN_ROOM acknowledgment.
    // client.send() called within onJoin() is enqueued on the WebSocket before
    // Colyseus sends JOIN_ROOM (which happens after onJoin() returns). The client
    // therefore receives ROOM_DATA before onJoin.invoke() fires, meaning no
    // room_info handler is registered yet and the message is silently dropped.
    // The 250 ms delay guarantees handlers are in place before delivery.
    if (this.roomSlug) {
      const slug = this.roomSlug;
      this.clock.setTimeout(() => {
        try {
          client.send("room_info", { roomSlug: slug });
        } catch {
          // Client disconnected during the handshake window — no-op
        }
      }, 250);
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

    // Consented leave or game already over → remove immediately and free the seat.
    if (consented || this.state.status === "finished") {
      this.state.players.delete(client.sessionId);
      // Also free the initialPlayers slot so subsequent fresh joins can reclaim
      // the seat. React StrictMode fires a synthetic consented leave on every
      // effect re-run; without this cleanup the counter grows monotonically.
      this.initialPlayers.delete(client.sessionId);

      if (this.state.status === "in_progress" && consented) {
        this.handlePlayerForfeit(client.sessionId);
      }

      if (!player.isSpectator && this.state.status === "waiting") {
        lobbyService.playerLeft(this.roomId).catch((err) => {
          logger.warn({ error: err, roomId: this.roomId }, "Failed to update lobby in Redis");
        });

        // If no real players remain in the waiting room, remove it from the lobby
        // so it no longer appears in the game list.
        const remainingRealPlayers = Array.from(this.state.players.values()).filter(
          (p) => !p.isSpectator && !p.isBot
        );
        if (remainingRealPlayers.length === 0) {
          lobbyService.deleteLobby(this.roomId).catch((err) => {
            logger.warn(
              { error: err, roomId: this.roomId },
              "Failed to delete empty lobby from Redis"
            );
          });
          logger.info(
            { roomId: this.roomId },
            "Last real player left waiting room — lobby removed"
          );
        }
      }

      this.scheduleEmptyRoomDisposal();
      return;
    }

    // Spectators: just drop; no reconnect window needed.
    if (player.isSpectator) {
      this.state.players.delete(client.sessionId);
      lobbyService.spectatorLeft(this.roomId).catch((err) => {
        logger.warn(
          { error: err, roomId: this.roomId },
          "Failed to update spectator count in Redis"
        );
      });
      this.scheduleEmptyRoomDisposal();
      return;
    }

    // Non-consented, non-spectator drop in "waiting" state: hold the seat open
    // so the player can navigate back and reconnect as the same sessionId.
    // Without this, each disconnect increments initialPlayers without a matching
    // decrement, so seatsAreFull becomes true after one StrictMode cycle + navigation.
    if (this.state.status === "waiting") {
      player.isConnected = false;
      const reconnectSeconds = Math.max(1, Math.floor(config.game.reconnectTimeout / 1000));
      logger.info(
        {
          roomId: this.roomId,
          sessionId: client.sessionId,
          displayName: player.displayName,
          reconnectWindowSec: reconnectSeconds,
        },
        "Reconnect window opened for waiting player"
      );

      try {
        await this.allowReconnection(client, reconnectSeconds);
        // onJoin() fires again with the same sessionId; isConnected flipped back.
        logger.info(
          {
            roomId: this.roomId,
            sessionId: client.sessionId,
            displayName: player.displayName,
          },
          "Waiting player reconnected"
        );
      } catch {
        // Window expired — free the seat completely so fresh joins can fill it.
        logger.info(
          {
            roomId: this.roomId,
            sessionId: client.sessionId,
            displayName: player.displayName,
            reconnectWindowSec: reconnectSeconds,
          },
          "Waiting player reconnect window expired, freeing seat"
        );
        this.state.players.delete(client.sessionId);
        this.initialPlayers.delete(client.sessionId);
        lobbyService.playerLeft(this.roomId).catch((err) => {
          logger.warn({ error: err, roomId: this.roomId }, "Failed to update lobby in Redis");
        });
        // Remove lobby from Redis if no real players remain after reconnect window expires
        const remainingAfterExpiry = Array.from(this.state.players.values()).filter(
          (p) => !p.isSpectator && !p.isBot
        );
        if (remainingAfterExpiry.length === 0) {
          lobbyService.deleteLobby(this.roomId).catch((err) => {
            logger.warn(
              { error: err, roomId: this.roomId },
              "Failed to delete empty lobby from Redis after reconnect expiry"
            );
          });
        }
        this.scheduleEmptyRoomDisposal();
      }
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
    this.botWatchdog.clear();
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

    // Check for win condition — only if the game is still running.
    // Some rooms (e.g. BlackjackRoom) call checkWinCondition + endGame
    // internally during handleMove, so we guard here to prevent a second
    // endGame call that would double-broadcast game_ended.
    if (this.state.status === "in_progress") {
      const result = this.checkWinCondition();
      if (result) {
        await this.endGame(result.winner, result.isDraw);
      }
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

    // Seated players = non-spectators (bots count as seated; spectators do not)
    const seatedPlayers = Array.from(this.state.players.values()).filter((p) => !p.isSpectator);

    // Need all seats filled before the game can start
    if (seatedPlayers.length < this.maxPlayers) return;

    // All seated players must be ready (bots are always ready)
    const allReady = seatedPlayers.every((p) => p.isReady);

    logger.info(
      {
        roomId: this.roomId,
        seatedCount: seatedPlayers.length,
        allReady,
        initialPlayers: Array.from(this.initialPlayers),
        players: Array.from(this.state.players.values()).map((p) => ({
          id: p.id,
          isReady: p.isReady,
          isBot: p.isBot,
          isSpectator: p.isSpectator,
        })),
      },
      "Checking if game should start"
    );

    if (allReady) {
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
    // Start bot watchdog whenever a new turn begins
    this.onTurnStarted();
  }

  private onTurnStarted(): void {
    const currentPlayerId = this.state.currentTurnId;
    if (!currentPlayerId) return;

    if (this.isBot(currentPlayerId)) {
      this.botWatchdog.startForBot(currentPlayerId);
      // If this bot was added to a human lobby, trigger its move
      if (this.lobbyBotAgents.has(currentPlayerId)) {
        this.scheduleLobbyBotMoveIfNeeded();
      }
    } else {
      this.botWatchdog.resetForHuman();
    }
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
    this.botWatchdog.clear();
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

    // Check seat availability before adding bot
    if (this.initialPlayers.size >= this.maxPlayers) {
      client.send("error", { message: "Room is full" });
      return;
    }

    // Generate bot ID and name
    const botId = `bot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const botName = data.name || `Bot ${this.state.players.size + 1}`;
    const difficulty = (data.difficulty || "medium").toLowerCase();

    // Create bot player (subclass may return a game-specific schema type)
    const bot = this.createLobbyBotPlayerSchema(botId, botName, difficulty);
    bot.id = botId;
    bot.displayName = botName;
    bot.isBot = true;
    bot.botDifficulty = difficulty;
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

    // Create game-specific bot agent (overridden per game room)
    const agent = this.createLobbyBotAgent(botId, difficulty);
    if (agent) {
      this.lobbyBotAgents.set(botId, agent);
      logger.info({ roomId: this.roomId, botId, difficulty }, "Lobby bot agent created");
    }

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
      this.lobbyBotAgents.delete(playerId);

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
