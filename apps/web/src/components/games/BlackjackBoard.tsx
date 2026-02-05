"use client";

import { useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";

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
    () => Array.from(players.values()).find(p => p.id === playerId),
    [players, playerId]
  );

  const opponents = useMemo(
    () => Array.from(players.values()).filter(p => p.id !== playerId && !p.isEliminated),
    [players, playerId]
  );

  const isEliminationHand = eliminationHands.includes(handNumber);
  const isBettingPhase = phase === "betting";
  const isPlayerTurnPhase = phase === "player_turn";
  const isPayoutPhase = phase === "payout";

  // Calculate hand value display
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

  // Handle bet placement
  const handlePlaceBet = useCallback(() => {
    if (!myPlayer || myPlayer.hasPlacedBet) return;
    onAction("place_bet", { amount: betAmount, isSecret: isSecretBet });
  }, [myPlayer, betAmount, isSecretBet, onAction]);

  // Handle game actions
  const handleHit = useCallback(() => onAction("hit", {}), [onAction]);
  const handleStand = useCallback(() => onAction("stand", {}), [onAction]);
  const handleDoubleDown = useCallback(() => onAction("double_down", {}), [onAction]);
  const handleSplit = useCallback(() => onAction("split", {}), [onAction]);
  const handleInsurance = useCallback(() => onAction("insurance", {}), [onAction]);
  const handleSurrender = useCallback(() => onAction("surrender", {}), [onAction]);

  // Check if split is possible
  const canSplit = useMemo(() => {
    if (!myPlayer || !isMyTurn || !isPlayerTurnPhase) return false;
    const hand = myPlayer.hands[myPlayer.currentHandIndex];
    if (!hand || hand.cards.length !== 2) return false;
    if (hand.cards[0].rank !== hand.cards[1].rank) return false;
    return myPlayer.chips >= hand.bet;
  }, [myPlayer, isMyTurn, isPlayerTurnPhase]);

  // Check if double down is possible
  const canDoubleDown = useMemo(() => {
    if (!myPlayer || !isMyTurn || !isPlayerTurnPhase) return false;
    const hand = myPlayer.hands[myPlayer.currentHandIndex];
    if (!hand || hand.cards.length !== 2) return false;
    return myPlayer.chips >= hand.bet;
  }, [myPlayer, isMyTurn, isPlayerTurnPhase]);

  // Check if insurance is possible
  const canInsurance = useMemo(() => {
    if (!myPlayer || myPlayer.hasInsurance) return false;
    if (dealerHand.length === 0 || dealerHand[0]?.rank !== "A") return false;
    const hand = myPlayer.hands[0];
    if (!hand) return false;
    return myPlayer.chips >= Math.floor(hand.bet / 2);
  }, [myPlayer, dealerHand]);

  // Check if surrender is possible
  const canSurrender = useMemo(() => {
    if (!myPlayer || !isMyTurn || !isPlayerTurnPhase) return false;
    const hand = myPlayer.hands[myPlayer.currentHandIndex];
    return hand && hand.cards.length === 2;
  }, [myPlayer, isMyTurn, isPlayerTurnPhase]);

  // Get chip breakdown for display
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
    <div className="flex flex-col gap-6 w-full max-w-5xl mx-auto">
      {/* Game Info Header */}
      <div className="text-center">
        <div className="flex items-center justify-center gap-4 mb-2">
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${
            isEliminationHand 
              ? "bg-error/20 text-error animate-pulse" 
              : "bg-surface-700 text-surface-300"
          }`}>
            Hand #{handNumber}
            {isEliminationHand && " ⚠️ ELIMINATION"}
          </span>
          <span className="text-surface-400 text-sm">
            Phase: <span className="text-white capitalize">{phase.replace("_", " ")}</span>
          </span>
        </div>
        {isMyTurn && isPlayerTurnPhase && (
          <div className="text-lg font-medium text-success">Your turn to act!</div>
        )}
        {isBettingPhase && isMyTurn && !myPlayer?.hasPlacedBet && (
          <div className="text-lg font-medium text-warning">Place your bet!</div>
        )}
      </div>

      {/* Dealer Area */}
      <div className="bg-green-900/50 rounded-2xl p-6 border border-green-800">
        <div className="text-center mb-4">
          <span className="text-sm text-surface-400">DEALER</span>
          {dealerHand.length > 0 && (
            <span className="ml-2 text-lg font-bold">
              {dealerBusted ? (
                <span className="text-error">BUST!</span>
              ) : dealerBlackjack ? (
                <span className="text-warning">BLACKJACK!</span>
              ) : (
                <span className="text-white">{calculateVisibleValue(dealerHand)}</span>
              )}
            </span>
          )}
        </div>

        <div className="flex justify-center gap-2">
          <AnimatePresence>
            {dealerHand.map((card, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: -50, rotateY: 180 }}
                animate={{ opacity: 1, y: 0, rotateY: card.faceUp ? 0 : 180 }}
                exit={{ opacity: 0, scale: 0.5 }}
                transition={{ delay: idx * 0.2, type: "spring", stiffness: 200 }}
              >
                <PlayingCard card={card} />
              </motion.div>
            ))}
          </AnimatePresence>
          {dealerHand.length === 0 && (
            <div className="w-20 h-28 rounded-lg border-2 border-dashed border-green-700 flex items-center justify-center">
              <span className="text-green-700 text-sm">Cards</span>
            </div>
          )}
        </div>
      </div>

      {/* Other Players */}
      {opponents.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {opponents.map(player => (
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

      {/* My Player Area */}
      {myPlayer && (
        <div className={`bg-surface-800 rounded-2xl p-6 ${
          myPlayer.isEliminated ? "opacity-50" : ""
        }`}>
          {myPlayer.isEliminated ? (
            <div className="text-center py-8">
              <span className="text-4xl mb-4 block">😔</span>
              <span className="text-error font-bold text-xl">ELIMINATED</span>
            </div>
          ) : (
            <>
              {/* Player Info */}
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-3">
                  <span className="font-bold text-lg">{myPlayer.displayName}</span>
                  {buttonPlayerId === playerId && (
                    <span className="px-2 py-0.5 rounded-full bg-warning text-black text-xs font-bold">
                      BUTTON
                    </span>
                  )}
                </div>
                <ChipStack chips={myPlayer.chips} getChipBreakdown={getChipBreakdown} />
              </div>

              {/* Betting Phase */}
              {isBettingPhase && !myPlayer.hasPlacedBet && isMyTurn && (
                <div className="bg-surface-700 rounded-xl p-4 mb-4">
                  <h3 className="text-sm text-surface-400 mb-3">Place Your Bet</h3>
                  
                  {/* Chip selection */}
                  <div className="flex flex-wrap gap-2 justify-center mb-4">
                    {CHIP_COLORS.filter(c => c.value <= maxBet).map(chip => (
                      <motion.button
                        key={chip.value}
                        whileHover={{ scale: 1.1, y: -5 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setBetAmount(prev => 
                          Math.min(prev + chip.value, Math.min(maxBet, myPlayer.chips))
                        )}
                        className="w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold shadow-lg border-2 border-white/30"
                        style={{ backgroundColor: chip.color, color: chip.textColor }}
                      >
                        {chip.value}
                      </motion.button>
                    ))}
                  </div>

                  {/* Bet amount display */}
                  <div className="flex items-center justify-center gap-4 mb-4">
                    <button
                      onClick={() => setBetAmount(prev => Math.max(minBet, prev - 10))}
                      className="w-8 h-8 rounded-full bg-surface-600 text-white"
                    >
                      -
                    </button>
                    <div className="text-center">
                      <span className="text-3xl font-bold text-primary-400">${betAmount}</span>
                      <div className="text-xs text-surface-400">
                        Min: ${minBet} • Max: ${Math.min(maxBet, myPlayer.chips)}
                      </div>
                    </div>
                    <button
                      onClick={() => setBetAmount(prev => 
                        Math.min(prev + 10, Math.min(maxBet, myPlayer.chips))
                      )}
                      className="w-8 h-8 rounded-full bg-surface-600 text-white"
                    >
                      +
                    </button>
                  </div>

                  {/* Quick bet buttons */}
                  <div className="flex gap-2 justify-center mb-4">
                    <button
                      onClick={() => setBetAmount(minBet)}
                      className="px-3 py-1 rounded bg-surface-600 text-sm"
                    >
                      Min
                    </button>
                    <button
                      onClick={() => setBetAmount(Math.floor(myPlayer.chips / 2))}
                      className="px-3 py-1 rounded bg-surface-600 text-sm"
                    >
                      Half
                    </button>
                    <button
                      onClick={() => setBetAmount(Math.min(maxBet, myPlayer.chips))}
                      className="px-3 py-1 rounded bg-surface-600 text-sm"
                    >
                      Max
                    </button>
                  </div>

                  {/* Secret bet toggle */}
                  {allowSecretBets && (
                    <div className="flex items-center justify-center gap-2 mb-4">
                      <button
                        onClick={() => setIsSecretBet(!isSecretBet)}
                        className={`px-4 py-2 rounded-lg text-sm ${
                          isSecretBet
                            ? "bg-purple-600 text-white"
                            : "bg-surface-600 text-surface-300"
                        }`}
                      >
                        🤫 Secret Bet
                      </button>
                    </div>
                  )}

                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handlePlaceBet}
                    disabled={betAmount < minBet || betAmount > myPlayer.chips}
                    className="w-full py-3 bg-primary-500 text-white rounded-xl font-bold text-lg disabled:opacity-50"
                  >
                    Place Bet
                  </motion.button>
                </div>
              )}

              {/* Waiting for bet */}
              {isBettingPhase && !myPlayer.hasPlacedBet && !isMyTurn && (
                <div className="text-center py-4 text-surface-400">
                  Waiting for your turn to bet...
                </div>
              )}

              {/* Bet placed indicator */}
              {isBettingPhase && myPlayer.hasPlacedBet && (
                <div className="text-center py-4">
                  <span className="text-success">
                    ✓ Bet placed: {myPlayer.isSecretBetRevealed ? `$${myPlayer.hands[0]?.bet || 0}` : "🤫 Secret"}
                  </span>
                </div>
              )}

              {/* My Hands */}
              {myPlayer.hands.length > 0 && (
                <div className="space-y-4">
                  {myPlayer.hands.map((hand, handIdx) => (
                    <div
                      key={handIdx}
                      className={`p-4 rounded-xl ${
                        myPlayer.currentHandIndex === handIdx && isPlayerTurnPhase && isMyTurn
                          ? "bg-primary-500/20 ring-2 ring-primary-500"
                          : "bg-surface-700/50"
                      }`}
                    >
                      <div className="flex justify-between items-center mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-surface-400">
                            Hand {handIdx + 1}
                          </span>
                          {hand.isSplit && (
                            <span className="px-2 py-0.5 rounded bg-purple-500/30 text-purple-300 text-xs">
                              Split
                            </span>
                          )}
                          {hand.isDoubled && (
                            <span className="px-2 py-0.5 rounded bg-warning/30 text-warning text-xs">
                              Doubled
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-surface-400 text-sm">
                            Bet: <span className="text-white">${hand.bet}</span>
                          </span>
                          <span className={`font-bold text-lg ${
                            hand.isBusted ? "text-error" :
                            hand.isBlackjack ? "text-warning" :
                            "text-white"
                          }`}>
                            {hand.isBusted ? "BUST" :
                             hand.isBlackjack ? "BJ!" :
                             hand.value}
                          </span>
                        </div>
                      </div>

                      {/* Cards */}
                      <div className="flex gap-2 justify-center mb-4">
                        <AnimatePresence>
                          {hand.cards.map((card, cardIdx) => (
                            <motion.div
                              key={cardIdx}
                              initial={{ opacity: 0, x: -50, rotateY: 180 }}
                              animate={{ opacity: 1, x: 0, rotateY: 0 }}
                              transition={{ delay: cardIdx * 0.15, type: "spring" }}
                            >
                              <PlayingCard card={card} />
                            </motion.div>
                          ))}
                        </AnimatePresence>
                      </div>

                      {/* Action Buttons */}
                      {isPlayerTurnPhase && isMyTurn && 
                       myPlayer.currentHandIndex === handIdx &&
                       !hand.isStanding && !hand.isBusted && !hand.isBlackjack && (
                        <div className="flex flex-wrap gap-2 justify-center">
                          <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={handleHit}
                            className="px-6 py-2 bg-success text-white rounded-lg font-medium"
                          >
                            Hit
                          </motion.button>
                          <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={handleStand}
                            className="px-6 py-2 bg-surface-600 text-white rounded-lg font-medium"
                          >
                            Stand
                          </motion.button>
                          {canDoubleDown && (
                            <motion.button
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={handleDoubleDown}
                              className="px-6 py-2 bg-warning text-black rounded-lg font-medium"
                            >
                              Double
                            </motion.button>
                          )}
                          {canSplit && (
                            <motion.button
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={handleSplit}
                              className="px-6 py-2 bg-purple-500 text-white rounded-lg font-medium"
                            >
                              Split
                            </motion.button>
                          )}
                          {canSurrender && (
                            <motion.button
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={handleSurrender}
                              className="px-6 py-2 bg-error/50 text-white rounded-lg font-medium"
                            >
                              Surrender
                            </motion.button>
                          )}
                        </div>
                      )}

                      {/* Hand Status */}
                      {(hand.isStanding || hand.isBusted || hand.isBlackjack) && (
                        <div className="text-center text-sm text-surface-400">
                          {hand.isStanding && !hand.isBusted && "Standing"}
                          {hand.isBusted && "Busted"}
                          {hand.isBlackjack && "Blackjack!"}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Insurance prompt */}
              {canInsurance && phase === "player_turn" && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-4 p-4 bg-warning/20 rounded-xl text-center"
                >
                  <p className="text-warning mb-3">Dealer showing Ace - Insurance?</p>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleInsurance}
                    className="px-6 py-2 bg-warning text-black rounded-lg font-medium"
                  >
                    Take Insurance (${Math.floor(myPlayer.hands[0]?.bet / 2 || 0)})
                  </motion.button>
                </motion.div>
              )}

              {/* Payout display */}
              {isPayoutPhase && myPlayer.roundWinnings > 0 && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="mt-4 p-4 bg-success/20 rounded-xl text-center"
                >
                  <span className="text-4xl mb-2 block">🎉</span>
                  <span className="text-success text-2xl font-bold">
                    +${myPlayer.roundWinnings}
                  </span>
                </motion.div>
              )}
            </>
          )}
        </div>
      )}

      {/* Leaderboard */}
      <div className="bg-surface-800 rounded-xl p-4">
        <h3 className="text-sm text-surface-400 mb-3 text-center">TOURNAMENT STANDINGS</h3>
        <div className="space-y-2">
          {Array.from(players.values())
            .sort((a, b) => b.chips - a.chips)
            .map((player, idx) => (
              <div
                key={player.id}
                className={`flex items-center justify-between p-2 rounded-lg ${
                  player.isEliminated
                    ? "bg-surface-900 opacity-50"
                    : player.id === playerId
                    ? "bg-primary-500/20"
                    : "bg-surface-700"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    idx === 0 ? "bg-yellow-500 text-black" :
                    idx === 1 ? "bg-gray-400 text-black" :
                    idx === 2 ? "bg-amber-700 text-white" :
                    "bg-surface-600 text-surface-300"
                  }`}>
                    {idx + 1}
                  </span>
                  <span className={player.isEliminated ? "line-through" : ""}>
                    {player.displayName}
                    {player.id === playerId && " (You)"}
                  </span>
                </div>
                <span className="font-bold">
                  ${player.chips}
                  {player.isEliminated && (
                    <span className="ml-2 text-error text-xs">OUT</span>
                  )}
                </span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

function PlayingCard({ card }: { card: BlackjackCard }) {
  const suitSymbol = SUIT_SYMBOLS[card.suit] || "?";
  const suitColor = SUIT_COLORS[card.suit] || "#000";

  if (!card.faceUp) {
    return (
      <div className="w-16 h-24 md:w-20 md:h-28 rounded-lg bg-gradient-to-br from-blue-800 to-blue-950 border-2 border-white/20 shadow-lg flex items-center justify-center">
        <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-blue-600/50 flex items-center justify-center">
          <span className="text-white/50 text-lg">?</span>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      className="w-16 h-24 md:w-20 md:h-28 rounded-lg bg-white shadow-lg flex flex-col p-1.5 relative overflow-hidden"
      whileHover={{ y: -5 }}
    >
      {/* Top left */}
      <div className="flex flex-col items-center" style={{ color: suitColor }}>
        <span className="text-sm md:text-base font-bold leading-none">{card.rank}</span>
        <span className="text-xs md:text-sm leading-none">{suitSymbol}</span>
      </div>

      {/* Center */}
      <div className="flex-1 flex items-center justify-center">
        <span className="text-2xl md:text-3xl" style={{ color: suitColor }}>
          {suitSymbol}
        </span>
      </div>

      {/* Bottom right (rotated) */}
      <div className="flex flex-col items-center rotate-180" style={{ color: suitColor }}>
        <span className="text-sm md:text-base font-bold leading-none">{card.rank}</span>
        <span className="text-xs md:text-sm leading-none">{suitSymbol}</span>
      </div>
    </motion.div>
  );
}

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
  getChipBreakdown: (amount: number) => { value: number; count: number; color: string; textColor: string }[];
}) {
  return (
    <div className={`bg-surface-800 rounded-xl p-3 ${
      isCurrentTurn ? "ring-2 ring-primary-500" : ""
    } ${player.isEliminated ? "opacity-50" : ""}`}>
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate max-w-20">{player.displayName}</span>
          {isButton && (
            <span className="px-1.5 py-0.5 rounded bg-warning text-black text-[10px] font-bold">
              BTN
            </span>
          )}
        </div>
        <span className="text-sm font-bold text-primary-400">${player.chips}</span>
      </div>

      {player.hands.length > 0 && (
        <div className="space-y-2">
          {player.hands.map((hand, idx) => (
            <div key={idx} className="bg-surface-700/50 rounded p-2">
              <div className="flex gap-1 justify-center mb-1">
                {hand.cards.slice(0, 4).map((card, cardIdx) => (
                  <div
                    key={cardIdx}
                    className={`w-6 h-9 rounded text-[8px] flex items-center justify-center font-bold ${
                      card.faceUp ? "bg-white" : "bg-blue-800"
                    }`}
                    style={card.faceUp ? { color: SUIT_COLORS[card.suit] } : undefined}
                  >
                    {card.faceUp ? card.rank : "?"}
                  </div>
                ))}
                {hand.cards.length > 4 && (
                  <span className="text-xs text-surface-400">+{hand.cards.length - 4}</span>
                )}
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-surface-400">${hand.bet}</span>
                <span className={
                  hand.isBusted ? "text-error" :
                  hand.isBlackjack ? "text-warning" :
                  "text-white"
                }>
                  {hand.isBusted ? "Bust" :
                   hand.isBlackjack ? "BJ" :
                   hand.value}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {!player.hasPlacedBet && !player.isEliminated && (
        <div className="text-center text-xs text-surface-400 py-2">
          {player.isSecretBetRevealed ? "Waiting..." : "🤫"}
        </div>
      )}
    </div>
  );
}

function ChipStack({
  chips,
  getChipBreakdown,
}: {
  chips: number;
  getChipBreakdown: (amount: number) => { value: number; count: number; color: string; textColor: string }[];
}) {
  const breakdown = getChipBreakdown(chips);

  return (
    <div className="flex items-center gap-2">
      <div className="flex -space-x-2">
        {breakdown.slice(0, 5).map((chip, idx) => (
          <div
            key={idx}
            className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold shadow border border-white/30"
            style={{ backgroundColor: chip.color, color: chip.textColor, zIndex: 5 - idx }}
          >
            {chip.count > 1 ? `×${chip.count}` : chip.value}
          </div>
        ))}
      </div>
      <span className="font-bold text-lg text-primary-400">${chips}</span>
    </div>
  );
}
