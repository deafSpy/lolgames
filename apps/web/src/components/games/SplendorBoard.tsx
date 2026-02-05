"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";

interface SplendorCard {
  id: string;
  tier: number;
  gemType: string;
  points: number;
  costWhite: number;
  costBlue: number;
  costGreen: number;
  costRed: number;
  costBlack: number;
}

interface SplendorNoble {
  id: string;
  points: number;
  reqWhite: number;
  reqBlue: number;
  reqGreen: number;
  reqRed: number;
  reqBlack: number;
}

interface SplendorPlayer {
  id: string;
  displayName: string;
  isReady: boolean;
  isConnected: boolean;
  joinedAt: number;
  isBot: boolean;
  isSpectator: boolean;
  wasInitialPlayer: boolean;
  gemWhite: number;
  gemBlue: number;
  gemGreen: number;
  gemRed: number;
  gemBlack: number;
  gemGold: number;
  cards: SplendorCard[];
  reserved: SplendorCard[];
  nobles: SplendorNoble[];
  points: number;
}

interface Bank {
  white: number;
  blue: number;
  green: number;
  red: number;
  black: number;
  gold: number;
}

interface SplendorBoardProps {
  bank: Bank;
  tier1Cards: SplendorCard[];
  tier2Cards: SplendorCard[];
  tier3Cards: SplendorCard[];
  nobles: SplendorNoble[];
  players: Map<string, SplendorPlayer>;
  currentTurnId: string;
  playerId: string;
  phase: string;
  isMyTurn: boolean;
  onAction: (action: string, data: Record<string, unknown>) => void;
}

const GEM_COLORS: Record<string, string> = {
  white: "#e5e7eb",
  blue: "#3b82f6",
  green: "#22c55e",
  red: "#ef4444",
  black: "#374151",
  gold: "#eab308",
};

const GEM_ICONS: Record<string, string> = {
  white: "💎",
  blue: "💙",
  green: "💚",
  red: "❤️",
  black: "🖤",
  gold: "⭐",
};

type GemType = "white" | "blue" | "green" | "red" | "black";

