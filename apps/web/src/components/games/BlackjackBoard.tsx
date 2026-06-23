"use client";

import { useState, useCallback, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";

interface BlackjackCard {
  suit: string;
  rank: string;
  faceUp: boolean;
}

interface BlackjackHand {
  cards: BlackjackCard[];
  bet: number;
  isDoubled: boolean;
  isSplit: boolean;
  isStanding: boolean;
  isBusted: boolean;
  isBlackjack: boolean;
  value: number;
}

interface BlackjackPlayer {
  id: string;
  displayName: string;
  isReady: boolean;
  isConnected: boolean;
  joinedAt: number;
  isBot: boolean;
  isSpectator: boolean;
  wasInitialPlayer: boolean;
  hands: BlackjackHand[];
  chips: number;
  currentHandIndex: number;
  hasInsurance: boolean;
  insuranceBet: number;
  isEliminated: boolean;
  secretBet: number;
  isSecretBetRevealed: boolean;
  hasPlacedBet: boolean;
  roundWinnings: number;
}

interface BlackjackBoardProps {
  players: Map<string, BlackjackPlayer>;
  dealerHand: BlackjackCard[];
  dealerValue: number;
  dealerBusted: boolean;
  dealerBlackjack: boolean;
  currentTurnId: string;
  playerId: string;
  phase: string;
  handNumber: number;
  buttonPlayerId: string;
  eliminationHands: number[];
  minBet: number;
  maxBet: number;
  allowSecretBets: boolean;
  isMyTurn: boolean;
  onAction: (action: string, data: Record<string, unknown>) => void;
}

const SUIT_SYMBOLS: Record<string, string> = {
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
  spades: "♠",
};

const SUIT_COLORS: Record<string, string> = {
  hearts: "#ef4444",
  diamonds: "#ef4444",
  clubs: "#1f2937",
  spades: "#1f2937",
};

const CHIP_COLORS = [
  { value: 1, color: "#ffffff", textColor: "#000000" },
  { value: 5, color: "#ef4444", textColor: "#ffffff" },
  { value: 10, color: "#3b82f6", textColor: "#ffffff" },
  { value: 25, color: "#22c55e", textColor: "#ffffff" },
  { value: 50, color: "#f97316", textColor: "#ffffff" },
  { value: 100, color: "#111827", textColor: "#ffffff" },
  { value: 500, color: "#a855f7", textColor: "#ffffff" },
];

export function BlackjackBoard({
  players,
  dealerHand,
  dealerValue,
  dealerBusted,
  dealerBlackjack,
  currentTurnId,
  playerId,
  phase,
  handNumber,
  buttonPlayerId,
  eliminationHands,
  minBet,
  maxBet,
  allowSecretBets,
  isMyTurn,
  onAction,
}: BlackjackBoardProps) {
  const [betAmount, setBetAmount] = useState(minBet);
  const [isSecretBet, setIsSecretBet] = useState(false);

  const myPlayer = useMemo(
    () => Array.from(players.values()).find((p) => p.id === playerId),
    [players, playerId]
  );

  const opponents = useMemo(
    () => Array.from(players.values()).filter((p) => p.id !== playerId && !p.isEliminated),
    [players, playerId]
  );

  const isEliminationHand = eliminationHands.includes(handNumber);
  const isBettingPhase = phase === "betting";
  const isPlayerTurnPhase = phase === "player_turn";
  const isPayoutPhase = phase === "payout";

  const calculateVisibleValue = useCallback((cards: BlackjackCard[]) => {
    let value = 0;
    let aces = 0;
    for (const card of cards) {
      if (!card.faceUp) continue;
      if (card.rank === "A") {
        aces++;
        value += 11;
      } else if (["K", "Q", "J"].includes(card.rank)) {
        value += 10;
      } else {
        value += parseInt(card.rank);
      }
    }
    while (value > 21 && aces > 0) {
      value -= 10;
      aces--;
    }
    return value;
  }, []);

  const handlePlaceBet = useCallback(() => {
    if (!myPlayer || myPlayer.hasPlacedBet) return;
    onAction("place_bet", { amount: betAmount, isSecret: isSecretBet });
  }, [myPlayer, betAmount, isSecretBet, onAction]);

  const handleHit = useCallback(() => onAction("hit", {}), [onAction]);
  const handleStand = useCallback(() => onAction("stand", {}), [onAction]);
  const handleDoubleDown = useCallback(() => onAction("double_down", {}), [onAction]);
  const handleSplit = useCallback(() => onAction("split", {}), [onAction]);
  const handleInsurance = useCallback(() => onAction("insurance", {}), [onAction]);
  const handleSurrender = useCallback(() => onAction("surrender", {}), [onAction]);

  const canSplit = useMemo(() => {
    if (!myPlayer || !isMyTurn || !isPlayerTurnPhase) return false;
    const hand = myPlayer.hands[myPlayer.currentHandIndex];
    if (!hand || hand.cards.length !== 2) return false;
    if (hand.cards[0].rank !== hand.cards[1].rank) return false;
    return myPlayer.chips >= hand.bet;
  }, [myPlayer, isMyTurn, isPlayerTurnPhase]);

  const canDoubleDown = useMemo(() => {
    if (!myPlayer || !isMyTurn || !isPlayerTurnPhase) return false;
    const hand = myPlayer.hands[myPlayer.currentHandIndex];
    if (!hand || hand.cards.length !== 2) return false;
    return myPlayer.chips >= hand.bet;
  }, [myPlayer, isMyTurn, isPlayerTurnPhase]);

  const canInsurance = useMemo(() => {
    if (!myPlayer || myPlayer.hasInsurance) return false;
    if (dealerHand.length === 0 || dealerHand[0]?.rank !== "A") return false;
    const hand = myPlayer.hands[0];
    if (!hand) return false;
    return myPlayer.chips >= Math.floor(hand.bet / 2);
  }, [myPlayer, dealerHand]);

  const canSurrender = useMemo(() => {
    if (!myPlayer || !isMyTurn || !isPlayerTurnPhase) return false;
    const hand = myPlayer.hands[myPlayer.currentHandIndex];
    return hand !== undefined && hand.cards.length === 2;
  }, [myPlayer, isMyTurn, isPlayerTurnPhase]);

  const getChipBreakdown = useCallback((amount: number) => {
    const chips: { value: number; count: number; color: string; textColor: string }[] = [];
    let remaining = amount;
    for (const chip of [...CHIP_COLORS].reverse()) {
      if (remaining >= chip.value) {
        const count = Math.floor(remaining / chip.value);
        chips.push({ ...chip, count });
        remaining = remaining % chip.value;
      }
    }
    return chips;
  }, []);

  return (
    <div className="flex flex-col gap-4 w-full max-w-3xl mx-auto">
      {/* Game info header */}
      <div className="text-center">
        <div className="flex items-center justify-center gap-3 mb-1">
          <span
            className={`px-3 py-1 rounded-full text-xs font-semibold ${
              isEliminationHand
                ? "bg-error/20 text-error animate-pulse"
                : "bg-surface-700 text-surface-400"
            }`}
          >
            Hand #{handNumber}
            {isEliminationHand && " ⚠️ ELIMINATION"}
          </span>
          <span className="text-surface-500 text-xs capitalize">{phase.replace("_", " ")}</span>
        </div>
        {isMyTurn && isPlayerTurnPhase && (
          <div className="text-base font-semibold text-success animate-pulse">
            Your turn to act!
          </div>
        )}
        {isBettingPhase && isMyTurn && !myPlayer?.hasPlacedBet && (
          <div className="text-base font-semibold text-warning animate-pulse">Place your bet!</div>
        )}
      </div>

      {/* Dealer area */}
      <div className="bg-green-900/40 rounded-2xl p-4 sm:p-6 border border-green-800/60">
        <div className="flex items-center justify-center gap-3 mb-4">
          <span className="text-xs font-semibold text-surface-400 uppercase tracking-wider">
            Dealer
          </span>
          {dealerHand.length > 0 && (
            <span className="text-lg font-black">
              {dealerBusted ? (
                <span className="text-error">BUST 💥</span>
              ) : dealerBlackjack ? (
                <span className="text-warning">BLACKJACK! ⭐</span>
              ) : (
                <span className="text-white">{calculateVisibleValue(dealerHand)}</span>
              )}
            </span>
          )}
        </div>

        <div className="flex justify-center gap-2 flex-wrap">
          <AnimatePresence>
            {dealerHand.map((card, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: -30 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.5 }}
                transition={{ delay: idx * 0.15, type: "spring", stiffness: 250, damping: 20 }}
              >
                <PlayingCard card={card} />
              </motion.div>
            ))}
          </AnimatePresence>
          {dealerHand.length === 0 && (
            <div className="w-14 h-20 sm:w-20 sm:h-28 rounded-lg border-2 border-dashed border-green-700/60 flex items-center justify-center">
              <span className="text-green-700 text-xs">Cards</span>
            </div>
          )}
        </div>
      </div>

      {/* Other players compact grid */}
      {opponents.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {opponents.map((player) => (
            <PlayerSeat
              key={player.id}
              player={player}
              isCurrentTurn={currentTurnId === player.id}
              isButton={buttonPlayerId === player.id}
              calculateValue={calculateVisibleValue}
              getChipBreakdown={getChipBreakdown}
            />
          ))}
        </div>
      )}

      {/* My player area */}
      {myPlayer && (
        <div
          className={`bg-surface-800/80 rounded-2xl p-4 sm:p-6 border transition-all duration-300 ${
            isMyTurn && isPlayerTurnPhase
              ? "border-primary-500/60 shadow-[0_0_20px_rgba(37,166,180,0.15)]"
              : "border-surface-700/50"
          } ${myPlayer.isEliminated ? "opacity-50" : ""}`}
        >
          {myPlayer.isEliminated ? (
            <div className="text-center py-8">
              <span className="text-4xl mb-4 block">😔</span>
              <span className="text-error font-black text-xl">ELIMINATED</span>
            </div>
          ) : (
            <>
              {/* Player header row */}
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-bold text-base sm:text-lg truncate">
                    {myPlayer.displayName}
                  </span>
                  {buttonPlayerId === playerId && (
                    <span className="px-2 py-0.5 rounded-full bg-warning text-black text-[10px] font-black shrink-0">
                      BTN
                    </span>
                  )}
                </div>
                <ChipStack chips={myPlayer.chips} getChipBreakdown={getChipBreakdown} />
              </div>

              {/* Betting panel */}
              {isBettingPhase && !myPlayer.hasPlacedBet && isMyTurn && (
                <BettingPanel
                  betAmount={betAmount}
                  setBetAmount={setBetAmount}
                  minBet={minBet}
                  maxBet={maxBet}
                  chips={myPlayer.chips}
                  isSecretBet={isSecretBet}
                  setIsSecretBet={setIsSecretBet}
                  allowSecretBets={allowSecretBets}
                  onPlaceBet={handlePlaceBet}
                />
              )}

              {isBettingPhase && !myPlayer.hasPlacedBet && !isMyTurn && (
                <div className="text-center py-4 text-surface-400 text-sm">
                  Waiting for your turn to bet…
                </div>
              )}

              {isBettingPhase && myPlayer.hasPlacedBet && (
                <div className="text-center py-3">
                  <span className="text-success text-sm font-medium">
                    ✓ Bet placed:{" "}
                    {myPlayer.isSecretBetRevealed ? `$${myPlayer.hands[0]?.bet ?? 0}` : "🤫 Secret"}
                  </span>
                </div>
              )}

              {/* Hands */}
              {myPlayer.hands.length > 0 && (
                <div className="space-y-4">
                  {myPlayer.hands.map((hand, handIdx) => {
                    const isActive =
                      myPlayer.currentHandIndex === handIdx && isPlayerTurnPhase && isMyTurn;
                    return (
                      <div
                        key={handIdx}
                        className={`p-3 sm:p-4 rounded-xl transition-all duration-200 ${
                          isActive
                            ? "bg-primary-500/15 ring-2 ring-primary-500"
                            : "bg-surface-700/40"
                        }`}
                      >
                        {/* Hand meta */}
                        <div className="flex justify-between items-center mb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-surface-400">Hand {handIdx + 1}</span>
                            {hand.isSplit && (
                              <span className="px-1.5 py-0.5 rounded bg-purple-500/30 text-purple-300 text-[10px]">
                                Split
                              </span>
                            )}
                            {hand.isDoubled && (
                              <span className="px-1.5 py-0.5 rounded bg-warning/30 text-warning text-[10px]">
                                2×
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-surface-400 text-xs">
                              Bet: <span className="text-white font-semibold">${hand.bet}</span>
                            </span>
                            <span
                              className={`font-black text-lg ${
                                hand.isBusted
                                  ? "text-error"
                                  : hand.isBlackjack
                                    ? "text-warning"
                                    : "text-white"
                              }`}
                            >
                              {hand.isBusted ? "BUST" : hand.isBlackjack ? "BJ!" : hand.value}
                            </span>
                          </div>
                        </div>

                        {/* Cards */}
                        <div className="flex gap-2 justify-center flex-wrap mb-4">
                          <AnimatePresence>
                            {hand.cards.map((card, cardIdx) => (
                              <motion.div
                                key={cardIdx}
                                initial={{ opacity: 0, x: -40 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: cardIdx * 0.12, type: "spring" }}
                              >
                                <PlayingCard card={card} />
                              </motion.div>
                            ))}
                          </AnimatePresence>
                        </div>

                        {/* Action buttons */}
                        {isActive && !hand.isStanding && !hand.isBusted && !hand.isBlackjack && (
                          <ActionButtons
                            onHit={handleHit}
                            onStand={handleStand}
                            onDoubleDown={canDoubleDown ? handleDoubleDown : undefined}
                            onSplit={canSplit ? handleSplit : undefined}
                            onSurrender={canSurrender ? handleSurrender : undefined}
                          />
                        )}

                        {(hand.isStanding || hand.isBusted || hand.isBlackjack) && (
                          <div className="text-center text-xs text-surface-500 mt-1">
                            {hand.isBusted && "💥 Busted"}
                            {hand.isStanding && !hand.isBusted && "🛑 Standing"}
                            {hand.isBlackjack && "⭐ Blackjack!"}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Insurance prompt */}
              {canInsurance && phase === "player_turn" && (
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-4 p-4 bg-warning/15 rounded-xl border border-warning/30 text-center"
                >
                  <p className="text-warning text-sm font-medium mb-3">
                    Dealer showing Ace — take insurance?
                  </p>
                  <button
                    onClick={handleInsurance}
                    className="px-6 py-2 bg-warning text-black rounded-xl font-bold text-sm hover:bg-yellow-400 active:scale-95 transition-all"
                  >
                    Insurance (${Math.floor(myPlayer.hands[0]?.bet / 2 || 0)})
                  </button>
                </motion.div>
              )}

              {/* Payout */}
              {isPayoutPhase && myPlayer.roundWinnings > 0 && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="mt-4 p-4 bg-success/15 rounded-xl border border-success/30 text-center"
                >
                  <span className="text-3xl mb-2 block">🎉</span>
                  <span className="text-success text-2xl font-black">
                    +${myPlayer.roundWinnings}
                  </span>
                </motion.div>
              )}
            </>
          )}
        </div>
      )}

      {/* Tournament leaderboard */}
      <div className="bg-surface-800/60 rounded-xl p-4 border border-surface-700/30">
        <h3 className="text-xs text-surface-500 uppercase tracking-wider mb-3 text-center font-semibold">
          Tournament Standings
        </h3>
        <div className="space-y-2">
          {Array.from(players.values())
            .sort((a, b) => b.chips - a.chips)
            .map((player, idx) => (
              <div
                key={player.id}
                className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${
                  player.isEliminated
                    ? "bg-surface-900/60 opacity-50"
                    : player.id === playerId
                      ? "bg-primary-500/15 border border-primary-500/30"
                      : "bg-surface-700/60"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black shrink-0 ${
                      idx === 0
                        ? "bg-yellow-500 text-black"
                        : idx === 1
                          ? "bg-gray-400 text-black"
                          : idx === 2
                            ? "bg-amber-700 text-white"
                            : "bg-surface-600 text-surface-300"
                    }`}
                  >
                    {idx + 1}
                  </span>
                  <span className={`truncate ${player.isEliminated ? "line-through" : ""}`}>
                    {player.displayName}
                    {player.id === playerId && <span className="text-primary-400 ml-1">(You)</span>}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-bold">${player.chips}</span>
                  {player.isEliminated && (
                    <span className="text-error text-[10px] font-semibold">OUT</span>
                  )}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

// PlayingCard — CSS flip via bj-card-* classes in globals.css
function PlayingCard({ card }: { card: BlackjackCard }) {
  const suitSymbol = SUIT_SYMBOLS[card.suit] ?? "?";
  const suitColor = SUIT_COLORS[card.suit] ?? "#000";

  return (
    <div
      className="bj-card-wrapper"
      style={{ width: "clamp(52px, 7.5vw, 76px)", height: "clamp(76px, 11vw, 108px)" }}
    >
      <div className={`bj-card-inner w-full h-full ${card.faceUp ? "is-face-up" : "is-face-down"}`}>
        {/* Card front */}
        <div className="bj-card-front rounded-lg bg-white shadow-lg flex flex-col p-1 overflow-hidden">
          <div className="flex flex-col items-center leading-none" style={{ color: suitColor }}>
            <span className="text-[0.6rem] sm:text-xs font-black">{card.rank}</span>
            <span className="text-[0.5rem] sm:text-[0.65rem]">{suitSymbol}</span>
          </div>
          <div className="flex-1 flex items-center justify-center">
            <span className="text-base sm:text-2xl" style={{ color: suitColor }}>
              {suitSymbol}
            </span>
          </div>
          <div
            className="flex flex-col items-center rotate-180 leading-none"
            style={{ color: suitColor }}
          >
            <span className="text-[0.6rem] sm:text-xs font-black">{card.rank}</span>
            <span className="text-[0.5rem] sm:text-[0.65rem]">{suitSymbol}</span>
          </div>
        </div>

        {/* Card back */}
        <div className="bj-card-back rounded-lg shadow-lg bg-gradient-to-br from-blue-800 to-blue-950 border-2 border-white/20 flex items-center justify-center">
          <div className="w-6 h-6 sm:w-9 sm:h-9 rounded-full bg-blue-600/50 flex items-center justify-center">
            <span className="text-white/40 text-xs sm:text-sm">?</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Action buttons — large, colour-coded, clearly labelled
function ActionButtons({
  onHit,
  onStand,
  onDoubleDown,
  onSplit,
  onSurrender,
}: {
  onHit: () => void;
  onStand: () => void;
  onDoubleDown?: () => void;
  onSplit?: () => void;
  onSurrender?: () => void;
}) {
  const base =
    "flex-1 min-w-[4rem] py-3 rounded-xl font-bold text-sm sm:text-base transition-all duration-150 active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-surface-800";

  return (
    <div className="flex flex-wrap gap-2 justify-center">
      <button
        onClick={onHit}
        className={`${base} bg-success text-white hover:bg-green-400 focus:ring-success shadow-lg`}
        title="Take another card"
      >
        Hit
      </button>
      <button
        onClick={onStand}
        className={`${base} bg-error text-white hover:bg-red-400 focus:ring-error shadow-lg`}
        title="Keep your current hand"
      >
        Stand
      </button>
      {onDoubleDown && (
        <button
          onClick={onDoubleDown}
          className={`${base} bg-warning text-black hover:bg-yellow-400 focus:ring-warning shadow-lg`}
          title="Double bet, receive exactly one more card"
        >
          Double
        </button>
      )}
      {onSplit && (
        <button
          onClick={onSplit}
          className={`${base} bg-purple-500 text-white hover:bg-purple-400 focus:ring-purple-500 shadow-lg`}
          title="Split matching pair into two hands"
        >
          Split
        </button>
      )}
      {onSurrender && (
        <button
          onClick={onSurrender}
          className={`${base} bg-surface-600 text-surface-300 hover:bg-surface-500 focus:ring-surface-500 border border-surface-500`}
          title="Forfeit half your bet"
        >
          Surrender
        </button>
      )}
    </div>
  );
}

// Betting panel
function BettingPanel({
  betAmount,
  setBetAmount,
  minBet,
  maxBet,
  chips,
  isSecretBet,
  setIsSecretBet,
  allowSecretBets,
  onPlaceBet,
}: {
  betAmount: number;
  setBetAmount: (v: number | ((prev: number) => number)) => void;
  minBet: number;
  maxBet: number;
  chips: number;
  isSecretBet: boolean;
  setIsSecretBet: (v: boolean) => void;
  allowSecretBets: boolean;
  onPlaceBet: () => void;
}) {
  const effectiveMax = Math.min(maxBet, chips);

  return (
    <div className="bg-surface-700/60 rounded-xl p-4 mb-4 border border-surface-600/40">
      <h3 className="text-xs text-surface-400 uppercase tracking-wider mb-4 text-center font-semibold">
        Place Your Bet
      </h3>

      {/* Chip quick-add */}
      <div className="flex flex-wrap gap-2 justify-center mb-4">
        {CHIP_COLORS.filter((c) => c.value <= effectiveMax).map((chip) => (
          <button
            key={chip.value}
            onClick={() => setBetAmount((prev) => Math.min(prev + chip.value, effectiveMax))}
            className="w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center text-[10px] sm:text-xs font-black shadow-md border-2 border-white/20 hover:scale-110 active:scale-95 transition-transform duration-100"
            style={{ backgroundColor: chip.color, color: chip.textColor }}
          >
            {chip.value >= 1000 ? `${chip.value / 1000}k` : chip.value}
          </button>
        ))}
      </div>

      {/* Bet amount stepper */}
      <div className="flex items-center justify-center gap-4 mb-4">
        <button
          onClick={() => setBetAmount((prev) => Math.max(minBet, prev - 10))}
          className="w-9 h-9 rounded-full bg-surface-600 hover:bg-surface-500 text-white font-bold transition-colors text-lg"
        >
          −
        </button>
        <div className="text-center min-w-[90px]">
          <span className="text-3xl font-black text-primary-400">${betAmount}</span>
          <div className="text-[10px] text-surface-500 mt-0.5">
            Min ${minBet} · Max ${effectiveMax}
          </div>
        </div>
        <button
          onClick={() => setBetAmount((prev) => Math.min(prev + 10, effectiveMax))}
          className="w-9 h-9 rounded-full bg-surface-600 hover:bg-surface-500 text-white font-bold transition-colors text-lg"
        >
          +
        </button>
      </div>

      {/* Quick presets */}
      <div className="flex gap-2 justify-center mb-4">
        {[
          { label: "Min", value: minBet },
          { label: "½ Stack", value: Math.floor(chips / 2) },
          { label: "Max", value: effectiveMax },
        ].map(({ label, value }) => (
          <button
            key={label}
            onClick={() => setBetAmount(Math.min(Math.max(value, minBet), effectiveMax))}
            className="px-3 py-1.5 rounded-lg bg-surface-600 hover:bg-surface-500 text-xs font-semibold transition-colors"
          >
            {label}
          </button>
        ))}
      </div>

      {/* Secret bet */}
      {allowSecretBets && (
        <div className="flex justify-center mb-4">
          <button
            onClick={() => setIsSecretBet(!isSecretBet)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              isSecretBet ? "bg-purple-600 text-white" : "bg-surface-600 text-surface-300"
            }`}
          >
            🤫 {isSecretBet ? "Secret Bet ON" : "Secret Bet OFF"}
          </button>
        </div>
      )}

      {/* CTA */}
      <button
        onClick={onPlaceBet}
        disabled={betAmount < minBet || betAmount > chips}
        className="w-full py-3 bg-primary-500 hover:bg-primary-400 active:bg-primary-600 text-white rounded-xl font-black text-lg disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150 shadow-glow"
      >
        Place Bet · ${betAmount}
      </button>
    </div>
  );
}

// Compact opponent seat
function PlayerSeat({
  player,
  isCurrentTurn,
  isButton,
  calculateValue,
  getChipBreakdown,
}: {
  player: BlackjackPlayer;
  isCurrentTurn: boolean;
  isButton: boolean;
  calculateValue: (cards: BlackjackCard[]) => number;
  getChipBreakdown: (
    amount: number
  ) => { value: number; count: number; color: string; textColor: string }[];
}) {
  return (
    <div
      className={`bg-surface-800/70 rounded-xl p-3 border transition-all duration-200 ${
        isCurrentTurn ? "ring-2 ring-primary-500 border-primary-500/40" : "border-surface-700/40"
      } ${player.isEliminated ? "opacity-50" : ""}`}
    >
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-semibold text-sm truncate max-w-[90px]">{player.displayName}</span>
          {isButton && (
            <span className="px-1.5 py-0.5 rounded bg-warning text-black text-[9px] font-black shrink-0">
              BTN
            </span>
          )}
        </div>
        <span className="text-xs font-bold text-primary-400 shrink-0">${player.chips}</span>
      </div>

      {player.hands.length > 0 && (
        <div className="space-y-1.5">
          {player.hands.map((hand, idx) => (
            <div key={idx} className="bg-surface-700/50 rounded-lg p-2">
              <div className="flex gap-1 justify-center mb-1 flex-wrap">
                {hand.cards.slice(0, 5).map((card, cardIdx) => (
                  <div
                    key={cardIdx}
                    className={`w-6 h-9 rounded text-[9px] flex items-center justify-center font-black ${
                      card.faceUp ? "bg-white" : "bg-blue-800"
                    }`}
                    style={card.faceUp ? { color: SUIT_COLORS[card.suit] } : undefined}
                  >
                    {card.faceUp ? card.rank : "?"}
                  </div>
                ))}
                {hand.cards.length > 5 && (
                  <span className="text-[10px] text-surface-400 self-center">
                    +{hand.cards.length - 5}
                  </span>
                )}
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-surface-400">${hand.bet}</span>
                <span
                  className={
                    hand.isBusted ? "text-error" : hand.isBlackjack ? "text-warning" : "text-white"
                  }
                >
                  {hand.isBusted ? "Bust" : hand.isBlackjack ? "BJ" : hand.value}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {!player.hasPlacedBet && !player.isEliminated && (
        <div className="text-center text-[11px] text-surface-500 py-2">
          {player.isSecretBetRevealed ? "Waiting…" : "🤫"}
        </div>
      )}
    </div>
  );
}

// Chip stack display
function ChipStack({
  chips,
  getChipBreakdown,
}: {
  chips: number;
  getChipBreakdown: (
    amount: number
  ) => { value: number; count: number; color: string; textColor: string }[];
}) {
  const breakdown = getChipBreakdown(chips);
  return (
    <div className="flex items-center gap-2 shrink-0">
      <div className="flex -space-x-2">
        {breakdown.slice(0, 4).map((chip, idx) => (
          <div
            key={idx}
            className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-black shadow border border-white/30"
            style={{ backgroundColor: chip.color, color: chip.textColor, zIndex: 4 - idx }}
          >
            {chip.count > 1 ? `×${chip.count}` : chip.value}
          </div>
        ))}
      </div>
      <span className="font-black text-base text-primary-400">${chips}</span>
    </div>
  );
}
