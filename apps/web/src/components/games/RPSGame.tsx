"use client";

import { useEffect, useRef, useState } from "react";
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
  players?: Map<string, { id: string; displayName?: string }>;
}

const CHOICES: { value: RPSChoice; emoji: string; label: string }[] = [
  { value: RPSChoice.ROCK, emoji: "✊", label: "Rock" },
  { value: RPSChoice.PAPER, emoji: "✋", label: "Paper" },
  { value: RPSChoice.SCISSORS, emoji: "✌️", label: "Scissors" },
];

type CountdownStep = 3 | 2 | 1 | "GO" | null;

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
  const [countdownStep, setCountdownStep] = useState<CountdownStep>(null);
  const [handsVisible, setHandsVisible] = useState(false);
  const prevPhaseRef = useRef<string>("");

  const isPlayer1 = playerId === player1Id;
  const myScore = isPlayer1 ? player1Score : player2Score;
  const opponentScore = isPlayer1 ? player2Score : player1Score;
  const myCommitted = isPlayer1 ? player1Committed : player2Committed;
  const opponentCommitted = isPlayer1 ? player2Committed : player1Committed;
  const myChoice = isPlayer1 ? player1Choice : player2Choice;
  const opponentChoice = isPlayer1 ? player2Choice : player1Choice;

  const opponentId = Array.from(players?.keys() ?? []).find((id) => id !== playerId);
  const opponentName = players?.get(opponentId ?? "")?.displayName ?? "Opponent";

  // Kick off countdown when phase first transitions to "reveal"
  useEffect(() => {
    if (phase !== "reveal" && phase !== "result") {
      setHandsVisible(false);
      setCountdownStep(null);
      prevPhaseRef.current = phase;
      return;
    }

    if (phase === "result") {
      setHandsVisible(true);
      prevPhaseRef.current = phase;
      return;
    }

    // phase === "reveal"
    const prevPhase = prevPhaseRef.current;
    prevPhaseRef.current = phase;
    const entering = prevPhase !== "reveal";

    if (!entering) return;

    setHandsVisible(false);
    setCountdownStep(3);

    let cancelled = false;
    const ids: ReturnType<typeof setTimeout>[] = [
      setTimeout(() => {
        if (!cancelled) setCountdownStep(2);
      }, 800),
      setTimeout(() => {
        if (!cancelled) setCountdownStep(1);
      }, 1600),
      setTimeout(() => {
        if (!cancelled) setCountdownStep("GO");
      }, 2400),
      setTimeout(() => {
        if (!cancelled) {
          setCountdownStep(null);
          setHandsVisible(true);
        }
      }, 3100),
    ];

    return () => {
      cancelled = true;
      prevPhaseRef.current = prevPhase; // restore so StrictMode re-run re-detects the transition
      ids.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Turn timer
  useEffect(() => {
    if (!turnStartedAt || disabled || phase !== "commit") {
      setTimeRemaining(turnTimeLimit);
      return;
    }
    const update = () => {
      const elapsed = Date.now() - turnStartedAt;
      setTimeRemaining(Math.max(0, turnTimeLimit - elapsed));
    };
    update();
    const id = setInterval(update, 100);
    return () => clearInterval(id);
  }, [turnStartedAt, turnTimeLimit, disabled, phase]);

  const isTimeLow = timeRemaining <= 3000;

  const roundResult = (): "win" | "lose" | "draw" => {
    if (!roundWinnerId) return "draw";
    return roundWinnerId === playerId ? "win" : "lose";
  };

  const renderScoreDots = (score: number, isMe: boolean) =>
    Array.from({ length: targetScore }, (_, i) => (
      <div
        key={i}
        className={`w-4 h-4 rounded-full border-2 transition-all duration-300 ${
          i < score
            ? isMe
              ? "bg-primary-400 border-primary-400 shadow-[0_0_8px_rgba(37,166,180,0.6)]"
              : "bg-error border-error shadow-[0_0_8px_rgba(239,68,68,0.6)]"
            : "border-surface-600 bg-surface-800"
        }`}
      />
    ));

  const choiceEmoji = (c: string) => CHOICES.find((ch) => ch.value === c)?.emoji ?? "❓";

  return (
    <div className="flex flex-col items-center w-full max-w-lg mx-auto px-4 select-none">
      {/* ── Score / Best-of indicator ─────────────────────────── */}
      <div className="mb-8 text-center w-full">
        <p className="text-surface-500 text-xs uppercase tracking-wider mb-3">
          Round {roundNumber} · Best of {targetScore * 2 - 1}
        </p>
        <div className="flex items-center justify-center gap-6 sm:gap-12">
          {/* My score */}
          <div className="text-center">
            <div className="flex gap-1.5 justify-center mb-2">{renderScoreDots(myScore, true)}</div>
            <div className="text-xs text-surface-400 font-medium">You</div>
            <div className="text-2xl font-black text-primary-400 mt-1">{myScore}</div>
          </div>

          <div className="text-surface-600 text-xl font-bold">vs</div>

          {/* Opponent score */}
          <div className="text-center">
            <div className="flex gap-1.5 justify-center mb-2">
              {renderScoreDots(opponentScore, false)}
            </div>
            <div className="text-xs text-surface-400 font-medium truncate max-w-[80px] sm:max-w-none">
              {opponentName}
            </div>
            <div className="text-2xl font-black text-error mt-1">{opponentScore}</div>
          </div>
        </div>
      </div>

      {/* ── Turn timer (commit phase only) ────────────────────── */}
      {phase === "commit" && !disabled && turnStartedAt > 0 && (
        <div className="mb-5">
          <span
            className={`font-mono text-2xl font-bold px-4 py-2 rounded-xl transition-all duration-300 ${
              isTimeLow
                ? "bg-red-500/20 text-red-400 animate-pulse"
                : "bg-surface-700 text-surface-300"
            }`}
          >
            {Math.ceil(timeRemaining / 1000)}s
          </span>
        </div>
      )}

      {/* ── Phase status text ─────────────────────────────────── */}
      <div className="mb-6 text-center min-h-[28px]">
        {disabled ? (
          <span className="text-surface-400">Waiting for opponent…</span>
        ) : phase === "commit" ? (
          myCommitted ? (
            <span className="text-primary-400">Waiting for opponent to choose…</span>
          ) : (
            <span className="text-success font-semibold animate-pulse">Make your choice!</span>
          )
        ) : phase === "reveal" && countdownStep !== null ? (
          <span className="text-accent-400 font-semibold">Get ready…</span>
        ) : null}
      </div>

      {/* ── Hand reveal area + countdown overlay ──────────────── */}
      <div className="relative mb-10 w-full">
        {/* Countdown overlay */}
        {phase === "reveal" && countdownStep !== null && (
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <span
              key={String(countdownStep)}
              className="rps-countdown-digit font-black leading-none"
              style={{
                fontSize: "clamp(4rem, 20vw, 7rem)",
                color: countdownStep === "GO" ? "#22c55e" : "#ffffff",
                textShadow:
                  countdownStep === "GO"
                    ? "0 0 40px rgba(34,197,94,0.8)"
                    : "0 0 40px rgba(255,255,255,0.5)",
              }}
            >
              {countdownStep === "GO" ? "GO!" : countdownStep}
            </span>
          </div>
        )}

        {/* VS display — hands */}
        <div
          className={`flex items-center justify-center gap-8 sm:gap-16 transition-opacity duration-300 ${
            phase === "reveal" && countdownStep !== null ? "opacity-20" : "opacity-100"
          }`}
        >
          {/* My hand */}
          <div className="text-center">
            <div
              className={`w-28 h-28 sm:w-36 sm:h-36 rounded-3xl flex items-center justify-center border-2 transition-all duration-300 ${
                handsVisible && myChoice
                  ? "bg-primary-500/20 border-primary-500/60 shadow-[0_0_20px_rgba(37,166,180,0.3)]"
                  : myCommitted
                    ? "bg-success/10 border-success/40"
                    : "bg-surface-800 border-surface-700"
              }`}
            >
              {handsVisible && myChoice ? (
                <span className="text-6xl sm:text-7xl animate-scale-in">
                  {choiceEmoji(myChoice)}
                </span>
              ) : myCommitted ? (
                <span className="text-4xl text-success">✓</span>
              ) : (
                <span className="text-5xl text-surface-600">?</span>
              )}
            </div>
            <p className="text-sm text-surface-400 mt-3 font-medium">You</p>
          </div>

          {/* VS divider */}
          <div className="text-surface-500 text-2xl sm:text-3xl font-black">VS</div>

          {/* Opponent hand */}
          <div className="text-center">
            <div
              className={`w-28 h-28 sm:w-36 sm:h-36 rounded-3xl flex items-center justify-center border-2 transition-all duration-300 ${
                handsVisible && opponentChoice
                  ? "bg-error/20 border-error/60 shadow-[0_0_20px_rgba(239,68,68,0.3)]"
                  : opponentCommitted
                    ? "bg-success/10 border-success/40"
                    : "bg-surface-800 border-surface-700"
              }`}
            >
              {handsVisible && opponentChoice ? (
                <span
                  className="text-6xl sm:text-7xl animate-scale-in"
                  style={{ animationDelay: "100ms", animationFillMode: "both" }}
                >
                  {choiceEmoji(opponentChoice)}
                </span>
              ) : opponentCommitted ? (
                <span className="text-4xl text-success">✓</span>
              ) : (
                <span className="text-5xl text-surface-600">?</span>
              )}
            </div>
            <p className="text-sm text-surface-400 mt-3 font-medium truncate max-w-[120px] sm:max-w-none">
              {opponentName}
            </p>
          </div>
        </div>
      </div>

      {/* ── Result screen (phase === "result") ────────────────── */}
      {phase === "result" && (
        <div className="mb-8 text-center animate-scale-in">
          {/* Result icon + label */}
          <div className="text-5xl sm:text-6xl mb-2">
            {roundResult() === "win" ? "🎉" : roundResult() === "lose" ? "💔" : "🤝"}
          </div>
          <div
            className={`text-2xl sm:text-3xl font-black mb-4 ${
              roundResult() === "win"
                ? "text-success"
                : roundResult() === "lose"
                  ? "text-error"
                  : "text-surface-300"
            }`}
          >
            {roundResult() === "win"
              ? "Round Won!"
              : roundResult() === "lose"
                ? "Round Lost"
                : "Draw!"}
          </div>
          {/* Score summary */}
          <div className="flex items-center justify-center gap-3 text-sm text-surface-400">
            <div className="flex gap-1.5">{renderScoreDots(myScore, true)}</div>
            <span className="font-bold text-surface-300">
              {myScore} – {opponentScore}
            </span>
            <div className="flex gap-1.5">{renderScoreDots(opponentScore, false)}</div>
          </div>
        </div>
      )}

      {/* ── Choice buttons (commit phase, not yet committed) ──── */}
      {phase === "commit" && !myCommitted && !disabled && (
        <div className="flex gap-4 sm:gap-6 flex-wrap justify-center">
          {CHOICES.map((choice) => (
            <button
              key={choice.value}
              onClick={() => onChoice(choice.value)}
              className={[
                "w-24 h-24 sm:w-28 sm:h-28 rounded-2xl flex flex-col items-center justify-center gap-2",
                "bg-surface-800 border-2 border-surface-700",
                "hover:bg-surface-700 hover:border-primary-500 hover:scale-105 hover:-translate-y-1",
                "active:scale-95",
                "transition-all duration-150",
                "focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-surface-950",
                "cursor-pointer",
              ].join(" ")}
            >
              <span className="text-4xl sm:text-5xl">{choice.emoji}</span>
              <span className="text-xs text-surface-400 font-medium">{choice.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Committed: waiting for partner ────────────────────── */}
      {phase === "commit" && myCommitted && (
        <div className="text-center text-surface-400 animate-pulse text-base">
          Waiting for opponent…
        </div>
      )}
    </div>
  );
}
