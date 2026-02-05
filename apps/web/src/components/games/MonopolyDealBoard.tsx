"use client";

import { useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface MonopolyDealCard {
  id: string;
  cardType: string;
  value: number;
  name: string;
  actionType?: string;
  color?: string;
  colors?: string[];
}

interface PropertySet {
  color: string;
  cards: MonopolyDealCard[];
  hasHouse: boolean;
  hasHotel: boolean;
  isComplete: boolean;
}

interface MonopolyDealPlayer {
  id: string;
  displayName: string;
  isReady: boolean;
  isConnected: boolean;
  joinedAt: number;
  isBot: boolean;
  isSpectator: boolean;
  wasInitialPlayer: boolean;
  hand: MonopolyDealCard[];
  bank: MonopolyDealCard[];
  propertySets: PropertySet[];
  completeSets: number;
  actionsRemaining: number;
  amountOwed: number;
  owedToPlayerId: string;
}

interface ActionRequest {
  id: string;
  actionType: string;
  sourcePlayerId: string;
  targetPlayerId: string;
  amount?: number;
}

interface MonopolyDealBoardProps {
  players: Map<string, MonopolyDealPlayer>;
  currentTurnId: string;
  playerId: string;
  phase: string;
  deckRemaining: number;
  discardPile: MonopolyDealCard[];
  actionStack: ActionRequest[];
  activeResponderId: string;
  isMyTurn: boolean;
  onAction: (action: string, data: Record<string, unknown>) => void;
}

const COLOR_MAP: Record<string, string> = {
  brown: "#8B4513",
  light_blue: "#87CEEB",
  pink: "#FF69B4",
  orange: "#FFA500",
  red: "#DC143C",
  yellow: "#FFD700",
  green: "#228B22",
  dark_blue: "#00008B",
  railroad: "#2F4F4F",
  utility: "#708090",
};

const COLOR_NAMES: Record<string, string> = {
  brown: "Brown",
  light_blue: "Light Blue",
  pink: "Pink",
  orange: "Orange",
  red: "Red",
  yellow: "Yellow",
  green: "Green",
  dark_blue: "Dark Blue",
  railroad: "Railroad",
  utility: "Utility",
};

const SET_REQUIREMENTS: Record<string, number> = {
  brown: 2,
  light_blue: 3,
  pink: 3,
  orange: 3,
  red: 3,
  yellow: 3,
  green: 3,
  dark_blue: 2,
  railroad: 4,
  utility: 2,
};

export function MonopolyDealBoard({
  players,
  currentTurnId,
  playerId,
  phase,
  deckRemaining,
  discardPile,
  actionStack,
  activeResponderId,
  isMyTurn,
  onAction,
}: MonopolyDealBoardProps) {
  const [selectedCard, setSelectedCard] = useState<MonopolyDealCard | null>(null);
  const [targetPlayer, setTargetPlayer] = useState<string | null>(null);
  const [targetCard, setTargetCard] = useState<string | null>(null);
  const [targetColor, setTargetColor] = useState<string | null>(null);
  const [paymentCards, setPaymentCards] = useState<string[]>([]);
  const [discardCards, setDiscardCards] = useState<string[]>([]);

  const myPlayer = useMemo(() => 
    Array.from(players.values()).find(p => p.id === playerId),
    [players, playerId]
  );
  
  const opponents = useMemo(() => 
    Array.from(players.values()).filter(p => p.id !== playerId),
    [players, playerId]
  );

  const currentAction = actionStack.length > 0 ? actionStack[actionStack.length - 1] : null;
  const mustRespond = activeResponderId === playerId;

  // Calculate total bank value
  const getBankValue = useCallback((player: MonopolyDealPlayer) => {
    return player.bank.reduce((sum, card) => sum + card.value, 0);
  }, []);

  // Get player's total payable assets
  const getTotalAssets = useCallback((player: MonopolyDealPlayer) => {
    let total = player.bank.reduce((sum, card) => sum + card.value, 0);
    for (const set of player.propertySets) {
      for (const card of set.cards) {
        total += card.value;
      }
    }
    return total;
  }, []);

  // Handle drawing cards
  const handleDraw = useCallback(() => {
    onAction("draw", {});
  }, [onAction]);

  // Handle playing a card
  const handlePlayCard = useCallback((card: MonopolyDealCard) => {
    if (!isMyTurn || phase !== "play") return;

    if (card.cardType === "money") {
      onAction("play_money", { cardId: card.id });
    } else if (card.cardType === "property") {
      onAction("play_property", { cardId: card.id });
    } else if (card.cardType === "wildcard") {
      setSelectedCard(card);
    } else if (card.cardType === "action" || card.cardType === "rent") {
      setSelectedCard(card);
    }
  }, [isMyTurn, phase, onAction]);

  // Handle wildcard color selection
  const handleSelectWildcardColor = useCallback((color: string) => {
    if (selectedCard) {
      onAction("play_property", { cardId: selectedCard.id, targetColor: color });
      setSelectedCard(null);
      setTargetColor(null);
    }
  }, [selectedCard, onAction]);

  // Handle action card execution
  const handleExecuteAction = useCallback(() => {
    if (!selectedCard) return;

    const data: Record<string, unknown> = { cardId: selectedCard.id };

    if (targetPlayer) data.targetPlayerId = targetPlayer;
    if (targetCard) data.targetCardId = targetCard;
    if (targetColor) data.targetColor = targetColor;

    onAction("play_action", data);
    setSelectedCard(null);
    setTargetPlayer(null);
    setTargetCard(null);
    setTargetColor(null);
  }, [selectedCard, targetPlayer, targetCard, targetColor, onAction]);

  // Handle response to action
  const handleRespond = useCallback((response: "accept" | "just_say_no") => {
    onAction("respond", { response });
  }, [onAction]);

  // Handle payment
  const handlePay = useCallback(() => {
    onAction("pay", { cardIds: paymentCards });
    setPaymentCards([]);
  }, [onAction, paymentCards]);

  // Handle discard
  const handleDiscard = useCallback(() => {
    onAction("discard", { cardIds: discardCards });
    setDiscardCards([]);
  }, [onAction, discardCards]);

  // Handle pass turn
  const handlePass = useCallback(() => {
    onAction("pass", {});
  }, [onAction]);

  // Toggle payment card
  const togglePaymentCard = useCallback((cardId: string) => {
    setPaymentCards(prev =>
      prev.includes(cardId)
        ? prev.filter(id => id !== cardId)
        : [...prev, cardId]
    );
  }, []);

  // Toggle discard card
  const toggleDiscardCard = useCallback((cardId: string) => {
    setDiscardCards(prev =>
      prev.includes(cardId)
        ? prev.filter(id => id !== cardId)
        : [...prev, cardId]
    );
  }, []);

  // Check if player has Just Say No
  const hasJustSayNo = useMemo(() => {
    return myPlayer?.hand.some(c => c.actionType === "just_say_no") || false;
  }, [myPlayer]);

  // Calculate selected payment total
  const paymentTotal = useMemo(() => {
    if (!myPlayer) return 0;
    let total = 0;
    for (const cardId of paymentCards) {
      const bankCard = myPlayer.bank.find(c => c.id === cardId);
      if (bankCard) {
        total += bankCard.value;
        continue;
      }
      for (const set of myPlayer.propertySets) {
        const propCard = set.cards.find(c => c.id === cardId);
        if (propCard) {
          total += propCard.value;
          break;
        }
      }
    }
    return total;
  }, [myPlayer, paymentCards]);

  return (
    <div className="flex flex-col gap-4 w-full max-w-6xl mx-auto">
      {/* Turn & Phase Info */}
      <div className="text-center">
        <div className="text-lg font-medium">
          {isMyTurn ? (
            <span className="text-success">Your turn!</span>
          ) : (
            <span className="text-surface-400">
              Waiting for {Array.from(players.values()).find(p => p.id === currentTurnId)?.displayName || "opponent"}...
            </span>
          )}
        </div>
        <div className="text-sm text-surface-500 capitalize">
          Phase: {phase.replace("_", " ")}
          {myPlayer && phase === "play" && ` • ${myPlayer.actionsRemaining} actions left`}
        </div>
      </div>

      {/* Action Stack / Response Modal */}
      <AnimatePresence>
        {mustRespond && currentAction && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          >
            <div className="bg-surface-900 rounded-2xl p-6 max-w-md w-full mx-4 shadow-xl border border-surface-700">
              <h3 className="text-xl font-bold mb-4 text-center">Respond to Action!</h3>
              <div className="text-center mb-6">
                <p className="text-surface-300">
                  <span className="text-primary-400 font-medium">
                    {Array.from(players.values()).find(p => p.id === currentAction.sourcePlayerId)?.displayName}
                  </span>
                  {" played "}
                  <span className="text-warning font-medium capitalize">
                    {currentAction.actionType.replace(/_/g, " ")}
                  </span>
                  {currentAction.amount && ` for $${currentAction.amount}M`}
                </p>
              </div>
              <div className="flex gap-4 justify-center">
                {hasJustSayNo && (
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handleRespond("just_say_no")}
                    className="px-6 py-3 bg-error text-white rounded-xl font-medium"
                  >
                    🚫 Just Say No!
                  </motion.button>
                )}
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => handleRespond("accept")}
                  className="px-6 py-3 bg-surface-700 text-white rounded-xl font-medium"
                >
                  ✓ Accept
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Payment Modal */}
      <AnimatePresence>
        {myPlayer && myPlayer.amountOwed > 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          >
            <div className="bg-surface-900 rounded-2xl p-6 max-w-lg w-full mx-4 shadow-xl border border-surface-700">
              <h3 className="text-xl font-bold mb-4 text-center">💰 Pay ${myPlayer.amountOwed}M</h3>
              <p className="text-center text-surface-400 mb-4">
                Select cards to pay (no change given)
              </p>
              <p className="text-center text-lg mb-4">
                Selected: <span className={paymentTotal >= myPlayer.amountOwed ? "text-success" : "text-error"}>
                  ${paymentTotal}M
                </span> / ${myPlayer.amountOwed}M
              </p>

              {/* Bank cards */}
              <div className="mb-4">
                <h4 className="text-sm text-surface-400 mb-2">Bank</h4>
                <div className="flex flex-wrap gap-2">
                  {myPlayer.bank.map(card => (
                    <motion.button
                      key={card.id}
                      whileHover={{ scale: 1.05 }}
                      onClick={() => togglePaymentCard(card.id)}
                      className={`px-3 py-2 rounded-lg text-sm font-medium ${
                        paymentCards.includes(card.id)
                          ? "bg-primary-500 text-white"
                          : "bg-surface-700 text-surface-200"
                      }`}
                    >
                      ${card.value}M
                    </motion.button>
                  ))}
                </div>
              </div>

              {/* Property cards */}
              {myPlayer.propertySets.map((set, si) => (
                <div key={si} className="mb-2">
                  <h4 className="text-sm mb-1" style={{ color: COLOR_MAP[set.color] }}>
                    {COLOR_NAMES[set.color]}
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {set.cards.map(card => (
                      <motion.button
                        key={card.id}
                        whileHover={{ scale: 1.05 }}
                        onClick={() => togglePaymentCard(card.id)}
                        className={`px-3 py-2 rounded-lg text-xs ${
                          paymentCards.includes(card.id)
                            ? "bg-primary-500 text-white"
                            : "bg-surface-700 text-surface-200"
                        }`}
                        style={{ borderColor: COLOR_MAP[set.color], borderWidth: 2 }}
                      >
                        ${card.value}M
                      </motion.button>
                    ))}
                  </div>
                </div>
              ))}

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handlePay}
                disabled={paymentTotal < myPlayer.amountOwed && getTotalAssets(myPlayer) > paymentTotal}
                className="w-full mt-4 px-6 py-3 bg-success text-white rounded-xl font-medium disabled:opacity-50"
              >
                Pay ${paymentTotal}M
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Opponents */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {opponents.map(opponent => (
          <OpponentArea
            key={opponent.id}
            player={opponent}
            isCurrentTurn={opponent.id === currentTurnId}
            isTargetable={selectedCard?.actionType === "debt_collector" || 
                          selectedCard?.actionType === "sly_deal" ||
                          selectedCard?.actionType === "forced_deal" ||
                          selectedCard?.actionType === "deal_breaker"}
            isSelected={targetPlayer === opponent.id}
            onSelect={() => setTargetPlayer(opponent.id)}
            onSelectCard={(cardId) => setTargetCard(cardId)}
            targetCard={targetCard}
          />
        ))}
      </div>

      {/* Table Center - Deck & Discard */}
      <div className="flex justify-center gap-8 my-4">
        {/* Draw Deck */}
        <motion.div
          whileHover={isMyTurn && phase === "draw" ? { scale: 1.05 } : {}}
          onClick={isMyTurn && phase === "draw" ? handleDraw : undefined}
          className={`w-24 h-36 rounded-xl bg-gradient-to-br from-blue-600 to-blue-800 flex flex-col items-center justify-center shadow-lg ${
            isMyTurn && phase === "draw" ? "cursor-pointer ring-2 ring-primary-500 animate-pulse" : ""
          }`}
        >
          <span className="text-3xl mb-1">🃏</span>
          <span className="text-white text-sm font-medium">{deckRemaining}</span>
          <span className="text-white/70 text-xs">cards</span>
        </motion.div>

        {/* Discard Pile */}
        <div className="w-24 h-36 rounded-xl bg-surface-800 border-2 border-dashed border-surface-600 flex flex-col items-center justify-center">
          {discardPile.length > 0 ? (
            <CardMini card={discardPile[discardPile.length - 1]} />
          ) : (
            <>
              <span className="text-surface-500 text-sm">Discard</span>
              <span className="text-surface-600 text-xs">Pile</span>
            </>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      {isMyTurn && phase === "play" && (
        <div className="flex justify-center gap-4">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handlePass}
            className="px-6 py-2 bg-surface-700 text-white rounded-xl"
          >
            End Turn
          </motion.button>
        </div>
      )}

      {/* Wildcard Color Selection */}
      <AnimatePresence>
        {selectedCard?.cardType === "wildcard" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="bg-surface-800 rounded-xl p-4 mx-auto"
          >
            <p className="text-center text-sm text-surface-400 mb-3">Select color for wildcard:</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {selectedCard.colors?.map(color => (
                <motion.button
                  key={color}
                  whileHover={{ scale: 1.1 }}
                  onClick={() => handleSelectWildcardColor(color)}
                  className="w-10 h-10 rounded-lg"
                  style={{ backgroundColor: COLOR_MAP[color] }}
                  title={COLOR_NAMES[color]}
                />
              ))}
            </div>
            <button
              onClick={() => setSelectedCard(null)}
              className="mt-3 w-full text-sm text-surface-400 hover:text-white"
            >
              Cancel
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Action Target Selection */}
      <AnimatePresence>
        {selectedCard && (selectedCard.cardType === "action" || selectedCard.cardType === "rent") && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="bg-surface-800 rounded-xl p-4 mx-auto max-w-md"
          >
            <p className="text-center font-medium mb-3 capitalize">
              {selectedCard.actionType?.replace(/_/g, " ") || selectedCard.name}
            </p>

            {/* Rent color selection */}
            {selectedCard.cardType === "rent" && (
              <div className="mb-4">
                <p className="text-sm text-surface-400 mb-2">Select property color:</p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {(selectedCard.colors || []).map(color => {
                    const hasColor = myPlayer?.propertySets.some(ps => ps.color === color && ps.cards.length > 0);
                    return (
                      <motion.button
                        key={color}
                        whileHover={hasColor ? { scale: 1.1 } : {}}
                        onClick={() => hasColor && setTargetColor(color)}
                        disabled={!hasColor}
                        className={`w-10 h-10 rounded-lg ${targetColor === color ? "ring-2 ring-white" : ""} ${!hasColor ? "opacity-30" : ""}`}
                        style={{ backgroundColor: COLOR_MAP[color] }}
                        title={COLOR_NAMES[color]}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* Target player selection for targeted actions */}
            {(selectedCard.actionType === "debt_collector" || 
              selectedCard.actionType === "sly_deal" ||
              selectedCard.actionType === "forced_deal" ||
              selectedCard.actionType === "deal_breaker") && (
              <div className="mb-4">
                <p className="text-sm text-surface-400 mb-2">Select target player:</p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {opponents.map(opp => (
                    <motion.button
                      key={opp.id}
                      whileHover={{ scale: 1.05 }}
                      onClick={() => setTargetPlayer(opp.id)}
                      className={`px-4 py-2 rounded-lg text-sm ${
                        targetPlayer === opp.id
                          ? "bg-primary-500 text-white"
                          : "bg-surface-700 text-surface-200"
                      }`}
                    >
                      {opp.displayName}
                    </motion.button>
                  ))}
                </div>
              </div>
            )}

            {/* House/Hotel color selection */}
            {(selectedCard.actionType === "house" || selectedCard.actionType === "hotel") && (
              <div className="mb-4">
                <p className="text-sm text-surface-400 mb-2">
                  Select complete set to add {selectedCard.actionType}:
                </p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {myPlayer?.propertySets
                    .filter(ps => ps.isComplete && (selectedCard.actionType === "house" ? !ps.hasHouse : ps.hasHouse && !ps.hasHotel))
                    .map(ps => (
                      <motion.button
                        key={ps.color}
                        whileHover={{ scale: 1.1 }}
                        onClick={() => setTargetColor(ps.color)}
                        className={`w-10 h-10 rounded-lg ${targetColor === ps.color ? "ring-2 ring-white" : ""}`}
                        style={{ backgroundColor: COLOR_MAP[ps.color] }}
                        title={COLOR_NAMES[ps.color]}
                      />
                    ))}
                </div>
              </div>
            )}

            <div className="flex gap-4 justify-center mt-4">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleExecuteAction}
                disabled={
                  (selectedCard.actionType === "debt_collector" && !targetPlayer) ||
                  (selectedCard.actionType === "sly_deal" && (!targetPlayer || !targetCard)) ||
                  (selectedCard.cardType === "rent" && !targetColor)
                }
                className="px-6 py-2 bg-success text-white rounded-xl disabled:opacity-50"
              >
                Play
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  setSelectedCard(null);
                  setTargetPlayer(null);
                  setTargetCard(null);
                  setTargetColor(null);
                }}
                className="px-6 py-2 bg-surface-700 text-white rounded-xl"
              >
                Cancel
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* My Hand & Properties */}
      {myPlayer && (
        <div className="bg-surface-800/50 rounded-2xl p-4">
          {/* Stats */}
          <div className="flex justify-between items-center mb-4">
            <div>
              <span className="text-lg font-bold text-primary-400">{myPlayer.completeSets}/3 Sets</span>
              <span className="text-surface-400 ml-3">Bank: ${getBankValue(myPlayer)}M</span>
            </div>
            <div className="text-sm text-surface-400">
              {myPlayer.hand.length} cards in hand
            </div>
          </div>

          {/* My Properties */}
          <div className="mb-4">
            <h4 className="text-sm text-surface-400 mb-2">Your Properties</h4>
            <div className="flex flex-wrap gap-3">
              {myPlayer.propertySets.map((set, idx) => (
                <PropertySetDisplay key={idx} set={set} />
              ))}
              {myPlayer.propertySets.length === 0 && (
                <span className="text-surface-500 text-sm">No properties yet</span>
              )}
            </div>
          </div>

          {/* My Bank */}
          <div className="mb-4">
            <h4 className="text-sm text-surface-400 mb-2">Your Bank</h4>
            <div className="flex flex-wrap gap-2">
              {myPlayer.bank.map(card => (
                <motion.div
                  key={card.id}
                  className="w-12 h-16 rounded-lg bg-gradient-to-br from-green-600 to-green-800 flex items-center justify-center text-white font-bold shadow"
                >
                  ${card.value}M
                </motion.div>
              ))}
              {myPlayer.bank.length === 0 && (
                <span className="text-surface-500 text-sm">No money in bank</span>
              )}
            </div>
          </div>

          {/* Discard Phase */}
          {phase === "discard" && myPlayer.hand.length > 7 && (
            <div className="mb-4 p-4 bg-warning/20 rounded-xl">
              <p className="text-warning text-center mb-2">
                Discard {myPlayer.hand.length - 7} card(s)
              </p>
              <p className="text-sm text-center text-surface-400 mb-3">
                Selected: {discardCards.length} / {myPlayer.hand.length - 7}
              </p>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleDiscard}
                disabled={discardCards.length !== myPlayer.hand.length - 7}
                className="w-full px-6 py-2 bg-warning text-black rounded-xl font-medium disabled:opacity-50"
              >
                Confirm Discard
              </motion.button>
            </div>
          )}

          {/* My Hand */}
          <div>
            <h4 className="text-sm text-surface-400 mb-2">Your Hand</h4>
            <div className="flex flex-wrap gap-2">
              {myPlayer.hand.map((card, idx) => (
                <motion.div
                  key={card.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  whileHover={isMyTurn && phase === "play" ? { scale: 1.1, y: -10 } : {}}
                  onClick={() => {
                    if (phase === "discard") {
                      toggleDiscardCard(card.id);
                    } else if (isMyTurn && phase === "play" && myPlayer.actionsRemaining > 0) {
                      handlePlayCard(card);
                    }
                  }}
                  className={`cursor-pointer ${
                    discardCards.includes(card.id) ? "ring-2 ring-warning" : ""
                  } ${selectedCard?.id === card.id ? "ring-2 ring-primary-500" : ""}`}
                >
                  <CardDisplay card={card} />
                </motion.div>
              ))}
              {myPlayer.hand.length === 0 && (
                <span className="text-surface-500 text-sm">Hand is empty</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OpponentArea({
  player,
  isCurrentTurn,
  isTargetable,
  isSelected,
  onSelect,
  onSelectCard,
  targetCard,
}: {
  player: MonopolyDealPlayer;
  isCurrentTurn: boolean;
  isTargetable: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onSelectCard: (cardId: string) => void;
  targetCard: string | null;
}) {
  return (
    <motion.div
      className={`bg-surface-800 rounded-xl p-3 ${
        isCurrentTurn ? "ring-2 ring-primary-500" : ""
      } ${isSelected ? "ring-2 ring-warning" : ""} ${
        isTargetable ? "cursor-pointer hover:bg-surface-700" : ""
      }`}
      onClick={isTargetable ? onSelect : undefined}
    >
      <div className="flex justify-between items-center mb-2">
        <span className="font-medium text-sm">{player.displayName}</span>
        <span className="text-xs text-surface-400">{player.hand.length} 🃏</span>
      </div>

      <div className="text-xs text-surface-400 mb-2">
        Sets: {player.completeSets}/3 • Bank: ${player.bank.reduce((s, c) => s + c.value, 0)}M
      </div>

      {/* Opponent Properties */}
      <div className="flex flex-wrap gap-1">
        {player.propertySets.map((set, idx) => (
          <div key={idx} className="flex flex-col gap-0.5">
            {set.cards.map(card => (
              <motion.div
                key={card.id}
                whileHover={isSelected ? { scale: 1.1 } : {}}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isSelected && !set.isComplete) {
                    onSelectCard(card.id);
                  }
                }}
                className={`w-8 h-5 rounded-sm ${targetCard === card.id ? "ring-1 ring-white" : ""}`}
                style={{ backgroundColor: COLOR_MAP[set.color] }}
              />
            ))}
            {set.hasHouse && <span className="text-xs">🏠</span>}
            {set.hasHotel && <span className="text-xs">🏨</span>}
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function PropertySetDisplay({ set }: { set: PropertySet }) {
  const required = SET_REQUIREMENTS[set.color] || 3;

  return (
    <div className={`p-2 rounded-lg ${set.isComplete ? "ring-2 ring-success" : ""}`}
         style={{ backgroundColor: COLOR_MAP[set.color] + "30" }}>
      <div className="flex items-center gap-1 mb-1">
        <div className="w-4 h-4 rounded" style={{ backgroundColor: COLOR_MAP[set.color] }} />
        <span className="text-xs text-surface-200">
          {set.cards.length}/{required}
        </span>
        {set.hasHouse && <span className="text-xs">🏠</span>}
        {set.hasHotel && <span className="text-xs">🏨</span>}
      </div>
      <div className="flex flex-wrap gap-0.5">
        {set.cards.map(card => (
          <div key={card.id} className="text-xs text-surface-300 truncate max-w-16">
            {card.name.split(" ")[0]}
          </div>
        ))}
      </div>
    </div>
  );
}

function CardDisplay({ card }: { card: MonopolyDealCard }) {
  const getCardStyle = () => {
    if (card.cardType === "money") {
      return "bg-gradient-to-br from-green-600 to-green-800 text-white";
    }
    if (card.cardType === "property") {
      return "text-white";
    }
    if (card.cardType === "wildcard") {
      return "bg-gradient-to-br from-purple-600 to-pink-600 text-white";
    }
    if (card.cardType === "action") {
      return "bg-gradient-to-br from-amber-500 to-orange-600 text-white";
    }
    if (card.cardType === "rent") {
      return "bg-gradient-to-br from-red-500 to-rose-600 text-white";
    }
    return "bg-surface-700 text-white";
  };

  const bgColor = card.cardType === "property" ? COLOR_MAP[card.color || "brown"] : undefined;

  return (
    <div
      className={`w-16 h-24 rounded-lg p-1 flex flex-col shadow-lg ${getCardStyle()}`}
      style={bgColor ? { backgroundColor: bgColor } : undefined}
    >
      <div className="text-[10px] font-bold">${card.value}M</div>
      <div className="flex-1 flex items-center justify-center">
        <span className="text-[9px] text-center leading-tight">
          {card.name.length > 15 ? card.name.slice(0, 15) + "..." : card.name}
        </span>
      </div>
      <div className="text-[8px] opacity-70 capitalize text-center">
        {card.cardType}
      </div>
    </div>
  );
}

function CardMini({ card }: { card: MonopolyDealCard }) {
  const bgColor = card.cardType === "property" ? COLOR_MAP[card.color || "brown"] : 
                  card.cardType === "money" ? "#22c55e" :
                  card.cardType === "action" ? "#f59e0b" : "#8b5cf6";

  return (
    <div
      className="w-full h-full rounded-lg flex items-center justify-center text-white text-xs font-medium p-2 text-center"
      style={{ backgroundColor: bgColor }}
    >
      {card.name.length > 12 ? card.name.slice(0, 12) + "..." : card.name}
    </div>
  );
}
