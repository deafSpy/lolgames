"use client";

import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

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
  deckRemaining: number;
  discardPileCount: number;
  lastDiscardedCard?: string;
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

const SUIT_TEXT_COLORS = {
  "♥": "#fa2315",
  "♦": "#e18400",
  "♣": "#0081e6",
  "♠": "#3a17b3",
} as const;

const getSuitFromCard = (card: string): string => {
  if (card.includes("♥")) return "♥";
  if (card.includes("♦")) return "♦";
  if (card.includes("♣")) return "♣";
  if (card.includes("♠")) return "♠";
  return "";
};

function getJackType(card: string): "one-eyed" | "two-eyed" | null;
function getJackType(card: { rank: string; suit: string }): "one-eyed" | "two-eyed" | null;
function getJackType(
  card: string | { rank: string; suit: string }
): "one-eyed" | "two-eyed" | null {
  if (typeof card === "string") {
    if (!card.startsWith("J")) return null;
    return card.includes("♥") || card.includes("♠") ? "one-eyed" : "two-eyed";
  }
  if (card.rank !== "J") return null;
  return card.suit === "hearts" || card.suit === "spades" ? "one-eyed" : "two-eyed";
}

// Parse a raw card string like "10H" or "AS" into display parts
function parseRawCard(raw: string): { rank: string; suit: string; suitSymbol: string } | null {
  if (!raw) return null;
  const suitChar = raw.slice(-1);
  const rank = raw.slice(0, -1);
  const suitMap: Record<string, string> = { H: "♥", D: "♦", C: "♣", S: "♠" };
  const suitSymbol = suitMap[suitChar] ?? "";
  return { rank, suit: suitChar, suitSymbol };
}

// Animated flying card that travels from origin rect to destination rect
interface FlyingCard {
  id: string;
  card: SequenceCard;
  fromRect: DOMRect;
  toRect: DOMRect;
}