export function SplendorBoard({
  bank,
  tier1Cards,
  tier2Cards,
  tier3Cards,
  nobles,
  players,
  currentTurnId,
  playerId,
  phase,
  isMyTurn,
  onAction,
}: SplendorBoardProps) {
  const [selectedPreviewGems, setSelectedPreviewGems] = useState<Partial<Record<GemType, number>>>({});
  const [discardGems, setDiscardGems] = useState<Partial<Record<GemType | "gold", number>>>({});

  const myPlayer = Array.from(players.values()).find(p => p.id === playerId);
  const playerArray = Array.from(players.values());
  const otherPlayers = playerArray.filter(p => p.id !== playerId);

  const canTakeGems = () => {
    const total = Object.values(selectedPreviewGems).reduce((sum, n) => sum + (n || 0), 0);
    const distinct = Object.keys(selectedPreviewGems).filter(k => (selectedPreviewGems[k as GemType] || 0) > 0).length;
    
    if (total === 0) return false;
    // 3 different gems (1 each)
    if (distinct === 3 && total === 3) return true;
    // 2 of same gem (only if bank had 4+)
    if (distinct === 1 && total === 2) {
      const gem = Object.keys(selectedPreviewGems)[0] as GemType;
      return bank[gem] >= 4;
    }
    // 2 different gems (1 each) - end game scenario
    if (distinct === 2 && total === 2) return true;
    // 1 gem only - end game scenario
    if (distinct === 1 && total === 1) return true;
    return false;
  };

  const handleBankGemClick = useCallback((gem: GemType) => {
    if (!isMyTurn || phase !== "take_gems") return;

    setSelectedPreviewGems(prev => {
      const current = prev[gem] || 0;
      const otherGems = Object.keys(prev).filter(k => k !== gem && (prev[k as GemType] || 0) > 0);
      const total = Object.values(prev).reduce((sum, n) => sum + (n || 0), 0);
      
      // If clicking on already selected gem, check if we can add a second one
      if (current === 1) {
        // Can only take 2 of same if bank has 4+ AND no other gems selected
        if (bank[gem] >= 4 && otherGems.length === 0) {
          return { [gem]: 2 };
        }
        // Otherwise, remove it
        const newPrev = { ...prev };
        delete newPrev[gem];
        return newPrev;
      }
      
      // If clicking on gem with 2 selected, remove it
      if (current === 2) {
        return {};
      }
      
      // Adding a new gem
      // Can't add if already have 3 gems total
      if (total >= 3) return prev;
      
      // Can't add if already have 2 of another gem
      if (otherGems.some(g => (prev[g as GemType] || 0) === 2)) return prev;
      
      // Can only take if bank has it
      if (bank[gem] > 0) {
        return { ...prev, [gem]: 1 };
      }
      
      return prev;
    });
  }, [isMyTurn, phase, bank]);

  const handleConfirmGems = useCallback(() => {
    if (!canTakeGems()) return;
    
    const gemsToTake: Partial<Record<GemType, number>> = {};
    Object.entries(selectedPreviewGems).forEach(([gem, count]) => {
      if (count && count > 0) {
        gemsToTake[gem as GemType] = count;
      }
    });

    onAction("take_gems", { gems: gemsToTake });
    setSelectedPreviewGems({});
  }, [selectedPreviewGems, onAction, canTakeGems]);

  const handleBuyCard = useCallback((cardId: string) => {
    onAction("buy_card", { cardId });
  }, [onAction]);

  const handleReserveCard = useCallback((cardId: string, tier: number) => {
    onAction("reserve_card", { cardId, tier, fromDeck: false });
  }, [onAction]);

  const handleReserveFromDeck = useCallback((tier: number) => {
    onAction("reserve_card", { cardId: "", tier, fromDeck: true });
  }, [onAction]);

  const handleDiscardChange = useCallback((gem: GemType | "gold", delta: number) => {
    setDiscardGems(prev => {
      const current = prev[gem] || 0;
      const newVal = Math.max(0, current + delta);
      const maxVal = gem === "gold" ? (myPlayer?.gemGold || 0) : (myPlayer?.[`gem${gem.charAt(0).toUpperCase()}${gem.slice(1)}` as keyof SplendorPlayer] as number || 0);
      return { ...prev, [gem]: Math.min(newVal, maxVal) };
    });
  }, [myPlayer]);

  const handleDiscardGems = useCallback(() => {
    onAction("discard_gems", { gems: discardGems });
    setDiscardGems({});
  }, [onAction, discardGems]);

  const handleSelectNoble = useCallback((nobleId: string) => {
    onAction("select_noble", { nobleId });
  }, [onAction]);

  const getMyGemCount = (): number => {
    if (!myPlayer) return 0;
    return myPlayer.gemWhite + myPlayer.gemBlue + myPlayer.gemGreen + 
           myPlayer.gemRed + myPlayer.gemBlack + myPlayer.gemGold;
  };

  const getMyCardCount = (gem: GemType): number => {
    if (!myPlayer) return 0;
    return myPlayer.cards.filter(c => c.gemType === gem).length;
  };

  const canAffordCard = (card: SplendorCard): boolean => {
    if (!myPlayer) return false;
    let goldNeeded = 0;
    
    const checkGem = (cost: number, gem: GemType) => {
      const cards = getMyCardCount(gem);
      const gems = myPlayer[`gem${gem.charAt(0).toUpperCase()}${gem.slice(1)}` as keyof SplendorPlayer] as number;
      const need = Math.max(0, cost - cards);
      if (gems < need) goldNeeded += need - gems;
    };
    
    checkGem(card.costWhite, "white");
    checkGem(card.costBlue, "blue");
    checkGem(card.costGreen, "green");
    checkGem(card.costRed, "red");
    checkGem(card.costBlack, "black");
    
    return goldNeeded <= myPlayer.gemGold;
  };

  return (
    <div className="w-full flex flex-col gap-4">
      {/* Top - Turn Info */}
      <div className="text-center">
        <div className="text-lg font-bold">
          {isMyTurn ? (
            <span className="text-success">Your Turn!</span>
          ) : (
            <span className="text-surface-400">
              {playerArray.find(p => p.id === currentTurnId)?.displayName || "Opponent"}'s Turn
            </span>
          )}
        </div>
        <div className="text-sm text-surface-500 capitalize">Phase: {phase.replace("_", " ")}</div>
      </div>

      {/* Main Content - Sidebar + Board */}
      <div className="flex gap-4 w-full">
        {/* Left Sidebar */}
        <div className="w-80 flex flex-col gap-3">
          {/* My Hand */}
          {myPlayer && (
            <div className="bg-surface-800 rounded-xl p-3">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-sm font-bold text-primary-400">You</h3>
                <span className="text-lg font-bold text-yellow-400">{myPlayer.points}pts</span>
              </div>
              
              {/* My Gems */}
              <div className="grid grid-cols-3 gap-2 mb-3">
                {(["white", "blue", "green", "red", "black", "gold"] as const).map(gem => (
                  <div key={gem} className="text-center">
                    <div
                      className="w-full h-10 rounded-lg flex items-center justify-center text-sm font-bold"
                      style={{ backgroundColor: GEM_COLORS[gem] }}
                    >
                      <span className="text-black drop-shadow-lg font-bold text-lg">{myPlayer[`gem${gem.charAt(0).toUpperCase()}${gem.slice(1)}` as keyof SplendorPlayer] as number}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* My Owned Cards */}
              <div className="mb-3">
                <div className="text-xs font-semibold text-surface-400 mb-1">Cards</div>
                <div className="flex gap-1 flex-wrap">
                  {(["white", "blue", "green", "red", "black"] as const).map(gem => {
                    const count = getMyCardCount(gem);
                    return count > 0 ? (
                      <div
                        key={gem}
                        className="px-1.5 py-0.5 rounded text-xs font-bold"
                        style={{ backgroundColor: GEM_COLORS[gem] + "40", color: GEM_COLORS[gem], border: `1px solid ${GEM_COLORS[gem]}` }}
                      >
                        {count}
                      </div>
                    ) : null;
                  })}
                </div>
              </div>

              {/* Reserved Cards */}
              {myPlayer.reserved.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-surface-400 mb-1">Reserved ({myPlayer.reserved.length}/3)</div>
                  <div className="flex gap-1 flex-wrap">
                    {myPlayer.reserved.map(card => (
                      <CardDisplay
                        key={card.id}
                        card={card}
                        canBuy={isMyTurn && canAffordCard(card)}
                        onBuy={() => handleBuyCard(card.id)}
                        isMyTurn={isMyTurn}
                        tiny
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Other Players */}
          {otherPlayers.map(player => (
            <div key={player.id} className="bg-surface-800/70 rounded-xl p-3">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-sm font-bold text-surface-300 truncate">{player.displayName}</h3>
                <span className="text-lg font-bold text-yellow-400">{player.points}pts</span>
              </div>
              
              {/* Player Gems */}
              <div className="grid grid-cols-3 gap-1 mb-2">
                {(["white", "blue", "green", "red", "black", "gold"] as const).map(gem => {
                  const count = player[`gem${gem.charAt(0).toUpperCase()}${gem.slice(1)}` as keyof SplendorPlayer] as number;
                  return count > 0 ? (
                    <div
                      key={gem}
                      className="h-8 rounded-lg flex items-center justify-center text-xs font-bold"
                      style={{ backgroundColor: GEM_COLORS[gem] }}
                    >
                      <span className="text-black drop-shadow-lg font-bold text-lg">{count}</span>
                    </div>
                  ) : (
                    <div key={gem} className="h-8 rounded-lg bg-surface-700/50"></div>
                  );
                })}
              </div>

              {/* Player Owned Cards */}
              <div className="text-xs font-semibold text-surface-400 mb-1">Cards</div>
              <div className="flex gap-1 flex-wrap">
                {(["white", "blue", "green", "red", "black"] as const).map(gem => {
                  const count = player.cards.filter(c => c.gemType === gem).length;
                  return count > 0 ? (
                    <div
                      key={gem}
                      className="px-1.5 py-0.5 rounded text-xs font-bold"
                      style={{ backgroundColor: GEM_COLORS[gem] + "40", color: GEM_COLORS[gem], border: `1px solid ${GEM_COLORS[gem]}` }}
                    >
                      {count}
                    </div>
                  ) : null;
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Right - Main Board */}
        <div className="flex-1 flex flex-col gap-4">
          {/* Nobles */}
          <div className="bg-surface-800/30 rounded-xl p-3">
            <h3 className="text-xs font-bold text-surface-400 mb-2">NOBLES ({nobles?.length || 0})</h3>
            <div className="flex gap-2 flex-wrap justify-center">
              {nobles && nobles.length > 0 ? (
                nobles.map(noble => (
                  <motion.div
                    key={noble.id}
                    whileHover={{ scale: 1.05 }}
                    onClick={() => phase === "select_noble" && isMyTurn && handleSelectNoble(noble.id)}
                    className={`w-16 h-20 bg-purple-900/60 rounded-lg border-2 border-purple-500 flex flex-col items-center justify-center text-xs cursor-pointer p-1 ${
                      phase === "select_noble" && isMyTurn ? "hover:bg-purple-800" : ""
                    }`}
                  >
                    <span className="text-sm mb-0.5">👑</span>
                    <span className="font-black text-yellow-400 text-2xl leading-none">{noble.points}</span>
                    <div className="text-[11px] mt-1 flex gap-0.5 flex-wrap justify-center font-bold">
                      {noble.reqWhite > 0 && <span style={{ color: GEM_COLORS.white, textShadow: "1px 1px 1px black, -1px -1px 1px black, 1px -1px 1px black, -1px 1px 1px black" }}>W{noble.reqWhite}</span>}
                      {noble.reqBlue > 0 && <span style={{ color: GEM_COLORS.blue, textShadow: "1px 1px 1px black, -1px -1px 1px black, 1px -1px 1px black, -1px 1px 1px black" }}>B{noble.reqBlue}</span>}
                      {noble.reqGreen > 0 && <span style={{ color: GEM_COLORS.green, textShadow: "1px 1px 1px black, -1px -1px 1px black, 1px -1px 1px black, -1px 1px 1px black" }}>G{noble.reqGreen}</span>}
                      {noble.reqRed > 0 && <span style={{ color: GEM_COLORS.red, textShadow: "1px 1px 1px black, -1px -1px 1px black, 1px -1px 1px black, -1px 1px 1px black" }}>R{noble.reqRed}</span>}
                      {noble.reqBlack > 0 && <span style={{ color: "#1f2937", textShadow: "1px 1px 1px black, -1px -1px 1px black, 1px -1px 1px black, -1px 1px 1px black", fontWeight: "900" }}>K{noble.reqBlack}</span>}
                    </div>
                  </motion.div>
                ))
              ) : (
                <span className="text-surface-500 text-xs">No nobles available</span>
              )}
            </div>
          </div>

          {/* Card Tiers */}
          <div className="space-y-2">
            {/* Tier 3 */}
            <div className="flex gap-2 overflow-x-auto">
              {tier3Cards.length === 0 && (
                <DeckPlaceholder tier={3} onClick={() => isMyTurn && handleReserveFromDeck(3)} />
              )}
              {tier3Cards.map(card => (
                <CardDisplay
                  key={card.id}
                  card={card}
                  canBuy={isMyTurn && canAffordCard(card)}
                  onBuy={() => handleBuyCard(card.id)}
                  onReserve={() => handleReserveCard(card.id, 3)}
                  isMyTurn={isMyTurn}
                />
              ))}
            </div>
            {/* Tier 2 */}
            <div className="flex gap-2 overflow-x-auto">
              {tier2Cards.length === 0 && (
                <DeckPlaceholder tier={2} onClick={() => isMyTurn && handleReserveFromDeck(2)} />
              )}
              {tier2Cards.map(card => (
                <CardDisplay
                  key={card.id}
                  card={card}
                  canBuy={isMyTurn && canAffordCard(card)}
                  onBuy={() => handleBuyCard(card.id)}
                  onReserve={() => handleReserveCard(card.id, 2)}
                  isMyTurn={isMyTurn}
                />
              ))}
            </div>
            {/* Tier 1 */}
            <div className="flex gap-2 overflow-x-auto">
              {tier1Cards.length === 0 && (
                <DeckPlaceholder tier={1} onClick={() => isMyTurn && handleReserveFromDeck(1)} />
              )}
              {tier1Cards.map(card => (
                <CardDisplay
                  key={card.id}
                  card={card}
                  canBuy={isMyTurn && canAffordCard(card)}
                  onBuy={() => handleBuyCard(card.id)}
                  onReserve={() => handleReserveCard(card.id, 1)}
                  isMyTurn={isMyTurn}
                />
              ))}
            </div>
          </div>

          {/* Gem Bank & Selection */}
          <div className="flex gap-4">
            {/* Bank */}
            <div className="bg-surface-800 rounded-xl p-3 flex-1">
              <h3 className="text-xs font-bold text-surface-400 text-center mb-2">BANK</h3>
              <div className="grid grid-cols-3 gap-2">
                {(["white", "blue", "green", "red", "black", "gold"] as const).map(gem => (
                  <motion.div
                    key={gem}
                    whileHover={gem !== "gold" && isMyTurn && phase === "take_gems" ? { scale: 1.05 } : {}}
                    onClick={() => gem !== "gold" && handleBankGemClick(gem)}
                    className={`h-12 rounded-lg flex items-center justify-center cursor-pointer relative ${
                      selectedPreviewGems[gem as GemType] ? "ring-2 ring-primary-500" : ""
                    }`}
                    style={{ 
                      backgroundColor: gem !== "gold" && isMyTurn && phase === "take_gems" ? GEM_COLORS[gem] + "80" : GEM_COLORS[gem] + "50"
                    }}
                  >
                    <span className="text-xl font-black drop-shadow-lg text-black">{bank[gem]}</span>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Preview Selection */}
            {isMyTurn && phase === "take_gems" && Object.values(selectedPreviewGems).some(v => v) && (
              <div className="bg-primary-500/20 rounded-xl p-3 flex flex-col gap-2 border border-primary-500 min-w-max">
                <h3 className="text-xs font-bold text-center text-primary-300">PREVIEW</h3>
                <div className="flex gap-1 flex-wrap justify-center">
                  {(["white", "blue", "green", "red", "black"] as const).map(gem => {
                    const count = selectedPreviewGems[gem];
                    if (!count) return null;
                    return (
                      <motion.button
                        key={gem}
                        whileHover={{ scale: 1.1 }}
                        onClick={() => handleBankGemClick(gem)}
                        className="px-2 py-1 rounded text-xs font-bold text-white hover:opacity-80 transition-opacity"
                        style={{ backgroundColor: GEM_COLORS[gem] }}
                      >
                        {gem[0].toUpperCase()}{count > 1 ? ` ×${count}` : ''}
                      </motion.button>
                    );
                  })}
                </div>
                <button
                  onClick={handleConfirmGems}
                  disabled={!canTakeGems()}
                  className={`px-3 py-1 rounded text-sm font-bold transition-opacity ${
                    canTakeGems() ? "bg-primary-500 text-white hover:bg-primary-400" : "bg-surface-600 text-surface-400 cursor-not-allowed"
                  }`}
                >
                  Confirm
                </button>
              </div>
            )}
          </div>

          {/* Discard Phase */}
          {phase === "discard_gems" && isMyTurn && (
            <div className="bg-warning/20 rounded-xl p-4 text-center border border-warning">
              <p className="text-warning mb-3 font-bold">You have {getMyGemCount()} gems. Discard down to 10.</p>
              <div className="flex gap-2 justify-center mb-3 flex-wrap">
                {(["white", "blue", "green", "red", "black", "gold"] as const).map(gem => (
                  <div key={gem} className="flex items-center gap-2 bg-surface-800 px-3 py-2 rounded">
                    <div
                      className="w-6 h-6 rounded flex items-center justify-center text-xs font-bold"
                      style={{ backgroundColor: GEM_COLORS[gem] }}
                    >
                      <span className="text-black font-bold">{gem[0].toUpperCase()}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleDiscardChange(gem, -1)}
                        className="w-6 h-6 bg-surface-700 rounded text-xs font-bold"
                      >-</button>
                      <span className="w-6 text-center font-bold">{discardGems[gem] || 0}</span>
                      <button
                        onClick={() => handleDiscardChange(gem, 1)}
                        className="w-6 h-6 bg-surface-700 rounded text-xs font-bold"
                      >+</button>
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={handleDiscardGems}
                className="px-4 py-2 bg-warning text-black rounded font-bold hover:bg-yellow-400"
              >
                Confirm Discard
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CardDisplay({
  card,
  canBuy,
  onBuy,
  onReserve,
  isMyTurn,
  tiny = false,
}: {
  card: SplendorCard;
  canBuy: boolean;
  onBuy: () => void;
  onReserve?: () => void;
  isMyTurn: boolean;
  tiny?: boolean;
}) {
  const [showActions, setShowActions] = useState(false);
  const size = tiny ? "w-12 h-16 flex-shrink-0" : "w-24 h-32 flex-shrink-0";

  return (
    <motion.div
      className={`${size} rounded-lg relative overflow-hidden cursor-pointer`}
      style={{ backgroundColor: GEM_COLORS[card.gemType] + "30", borderColor: GEM_COLORS[card.gemType], borderWidth: 2 }}
      onMouseEnter={() => isMyTurn && setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      whileHover={{ scale: 1.05 }}
    >
      {/* Points */}
      {card.points > 0 && (
        <div className="absolute top-1 right-1 w-7 h-7 bg-yellow-400 rounded-full flex items-center justify-center text-lg font-black text-black shadow-lg">
          {card.points}
        </div>
      )}

      {/* Gem type indicator */}
      <div
        className="absolute top-1 left-1 w-4 h-4 rounded-full shadow-md"
        style={{ backgroundColor: GEM_COLORS[card.gemType] }}
      />

      {/* Cost - Horizontal Layout, MUCH BIGGER Numbers */}
      <div className={`absolute bottom-1 left-1 right-1 flex gap-0.5 flex-wrap ${tiny ? "text-[11px]" : "text-base"}`}>
        {card.costWhite > 0 && (
          <span className="font-black" style={{ 
            color: GEM_COLORS.white, 
            textShadow: "1px 1px 2px black, -1px -1px 1px black, 1px -1px 1px black, -1px 1px 1px black" 
          }}>
            {card.costWhite}
          </span>
        )}
        {card.costBlue > 0 && (
          <span className="font-black" style={{ 
            color: GEM_COLORS.blue, 
            textShadow: "1px 1px 2px black, -1px -1px 1px black, 1px -1px 1px black, -1px 1px 1px black" 
          }}>
            {card.costBlue}
          </span>
        )}
        {card.costGreen > 0 && (
          <span className="font-black" style={{ 
            color: GEM_COLORS.green, 
            textShadow: "1px 1px 2px black, -1px -1px 1px black, 1px -1px 1px black, -1px 1px 1px black" 
          }}>
            {card.costGreen}
          </span>
        )}
        {card.costRed > 0 && (
          <span className="font-black" style={{ 
            color: GEM_COLORS.red, 
            textShadow: "1px 1px 2px black, -1px -1px 1px black, 1px -1px 1px black, -1px 1px 1px black" 
          }}>
            {card.costRed}
          </span>
        )}
        {card.costBlack > 0 && (
          <span className="font-black" style={{ 
            color: "#1f2937",
            textShadow: "1px 1px 2px rgba(255,255,255,0.8), -1px -1px 1px rgba(255,255,255,0.8), 1px -1px 1px rgba(255,255,255,0.8), -1px 1px 1px rgba(255,255,255,0.8)"
          }}>
            {card.costBlack}
          </span>
        )}
      </div>

      {/* Action overlay */}
      {showActions && isMyTurn && (
        <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-1">
          <button
            onClick={onBuy}
            disabled={!canBuy}
            className={`px-2 py-0.5 rounded text-xs font-bold ${canBuy ? "bg-success text-white" : "bg-surface-600 text-surface-400"}`}
          >
            Buy
          </button>
          {onReserve && (
            <button
              onClick={onReserve}
              className="px-2 py-0.5 rounded text-xs font-bold bg-primary-500 text-white"
            >
              Reserve
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}

function DeckPlaceholder({ tier, onClick }: { tier: number; onClick?: () => void }) {
  const colors = { 1: "bg-green-900", 2: "bg-yellow-900", 3: "bg-blue-900" };
  return (
    <motion.div
      whileHover={{ scale: 1.05 }}
      onClick={onClick}
      className={`w-24 h-32 flex-shrink-0 ${colors[tier as 1 | 2 | 3]} rounded-lg flex flex-col items-center justify-center cursor-pointer border-2 border-dashed border-surface-600`}
    >
      <span className="text-3xl">🃏</span>
      <span className="text-xs text-surface-400 font-bold">Tier {tier}</span>
    </motion.div>
  );
}
