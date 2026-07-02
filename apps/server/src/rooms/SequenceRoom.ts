import { Client } from "@colyseus/core";
import { SequenceState, SequencePlayer, SequenceCard, SequenceChip } from "@multiplayer/shared";
import { BaseRoom, type JoinOptions } from "./BaseRoom.js";
import { logger } from "../logger.js";
import { lobbyService } from "../services/lobbyService.js";
import type { ParticipantIdentity } from "../services/historyService.js";
import { SequenceBot } from "../bots/SequenceBot.js";
import type { BotAgent } from "../bots/BotAgent.js";

interface MoveData {
  cardIndex: number;
  boardX: number;
  boardY: number;
}

// Standard Sequence board layout (10x10)
// Each cell corresponds to a card
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

export class SequenceRoom extends BaseRoom<SequenceState> {
  maxClients = 4; // 2-4 players (2 or 3 teams)
  private deck: string[] = [];

  initializeGame(): void {
    this.setState(new SequenceState());
    this.state.status = "waiting";
    this.state.sequencesToWin = 2;
    this.initializeDeck();
  }

  private initializeDeck(): void {
    const suits = ["H", "D", "C", "S"]; // Hearts, Diamonds, Clubs, Spades
    const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

    // Two standard decks
    for (let d = 0; d < 2; d++) {
      for (const suit of suits) {
        for (const rank of ranks) {
          this.deck.push(`${rank}${suit}`);
        }
      }
    }

    // Shuffle deck
    this.shuffleDeck();
    this.state.deckRemaining = this.deck.length;
  }

