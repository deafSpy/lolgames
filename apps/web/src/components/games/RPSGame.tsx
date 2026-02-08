"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { RPSChoice } from "@multiplayer/shared";

interface RPSGameProps {
  roundNumber: number;
  targetScore: number;
  player1Score: number;
  player2Score: number;
  player1Choice: string;
  player2Choice: string;
  player1Committed: boolean;
  player2Committed: boolean;
  phase: string;
  roundWinnerId: string;
  playerId: string;
  player1Id: string;
  onChoice: (choice: RPSChoice) => void;
  disabled?: boolean;
  turnStartedAt?: number;
  turnTimeLimit?: number;
  players?: Map<string, any>;
}

const choices: { value: RPSChoice; emoji: string; label: string }[] = [
  { value: RPSChoice.ROCK, emoji: "✊", label: "Rock" },
  { value: RPSChoice.PAPER, emoji: "✋", label: "Paper" },
  { value: RPSChoice.SCISSORS, emoji: "✌️", label: "Scissors" },
];

export function RPSGame({
  roundNumber,
  targetScore,
  player1Score,
  player2Score,
  player1Choice,
  player2Choice,
  player1Committed,
  player2Committed,
  phase,
  roundWinnerId,
  playerId,
  player1Id,
  onChoice,
  disabled = false,
  turnStartedAt = 0,
  turnTimeLimit = 10000,
  players,
}: RPSGameProps) {
  const [timeRemaining, setTimeRemaining] = useState<number>(turnTimeLimit);

  const isPlayer1 = playerId === player1Id;
  const myScore = isPlayer1 ? player1Score : player2Score;
  const opponentScore = isPlayer1 ? player2Score : player1Score;
  const myCommitted = isPlayer1 ? player1Committed : player2Committed;
  const opponentCommitted = isPlayer1 ? player2Committed : player1Committed;
  const myChoice = isPlayer1 ? player1Choice : player2Choice;
  const opponentChoice = isPlayer1 ? player2Choice : player1Choice;

  // Get opponent name from players map
  const opponentId = isPlayer1
    ? players?.get(player1Id)?.id === playerId
      ? Array.from(players.keys()).find((id) => id !== playerId)
      : undefined
    : player1Id;
  const opponentPlayer = players?.get(
    opponentId ||
      (isPlayer1 ? Array.from(players?.keys() || []).find((id) => id !== playerId) : player1Id) ||
      ""
  );
  const opponentName = opponentPlayer?.displayName || "Opponent";

  // Timer effect
  useEffect(() => {
    if (!turnStartedAt || disabled || phase !== "commit") {
      setTimeRemaining(turnTimeLimit);
      return;
    }

    const updateTimer = () => {
      const elapsed = Date.now() - turnStartedAt;
      const remaining = Math.max(0, turnTimeLimit - elapsed);
      setTimeRemaining(remaining);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 100);
    return () => clearInterval(interval);
  }, [turnStartedAt, turnTimeLimit, disabled, phase]);

  const formatTime = (ms: number): string => {
    const seconds = Math.ceil(ms / 1000);
    return `${seconds}s`;
  };

  const isTimeLow = timeRemaining <= 3000; // Last 3 seconds for RPS

  const getRoundResult = () => {
    if (!roundWinnerId) return "draw";
    return roundWinnerId === playerId ? "win" : "lose";
  };

  const renderWinCircles = (score: number, isPlayer1: boolean) => {
    return Array.from({ length: targetScore }, (_, i) => (
      <div
        key={i}
        className={`w-4 h-4 rounded-full border-2 transition-colors ${
          i < score
            ? isPlayer1
              ? "bg-success border-success shadow-lg shadow-success/50"
              : "bg-error border-error shadow-lg shadow-error/50"
            : "border-surface-600 bg-surface-800"
        }`}
      />
    ));
  };

  return (
    <div className="flex flex-col items-center max-w-2xl mx-auto">
      {/* Score */}
      <div className="mb-10 text-center">
        <div className="text-surface-400 text-lg mb-3">Round {roundNumber}</div>
        <div className="flex items-center gap-8">
          <div className="text-center">
            <div className="flex gap-2 justify-center mb-2">{renderWinCircles(myScore, true)}</div>
            <div className="text-sm text-surface-400">You</div>
          </div>
          <div className="text-surface-500 text-2xl">vs</div>
          <div className="text-center">
            <div className="flex gap-2 justify-center mb-2">
              {renderWinCircles(opponentScore, false)}
            </div>
            <div className="text-sm text-surface-400">{opponentName}</div>
          </div>
        </div>
      </div>

      {/* Timer (shown during commit phase) */}
      {phase === "commit" && !disabled && turnStartedAt > 0 && (
        <div className="mb-6">
          <span
            className={`font-mono text-2xl font-bold px-4 py-2 rounded-xl transition-colors ${
              isTimeLow
                ? "bg-red-500/20 text-red-400 animate-pulse"
                : "bg-surface-700 text-surface-300"
            }`}
          >
            {formatTime(timeRemaining)}
          </span>
        </div>
      )}

      {/* Phase indicator */}
      <div className="mb-8 text-center text-lg">
        {disabled ? (
          <span className="text-surface-400">Waiting for opponent...</span>
        ) : phase === "commit" ? (
          myCommitted ? (
            <span className="text-primary-400">Waiting for opponent to choose...</span>
          ) : (
            <span className="text-success font-medium">Make your choice!</span>
          )
        ) : phase === "reveal" ? (
          <span className="text-accent-400 font-medium text-xl">Revealing...</span>
        ) : (
          <span
            className={`font-medium text-xl ${
              getRoundResult() === "win"
                ? "text-success"
                : getRoundResult() === "lose"
                  ? "text-error"
                  : "text-surface-300"
            }`}
          >
            {getRoundResult() === "win"
              ? "🎉 You won this round!"
              : getRoundResult() === "lose"
                ? "You lost this round"
                : "It's a draw!"}
          </span>
        )}
      </div>

      {/* Choices area - BIGGER */}
      <div className="flex items-center gap-16 mb-12">
        {/* My choice */}
        <div className="text-center">
          <div className="w-36 h-36 rounded-3xl bg-surface-800 flex items-center justify-center mb-4 border-2 border-surface-700">
            {phase === "reveal" || phase === "result" ? (
              <motion.span
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 200, damping: 15 }}
                className="text-7xl"
              >
                {choices.find((c) => c.value === myChoice)?.emoji || "❓"}
              </motion.span>
            ) : myCommitted ? (
              <span className="text-5xl text-success">✓</span>
            ) : (
              <span className="text-5xl text-surface-600">?</span>
            )}
          </div>
          <div className="text-sm text-surface-400">You</div>
        </div>

        {/* VS */}
        <div className="text-surface-500 text-3xl font-bold">VS</div>

        {/* Opponent choice */}
        <div className="text-center">
          <div className="w-36 h-36 rounded-3xl bg-surface-800 flex items-center justify-center mb-4 border-2 border-surface-700">
            {phase === "reveal" || phase === "result" ? (
              <motion.span
                initial={{ scale: 0, rotate: 180 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 200, damping: 15 }}
                className="text-7xl"
              >
                {choices.find((c) => c.value === opponentChoice)?.emoji || "❓"}
              </motion.span>
            ) : opponentCommitted ? (
              <span className="text-5xl text-success">✓</span>
            ) : (
              <span className="text-5xl text-surface-600">?</span>
            )}
          </div>
          <div className="text-sm text-surface-400">{opponentName}</div>
        </div>
      </div>

      {/* Choice buttons - BIGGER */}
      {phase === "commit" && !myCommitted && !disabled && (
        <div className="flex gap-6">
          {choices.map((choice) => (
            <motion.button
              key={choice.value}
              whileHover={{ scale: 1.08, y: -4 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => onChoice(choice.value)}
              className="w-28 h-28 rounded-2xl bg-surface-800 hover:bg-surface-700 transition-colors flex flex-col items-center justify-center gap-2 border-2 border-surface-700 hover:border-primary-500"
            >
              <span className="text-5xl">{choice.emoji}</span>
              <span className="text-sm text-surface-400">{choice.label}</span>
            </motion.button>
          ))}
        </div>
      )}

      {/* Committed indicator */}
      {phase === "commit" && myCommitted && (
        <div className="text-center text-surface-400 text-lg">
          <div className="animate-pulse">Waiting for opponent...</div>
        </div>
      )}
    </div>
  );
}
