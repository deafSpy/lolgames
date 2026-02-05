import { BotAgent, BotConfig } from "./BotAgent.js";

const COLS = 7;
const ROWS = 6;

interface Connect4State {
  board: number[];
  player1Id: string;
  player2Id: string;
  currentTurnId: string;
}

export class Connect4Bot extends BotAgent {
  private myPlayerNum: number = 0;
  private opponentPlayerNum: number = 0;

  constructor(playerId: string, config: Partial<BotConfig> = {}) {
    super(playerId, config);
  }

  calculateMove(gameState: Connect4State): { column: number } {
    // Determine which player number we are
    this.myPlayerNum = gameState.player1Id === this.playerId ? 1 : 2;
    this.opponentPlayerNum = this.myPlayerNum === 1 ? 2 : 1;

    const board = [...gameState.board];
    let column: number;

    switch (this.config.difficulty) {
      case "easy":
        column = this.easyMove(board);
        break;
      case "hard":
        column = this.hardMove(board);
        break;
      case "medium":
      default:
        column = this.mediumMove(board);
        break;
    }

    return { column };
  }

  // Easy: Random valid move
  private easyMove(board: number[]): number {
    const validColumns = this.getValidColumns(board);
    return this.randomChoice(validColumns);
  }

  // Medium: Block wins, take wins, otherwise random
  private mediumMove(board: number[]): number {
    const validColumns = this.getValidColumns(board);

    // Check for winning move
    for (const col of validColumns) {
      const testBoard = this.simulateMove(board, col, this.myPlayerNum);
      if (this.checkWin(testBoard, this.myPlayerNum)) {
        return col;
      }
    }

    // Check for blocking move
    for (const col of validColumns) {
      const testBoard = this.simulateMove(board, col, this.opponentPlayerNum);
      if (this.checkWin(testBoard, this.opponentPlayerNum)) {
        return col;
      }
    }

    // Prefer center column
    if (validColumns.includes(3)) {
      return 3;
    }

    return this.randomChoice(validColumns);
  }

  // Hard: Minimax with limited depth
  private hardMove(board: number[]): number {
    const validColumns = this.getValidColumns(board);
    let bestScore = -Infinity;
    let bestColumn = validColumns[0];

    for (const col of validColumns) {
      const testBoard = this.simulateMove(board, col, this.myPlayerNum);
      const score = this.minimax(testBoard, 4, false, -Infinity, Infinity);
      if (score > bestScore) {
        bestScore = score;
        bestColumn = col;
      }
    }

    return bestColumn;
  }

  private minimax(
    board: number[],
    depth: number,
    isMaximizing: boolean,
    alpha: number,
    beta: number
  ): number {
    // Check terminal conditions
    if (this.checkWin(board, this.myPlayerNum)) return 100 + depth;
    if (this.checkWin(board, this.opponentPlayerNum)) return -100 - depth;
    if (this.isBoardFull(board) || depth === 0) return this.evaluateBoard(board);

    const validColumns = this.getValidColumns(board);

    if (isMaximizing) {
      let maxScore = -Infinity;
      for (const col of validColumns) {
        const testBoard = this.simulateMove(board, col, this.myPlayerNum);
        const score = this.minimax(testBoard, depth - 1, false, alpha, beta);
        maxScore = Math.max(maxScore, score);
        alpha = Math.max(alpha, score);
        if (beta <= alpha) break;
      }
      return maxScore;
    } else {
      let minScore = Infinity;
      for (const col of validColumns) {
        const testBoard = this.simulateMove(board, col, this.opponentPlayerNum);
        const score = this.minimax(testBoard, depth - 1, true, alpha, beta);
        minScore = Math.min(minScore, score);
        beta = Math.min(beta, score);
        if (beta <= alpha) break;
      }
      return minScore;
    }
  }

  private evaluateBoard(board: number[]): number {
    let score = 0;

    // Prefer center columns
    for (let row = 0; row < ROWS; row++) {
      if (board[row * COLS + 3] === this.myPlayerNum) score += 3;
    }

    // Evaluate windows
    score += this.evaluateWindows(board, this.myPlayerNum);
    score -= this.evaluateWindows(board, this.opponentPlayerNum);

    return score;
  }

  private evaluateWindows(board: number[], player: number): number {
    let score = 0;

    // Horizontal
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col <= COLS - 4; col++) {
        const window = [
          board[row * COLS + col],
          board[row * COLS + col + 1],
          board[row * COLS + col + 2],
          board[row * COLS + col + 3],
        ];
        score += this.evaluateWindow(window, player);
      }
    }

    // Vertical
    for (let col = 0; col < COLS; col++) {
      for (let row = 0; row <= ROWS - 4; row++) {
        const window = [
          board[row * COLS + col],
          board[(row + 1) * COLS + col],
          board[(row + 2) * COLS + col],
          board[(row + 3) * COLS + col],
        ];
        score += this.evaluateWindow(window, player);
      }
    }

    return score;
  }

  private evaluateWindow(window: number[], player: number): number {
    const playerCount = window.filter((c) => c === player).length;
    const emptyCount = window.filter((c) => c === 0).length;

    if (playerCount === 4) return 100;
    if (playerCount === 3 && emptyCount === 1) return 5;
    if (playerCount === 2 && emptyCount === 2) return 2;

    return 0;
  }

  private getValidColumns(board: number[]): number[] {
    const valid: number[] = [];
    for (let col = 0; col < COLS; col++) {
      if (board[col] === 0) {
        valid.push(col);
      }
    }
    return valid;
  }

  private simulateMove(board: number[], col: number, player: number): number[] {
    const newBoard = [...board];
    for (let row = ROWS - 1; row >= 0; row--) {
      if (newBoard[row * COLS + col] === 0) {
        newBoard[row * COLS + col] = player;
        break;
      }
    }
    return newBoard;
  }

  private checkWin(board: number[], player: number): boolean {
    // Horizontal
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col <= COLS - 4; col++) {
        if (
          board[row * COLS + col] === player &&
          board[row * COLS + col + 1] === player &&
          board[row * COLS + col + 2] === player &&
          board[row * COLS + col + 3] === player
        ) {
          return true;
        }
      }
    }

    // Vertical
    for (let col = 0; col < COLS; col++) {
      for (let row = 0; row <= ROWS - 4; row++) {
        if (
          board[row * COLS + col] === player &&
          board[(row + 1) * COLS + col] === player &&
          board[(row + 2) * COLS + col] === player &&
          board[(row + 3) * COLS + col] === player
        ) {
          return true;
        }
      }
    }

    // Diagonal
    for (let row = 0; row <= ROWS - 4; row++) {
      for (let col = 0; col <= COLS - 4; col++) {
        if (
          board[row * COLS + col] === player &&
          board[(row + 1) * COLS + col + 1] === player &&
          board[(row + 2) * COLS + col + 2] === player &&
          board[(row + 3) * COLS + col + 3] === player
        ) {
          return true;
        }
      }
    }

    for (let row = 3; row < ROWS; row++) {
      for (let col = 0; col <= COLS - 4; col++) {
        if (
          board[row * COLS + col] === player &&
          board[(row - 1) * COLS + col + 1] === player &&
          board[(row - 2) * COLS + col + 2] === player &&
          board[(row - 3) * COLS + col + 3] === player
        ) {
          return true;
        }
      }
    }

    return false;
  }

  private isBoardFull(board: number[]): boolean {
    return board.slice(0, COLS).every((cell) => cell !== 0);
  }
}