  private shuffleDeck(): void {
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  onJoin(client: Client, options: JoinOptions): void {
    const existingPlayer = this.state.players.get(client.sessionId) as SequencePlayer | undefined;
    if (existingPlayer) {
      // Reconnect — restore connection state
      existingPlayer.isConnected = true;
      logger.info(
        { roomId: this.roomId, playerId: client.sessionId },
        "Player reconnected to Sequence"
      );
      return;
    }

    // StrictMode dedup: evict stale ghost slot for same browser session
    if (options.browserSessionId) {
      const priorSessionId = this.browserSessionToInitialPlayer.get(options.browserSessionId);
      if (priorSessionId) {
        const priorPlayer = this.state.players.get(priorSessionId);
        if (!priorPlayer || !priorPlayer.isConnected) {
          this.initialPlayers.delete(priorSessionId);
          this.playerIdentities.delete(priorSessionId);
          this.browserSessionToInitialPlayer.delete(options.browserSessionId);
          if (priorPlayer && !priorPlayer.isConnected) {
            this.state.players.delete(priorSessionId);
          }
        }
      }
    }

    const player = new SequencePlayer();
    player.id = client.sessionId;
    player.displayName = options.playerName || `Guest_${client.sessionId.slice(0, 4)}`;
    player.isReady = false;
    player.isConnected = true;
    player.joinedAt = Date.now();
    player.isBot = false;
    player.isHost = false;

    // Spectator if game already started or all seats are taken
    const seatsAreFull = this.initialPlayers.size >= this.maxPlayers;
    const isSpectator =
      this.state.status === "in_progress" || (this.state.status === "waiting" && seatsAreFull);
    player.isSpectator = isSpectator;
    player.wasInitialPlayer = !isSpectator;

    if (!isSpectator && this.state.status === "waiting") {
      // Assign team based on seat order so teams alternate: 0,1,0,1,...
      player.teamId = this.initialPlayers.size % 2;

      if (this.initialPlayers.size === 0) {
        this.hostSessionId = client.sessionId;
        player.isHost = true;
      }
      // Register in initialPlayers so startGame/nextTurn can cycle through them
      this.initialPlayers.add(client.sessionId);
      if (options.browserSessionId) {
        this.browserSessionToInitialPlayer.set(options.browserSessionId, client.sessionId);
      }

      // Register stable identity for history
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

      lobbyService.playerJoined(this.roomId).catch((err) => {
        logger.warn({ error: err, roomId: this.roomId }, "Failed to update lobby in Redis");
      });
    }

    this.state.players.set(client.sessionId, player);

    logger.info(
      { roomId: this.roomId, playerId: client.sessionId, teamId: player.teamId, isSpectator },
      "Player joined Sequence"
    );

    // Delayed room_info so the message arrives after the JOIN_ROOM acknowledgment
    if (this.roomSlug) {
      const slug = this.roomSlug;
      this.clock.setTimeout(() => {
        try {
          client.send("room_info", { roomSlug: slug });
        } catch {
          // Client disconnected during handshake window — no-op
        }
      }, 250);
    }

    if (this.clients.length >= this.maxPlayers) {
      this.lock();
    }
  }

  protected startGame(): void {
    super.startGame();

    // Deal cards only to seated (initial) players — 7 for 2p, 6 for 3p, 5 for 4p
    const seatCount = this.initialPlayers.size;
    const handSize = seatCount === 2 ? 7 : seatCount === 3 ? 6 : 5;

    for (const sessionId of this.initialPlayers) {
      const p = this.state.players.get(sessionId) as SequencePlayer | undefined;
      if (!p) continue;
      for (let i = 0; i < handSize; i++) {
        this.drawCard(p);
      }
    }

    this.state.deckRemaining = this.deck.length;
  }

  private drawCard(player: SequencePlayer): boolean {
    if (this.deck.length === 0) return false;

    const cardStr = this.deck.pop()!;
    const card = new SequenceCard();

    // Parse card string (e.g., "10H" -> rank: "10", suit: "hearts")
    const suitChar = cardStr.slice(-1);
    const rank = cardStr.slice(0, -1);

    card.rank = rank;
    card.suit =
      suitChar === "H"
        ? "hearts"
        : suitChar === "D"
          ? "diamonds"
          : suitChar === "C"
            ? "clubs"
            : "spades";

    player.hand.push(card);
    this.state.deckRemaining = this.deck.length;

    return true;
  }

  handleMove(client: Client, data: unknown): void {
    const moveData = data as MoveData;
    const player = this.state.players.get(client.sessionId) as SequencePlayer;

    if (!player) {
      client.send("error", { message: "Player not found" });
      return;
    }

    const { cardIndex, boardX, boardY } = moveData;

    // Validate card index
    if (cardIndex < 0 || cardIndex >= player.hand.length) {
      client.send("error", { message: "Invalid card index" });
      return;
    }

    // Validate board position
    if (boardX < 0 || boardX >= 10 || boardY < 0 || boardY >= 10) {
      client.send("error", { message: "Invalid board position" });
      return;
    }

    const card = player.hand[cardIndex];
    const cardStr = `${card.rank}${card.suit.charAt(0).toUpperCase()}`;
    const boardCard = BOARD_LAYOUT[boardY][boardX];

    // Check if it's a free corner
    if (boardCard === "FREE") {
      client.send("error", { message: "Cannot play on free corners" });
      return;
    }

    // Check if card matches board position
    const isJack = card.rank === "J";
    const isTwoEyedJack = isJack && (card.suit === "diamonds" || card.suit === "clubs");
    const isOneEyedJack = isJack && (card.suit === "hearts" || card.suit === "spades");

    // Check if position is already occupied
    const existingChip = this.state.chips.find((c) => c.x === boardX && c.y === boardY);

    if (isOneEyedJack) {
      // One-eyed jack removes an opponent's chip
      if (!existingChip || existingChip.teamId === player.teamId) {
        client.send("error", { message: "One-eyed jack must remove opponent's chip" });
        return;
      }
      if (existingChip.isPartOfSequence) {
        client.send("error", { message: "Cannot remove chip that is part of a sequence" });
        return;
      }
      // Remove the chip
      const chipIndex = this.state.chips.indexOf(existingChip);
      this.state.chips.splice(chipIndex, 1);
      // Recount sequences for both teams since the opponent's chip was removed
      this.checkSequences(0);
      this.checkSequences(1);
    } else if (isTwoEyedJack) {
      // Two-eyed jack places chip anywhere
      if (existingChip) {
        client.send("error", { message: "Position already occupied" });
        return;
      }
      this.placeChip(boardX, boardY, player.teamId);
    } else {
      // Regular card - must match board position
      if (boardCard !== cardStr) {
        client.send("error", { message: "Card does not match board position" });
        return;
      }
      if (existingChip) {
        client.send("error", { message: "Position already occupied" });
        return;
      }
      this.placeChip(boardX, boardY, player.teamId);
    }

    // Track discard before removing
    const suitChar =
      card.suit === "hearts"
        ? "H"
        : card.suit === "diamonds"
          ? "D"
          : card.suit === "clubs"
            ? "C"
            : "S";
    this.state.lastDiscardedCard = `${card.rank}${suitChar}`;
    this.state.discardPileCount += 1;

    // Remove card from hand
    player.hand.splice(cardIndex, 1);

    // Draw new card
    this.drawCard(player);

    logger.info(
      { roomId: this.roomId, playerId: client.sessionId, boardX, boardY },
      "Sequence move made"
    );

    // Update sequence counts before broadcasting so clients get current state
    this.checkSequences(player.teamId);

    this.broadcast("chip_placed", {
      playerId: client.sessionId,
      boardX,
      boardY,
      teamId: player.teamId,
    });

    // Advance turn only when game continues; BaseRoom.handleMoveMessage handles endGame on win
    if (!this.checkWinCondition()) {
      this.nextTurn();
    }
  }

  private placeChip(x: number, y: number, teamId: number): void {
    const chip = new SequenceChip();
    chip.x = x;
    chip.y = y;
    chip.teamId = teamId;
    chip.isPartOfSequence = false;
    this.state.chips.push(chip);
  }

  private checkSequences(teamId: number): void {
    // Recount all sequences for this team
    const sequences = this.countSequences(teamId);
    if (teamId === 0) {
      this.state.team1Sequences = sequences;
    } else {
      this.state.team2Sequences = sequences;
    }
  }

  private countSequences(teamId: number): number {
    // Create a 10x10 grid showing which cells are occupied by team
    const grid: number[][] = [];
    for (let y = 0; y < 10; y++) {
      grid[y] = [];
      for (let x = 0; x < 10; x++) {
        // Check for free corners (count for all teams)
        if (
          (x === 0 && y === 0) ||
          (x === 9 && y === 0) ||
          (x === 0 && y === 9) ||
          (x === 9 && y === 9)
        ) {
          grid[y][x] = 2; // Free corner (wild)
        } else {
          grid[y][x] = -1; // Empty
        }
      }
    }

    // Fill grid with chip positions
    for (const chip of this.state.chips) {
      if (chip.teamId === teamId) {
        grid[chip.y][chip.x] = 1; // Team's chip
      } else {
        // Keep as -1 (opponent's chip or empty doesn't help)
      }
    }

    // Find all sequences of 5
    const foundSequences: string[] = [];
    const usedInSequence: Set<string> = new Set();

    // Check horizontal sequences
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x <= 5; x++) {
        if (this.isSequenceAt(grid, x, y, 1, 0)) {
          const key = this.getSequenceKey(x, y, 1, 0);
          if (!this.overlapsExistingSequence(key, x, y, 1, 0, usedInSequence)) {
            foundSequences.push(key);
            this.markSequenceUsed(x, y, 1, 0, usedInSequence);
          }
        }
      }
    }

