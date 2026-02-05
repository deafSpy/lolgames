"use client";

import { motion } from "framer-motion";
import { useState, useMemo, useCallback, useEffect, useRef } from "react";

const COLS = 7;
const ROWS = 6;

interface Connect4BoardProps {
  board: number[];
  currentTurn: string;
  playerId: string;
  player1Id: string;
  player2Id: string;
  isMyTurn: boolean;
  onColumnClick: (column: number) => void;
  disabled?: boolean;
  winnerId?: string;
  isFinished?: boolean;
  turnStartedAt?: number;
  turnTimeLimit?: number;
}

export function Connect4Board({
  board,
  currentTurn,
  playerId,
  player1Id,
  player2Id,
  isMyTurn,
  onColumnClick,
  disabled = false,
  winnerId,
  isFinished = false,
  turnStartedAt = 0,
  turnTimeLimit = 30000,
}: Connect4BoardProps) {
  const [hoveredCol, setHoveredCol] = useState<number | null>(null);
  const [lastMoveIndex, setLastMoveIndex] = useState<number | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number>(turnTimeLimit);
  const prevBoardRef = useRef<number[]>([]);
  const myPlayerNum = playerId === player1Id ? 1 : 2;

  // Timer effect - update every second
  useEffect(() => {
    if (!turnStartedAt || disabled || isFinished) {
      setTimeRemaining(turnTimeLimit);
      return;
    }

    const updateTimer = () => {
      const elapsed = Date.now() - turnStartedAt;
      const remaining = Math.max(0, turnTimeLimit - elapsed);
      setTimeRemaining(remaining);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [turnStartedAt, turnTimeLimit, disabled, isFinished]);

  // Format time for display
  const formatTime = (ms: number): string => {
    const seconds = Math.ceil(ms / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}:${secs.toString().padStart(2, "0")}` : `${secs}s`;
  };

  const isTimeLow = timeRemaining <= 10000; // Last 10 seconds

  const getCell = (row: number, col: number): number => {
    return board[row * COLS + col] || 0;
  };

  const canDropInColumn = (col: number): boolean => {
    // Check if top row is empty
    return board[col] === 0;
  };

  const targetRowForCol = useMemo(() => {
    if (hoveredCol === null) return null;
    for (let row = ROWS - 1; row >= 0; row--) {
      if (getCell(row, hoveredCol) === 0) return row;
    }
    return null;
  }, [hoveredCol, board]);

  const handleHoverCol = useCallback((col: number) => {
    // Only allow hover if it's actually droppable
    if (!disabled && !isFinished && isMyTurn && canDropInColumn(col)) {
      setHoveredCol(col);
    }
  }, [disabled, isFinished, isMyTurn]);

  const handleLeaveBoard = useCallback(() => {
    setHoveredCol(null);
  }, []);

  const handleColumnClick = useCallback((col: number) => {
    // Clear hover state immediately on click to prevent visual glitches
    setHoveredCol(null);
    onColumnClick(col);
  }, [onColumnClick]);

  // Track last move by diffing previous board
  useEffect(() => {
    const prev = prevBoardRef.current;
    let changedIndex: number | null = null;
    if (prev.length === board.length) {
      for (let i = 0; i < board.length; i++) {
        if (prev[i] !== board[i] && board[i] !== 0) {
          changedIndex = i;
          break;
        }
      }
    }
    if (changedIndex !== null) {
      setLastMoveIndex(changedIndex);
    }
    prevBoardRef.current = [...board];
  }, [board]);

  // Compute winning cells when finished
  const winningCells = useMemo(() => {
    if (!winnerId) return null;
    const winnerNum = winnerId === player1Id ? 1 : winnerId === player2Id ? 2 : 0;
    if (winnerNum === 0) return null;

    const dirs = [
      { dr: 0, dc: 1 },
      { dr: 1, dc: 0 },
      { dr: 1, dc: 1 },
      { dr: 1, dc: -1 },
    ];

    const cells: number[] = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        for (const { dr, dc } of dirs) {
          const line: number[] = [];
          for (let k = 0; k < 4; k++) {
            const nr = r + dr * k;
            const nc = c + dc * k;
            if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) {
              line.length = 0;
              break;
            }
            const idx = nr * COLS + nc;
            if (board[idx] !== winnerNum) {
              line.length = 0;
              break;
            }
            line.push(idx);
          }
          if (line.length === 4) {
            return line;
          }
        }
      }
    }
    return null;
  }, [board, winnerId, player1Id, player2Id]);

  return (
    <div className="flex flex-col items-center" onMouseLeave={handleLeaveBoard}>
      {/* Turn indicator with timer */}
      <div className="mb-4 text-center">
        <div className="flex items-center justify-center gap-4">
          {disabled ? (
            <span className="text-surface-400">Game not started</span>
          ) : isFinished ? (
            <span className="text-surface-300 font-medium">Game Over</span>
          ) : isMyTurn ? (
            <span className="text-success font-medium">Your turn!</span>
          ) : (
            <span className="text-surface-400">Waiting for opponent...</span>
          )}
          {!disabled && !isFinished && turnStartedAt > 0 && (
            <span
              className={`font-mono text-lg font-bold px-3 py-1 rounded-lg transition-colors ${
                isTimeLow
                  ? "bg-red-500/20 text-red-400 animate-pulse"
                  : "bg-surface-700 text-surface-300"
              }`}
            >
              {formatTime(timeRemaining)}
            </span>
          )}
        </div>
      </div>

      {/* Board */}
      <div className="bg-primary-600 p-3 rounded-2xl shadow-lg">
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}
        >
          {Array.from({ length: ROWS }).map((_, row) =>
            Array.from({ length: COLS }).map((_, col) => {
              const cell = getCell(row, col);
              const canDrop = !disabled && !isFinished && isMyTurn && canDropInColumn(col);
              const isDropTarget =
                hoveredCol === col && targetRowForCol === row && canDrop;
              const idx = row * COLS + col;
              const isLastMove = lastMoveIndex === idx;
              const isWinningCell = winningCells?.includes(idx);

              return (
                <button
                  key={`${row}-${col}`}
                  onMouseEnter={() => handleHoverCol(col)}
                  onClick={() => canDrop && handleColumnClick(col)}
                  disabled={!canDrop}
                  className={`
                    w-12 h-12 md:w-14 md:h-14 rounded-full
                    transition-all duration-200
                    ${
                      canDrop
                        ? "cursor-pointer"
                        : "cursor-default"
                    }
                    ${cell === 0 && !isDropTarget ? "bg-surface-900" : ""}
                    ${isDropTarget ? "ring-2 ring-white/60 bg-primary-500/30" : ""}
                    ${isWinningCell ? "ring-4 ring-accent-400" : ""}
                  `}
                >
                  {/* Show preview token on hover */}
                  {isDropTarget && (
                    <motion.div
                      initial={{ scale: 0.8, opacity: 0.6 }}
                      animate={{ scale: 1, opacity: 0.8 }}
                      transition={{ duration: 0.15 }}
                      className={`
                        w-full h-full rounded-full
                        ${myPlayerNum === 1 ? "bg-player1" : "bg-player2"}
                        shadow-lg
                      `}
                    />
                  )}

                  {/* Show actual placed token */}
                  {cell !== 0 && (
                    <motion.div
                      initial={{ scale: 0, y: -50 }}
                      animate={{ scale: 1, y: 0 }}
                      transition={{
                        type: "spring",
                        stiffness: 300,
                        damping: 20,
                      }}
                      className={`
                        w-full h-full rounded-full
                        ${cell === 1 ? "bg-player1" : "bg-player2"}
                        ${isWinningCell ? "ring-2 ring-accent-300" : cell === myPlayerNum ? "ring-2 ring-white/30" : ""}
                        ${isLastMove ? "ring-4 ring-accent-400/70 animate-pulse" : ""}
                        shadow-inner
                      `}
                    />
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Player indicators */}
      <div className="mt-6 flex items-center gap-8">
        <div
          className={`flex items-center gap-2 ${
            currentTurn === player1Id ? "opacity-100" : "opacity-50"
          }`}
        >
          <div className="w-6 h-6 rounded-full bg-player1" />
          <span className="text-sm">
            {player1Id === playerId ? "You" : "Opponent"}
          </span>
        </div>
        <div
          className={`flex items-center gap-2 ${
            currentTurn === player2Id ? "opacity-100" : "opacity-50"
          }`}
        >
          <div className="w-6 h-6 rounded-full bg-player2" />
          <span className="text-sm">
            {player2Id === playerId ? "You" : "Opponent"}
          </span>
        </div>
      </div>
    </div>
  );
}

