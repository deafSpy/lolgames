"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface CatanTile {
  q: number;
  r: number;
  tileType: string;
  number: number;
  hasRobber: boolean;
}

interface CatanVertex {
  id: string;
  building: string;
  playerId: string;
}

interface CatanEdge {
  id: string;
  hasRoad: boolean;
  playerId: string;
}

interface CatanPlayer {
  id: string;
  displayName: string;
  isReady: boolean;
  isConnected: boolean;
  joinedAt: number;
  isBot: boolean;
  isSpectator: boolean;
  wasInitialPlayer: boolean;
  wood: number;
  brick: number;
  wheat: number;
  sheep: number;
  ore: number;
  points: number;
}

interface CatanBoardProps {
  tiles: CatanTile[];
  vertices: Map<string, CatanVertex>;
  edges: Map<string, CatanEdge>;
  players: Map<string, CatanPlayer>;
  currentTurnId: string;
  playerId: string;
  phase: string;
  lastDiceRoll: number;
  isMyTurn: boolean;
  onAction: (action: string, data: Record<string, unknown>) => void;
}

const TILE_COLORS: Record<string, string> = {
  wood: "#2d5a27",
  brick: "#b35636",
  wheat: "#e6c35c",
  sheep: "#90be6d",
  ore: "#6b7280",
  desert: "#d4a76a",
};

const TILE_ICONS: Record<string, string> = {
  wood: "🌲",
  brick: "🧱",
  wheat: "🌾",
  sheep: "🐑",
  ore: "⛏️",
  desert: "🏜️",
};

const RESOURCE_ICONS: Record<string, string> = {
  wood: "🌲",
  brick: "🧱",
  wheat: "🌾",
  sheep: "🐑",
  ore: "⛏️",
};

const RESOURCES = ["wood", "brick", "wheat", "sheep", "ore"] as const;
type ResourceType = (typeof RESOURCES)[number];

const HEX_SIZE = 50;

interface FlyingCardState {
  id: string;
  resource: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  delay: number;
}

interface ResourceSnapshot {
  wood: number;
  brick: number;
  wheat: number;
  sheep: number;
  ore: number;
}

function hexToPixel(q: number, r: number): { x: number; y: number } {
  const x = HEX_SIZE * ((3 / 2) * q);
  const y = HEX_SIZE * ((Math.sqrt(3) / 2) * q + Math.sqrt(3) * r);
  return { x: x + 250, y: y + 200 };
}

function getHexPoints(cx: number, cy: number): string {
  const points: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i;
    const x = cx + HEX_SIZE * Math.cos(angle);
    const y = cy + HEX_SIZE * Math.sin(angle);
    points.push(`${x},${y}`);
  }
  return points.join(" ");
}

function FlyingCard({
  card,
  onComplete,
}: {
  card: FlyingCardState;
  onComplete: (id: string) => void;
}) {
  return (
    <motion.div
      initial={{ x: card.fromX - 12, y: card.fromY - 12, opacity: 1, scale: 1.4 }}
      animate={{ x: card.toX - 12, y: card.toY - 12, opacity: 0, scale: 0.6 }}
      transition={{ duration: 0.55, delay: card.delay, ease: "easeInOut" }}
      onAnimationComplete={() => onComplete(card.id)}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        zIndex: 9999,
        pointerEvents: "none",
        fontSize: "22px",
        width: "24px",
        height: "24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        lineHeight: 1,
      }}
    >
      {RESOURCE_ICONS[card.resource]}
    </motion.div>
  );
}

