"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState, useMemo, useCallback, useEffect, useRef, type KeyboardEvent } from "react";

const COLS = 7;
const ROWS = 6;
const PENDING_TIMEOUT_MS = 2000;

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

interface PendingMove {
  col: number;
  row: number;
  ts: number;
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
  const [focusedCol, setFocusedCol] = useState<number>(3); // middle column
  const [lastMoveIndex, setLastMoveIndex] = useState<number | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number>(turnTimeLimit);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [liveText, setLiveText] = useState<string>("");
  const prevBoardRef = useRef<number[]>([]);
  const columnRefs = useRef<Array<HTMLButtonElement | null>>([]);
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

  const formatTime = (ms: number): string => {
    const seconds = Math.ceil(ms / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}:${secs.toString().padStart(2, "0")}` : `${secs}s`;
  };

  const isTimeLow = timeRemaining <= 10000;

  const getCell = useCallback(
    (row: number, col: number): number => board[row * COLS + col] || 0,
    [board]
  );

  const targetRowForCol = useCallback(
    (col: number): number | null => {
      for (let row = ROWS - 1; row >= 0; row--) {
        if (getCell(row, col) === 0) return row;
      }
      return null;
    },
    [getCell]
  );

  const canDropInColumn = useCallback(
    (col: number): boolean => targetRowForCol(col) !== null,
    [targetRowForCol]
  );

  const previewRow = useMemo(
    () => (hoveredCol === null ? null : targetRowForCol(hoveredCol)),
    [hoveredCol, targetRowForCol]
  );

  const interactive = !disabled && !isFinished && isMyTurn;

  const handleHoverCol = useCallback(
    (col: number) => {
      if (interactive && canDropInColumn(col)) {
        setHoveredCol(col);
      }
    },
    [interactive, canDropInColumn]
  );

  const handleLeaveBoard = useCallback(() => {
    setHoveredCol(null);
  }, []);

  const dropInColumn = useCallback(
    (col: number) => {
      if (!interactive) return;
      const row = targetRowForCol(col);
      if (row === null) return;
      // Optimistic render: show the disc before the server ack.
      setPendingMove({ col, row, ts: Date.now() });
      setHoveredCol(null);
      onColumnClick(col);
    },
    [interactive, targetRowForCol, onColumnClick]
  );

  // Track last move by diffing previous board; also reconcile optimistic state.
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
      // If the confirmed cell matches our pending optimistic move, clear it.
      setPendingMove((p) => {
        if (!p) return p;
        const pendingIdx = p.row * COLS + p.col;
        return pendingIdx === changedIndex ? null : p;
      });
    }
    prevBoardRef.current = [...board];
  }, [board]);

  // Snap back: if server didn't accept within PENDING_TIMEOUT_MS, clear pending.
  useEffect(() => {
    if (!pendingMove) return;
    const t = setTimeout(() => {
      setPendingMove((p) => (p && Date.now() - p.ts >= PENDING_TIMEOUT_MS ? null : p));
    }, PENDING_TIMEOUT_MS + 50);
    return () => clearTimeout(t);
  }, [pendingMove]);

  // Clear any pending move on game over (defensive).
  useEffect(() => {
    if (isFinished) setPendingMove(null);
  }, [isFinished]);

  // ARIA live region: announce turn changes.
  useEffect(() => {
    if (disabled) {
      setLiveText("Game not started.");
      return;
    }
    if (isFinished) {
      if (!winnerId) setLiveText("Game over. The game ended in a draw.");
      else if (winnerId === playerId) setLiveText("Game over. You won.");
      else setLiveText("Game over. Opponent won.");
      return;
    }
    if (isMyTurn) setLiveText("Your turn.");
    else setLiveText("Opponent's turn.");
  }, [isMyTurn, isFinished, winnerId, playerId, disabled]);

  // Compute winning cells when finished.
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
          if (line.length === 4) return line;
        }
      }
    }
    return null;
  }, [board, winnerId, player1Id, player2Id]);

  // Keyboard navigation across the column row (roving tabindex pattern).
  const moveFocus = useCallback((delta: number) => {
    setFocusedCol((c) => {
      const next = (c + delta + COLS) % COLS;
      // Defer focus to next paint so the new tabIndex is in effect.
      queueMicrotask(() => columnRefs.current[next]?.focus());
      return next;
    });
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!interactive) return;
      switch (e.key) {
        case "ArrowLeft":
        case "ArrowUp":
          e.preventDefault();
          moveFocus(-1);
          break;
        case "ArrowRight":
        case "ArrowDown":
          e.preventDefault();
          moveFocus(1);
          break;
        case "Home":
          e.preventDefault();
          setFocusedCol(0);
          queueMicrotask(() => columnRefs.current[0]?.focus());
          break;
        case "End":
          e.preventDefault();
          setFocusedCol(COLS - 1);
          queueMicrotask(() => columnRefs.current[COLS - 1]?.focus());
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          dropInColumn(focusedCol);
          break;
        case "Escape":
          e.preventDefault();
          setHoveredCol(null);
          (e.target as HTMLElement).blur();
          break;
        default:
          break;
      }
    },
    [interactive, focusedCol, dropInColumn, moveFocus]
  );

  return (
    <div className="w-full flex flex-col items-center" onMouseLeave={handleLeaveBoard}>
      {/* ARIA live region (screen-reader only) */}
      <div className="sr-only" aria-live="polite" aria-atomic="true" role="status">
        {liveText}
      </div>

      {/* Turn indicator with timer */}
      <div className="mb-3 sm:mb-4 text-center w-full px-2">
        <div className="flex items-center justify-center gap-3 sm:gap-4 flex-wrap">
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
              className={`font-mono text-base sm:text-lg font-bold px-2 sm:px-3 py-1 rounded-lg transition-colors ${
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

      {/* Board container — fluid, never wider than the viewport.
          At 375px viewport the math is:
            375 (vp) − 16 (page px-2) − 16 (card p-2) − 8 (inner p-1) − 24 (6×gap-1) = 311
            311 / 7 ≈ 44.4px per column → tap target ≥ 44×44 CSS px (WCAG 2.5.5). */}
      <div
        className="w-full max-w-md mx-auto"
        onKeyDown={handleKeyDown}
        role="grid"
        aria-label="Connect 4 board"
        aria-rowcount={ROWS}
        aria-colcount={COLS}
      >
        <div className="bg-primary-600 p-1 sm:p-3 rounded-2xl shadow-lg">
          <div className="grid grid-cols-7 gap-1 sm:gap-2">
            {Array.from({ length: COLS }).map((_, col) => {
              const canDrop = interactive && canDropInColumn(col);
              const isFocused = focusedCol === col;
              const isHovered = hoveredCol === col;
              const previewActiveRow = isHovered ? previewRow : null;

              return (
                <button
                  key={col}
                  ref={(el) => {
                    columnRefs.current[col] = el;
                  }}
                  type="button"
                  role="gridcell"
                  aria-label={`Drop in column ${col + 1}${canDrop ? "" : " (full)"}`}
                  aria-disabled={!canDrop}
                  tabIndex={isFocused ? 0 : -1}
                  disabled={!canDrop}
                  onMouseEnter={() => handleHoverCol(col)}
                  onFocus={() => setFocusedCol(col)}
                  onClick={() => dropInColumn(col)}
                  className={`
                    flex flex-col gap-1 sm:gap-2 p-0 bg-transparent border-0
                    rounded-lg outline-none
                    ${canDrop ? "cursor-pointer" : "cursor-default"}
                    focus-visible:ring-2 focus-visible:ring-accent-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-primary-600
                  `}
                >
                  {Array.from({ length: ROWS }).map((_, row) => {
                    const cell = getCell(row, col);
                    const idx = row * COLS + col;
                    const isPreview = previewActiveRow === row && canDrop && cell === 0;
                    const isPending =
                      pendingMove &&
                      pendingMove.col === col &&
                      pendingMove.row === row &&
                      cell === 0;
                    const isLastMove = lastMoveIndex === idx;
                    const isWinningCell = winningCells?.includes(idx) ?? false;

                    return (
                      <div
                        key={row}
                        className={`
                          relative aspect-square rounded-full overflow-hidden
                          ${cell === 0 && !isPreview && !isPending ? "bg-surface-900" : ""}
                          ${isPreview ? "ring-2 ring-white/60 bg-primary-500/30" : ""}
                          ${isWinningCell ? "ring-2 sm:ring-4 ring-accent-400" : ""}
                        `}
                      >
                        {/* Hover preview disc */}
                        <AnimatePresence>
                          {isPreview && (
                            <motion.div
                              key="preview"
                              initial={{ scale: 0.8, opacity: 0.4 }}
                              animate={{ scale: 1, opacity: 0.7 }}
                              exit={{ opacity: 0 }}
                              transition={{ duration: 0.12 }}
                              className={`
                                absolute inset-0 rounded-full
                                ${myPlayerNum === 1 ? "bg-player1" : "bg-player2"}
                                shadow-lg
                              `}
                            />
                          )}
                        </AnimatePresence>

                        {/* Optimistic falling disc */}
                        <AnimatePresence>
                          {isPending && (
                            <motion.div
                              key="pending"
                              data-testid={`pending-disc-${col}-${row}`}
                              initial={{ y: "-700%", opacity: 0.9 }}
                              animate={{ y: 0, opacity: 1 }}
                              exit={{ opacity: 0 }}
                              transition={{
                                y: { type: "spring", stiffness: 260, damping: 22 },
                                opacity: { duration: 0.1 },
                              }}
                              className={`
                                absolute inset-0 rounded-full
                                ${myPlayerNum === 1 ? "bg-player1" : "bg-player2"}
                                ring-2 ring-white/40 shadow-inner
                              `}
                              aria-busy="true"
                            />
                          )}
                        </AnimatePresence>

                        {/* Confirmed placed disc */}
                        {cell !== 0 && (
                          <motion.div
                            initial={{ scale: 0, y: -50 }}
                            animate={{ scale: 1, y: 0 }}
                            transition={{ type: "spring", stiffness: 300, damping: 20 }}
                            className={`
                              absolute inset-0 rounded-full
                              ${cell === 1 ? "bg-player1" : "bg-player2"}
                              ${isWinningCell ? "ring-2 ring-accent-300 animate-pulse" : cell === myPlayerNum ? "ring-2 ring-white/30" : ""}
                              ${isLastMove && !isWinningCell ? "ring-2 sm:ring-4 ring-accent-400/70" : ""}
                              shadow-inner
                            `}
                          />
                        )}
                      </div>
                    );
                  })}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Player indicators */}
      <div className="mt-4 sm:mt-6 flex items-center gap-6 sm:gap-8 flex-wrap justify-center px-2">
        <div
          className={`flex items-center gap-2 ${
            currentTurn === player1Id ? "opacity-100" : "opacity-50"
          }`}
        >
          <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-player1" />
          <span className="text-sm">{player1Id === playerId ? "You" : "Opponent"}</span>
        </div>
        <div
          className={`flex items-center gap-2 ${
            currentTurn === player2Id ? "opacity-100" : "opacity-50"
          }`}
        >
          <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-player2" />
          <span className="text-sm">{player2Id === playerId ? "You" : "Opponent"}</span>
        </div>
      </div>

      {/* Mobile hint text */}
      {interactive && (
        <p className="mt-3 text-xs text-surface-500 text-center sm:hidden">
          Tap a column to drop your piece
        </p>
      )}
      {interactive && (
        <p className="mt-3 text-xs text-surface-500 text-center hidden sm:block">
          Use ← → to move, Enter to drop, Esc to cancel
        </p>
      )}
    </div>
  );
}
