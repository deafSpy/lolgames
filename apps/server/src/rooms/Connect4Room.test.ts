import { describe, it, expect, beforeEach } from "vitest";

// Test the Connect4 win detection logic
const COLS = 7;
const ROWS = 6;

function checkHorizontalWin(board: number[], player: number): boolean {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col <= COLS - 4; col++) {
      const idx = row * COLS + col;
      if (
        board[idx] === player &&
        board[idx + 1] === player &&
        board[idx + 2] === player &&
        board[idx + 3] === player
      ) {
        return true;
      }
    }
  }
  return false;
}

function checkVerticalWin(board: number[], player: number): boolean {
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row <= ROWS - 4; row++) {
      const idx = row * COLS + col;
      if (
        board[idx] === player &&
        board[idx + COLS] === player &&
        board[idx + COLS * 2] === player &&
        board[idx + COLS * 3] === player
      ) {
        return true;
      }
    }
  }
  return false;
}

function checkDiagonalWin(board: number[], player: number): boolean {
  // Bottom-left to top-right
  for (let row = 3; row < ROWS; row++) {
    for (let col = 0; col <= COLS - 4; col++) {
      const idx = row * COLS + col;
      if (
        board[idx] === player &&
        board[idx - COLS + 1] === player &&
        board[idx - COLS * 2 + 2] === player &&
        board[idx - COLS * 3 + 3] === player
      ) {
        return true;
      }
    }
  }

  // Top-left to bottom-right
  for (let row = 0; row <= ROWS - 4; row++) {
    for (let col = 0; col <= COLS - 4; col++) {
      const idx = row * COLS + col;
      if (
        board[idx] === player &&
        board[idx + COLS + 1] === player &&
        board[idx + COLS * 2 + 2] === player &&
        board[idx + COLS * 3 + 3] === player
      ) {
        return true;
      }
    }
  }

  return false;
}

function checkWin(board: number[], player: number): boolean {
  return (
    checkHorizontalWin(board, player) ||
    checkVerticalWin(board, player) ||
    checkDiagonalWin(board, player)
  );
}

function isBoardFull(board: number[]): boolean {
  return board.slice(0, COLS).every((cell) => cell !== 0);
}

describe("Connect4 Win Detection", () => {
  let board: number[];

  beforeEach(() => {
    board = new Array(42).fill(0);
  });

  describe("Horizontal wins", () => {
    it("should detect horizontal win in bottom row", () => {
      // Place 4 in a row at bottom
      board[35] = 1; // row 5, col 0
      board[36] = 1; // row 5, col 1
      board[37] = 1; // row 5, col 2
      board[38] = 1; // row 5, col 3
      
      expect(checkHorizontalWin(board, 1)).toBe(true);
      expect(checkHorizontalWin(board, 2)).toBe(false);
    });

    it("should detect horizontal win in middle row", () => {
      board[17] = 2; // row 2, col 3
      board[18] = 2; // row 2, col 4
      board[19] = 2; // row 2, col 5
      board[20] = 2; // row 2, col 6
      
      expect(checkHorizontalWin(board, 2)).toBe(true);
    });

    it("should not detect horizontal win with only 3", () => {
      board[35] = 1;
      board[36] = 1;
      board[37] = 1;
      
      expect(checkHorizontalWin(board, 1)).toBe(false);
    });
  });

  describe("Vertical wins", () => {
    it("should detect vertical win", () => {
      board[0] = 1; // row 0, col 0
      board[7] = 1; // row 1, col 0
      board[14] = 1; // row 2, col 0
      board[21] = 1; // row 3, col 0
      
      expect(checkVerticalWin(board, 1)).toBe(true);
    });

    it("should not detect vertical win with gap", () => {
      board[0] = 1;
      board[7] = 1;
      board[14] = 2; // different player
      board[21] = 1;
      
      expect(checkVerticalWin(board, 1)).toBe(false);
    });
  });

  describe("Diagonal wins", () => {
    it("should detect diagonal win (top-left to bottom-right)", () => {
      board[0] = 1; // row 0, col 0
      board[8] = 1; // row 1, col 1
      board[16] = 1; // row 2, col 2
      board[24] = 1; // row 3, col 3
      
      expect(checkDiagonalWin(board, 1)).toBe(true);
    });

    it("should detect diagonal win (bottom-left to top-right)", () => {
      board[21] = 2; // row 3, col 0
      board[15] = 2; // row 2, col 1
      board[9] = 2; // row 1, col 2
      board[3] = 2; // row 0, col 3
      
      expect(checkDiagonalWin(board, 2)).toBe(true);
    });
  });

  describe("Combined win check", () => {
    it("should detect win for player 1", () => {
      board[35] = 1;
      board[36] = 1;
      board[37] = 1;
      board[38] = 1;
      
      expect(checkWin(board, 1)).toBe(true);
      expect(checkWin(board, 2)).toBe(false);
    });
  });

  describe("Board full (draw)", () => {
    it("should detect full board", () => {
      for (let i = 0; i < 42; i++) {
        board[i] = (i % 2) + 1;
      }
      
      expect(isBoardFull(board)).toBe(true);
    });

    it("should not detect full board with empty cells", () => {
      for (let i = 0; i < 41; i++) {
        board[i] = (i % 2) + 1;
      }
      board[0] = 0; // One empty cell in top row
      
      expect(isBoardFull(board)).toBe(false);
    });
  });
});

