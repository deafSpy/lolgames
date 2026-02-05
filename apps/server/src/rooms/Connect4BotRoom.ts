import { Client } from "@colyseus/core";
import { Connect4State, GamePlayerSchema } from "@multiplayer/shared";
import { BaseRoom, type JoinOptions } from "./BaseRoom.js";
import { Connect4Bot } from "../bots/Connect4Bot.js";
import { logger } from "../logger.js";

const COLS = 7;
const ROWS = 6;

interface MoveData {
  column: number;
}

export class Connect4BotRoom extends BaseRoom<Connect4State> {
  maxClients = 1; // Only one human player
  private bot: Connect4Bot | null = null;
  private botPlayerId = "bot_connect4";

  initializeGame(): void {
    this.setState(new Connect4State());
    this.state.status = "waiting";
  }

  onJoin(client: Client, options: JoinOptions): void {
    super.onJoin(client, options);

    // Human is always player 1
    this.state.player1Id = client.sessionId;

    // Create bot as player 2
    const botPlayer = new GamePlayerSchema();
    botPlayer.id = this.botPlayerId;
    botPlayer.displayName = `Bot (${options.vsBot ? "Hard" : "Medium"})`;
    botPlayer.isReady = true;
    botPlayer.isConnected = true;
    botPlayer.joinedAt = Date.now();
    botPlayer.isBot = true;
    this.state.players.set(this.botPlayerId, botPlayer);
    this.state.player2Id = this.botPlayerId;
    // Add bot to initial players for turn rotation
    this.initialPlayers.add(this.botPlayerId);
    this.registerBotIdentity(this.botPlayerId, botPlayer.displayName);

    // Initialize bot
    const difficulty = (options as { difficulty?: "easy" | "medium" | "hard" }).difficulty || "medium";
    this.bot = new Connect4Bot(this.botPlayerId, { difficulty });

    logger.info(
      { roomId: this.roomId, difficulty },
      "Bot created for Connect4"
    );
  }

  protected checkStartGame(): void {
    if (this.state.status !== "waiting") return;

    // Only need human player to be ready (bot is always ready)
    const humanPlayer = Array.from(this.state.players.values()).find(
      (p) => p.id !== this.botPlayerId
    );

    if (humanPlayer?.isReady) {
      this.startGame();
    }
  }

  protected startGame(): void {
    super.startGame();

    // If bot goes first, make its move
    if (this.state.currentTurnId === this.botPlayerId) {
      this.scheduleBotMove();
    }
  }

  handleMove(client: Client, data: unknown): void {
    const moveData = data as MoveData;
    const column = moveData.column;

    // Validate column
    if (typeof column !== "number" || column < 0 || column >= COLS) {
      client.send("error", { message: "Invalid column" });
      return;
    }

    // Find the lowest empty row in the column
    const row = this.findLowestEmptyRow(column);
    if (row === -1) {
      client.send("error", { message: "Column is full" });
      return;
    }

    // Human is always player 1
    const playerNum = 1;

    // Place the piece
    const index = row * COLS + column;
    this.state.board[index] = playerNum;
    this.state.moveCount++;

    logger.info(
      { roomId: this.roomId, playerId: client.sessionId, column, row },
      "Human piece placed"
    );

    // Broadcast move
    this.broadcast("move", {
      playerId: client.sessionId,
      column,
      row,
      playerNum,
    });

    // Check for win
    const result = this.checkWinCondition();
    if (result) {
      this.endGame(result.winner, result.isDraw);
      return;
    }

    // Switch to bot's turn
    this.nextTurn();

    // Schedule bot move
    this.scheduleBotMove();
  }

