import { Client } from "@colyseus/core";
import { Connect4State } from "@multiplayer/shared";
import { BaseRoom, type JoinOptions } from "./BaseRoom.js";
import { logger } from "../logger.js";

const COLS = 7;
const ROWS = 6;

interface MoveData {
  column: number;
}

export class Connect4Room extends BaseRoom<Connect4State> {
  maxClients = 2;

  initializeGame(): void {
    this.setState(new Connect4State());
    this.state.status = "waiting";
  }

  onJoin(client: Client, options: JoinOptions): void {
    super.onJoin(client, options);

    // Assign player roles
    const playerCount = this.state.players.size;
    if (playerCount === 1) {
      this.state.player1Id = client.sessionId;
    } else if (playerCount === 2) {
      this.state.player2Id = client.sessionId;
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

    // Determine player number (1 or 2)
    const playerNum = client.sessionId === this.state.player1Id ? 1 : 2;

    // Place the piece
    const index = row * COLS + column;
    this.state.board[index] = playerNum;
    this.state.moveCount++;

    logger.info(
      { roomId: this.roomId, playerId: client.sessionId, column, row },
      "Piece placed"
    );

    // Broadcast move to all clients
    this.broadcast("move", {
      playerId: client.sessionId,
      column,
      row,
      playerNum,
    });

    // Move to next turn if game continues
    if (!this.checkWinCondition()) {
      this.nextTurn();
    }
  }

  checkWinCondition(): { winner: string | null; isDraw: boolean } | null {
    const board = this.state.board;

    // Check horizontal wins
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col <= COLS - 4; col++) {
        const idx = row * COLS + col;
        const val = board[idx];
        if (val !== 0 &&
            val === board[idx + 1] &&
            val === board[idx + 2] &&
            val === board[idx + 3]) {
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
        if (val !== 0 &&
            val === board[idx + COLS] &&
            val === board[idx + COLS * 2] &&
            val === board[idx + COLS * 3]) {
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
        if (val !== 0 &&
            val === board[idx - COLS + 1] &&
            val === board[idx - COLS * 2 + 2] &&
            val === board[idx - COLS * 3 + 3]) {
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
        if (val !== 0 &&
            val === board[idx + COLS + 1] &&
            val === board[idx + COLS * 2 + 2] &&
            val === board[idx + COLS * 3 + 3]) {
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
    return -1; // Column is full
  }
}