export function CatanBoard({
  tiles,
  vertices,
  edges,
  players,
  currentTurnId,
  playerId,
  phase,
  lastDiceRoll,
  isMyTurn,
  onAction,
}: CatanBoardProps) {
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [tradeOffer, setTradeOffer] = useState<{ give: string; receive: string } | null>(null);
  const [flyingCards, setFlyingCards] = useState<FlyingCardState[]>([]);

  const bankRef = useRef<HTMLDivElement>(null);
  const resourceRefs = useRef<Map<ResourceType, HTMLDivElement>>(new Map());
  const prevResourcesRef = useRef<ResourceSnapshot | null>(null);

  const myPlayer = Array.from(players.values()).find((p) => p.id === playerId);
  const playerArray = Array.from(players.values());

  // Detect resource changes and queue flying card animations
  useEffect(() => {
    if (!myPlayer) {
      prevResourcesRef.current = null;
      return;
    }

    const curr: ResourceSnapshot = {
      wood: myPlayer.wood,
      brick: myPlayer.brick,
      wheat: myPlayer.wheat,
      sheep: myPlayer.sheep,
      ore: myPlayer.ore,
    };

    const prev = prevResourcesRef.current;

    if (prev) {
      const newCards: FlyingCardState[] = [];
      let delayCounter = 0;

      for (const resource of RESOURCES) {
        const diff = curr[resource] - prev[resource];
        if (diff === 0) continue;

        const bankEl = bankRef.current;
        const resourceEl = resourceRefs.current.get(resource);
        if (!bankEl || !resourceEl) continue;

        const bankRect = bankEl.getBoundingClientRect();
        const resourceRect = resourceEl.getBoundingClientRect();

        const bankCenter = {
          x: bankRect.left + bankRect.width / 2,
          y: bankRect.top + bankRect.height / 2,
        };
        const resourceCenter = {
          x: resourceRect.left + resourceRect.width / 2,
          y: resourceRect.top + resourceRect.height / 2,
        };

        const isGain = diff > 0;
        const count = Math.min(Math.abs(diff), 5);

        for (let i = 0; i < count; i++) {
          newCards.push({
            id: `card-${Date.now()}-${resource}-${i}-${Math.random().toString(36).slice(2)}`,
            resource,
            fromX: isGain ? bankCenter.x : resourceCenter.x,
            fromY: isGain ? bankCenter.y : resourceCenter.y,
            toX: isGain ? resourceCenter.x : bankCenter.x,
            toY: isGain ? resourceCenter.y : bankCenter.y,
            delay: delayCounter++ * 0.08,
          });
        }
      }

      if (newCards.length > 0) {
        setFlyingCards((existing) => [...existing, ...newCards]);
      }
    }

    prevResourcesRef.current = curr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myPlayer?.wood, myPlayer?.brick, myPlayer?.wheat, myPlayer?.sheep, myPlayer?.ore]);

  const removeFlyingCard = useCallback((id: string) => {
    setFlyingCards((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const setResourceRef = useCallback(
    (resource: ResourceType) => (el: HTMLDivElement | null) => {
      if (el) resourceRefs.current.set(resource, el);
      else resourceRefs.current.delete(resource);
    },
    []
  );

  const handleRoll = useCallback(() => {
    onAction("roll", {});
  }, [onAction]);

  const handleEndTrade = useCallback(() => {
    onAction("end_trade", {});
  }, [onAction]);

  const handleEndTurn = useCallback(() => {
    onAction("end_turn", {});
  }, [onAction]);

  const handleBankTrade = useCallback(() => {
    if (tradeOffer?.give && tradeOffer?.receive) {
      onAction("bank_trade", {
        give: tradeOffer.give,
        giveAmount: 4,
        receive: tradeOffer.receive,
      });
      setTradeOffer(null);
    }
  }, [onAction, tradeOffer]);

  const handleVertexClick = useCallback(
    (vertexId: string) => {
      if (selectedAction === "settlement") {
        onAction("settlement", { vertexId });
        setSelectedAction(null);
      } else if (selectedAction === "city") {
        onAction("city", { vertexId });
        setSelectedAction(null);
      }
    },
    [onAction, selectedAction]
  );

  const handleEdgeClick = useCallback(
    (edgeId: string) => {
      if (selectedAction === "road") {
        onAction("road", { edgeId });
        setSelectedAction(null);
      }
    },
    [onAction, selectedAction]
  );

  const handleTileClick = useCallback(
    (q: number, r: number) => {
      if (phase === "robber") {
        onAction("move_robber", { q, r });
      }
    },
    [onAction, phase]
  );

  return (
    <div className="flex flex-col items-center">
      {/* Flying Cards Overlay */}
      <AnimatePresence>
        {flyingCards.map((card) => (
          <FlyingCard key={card.id} card={card} onComplete={removeFlyingCard} />
        ))}
      </AnimatePresence>

      {/* Phase & Turn Info */}
      <div className="mb-4 text-center">
        <div className="text-lg font-medium mb-1">
          {isMyTurn ? (
            <span className="text-success">Your turn!</span>
          ) : (
            <span className="text-surface-400">
              Waiting for{" "}
              {playerArray.find((p) => p.id === currentTurnId)?.displayName || "opponent"}...
            </span>
          )}
        </div>
        <div className="text-sm text-surface-500">
          Phase: <span className="text-primary-400 capitalize">{phase}</span>
          {lastDiceRoll > 0 && (
            <span className="ml-3">
              Last Roll: <span className="text-warning">{lastDiceRoll}</span>
            </span>
          )}
        </div>
      </div>

      {/* Game Board */}
      <div className="bg-blue-900/50 p-4 rounded-2xl shadow-lg mb-4">
        <svg width="500" height="400" className="overflow-visible">
          {/* Render tiles */}
          {tiles.map((tile) => {
            const { x, y } = hexToPixel(tile.q, tile.r);
            return (
              <g key={`tile-${tile.q}-${tile.r}`}>
                <polygon
                  points={getHexPoints(x, y)}
                  fill={TILE_COLORS[tile.tileType] || "#888"}
                  stroke="#4a3728"
                  strokeWidth="2"
                  onClick={() => phase === "robber" && handleTileClick(tile.q, tile.r)}
                  className={
                    phase === "robber" && isMyTurn ? "cursor-pointer hover:opacity-80" : ""
                  }
                />
                <text x={x} y={y - 10} textAnchor="middle" className="text-2xl select-none">
                  {TILE_ICONS[tile.tileType]}
                </text>
                {tile.number > 0 && (
                  <g>
                    <circle
                      cx={x}
                      cy={y + 15}
                      r="14"
                      fill="#f5f5dc"
                      stroke="#333"
                      strokeWidth="1"
                    />
                    <text
                      x={x}
                      y={y + 20}
                      textAnchor="middle"
                      fill={tile.number === 6 || tile.number === 8 ? "#dc2626" : "#333"}
                      className="text-sm font-bold select-none"
                    >
                      {tile.number}
                    </text>
                  </g>
                )}
                {tile.hasRobber && (
                  <text x={x} y={y + 35} textAnchor="middle" className="text-xl select-none">
                    🥷
                  </text>
                )}
              </g>
            );
          })}

          {/* Render vertices (settlement spots) */}
          {Array.from(vertices.entries()).map(([id, vertex]) => {
            const parts = id.split(",");
            const q = parseInt(parts[0]);
            const r = parseInt(parts[1]);
            const { x, y } = hexToPixel(q, r);
            const dir = parts[2];
            let vx = x,
              vy = y;
            if (dir === "N") vy -= HEX_SIZE;
            else if (dir === "S") vy += HEX_SIZE;
            else if (dir === "NE") {
              vx += HEX_SIZE * 0.75;
              vy -= HEX_SIZE * 0.5;
            } else if (dir === "SE") {
              vx += HEX_SIZE * 0.75;
              vy += HEX_SIZE * 0.5;
            } else if (dir === "NW") {
              vx -= HEX_SIZE * 0.75;
              vy -= HEX_SIZE * 0.5;
            } else if (dir === "SW") {
              vx -= HEX_SIZE * 0.75;
              vy += HEX_SIZE * 0.5;
            }

            const isSelectable =
              isMyTurn &&
              (selectedAction === "settlement" || selectedAction === "city") &&
              !vertex.building;

            return (
              <g key={id}>
                {vertex.building ? (
                  <g>
                    <circle
                      cx={vx}
                      cy={vy}
                      r="8"
                      fill={vertex.playerId === playerId ? "#3b82f6" : "#ef4444"}
                      stroke="#fff"
                      strokeWidth="2"
                    />
                    <text
                      x={vx}
                      y={vy + 4}
                      textAnchor="middle"
                      className="text-xs select-none"
                      fill="white"
                    >
                      {vertex.building === "city" ? "C" : "S"}
                    </text>
                  </g>
                ) : isSelectable ? (
                  <circle
                    cx={vx}
                    cy={vy}
                    r="6"
                    fill="#22c55e"
                    fillOpacity="0.5"
                    stroke="#22c55e"
                    strokeWidth="2"
                    className="cursor-pointer hover:fill-opacity-100"
                    onClick={() => handleVertexClick(id)}
                  />
                ) : null}
              </g>
            );
          })}

          {/* Render edges (road spots) */}
          {Array.from(edges.entries()).map(([id, edge]) => {
            if (!edge.hasRoad && !(isMyTurn && selectedAction === "road")) return null;

            const parts = id.split(",");
            const q = parseInt(parts[0]);
            const r = parseInt(parts[1]);
            const { x, y } = hexToPixel(q, r);
            const dir = parts[2];

            let ex = x,
              ey = y;
            let rotation = 0;
            if (dir === "N") {
              ey -= HEX_SIZE * 0.87;
              rotation = 0;
            } else if (dir === "NE") {
              ex += HEX_SIZE * 0.75;
              ey -= HEX_SIZE * 0.43;
              rotation = 60;
            } else if (dir === "E") {
              ex += HEX_SIZE;
              rotation = 90;
            } else if (dir === "SE") {
              ex += HEX_SIZE * 0.75;
              ey += HEX_SIZE * 0.43;
              rotation = 120;
            } else if (dir === "S") {
              ey += HEX_SIZE * 0.87;
              rotation = 0;
            } else if (dir === "SW") {
              ex -= HEX_SIZE * 0.75;
              ey += HEX_SIZE * 0.43;
              rotation = -60;
            }

            if (edge.hasRoad) {
              return (
                <rect
                  key={id}
                  x={ex - 15}
                  y={ey - 3}
                  width="30"
                  height="6"
                  fill={edge.playerId === playerId ? "#3b82f6" : "#ef4444"}
                  stroke="#fff"
                  strokeWidth="1"
                  transform={`rotate(${rotation}, ${ex}, ${ey})`}
                />
              );
            } else if (isMyTurn && selectedAction === "road") {
              return (
                <rect
                  key={id}
                  x={ex - 15}
                  y={ey - 3}
                  width="30"
                  height="6"
                  fill="#22c55e"
                  fillOpacity="0.3"
                  stroke="#22c55e"
                  strokeWidth="1"
                  transform={`rotate(${rotation}, ${ex}, ${ey})`}
                  className="cursor-pointer hover:fill-opacity-70"
                  onClick={() => handleEdgeClick(id)}
                />
              );
            }
            return null;
          })}
        </svg>
      </div>

      {/* Player Resources */}
      {myPlayer && (
        <div className="bg-surface-800 rounded-xl p-4 mb-4 w-full max-w-md">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-sm font-medium text-surface-400">Your Resources</h3>
            <div
              ref={bankRef}
              className="flex items-center gap-1 px-2 py-0.5 bg-surface-700 rounded-full text-xs text-surface-400"
            >
              <span>🏦</span>
              <span>Bank</span>
            </div>
          </div>
          <div className="flex justify-around text-center">
            {RESOURCES.map((resource) => (
              <ResourceDisplay
                key={resource}
                icon={RESOURCE_ICONS[resource]}
                count={myPlayer[resource]}
                label={resource.charAt(0).toUpperCase() + resource.slice(1)}
                divRef={setResourceRef(resource)}
              />
            ))}
          </div>
          <div className="mt-2 text-center text-sm">
            <span className="text-primary-400 font-medium">Points: {myPlayer.points}</span>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      {isMyTurn && (
        <div className="flex flex-wrap gap-2 justify-center">
          {phase === "roll" && <ActionButton onClick={handleRoll}>🎲 Roll Dice</ActionButton>}
          {phase === "trade" && (
            <>
              <div className="flex gap-2 items-center">
                <select
                  className="bg-surface-700 rounded px-2 py-1 text-sm"
                  value={tradeOffer?.give || ""}
                  onChange={(e) => setTradeOffer((t) => ({ ...t!, give: e.target.value }))}
                >
                  <option value="">Give 4...</option>
                  <option value="wood">Wood</option>
                  <option value="brick">Brick</option>
                  <option value="wheat">Wheat</option>
                  <option value="sheep">Sheep</option>
                  <option value="ore">Ore</option>
                </select>
                <span className="text-surface-400">→</span>
                <select
                  className="bg-surface-700 rounded px-2 py-1 text-sm"
                  value={tradeOffer?.receive || ""}
                  onChange={(e) => setTradeOffer((t) => ({ ...t!, receive: e.target.value }))}
                >
                  <option value="">Get 1...</option>
                  <option value="wood">Wood</option>
                  <option value="brick">Brick</option>
                  <option value="wheat">Wheat</option>
                  <option value="sheep">Sheep</option>
                  <option value="ore">Ore</option>
                </select>
                <ActionButton
                  onClick={handleBankTrade}
                  disabled={!tradeOffer?.give || !tradeOffer?.receive}
                >
                  Trade
                </ActionButton>
              </div>
              <ActionButton onClick={handleEndTrade}>Done Trading</ActionButton>
            </>
          )}
          {phase === "build" && (
            <>
              <ActionButton
                onClick={() => setSelectedAction(selectedAction === "road" ? null : "road")}
                active={selectedAction === "road"}
              >
                🛤️ Build Road
              </ActionButton>
              <ActionButton
                onClick={() =>
                  setSelectedAction(selectedAction === "settlement" ? null : "settlement")
                }
                active={selectedAction === "settlement"}
              >
                🏠 Settlement
              </ActionButton>
              <ActionButton
                onClick={() => setSelectedAction(selectedAction === "city" ? null : "city")}
                active={selectedAction === "city"}
              >
                🏰 City
              </ActionButton>
              <ActionButton onClick={handleEndTurn}>End Turn</ActionButton>
            </>
          )}
          {phase === "robber" && <p className="text-warning">Click a hex to move the robber</p>}
        </div>
      )}

      {/* Build Costs Reference */}
      <div className="mt-4 text-xs text-surface-500 text-center">
        <p>Road: 🌲+🧱 | Settlement: 🌲+🧱+🌾+🐑 | City: 2🌾+3⛏️</p>
      </div>
    </div>
  );
}

function ResourceDisplay({
  icon,
  count,
  label,
  divRef,
}: {
  icon: string;
  count: number;
  label: string;
  divRef?: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div ref={divRef} className="flex flex-col items-center">
      <span className="text-xl">{icon}</span>
      <span className="text-lg font-bold">{count}</span>
      <span className="text-xs text-surface-500">{label}</span>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled = false,
  active = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <motion.button
      whileHover={{ scale: disabled ? 1 : 1.05 }}
      whileTap={{ scale: disabled ? 1 : 0.95 }}
      onClick={onClick}
      disabled={disabled}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
        active
          ? "bg-primary-500 text-white"
          : disabled
            ? "bg-surface-700 text-surface-500 cursor-not-allowed"
            : "bg-surface-700 text-surface-200 hover:bg-surface-600"
      }`}
    >
      {children}
    </motion.button>
  );
}