  private async scheduleBotMove(): Promise<void> {
    if (!this.bot || this.state.status !== "in_progress") return;
    if (this.state.currentTurnId !== this.botPlayerId) return;

    try {
      const move = (await this.bot.getMove({
        board: Array.from(this.state.board),
        player1Id: this.state.player1Id,
        player2Id: this.state.player2Id,
        currentTurnId: this.state.currentTurnId,
      })) as { column: number };

      // Verify game is still in progress
      if (this.state.status !== "in_progress") return;
      if (this.state.currentTurnId !== this.botPlayerId) return;

      this.executeBotMove(move.column);
    } catch (error) {
      logger.error(error, "Bot move failed");
    }
  }

  private executeBotMove(column: number): void {
    const row = this.findLowestEmptyRow(column);
    if (row === -1) {
      // Fallback to first available column
      for (let c = 0; c < COLS; c++) {
        const r = this.findLowestEmptyRow(c);
        if (r !== -1) {
          this.executeBotMove(c);
          return;
        }
      }
      return;
    }

    // Bot is always player 2
    const playerNum = 2;
    const index = row * COLS + column;
    this.state.board[index] = playerNum;
    this.state.moveCount++;

    logger.info(
      { roomId: this.roomId, column, row },
      "Bot piece placed"
    );

    // Broadcast move
    this.broadcast("move", {
      playerId: this.botPlayerId,
      column,
      row,
      playerNum,
    });

    // Check for win
    const result = this.checkWinCondition();
    if (result) {
      this.endGame(result.winner, result.isDraw);
      return;
    }

    // Switch back to human's turn
    this.nextTurn();
  }

  checkWinCondition(): { winner: string | null; isDraw: boolean } | null {
    const board = this.state.board;

    // Check horizontal wins
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col <= COLS - 4; col++) {
        const idx = row * COLS + col;
        const val = board[idx];
        if (
          val !== 0 &&
          val === board[idx + 1] &&
          val === board[idx + 2] &&
          val === board[idx + 3]
        ) {
          return {
            winner: val === 1 ? this.state.player1Id : this.state.player2Id,
            isDraw: false,
          };
        }
      }
    }

    // Check vertical wins
    for (let col = 0; col < COLS; col++) {
      for (let row = 0; row <= ROWS - 4; row++) {
        const idx = row * COLS + col;
        const val = board[idx];
        if (
          val !== 0 &&
          val === board[idx + COLS] &&
          val === board[idx + COLS * 2] &&
          val === board[idx + COLS * 3]
        ) {
          return {
            winner: val === 1 ? this.state.player1Id : this.state.player2Id,
            isDraw: false,
          };
        }
      }
    }

    // Check diagonal wins (bottom-left to top-right)
    for (let row = 3; row < ROWS; row++) {
      for (let col = 0; col <= COLS - 4; col++) {
        const idx = row * COLS + col;
        const val = board[idx];
        if (
          val !== 0 &&
          val === board[idx - COLS + 1] &&
          val === board[idx - COLS * 2 + 2] &&
          val === board[idx - COLS * 3 + 3]
        ) {
          return {
            winner: val === 1 ? this.state.player1Id : this.state.player2Id,
            isDraw: false,
          };
        }
      }
    }

    // Check diagonal wins (top-left to bottom-right)
    for (let row = 0; row <= ROWS - 4; row++) {
      for (let col = 0; col <= COLS - 4; col++) {
        const idx = row * COLS + col;
        const val = board[idx];
        if (
          val !== 0 &&
          val === board[idx + COLS + 1] &&
          val === board[idx + COLS * 2 + 2] &&
          val === board[idx + COLS * 3 + 3]
        ) {
          return {
            winner: val === 1 ? this.state.player1Id : this.state.player2Id,
            isDraw: false,
          };
        }
      }
    }

    // Check for draw (board full)
    if (this.state.moveCount >= COLS * ROWS) {
      return { winner: null, isDraw: true };
    }

    return null;
  }

  private findLowestEmptyRow(column: number): number {
    for (let row = ROWS - 1; row >= 0; row--) {
      const index = row * COLS + column;
      if (this.state.board[index] === 0) {
        return row;
      }
    }
    return -1;
  }
}