export function SequenceBoard({
  chips,
  hand,
  currentTurnId,
  playerId,
  teamId,
  team1Sequences,
  team2Sequences,
  sequencesToWin,
  deckRemaining,
  discardPileCount,
  lastDiscardedCard,
  isMyTurn,
  onPlayCard,
  disabled = false,
}: SequenceBoardProps) {
  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const [flyingCards, setFlyingCards] = useState<FlyingCard[]>([]);

  const discardRef = useRef<HTMLDivElement>(null);
  const deckRef = useRef<HTMLDivElement>(null);
  const handCardRefs = useRef<Map<number, HTMLButtonElement | null>>(new Map());

  const getChipAt = (x: number, y: number) => {
    return chips.find((c) => c.x === x && c.y === y);
  };

  const isValidForSelectedCard = (x: number, y: number) => {
    if (selectedCard === null) return false;

    const boardCell = BOARD_LAYOUT[y][x];
    if (boardCell === "⭐") return false;

    const selectedCardData = hand[selectedCard];
    if (!selectedCardData) return false;

    const cardRank = selectedCardData.rank;
    const cardSuit =
      selectedCardData.suit === "hearts"
        ? "♥"
        : selectedCardData.suit === "diamonds"
          ? "♦"
          : selectedCardData.suit === "clubs"
            ? "♣"
            : "♠";

    const cardNotation = cardRank + cardSuit;
    return boardCell === cardNotation;
  };

  const launchCardToDiscard = useCallback((cardIndex: number, playedCard: SequenceCard) => {
    const cardEl = handCardRefs.current.get(cardIndex);
    const discardEl = discardRef.current;
    if (!cardEl || !discardEl) return;

    const fromRect = cardEl.getBoundingClientRect();
    const toRect = discardEl.getBoundingClientRect();
    const id = `fly-${Date.now()}-${cardIndex}`;

    setFlyingCards((prev) => [...prev, { id, card: playedCard, fromRect, toRect }]);

    // Remove flying card after animation completes
    setTimeout(() => {
      setFlyingCards((prev) => prev.filter((f) => f.id !== id));
    }, 500);
  }, []);

  const handleCellClick = (x: number, y: number) => {
    if (selectedCard !== null && isMyTurn && !disabled) {
      const playedCard = hand[selectedCard];
      launchCardToDiscard(selectedCard, playedCard);
      onPlayCard(selectedCard, x, y);
      setSelectedCard(null);
    }
  };

  const discardedCard = lastDiscardedCard ? parseRawCard(lastDiscardedCard) : null;

  return (
    <div className="flex flex-col items-center">
      {/* Score */}
      <div className="mb-4 flex items-center gap-8 text-center">
        <div>
          <div className="text-2xl font-bold text-primary-400">{team1Sequences}</div>
          <div className="text-xs text-surface-400">Team 1</div>
        </div>
        <div className="text-surface-500">First to {sequencesToWin}</div>
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
            <span className="text-success font-medium">
              Your turn! Select a card from your hand.
            </span>
          ) : (
            <span className="text-success font-medium">
              Card selected! Click on a highlighted square to play it.
            </span>
          )
        ) : (
          <span className="text-surface-400">Waiting for other player...</span>
        )}
      </div>

      {/* Deck + Discard widgets */}
      <div className="mb-4 flex items-center gap-6">
        {/* Deck */}
        <div ref={deckRef} className="flex flex-col items-center gap-1">
          <div className="w-12 h-16 rounded-lg bg-surface-700 border-2 border-surface-500 flex items-center justify-center shadow-md">
            <span className="text-xl">🂠</span>
          </div>
          <div className="text-xs text-surface-400">
            Deck: <span className="text-white font-semibold">{deckRemaining}</span>
          </div>
        </div>

        {/* Discard pile */}
        <div ref={discardRef} className="flex flex-col items-center gap-1">
          <div className="w-12 h-16 rounded-lg bg-white border-2 border-surface-400 flex flex-col items-center justify-center shadow-md relative overflow-hidden">
            {discardedCard ? (
              <>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={lastDiscardedCard}
                    initial={{ rotateY: 90, opacity: 0 }}
                    animate={{ rotateY: 0, opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="flex flex-col items-center"
                  >
                    <span className="text-black text-xs font-bold leading-none">
                      {discardedCard.rank}
                    </span>
                    <span
                      className="text-base font-bold leading-none"
                      style={{
                        color:
                          SUIT_TEXT_COLORS[
                            discardedCard.suitSymbol as keyof typeof SUIT_TEXT_COLORS
                          ],
                      }}
                    >
                      {discardedCard.suitSymbol}
                    </span>
                  </motion.div>
                </AnimatePresence>
              </>
            ) : (
              <span className="text-surface-400 text-xs">—</span>
            )}
          </div>
          <div className="text-xs text-surface-400">
            Discard: <span className="text-white font-semibold">{discardPileCount}</span>
          </div>
        </div>
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
                    <span
                      className={`font-bold ${selectedCard !== null ? "opacity-80" : "opacity-60"}`}
                    >
                      {cell.replace(/[♥♦♣♠]/g, "")}
                    </span>
                    <span
                      className={`text-lg font-bold ${selectedCard !== null ? "opacity-80" : "opacity-60"}`}
                      style={{ color: suitTextColor }}
                    >
                      {suit}
                    </span>
                    {jackType && (
                      <span
                        className={`text-[8px] font-bold leading-none ${selectedCard !== null ? "opacity-80" : "opacity-60"}`}
                        style={{ color: suitTextColor }}
                      >
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
                ref={(el) => {
                  handCardRefs.current.set(index, el);
                }}
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
                <span
                  className="text-lg font-bold"
                  style={{
                    color:
                      card.suit === "hearts"
                        ? SUIT_TEXT_COLORS["♥"]
                        : card.suit === "diamonds"
                          ? SUIT_TEXT_COLORS["♦"]
                          : card.suit === "clubs"
                            ? SUIT_TEXT_COLORS["♣"]
                            : SUIT_TEXT_COLORS["♠"],
                  }}
                >
                  {card.suit === "hearts"
                    ? "♥"
                    : card.suit === "diamonds"
                      ? "♦"
                      : card.suit === "clubs"
                        ? "♣"
                        : "♠"}
                </span>
                {jackType && (
                  <span
                    className="text-[10px] font-bold leading-none"
                    style={{
                      color:
                        card.suit === "hearts"
                          ? SUIT_TEXT_COLORS["♥"]
                          : card.suit === "diamonds"
                            ? SUIT_TEXT_COLORS["♦"]
                            : card.suit === "clubs"
                              ? SUIT_TEXT_COLORS["♣"]
                              : SUIT_TEXT_COLORS["♠"],
                    }}
                  >
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

      {/* Flying card animations (portal-like, fixed overlay) */}
      <AnimatePresence>
        {flyingCards.map(({ id, card, fromRect, toRect }) => {
          const suitSymbol =
            card.suit === "hearts"
              ? "♥"
              : card.suit === "diamonds"
                ? "♦"
                : card.suit === "clubs"
                  ? "♣"
                  : "♠";
          const suitColor = SUIT_TEXT_COLORS[suitSymbol as keyof typeof SUIT_TEXT_COLORS];

          return (
            <motion.div
              key={id}
              initial={{
                position: "fixed",
                left: fromRect.left,
                top: fromRect.top,
                width: fromRect.width,
                height: fromRect.height,
                zIndex: 9999,
                opacity: 1,
                scale: 1,
                rotate: 0,
              }}
              animate={{
                left: toRect.left,
                top: toRect.top,
                width: toRect.width,
                height: toRect.height,
                opacity: 0,
                scale: 0.8,
                rotate: 15,
              }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease: "easeIn" }}
              style={{ pointerEvents: "none" }}
              className="rounded-lg bg-white flex flex-col items-center justify-center shadow-xl"
            >
              <span className="text-black text-xs font-bold">{card.rank}</span>
              <span className="text-base font-bold" style={{ color: suitColor }}>
                {suitSymbol}
              </span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