    // Check vertical sequences
    for (let y = 0; y <= 5; y++) {
      for (let x = 0; x < 10; x++) {
        if (this.isSequenceAt(grid, x, y, 0, 1)) {
          const key = this.getSequenceKey(x, y, 0, 1);
          if (!this.overlapsExistingSequence(key, x, y, 0, 1, usedInSequence)) {
            foundSequences.push(key);
            this.markSequenceUsed(x, y, 0, 1, usedInSequence);
          }
        }
      }
    }

    // Check diagonal (down-right) sequences
    for (let y = 0; y <= 5; y++) {
      for (let x = 0; x <= 5; x++) {
        if (this.isSequenceAt(grid, x, y, 1, 1)) {
          const key = this.getSequenceKey(x, y, 1, 1);
          if (!this.overlapsExistingSequence(key, x, y, 1, 1, usedInSequence)) {
            foundSequences.push(key);
            this.markSequenceUsed(x, y, 1, 1, usedInSequence);
          }
        }
      }
    }

    // Check diagonal (down-left) sequences
    for (let y = 0; y <= 5; y++) {
      for (let x = 4; x < 10; x++) {
        if (this.isSequenceAt(grid, x, y, -1, 1)) {
          const key = this.getSequenceKey(x, y, -1, 1);
          if (!this.overlapsExistingSequence(key, x, y, -1, 1, usedInSequence)) {
            foundSequences.push(key);
            this.markSequenceUsed(x, y, -1, 1, usedInSequence);
          }
        }
      }
    }

    // Mark chips that are part of sequences
    for (const chip of this.state.chips) {
      chip.isPartOfSequence = usedInSequence.has(`${chip.x},${chip.y}`);
    }

