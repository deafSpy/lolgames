"use client";

import { useState } from "react";
import { motion } from "framer-motion";

interface SequenceCard {
  suit: string;
  rank: string;
}

interface SequenceChip {
  x: number;
  y: number;
  teamId: number;
  isPartOfSequence: boolean;
}

interface SequenceBoardProps {
  chips: SequenceChip[];
  hand: SequenceCard[];
  currentTurnId: string;
  playerId: string;
  teamId: number;
  team1Sequences: number;
  team2Sequences: number;
  sequencesToWin: number;
  isMyTurn: boolean;
  onPlayCard: (cardIndex: number, boardX: number, boardY: number) => void;
  disabled?: boolean;
}

// Simplified board layout display with suit colors
const BOARD_LAYOUT = [
  ["⭐", "2♠", "3♠", "4♠", "5♠", "6♠", "7♠", "8♠", "9♠", "⭐"],
  ["6♣", "5♣", "4♣", "3♣", "2♣", "A♥", "K♥", "Q♥", "10♥", "10♠"],
  ["7♣", "A♠", "2♦", "3♦", "4♦", "5♦", "6♦", "7♦", "9♥", "Q♠"],
  ["8♣", "K♠", "6♣", "5♣", "4♣", "3♣", "2♣", "8♦", "8♥", "K♠"],
  ["9♣", "Q♠", "7♣", "6♥", "5♥", "4♥", "A♥", "9♦", "7♥", "A♠"],
  ["10♣", "10♠", "8♣", "7♥", "2♥", "3♥", "K♥", "10♦", "6♥", "2♦"],
  ["Q♣", "9♠", "9♣", "8♥", "9♥", "10♥", "Q♥", "Q♦", "5♥", "3♦"],
  ["K♣", "8♠", "10♣", "Q♣", "K♣", "A♣", "A♦", "K♦", "4♥", "4♦"],
  ["A♣", "7♠", "6♠", "5♠", "4♠", "3♠", "2♠", "2♥", "3♥", "5♦"],
  ["⭐", "A♦", "K♦", "Q♦", "10♦", "9♦", "8♦", "7♦", "6♦", "⭐"],
];

// Suit colors for text (custom hex colors)
const SUIT_TEXT_COLORS = {
  "♥": "#fa2315", // Hearts - red
  "♦": "#e18400", // Diamonds - orange
  "♣": "#0081e6", // Clubs - blue
  "♠": "#3a17b3", // Spades - purple
} as const;

// Get suit from card notation
const getSuitFromCard = (card: string): string => {
  if (card.includes("♥")) return "♥";
  if (card.includes("♦")) return "♦";
  if (card.includes("♣")) return "♣";
  if (card.includes("♠")) return "♠";
  return "";
};

// Check if a card is a jack and determine if it's one-eyed or two-eyed
const getJackType = (card: { rank: string; suit: string }): "one-eyed" | "two-eyed" | null => {
  if (card.rank !== "J") return null;

  // One-eyed jacks: Jack of Hearts, Jack of Spades
  // Two-eyed jacks: Jack of Diamonds, Jack of Clubs
  return card.suit === "hearts" || card.suit === "spades" ? "one-eyed" : "two-eyed";
};