    return foundSequences.length;
  }

  private isSequenceAt(
    grid: number[][],
    startX: number,
    startY: number,
    dx: number,
    dy: number
  ): boolean {
    for (let i = 0; i < 5; i++) {
      const x = startX + i * dx;
      const y = startY + i * dy;
      if (x < 0 || x >= 10 || y < 0 || y >= 10) return false;
      // Must be team's chip (1) or free corner (2)
      if (grid[y][x] !== 1 && grid[y][x] !== 2) return false;
    }
    return true;
  }

  private getSequenceKey(startX: number, startY: number, dx: number, dy: number): string {
    return `${startX},${startY},${dx},${dy}`;
  }

  private overlapsExistingSequence(
    _key: string,
    startX: number,
    startY: number,
    dx: number,
    dy: number,
    usedInSequence: Set<string>
  ): boolean {
    // A sequence can share at most 1 cell with another sequence
    let sharedCount = 0;
    for (let i = 0; i < 5; i++) {
      const x = startX + i * dx;
      const y = startY + i * dy;
      if (usedInSequence.has(`${x},${y}`)) {
        sharedCount++;
      }
    }
    // If more than 1 cell is shared, this is an overlapping sequence
    return sharedCount > 1;
  }

  private markSequenceUsed(
    startX: number,
    startY: number,
    dx: number,
    dy: number,
    usedInSequence: Set<string>
  ): void {
    for (let i = 0; i < 5; i++) {
      const x = startX + i * dx;
      const y = startY + i * dy;
      usedInSequence.add(`${x},${y}`);
    }
  }

  protected createLobbyBotPlayerSchema(
    _botId: string,
    _botName: string,
    _difficulty: string
  ): import("@multiplayer/shared").GamePlayerSchema {
    const bot = new SequencePlayer();
    // Alternate teams in insertion order so the bot joins the smaller team
    bot.teamId = this.initialPlayers.size % 2;
    return bot;
  }

  protected createLobbyBotAgent(botId: string, difficulty: string): BotAgent {
    return new SequenceBot(botId, {
      difficulty: difficulty as "easy" | "medium" | "hard",
    });
  }

  protected scheduleLobbyBotMoveIfNeeded(): void {
    if (this.state.status !== "in_progress") return;

    const currentId = this.state.currentTurnId;
    const agent = this.lobbyBotAgents.get(currentId) as SequenceBot | undefined;
    if (!agent) return;

    const delay = 700 + Math.random() * 500;

    this.clock.setTimeout(async () => {
      if (this.state.status !== "in_progress") return;
      if (this.state.currentTurnId !== currentId) return;

      try {
        const gameState = this.buildBotGameState();
        const move = (await agent.getMove(gameState)) as {
          cardIndex: number;
          boardX: number;
          boardY: number;
        };

        if (this.state.status !== "in_progress" || this.state.currentTurnId !== currentId) return;

        const fakeClient = { sessionId: currentId, send: () => {} } as unknown as Client;
        this.handleMoveMessage(fakeClient, move);
      } catch (error) {
        logger.error({ error, botId: currentId }, "Lobby bot move failed, making random move");
        this.makeLobbyBotRandomMove(currentId);
      }
    }, delay);
  }

  private buildBotGameState(): unknown {
    const players = new Map<string, unknown>();

    for (const [id, player] of this.state.players) {
      const p = player as SequencePlayer;
      players.set(id, {
        id: p.id,
        teamId: p.teamId,
        hand: Array.from(p.hand).map((c) => ({ rank: c.rank, suit: c.suit })),
      });
    }

    return {
      currentTurnId: this.state.currentTurnId,
      players,
      chips: Array.from(this.state.chips).map((c) => ({
        x: c.x,
        y: c.y,
        teamId: c.teamId,
        isPartOfSequence: c.isPartOfSequence,
      })),
      team1Sequences: this.state.team1Sequences,
      team2Sequences: this.state.team2Sequences,
    };
  }

  private makeLobbyBotRandomMove(botId: string): void {
    const LAYOUT: string[][] = [
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

    const player = this.state.players.get(botId) as SequencePlayer;
    if (!player || player.hand.length === 0) return;

    for (let cardIndex = 0; cardIndex < player.hand.length; cardIndex++) {
      const card = player.hand[cardIndex] as SequenceCard;
      const suitChar =
        card.suit === "hearts"
          ? "H"
          : card.suit === "diamonds"
            ? "D"
            : card.suit === "clubs"
              ? "C"
              : "S";
      const cardStr = `${card.rank}${suitChar}`;

      for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
          if (LAYOUT[y][x] === cardStr) {
            const occupied = this.state.chips.some((c) => c.x === x && c.y === y);
            if (!occupied) {
              const fakeClient = { sessionId: botId, send: () => {} } as unknown as Client;
              this.handleMoveMessage(fakeClient, { cardIndex, boardX: x, boardY: y });
              return;
            }
          }
        }
      }
    }
  }

  checkWinCondition(): { winner: string | null; isDraw: boolean } | null {
    // Check if any team has enough sequences
    if (this.state.team1Sequences >= this.state.sequencesToWin) {
      // Find first player of team 1
      for (const [playerId, player] of this.state.players) {
        if ((player as SequencePlayer).teamId === 0) {
          return { winner: playerId, isDraw: false };
        }
      }
    }

    if (this.state.team2Sequences >= this.state.sequencesToWin) {
      for (const [playerId, player] of this.state.players) {
        if ((player as SequencePlayer).teamId === 1) {
          return { winner: playerId, isDraw: false };
        }
      }
    }

    // Check for draw (no cards left and no sequences possible)
    if (this.deck.length === 0) {
      let anyCardsLeft = false;
      for (const [, player] of this.state.players) {
        if ((player as SequencePlayer).hand.length > 0) {
          anyCardsLeft = true;
          break;
        }
      }
      if (!anyCardsLeft) {
        return { winner: null, isDraw: true };
      }
    }

    return null;
  }
}