export function SequenceBoard({
  chips,
  hand,
  currentTurnId,
  playerId,
  teamId,
  team1Sequences,
  team2Sequences,
  sequencesToWin,
  isMyTurn,
  onPlayCard,
  disabled = false,
}: SequenceBoardProps) {
  const [selectedCard, setSelectedCard] = useState<number | null>(null);

  const getChipAt = (x: number, y: number) => {
    return chips.find((c) => c.x === x && c.y === y);
  };

  // Check if a board position is valid for the selected card
  const isValidForSelectedCard = (x: number, y: number) => {
    if (selectedCard === null) return false;

    const boardCell = BOARD_LAYOUT[y][x];
    if (boardCell === "⭐") return false; // Free spaces can't be played on

    const selectedCardData = hand[selectedCard];
    if (!selectedCardData) return false;

    // Convert card to board format (rank + suit)
    const cardRank = selectedCardData.rank;
    const cardSuit = selectedCardData.suit === "hearts" ? "♥" :
                     selectedCardData.suit === "diamonds" ? "♦" :
                     selectedCardData.suit === "clubs" ? "♣" : "♠";

    const cardNotation = cardRank + cardSuit;

    return boardCell === cardNotation;
  };

  const handleCellClick = (x: number, y: number) => {
    if (selectedCard !== null && isMyTurn && !disabled) {
      onPlayCard(selectedCard, x, y);
      setSelectedCard(null);
    }
  };

  return (
    <div className="flex flex-col items-center">
      {/* Score */}
      <div className="mb-4 flex items-center gap-8 text-center">
        <div>
          <div className="text-2xl font-bold text-primary-400">{team1Sequences}</div>
          <div className="text-xs text-surface-400">Team 1</div>
        </div>
        <div className="text-surface-500">
          First to {sequencesToWin}
        </div>
        <div>
          <div className="text-2xl font-bold text-accent-400">{team2Sequences}</div>
          <div className="text-xs text-surface-400">Team 2</div>
        </div>
      </div>

      {/* Turn indicator */}
      <div className="mb-4 text-center">
        {disabled ? (
          <span className="text-surface-400">Game not started</span>
        ) : isMyTurn ? (
          selectedCard === null ? (
            <span className="text-success font-medium">Your turn! Select a card from your hand.</span>
          ) : (
            <span className="text-success font-medium">Card selected! Click on a highlighted square to play it.</span>
          )
        ) : (
          <span className="text-surface-400">Waiting for other player...</span>
        )}
      </div>

      {/* Board */}
      <div className="bg-emerald-900/50 p-2 rounded-xl shadow-lg overflow-x-auto">
        <div className="grid gap-0.5" style={{ gridTemplateColumns: "repeat(10, 36px)" }}>
          {BOARD_LAYOUT.map((row, y) =>
            row.map((cell, x) => {
              const chip = getChipAt(x, y);
              const isFreeSpace = cell === "⭐";
              const isValidMove = isValidForSelectedCard(x, y);
              const suit = getSuitFromCard(cell);
              const suitTextColor = SUIT_TEXT_COLORS[suit as keyof typeof SUIT_TEXT_COLORS];
              const jackType = getJackType(cell);

              return (
                <button
                  key={`${y}-${x}`}
                  onClick={() => handleCellClick(x, y)}
                  disabled={disabled || !isMyTurn || selectedCard === null || !isValidMove}
                  className={`
                    w-9 h-9 rounded text-xs font-medium
                    transition-all duration-200
                    relative border border-surface-600 bg-surface-800
                    ${isFreeSpace ? "bg-accent-500/30" : ""}
                    ${selectedCard !== null && isValidMove ? "ring-2 ring-success cursor-pointer brightness-110" : ""}
                    ${selectedCard !== null && !isFreeSpace && !isValidMove ? "opacity-30" : ""}
                  `}
                >
                  <div className="flex flex-col items-center justify-center h-full">
                    <span className={`font-bold ${selectedCard !== null ? "opacity-80" : "opacity-60"}`}>
                      {cell.replace(/[♥♦♣♠]/g, "")}
                    </span>
                    <span className={`text-lg font-bold ${selectedCard !== null ? "opacity-80" : "opacity-60"}`} style={{ color: suitTextColor }}>
                      {suit}
                    </span>
                    {jackType && (
                      <span className={`text-[8px] font-bold leading-none ${selectedCard !== null ? "opacity-80" : "opacity-60"}`} style={{ color: suitTextColor }}>
                        {jackType === "one-eyed" ? "1" : "2"}
                      </span>
                    )}
                  </div>
                  {chip && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className={`
                        absolute inset-1 rounded-full border-2 border-white
                        ${chip.teamId === 0 ? "bg-primary-500" : "bg-accent-500"}
                        ${chip.isPartOfSequence ? "ring-2 ring-white" : ""}
                      `}
                    />
                  )}
                  {isFreeSpace && (
                    <div className="absolute inset-1 rounded-full bg-accent-500/50 border border-accent-400" />
                  )}
                  {selectedCard !== null && isValidMove && !chip && (
                    <motion.div
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 0.6, opacity: 0.8 }}
                      className="absolute inset-1 rounded-full bg-white/60 border-2 border-success"
                    />
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Hand */}
      <div className="mt-6">
        <div className="text-sm text-surface-400 mb-2">Your Hand:</div>
        <div className="flex gap-2 flex-wrap justify-center">
          {hand.map((card, index) => {
            const jackType = getJackType(card);
            return (
              <motion.button
                key={index}
                whileHover={{ y: -4 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setSelectedCard(selectedCard === index ? null : index)}
                className={`
                  w-12 h-16 rounded-lg bg-white text-black flex flex-col items-center justify-center
                  text-sm font-medium shadow-md
                  transition-all
                  ${selectedCard === index ? "ring-2 ring-success -translate-y-2 shadow-lg shadow-success/50" : "hover:shadow-lg"}
                `}
              >
                <span>{card.rank}</span>
              <span className="text-lg font-bold" style={{
                color: card.suit === "hearts" ? SUIT_TEXT_COLORS["♥"] :
                       card.suit === "diamonds" ? SUIT_TEXT_COLORS["♦"] :
                       card.suit === "clubs" ? SUIT_TEXT_COLORS["♣"] : SUIT_TEXT_COLORS["♠"]
              }}>
                {card.suit === "hearts"
                  ? "♥"
                  : card.suit === "diamonds"
                    ? "♦"
                    : card.suit === "clubs"
                      ? "♣"
                      : "♠"}
              </span>
                {jackType && (
                  <span className="text-[10px] font-bold leading-none" style={{
                    color: card.suit === "hearts" ? SUIT_TEXT_COLORS["♥"] :
                           card.suit === "diamonds" ? SUIT_TEXT_COLORS["♦"] :
                           card.suit === "clubs" ? SUIT_TEXT_COLORS["♣"] : SUIT_TEXT_COLORS["♠"]
                  }}>
                    {jackType === "one-eyed" ? "1" : "2"}
                  </span>
                )}
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Team info */}
      <div className="mt-4 text-center text-surface-500 text-sm">
        You are on Team {teamId + 1} (
        <span className={teamId === 0 ? "text-primary-400" : "text-accent-400"}>
          {teamId === 0 ? "Blue" : "Gold"}
        </span>
        )
      </div>
    </div>
  );
}


