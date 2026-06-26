"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useParams, useRouter } from "next/navigation";
import SlugResolverClient from "./SlugResolverClient";

// Colyseus room IDs are short alphanumeric strings with no hyphens (e.g. "lhRbN7LVs").
// Human-readable slugs are adjective-color-noun format with 2+ hyphens (e.g. "swift-blue-fox").
// Split by "-": if there are 3+ parts it's a slug; otherwise treat as a Colyseus room ID.
function isRoomSlug(id: string): boolean {
  return id.split("-").filter((p) => p).length >= 3;
}
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Connect4Board } from "@/components/games/Connect4Board";
import { RPSGame } from "@/components/games/RPSGame";
import { QuoridorBoard } from "@/components/games/QuoridorBoard";
import { SequenceBoard } from "@/components/games/SequenceBoard";
import { CatanBoard } from "@/components/games/CatanBoard";
import { SplendorBoard } from "@/components/games/SplendorBoard";
import { MonopolyDealBoard } from "@/components/games/MonopolyDealBoard";
import { BlackjackBoard } from "@/components/games/BlackjackBoard";
import {
  PlayerInfoSkeleton,
  Connect4Skeleton,
  SplendorSkeleton,
  QuoridorSkeleton,
  RPSSkeleton,
  GenericGameSkeleton,
} from "@/components/games/SkeletonLoaders";
import { useGameStore } from "@/stores/gameStore";
import { useAuthStore } from "@/stores/authStore";
import {
  getSession,
  joinById,
  reconnect,
  clearSession,
  saveSession,
  getBrowserSessionId,
  lookupRoomBySlug,
  saveReconnectToken,
  getReconnectToken,
  clearReconnectToken,
  getAvailableRooms,
} from "@/lib/colyseus";
import { GameType, RPSChoice } from "@multiplayer/shared";
import type { Room } from "colyseus.js";
import type { Schema } from "@colyseus/schema";

interface PlayerInfo {
  id: string;
  displayName: string;
  isReady: boolean;
  isBot: boolean;
  isSpectator: boolean;
  wasInitialPlayer: boolean;
  isConnected: boolean;
  isHost?: boolean;
  wallsRemaining?: number;
  x?: number;
  y?: number;
  // Sequence specific
  hand?: Array<{ suit: string; rank: string }>;
  teamId?: number;
}

interface GameState {
  status: string;
  currentTurnId: string;
  winnerId: string;
  isDraw: boolean;
  phase?: string;
  turnStartedAt?: number;
  turnTimeLimit?: number;
  // Connect4 specific
  board?: number[];
  player1Id?: string;
  player2Id?: string;
  moveCount?: number;
  // RPS specific
  roundNumber?: number;
  targetScore?: number;
  player1Score?: number;
  player2Score?: number;
  player1Choice?: string;
  player2Choice?: string;
  player1Committed?: boolean;
  player2Committed?: boolean;
  roundWinnerId?: string;
  // Quoridor specific
  boardSize?: number;
  walls?: Array<{ x: number; y: number; orientation: string }>;
  // Sequence specific
  chips?: Array<{ x: number; y: number; teamId: number; isPartOfSequence: boolean }>;
  team1Sequences?: number;
  team2Sequences?: number;
  sequencesToWin?: number;
  // Catan specific
  tiles?: Array<{ q: number; r: number; tileType: string; number: number; hasRobber: boolean }>;
  vertices?: Map<string, { id: string; building: string; playerId: string }>;
  edges?: Map<string, { id: string; hasRoad: boolean; playerId: string }>;
  lastDiceRoll?: number;
  setupRound?: number;
  // Splendor specific
  bankWhite?: number;
  bankBlue?: number;
  bankGreen?: number;
  bankRed?: number;
  bankBlack?: number;
  bankGold?: number;
  tier1Cards?: Array<{
    id: string;
    tier: number;
    gemType: string;
    points: number;
    costWhite: number;
    costBlue: number;
    costGreen: number;
    costRed: number;
    costBlack: number;
  }>;
  tier2Cards?: Array<{
    id: string;
    tier: number;
    gemType: string;
    points: number;
    costWhite: number;
    costBlue: number;
    costGreen: number;
    costRed: number;
    costBlack: number;
  }>;
  tier3Cards?: Array<{
    id: string;
    tier: number;
    gemType: string;
    points: number;
    costWhite: number;
    costBlue: number;
    costGreen: number;
    costRed: number;
    costBlack: number;
  }>;
  nobles?: Array<{
    id: string;
    points: number;
    reqWhite: number;
    reqBlue: number;
    reqGreen: number;
    reqRed: number;
    reqBlack: number;
  }>;
  tier1Remaining?: number;
  tier2Remaining?: number;
  tier3Remaining?: number;
  pointsToWin?: number;
  // Monopoly Deal specific
  deckRemaining?: number;
  discardPile?: Array<{
    id: string;
    cardType: string;
    value: number;
    name: string;
    actionType?: string;
    color?: string;
    colors?: string[];
  }>;
  actionStack?: Array<{
    id: string;
    actionType: string;
    sourcePlayerId: string;
    targetPlayerId: string;
    amount?: number;
  }>;
  activeResponderId?: string;
  setsToWin?: number;
  // Blackjack specific
  dealerHand?: Array<{ suit: string; rank: string; faceUp: boolean }>;
  dealerValue?: number;
  dealerBusted?: boolean;
  dealerBlackjack?: boolean;
  handNumber?: number;
  buttonPlayerId?: string;
  eliminationHands?: number[];
  startingChips?: number;
  minBet?: number;
  maxBet?: number;
  allowSecretBets?: boolean;
  playersRemaining?: number;
  // Players map
  players?: Map<string, PlayerInfo>;
}

const gameLabels: Record<string, string> = {
  connect4: "Connect 4",
  rps: "Rock Paper Scissors",
  quoridor: "Quoridor",
  sequence: "Sequence",
  catan: "Catan",
  splendor: "Splendor",
  monopoly_deal: "Monopoly Deal",
  blackjack: "Blackjack",
};

function normalizeGameType(name?: string): GameType | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  if (lower.startsWith("connect4")) return GameType.CONNECT4;
  if (lower.startsWith("rps")) return GameType.ROCK_PAPER_SCISSORS;
  if (lower.startsWith("quoridor")) return GameType.QUORIDOR;
  if (lower.startsWith("sequence")) return GameType.SEQUENCE;
  if (lower.startsWith("catan")) return GameType.CATAN;
  if (lower.startsWith("splendor")) return GameType.SPLENDOR;
  if (lower.startsWith("monopoly_deal")) return GameType.MONOPOLY_DEAL;
  if (lower.startsWith("blackjack")) return GameType.BLACKJACK;
  return null;
}

export default function GameRoomPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.roomId as string;

  const {
    playerName,
    leaveRoom,
    room: existingRoom,
    createRoom,
    createBotRoom,
    roomSlug: storeRoomSlug,
  } = useGameStore();

  const [room, setRoom] = useState<Room<Schema> | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [gameType, setGameType] = useState<GameType | null>(null);
  const [isConnecting, setIsConnecting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [disconnectedCode, setDisconnectedCode] = useState<number | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [isReplaying, setIsReplaying] = useState(false);
  const [chatMessages, setChatMessages] = useState<
    Array<{ senderId: string; senderName: string; content: string; timestamp: number }>
  >([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [isBoardReady, setIsBoardReady] = useState(false); // Track if board has received initial state
  // True only when the player explicitly clicks "Leave Room" or "Play Again".
  // Navigation within the app should NOT send a consented leave so the server
  // holds the seat open for reconnection (allowReconnection path).
  const explicitLeaveRef = useRef(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [victoryModalOpen, setVictoryModalOpen] = useState(false);

  // Helper function to register message handlers
  const registerMessageHandlers = useCallback(
    (room: Room<Schema>) => {
      // For fresh join/reconnect paths not handled by the store, sync slug to store so getShareUrl picks it up.
      room.onMessage("room_info", (data: { roomSlug?: string }) => {
        if (data.roomSlug) useGameStore.setState({ roomSlug: data.roomSlug });
      });

      // Chat message listener
      room.onMessage(
        "chat",
        (data: { senderId: string; senderName: string; content: string; timestamp: number }) => {
          setChatMessages((prev) => [...prev.slice(-49), data]); // Keep last 50 messages
        }
      );

      // RPS game event listeners
      room.onMessage("player_committed", (data: { playerId: string }) => {
        console.log("Player committed:", data.playerId);
      });

      room.onMessage(
        "choices_revealed",
        (data: { player1Choice: string; player2Choice: string }) => {
          console.log("Choices revealed:", data);
        }
      );

      room.onMessage(
        "round_result",
        (data: {
          roundNumber: number;
          winner: string;
          player1Score: number;
          player2Score: number;
        }) => {
          console.log("Round result:", data);
        }
      );

      room.onMessage("round_started", (data: { roundNumber: number }) => {
        console.log("Round started:", data.roundNumber);
      });

      room.onMessage("round_replay", (data: { roundNumber: number }) => {
        console.log("Round replayed:", data.roundNumber);
      });

      room.onMessage("timeout", (data: { message: string }) => {
        console.log("Round timeout:", data.message);
      });

      room.onMessage("auto_choice", (data: { playerId: string }) => {
        console.log("Auto choice assigned for player:", data.playerId);
      });

      room.onMessage(
        "game_started",
        (data: { firstPlayer?: string; handNumber?: number; phase?: string }) => {
          console.log("game_started:", data);
        }
      );

      room.onMessage("move", (data: { playerId?: string; [key: string]: unknown }) => {
        console.log("move broadcast:", data);
      });

      room.onMessage("error", (data) => {
        setError(data.message);
        setTimeout(() => setError(null), 3000);
      });

      room.onMessage("kicked", (data: { reason: string }) => {
        setError(data.reason || "You were kicked from the room.");
        setTimeout(() => router.push("/lobby"), 1500);
      });
    },
    [router]
  );

  // Helper function to extract game state based on game type
  const extractGameState = useCallback((s: any, roomName: string): GameState => {
    const plainState: GameState = {
      status: s.status,
      currentTurnId: s.currentTurnId,
      winnerId: s.winnerId,
      isDraw: s.isDraw,
      phase: s.phase,
      turnStartedAt: s.turnStartedAt,
      turnTimeLimit: s.turnTimeLimit,
    };

    // Always extract players map (needed for all games)
    if (s.players) {
      plainState.players = new Map(s.players);
    }

    // Game-specific state extraction
    const normalized = normalizeGameType(roomName);

    if (normalized === GameType.CONNECT4) {
      plainState.board = s.board ? Array.from(s.board as unknown as ArrayLike<number>) : [];
      plainState.player1Id = s.player1Id;
      plainState.player2Id = s.player2Id;
      plainState.moveCount = s.moveCount;
    } else if (normalized === GameType.ROCK_PAPER_SCISSORS) {
      plainState.roundNumber = s.roundNumber;
      plainState.targetScore = s.targetScore;
      plainState.player1Score = s.player1Score;
      plainState.player2Score = s.player2Score;
      plainState.player1Choice = s.player1Choice;
      plainState.player2Choice = s.player2Choice;
      plainState.player1Committed = s.player1Committed;
      plainState.player2Committed = s.player2Committed;
      plainState.roundWinnerId = s.roundWinnerId;
      plainState.player1Id = s.player1Id;
      plainState.player2Id = s.player2Id;
    } else if (normalized === GameType.QUORIDOR) {
      plainState.boardSize = s.boardSize;
      if (s.walls) {
        plainState.walls = Array.from(
          s.walls as unknown as ArrayLike<{ x: number; y: number; orientation: string }>
        );
      }
    } else if (normalized === GameType.SEQUENCE) {
      if (s.chips) {
        plainState.chips = Array.from(
          s.chips as unknown as ArrayLike<{
            x: number;
            y: number;
            teamId: number;
            isPartOfSequence: boolean;
          }>
        );
      }
      plainState.team1Sequences = s.team1Sequences;
      plainState.team2Sequences = s.team2Sequences;
      plainState.sequencesToWin = s.sequencesToWin;
      plainState.deckRemaining = s.deckRemaining;
    } else if (normalized === GameType.CATAN) {
      if (s.tiles) {
        plainState.tiles = Array.from(
          s.tiles as unknown as ArrayLike<{
            q: number;
            r: number;
            tileType: string;
            number: number;
            hasRobber: boolean;
          }>
        );
      }
      if (s.vertices) {
        plainState.vertices = new Map(s.vertices);
      }
      if (s.edges) {
        plainState.edges = new Map(s.edges);
      }
      plainState.lastDiceRoll = s.lastDiceRoll;
      plainState.setupRound = s.setupRound;
    } else if (normalized === GameType.SPLENDOR) {
      plainState.bankWhite = s.bankWhite;
      plainState.bankBlue = s.bankBlue;
      plainState.bankGreen = s.bankGreen;
      plainState.bankRed = s.bankRed;
      plainState.bankBlack = s.bankBlack;
      plainState.bankGold = s.bankGold;
      if (s.tier1Cards) {
        plainState.tier1Cards = Array.from(s.tier1Cards!);
      }
      if (s.tier2Cards) {
        plainState.tier2Cards = Array.from(s.tier2Cards!);
      }
      if (s.tier3Cards) {
        plainState.tier3Cards = Array.from(s.tier3Cards!);
      }
      if (s.nobles) {
        plainState.nobles = Array.from(s.nobles!);
      }
      plainState.tier1Remaining = s.tier1Remaining;
      plainState.tier2Remaining = s.tier2Remaining;
      plainState.tier3Remaining = s.tier3Remaining;
      plainState.pointsToWin = s.pointsToWin;
    } else if (normalized === GameType.MONOPOLY_DEAL) {
      plainState.deckRemaining = s.deckRemaining;
      plainState.activeResponderId = s.activeResponderId;
      plainState.setsToWin = s.setsToWin;
      if (s.discardPile) {
        plainState.discardPile = Array.from(s.discardPile!);
      }
      if (s.actionStack) {
        plainState.actionStack = Array.from(s.actionStack!);
      }
    } else if (normalized === GameType.BLACKJACK) {
      if (s.dealerHand) {
        plainState.dealerHand = Array.from(s.dealerHand!);
      }
      plainState.dealerValue = s.dealerValue;
      plainState.dealerBusted = s.dealerBusted;
      plainState.dealerBlackjack = s.dealerBlackjack;
      plainState.handNumber = s.handNumber;
      plainState.buttonPlayerId = s.buttonPlayerId;
      if (s.eliminationHands) {
        plainState.eliminationHands = Array.from(
          s.eliminationHands as unknown as ArrayLike<number>
        );
      }
      plainState.minBet = s.minBet;
      plainState.maxBet = s.maxBet;
      plainState.allowSecretBets = s.allowSecretBets;
      plainState.playersRemaining = s.playersRemaining;
    }

    return plainState;
  }, []);

  // Connect to room
  useEffect(() => {
    let currentRoom: Room<Schema> | null = null;
    // StrictMode in dev fires effects twice (mount → cleanup → remount). The cleanup
    // runs synchronously while the async joinById is still in flight, so currentRoom
    // is null when cleanup fires and the first connection is never closed. Setting
    // cancelled=true lets the async callback self-close after it resolves.
    let cancelled = false;
    const MAX_RECONNECT_ATTEMPTS = 5;
    const RECONNECT_DELAY_MS = 2000; // Start with 2 second delay
    const CONNECTION_TIMEOUT_MS = 10_000; // surface error instead of hanging indefinitely

    async function connectToRoom() {
      setIsConnecting(true);
      setError(null);
      setReconnectAttempts(0);
      setIsBoardReady(false); // Reset board ready state when connecting

      try {
        // Only reuse the store room if its WebSocket connection is still live.
        // A stale (disconnected) Room object must fall through to reconnect/joinById
        // so the server can restore the player's original seat via reconnectionToken.
        if (existingRoom && existingRoom.roomId === roomId && existingRoom.connection?.isOpen) {
          const currentRoomRef = existingRoom;
          setRoom(currentRoomRef);
          setPlayerId(currentRoomRef.sessionId);
          setGameType(normalizeGameType(currentRoomRef.name));
          // Ensure the per-room token is written for this path too.
          if (currentRoomRef.reconnectionToken) {
            saveReconnectToken(currentRoomRef.roomId, currentRoomRef.reconnectionToken);
          }

          // Register message handlers
          registerMessageHandlers(currentRoomRef);

          // Set initial state if it exists
          if (currentRoomRef.state) {
            const s = currentRoomRef.state as unknown as GameState;
            const initialState = extractGameState(s, currentRoomRef.name);
            setGameState(initialState);
            setIsBoardReady(true);
          }

          // Subscribe to state changes locally
          currentRoomRef.onStateChange((state) => {
            const s = state as unknown as GameState;
            const newState = extractGameState(s, currentRoomRef.name);
            setGameState(newState);
            setIsBoardReady(true);
          });

          setIsConnecting(false);
          return;
        }

        // Get auth user ID if signed in
        const authUserId = useAuthStore.getState().user?.id;
        const browserSessionId = getBrowserSessionId();

        // Per-room reconnect token (primary path — survives navigation + unmount).
        // Stored in localStorage keyed by roomId; cleared only on explicit leave or
        // game end. The server opens a reconnect window when leave(false) is sent
        // (non-consented disconnect), so this token is valid even after navigating
        // away from the room page.
        const perRoomToken = getReconnectToken(roomId);
        if (perRoomToken) {
          try {
            currentRoom = await Promise.race([
              reconnect(perRoomToken),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("Reconnect timed out")), CONNECTION_TIMEOUT_MS)
              ),
            ]);
            if (currentRoom?.reconnectionToken) {
              saveReconnectToken(roomId, currentRoom.reconnectionToken);
            }
          } catch (reconnectErr) {
            console.warn("Per-room reconnect failed, falling back to fresh join", reconnectErr);
            clearReconnectToken(roomId);
            currentRoom = undefined as unknown as Room<Schema>;
          }
        }

        // Legacy fallback: single-session key for tokens saved before the per-room
        // change was deployed.
        if (!currentRoom) {
          const session = getSession();
          if (session?.roomId === roomId && session.reconnectionToken) {
            try {
              currentRoom = await Promise.race([
                reconnect(session.reconnectionToken),
                new Promise<never>((_, reject) =>
                  setTimeout(() => reject(new Error("Reconnect timed out")), CONNECTION_TIMEOUT_MS)
                ),
              ]);
              if (currentRoom?.reconnectionToken) {
                saveReconnectToken(roomId, currentRoom.reconnectionToken);
              }
            } catch (reconnectErr) {
              console.warn(
                "Legacy session reconnect failed, falling back to fresh join",
                reconnectErr
              );
              clearSession();
              currentRoom = undefined as unknown as Room<Schema>;
            }
          }
        }

        if (!currentRoom) {
          currentRoom = await Promise.race([
            joinById(roomId, { playerName, userId: authUserId, browserSessionId }),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error("Could not connect to room. It may no longer exist.")),
                CONNECTION_TIMEOUT_MS
              )
            ),
          ]);
        }

        // If cleanup already fired (StrictMode remount), close the connection we
        // just opened and bail out — the second effect invocation will create the
        // real connection.
        if (cancelled) {
          currentRoom?.leave();
          return;
        }

        setRoom(currentRoom);
        setPlayerId(currentRoom.sessionId);
        setGameType(normalizeGameType(currentRoom.name));

        saveSession({
          roomId: currentRoom.roomId,
          sessionId: currentRoom.sessionId,
          reconnectionToken: currentRoom.reconnectionToken,
          gameType: currentRoom.name,
          browserSessionId: getBrowserSessionId(),
        });
        // Only persist a valid token — undefined/null would be stringified by localStorage
        // and cause the next reconnect attempt to fail with "Invalid reconnection token format".
        if (currentRoom?.reconnectionToken) {
          saveReconnectToken(currentRoom.roomId, currentRoom.reconnectionToken);
        }

        // Register message handlers
        registerMessageHandlers(currentRoom);

        // REST fallback: ensure getShareUrl() shows the human-readable slug even if the
        // 250 ms delayed `room_info` WebSocket message was missed (race / handshake error).
        const joinedRoomId = currentRoom?.roomId;
        setTimeout(async () => {
          if (!useGameStore.getState().roomSlug) {
            try {
              const rooms = await getAvailableRooms();
              const match = rooms.find((r) => r.roomId === joinedRoomId);
              const slug = match?.metadata?.roomSlug as string | undefined;
              if (slug) useGameStore.setState({ roomSlug: slug });
            } catch {
              /* non-critical */
            }
          }
        }, 2000);

        // Set up state listener
        currentRoom.onStateChange((state) => {
          const s = state as unknown as GameState;
          const plainState = extractGameState(s, currentRoom?.name || "");
          setGameState(plainState);
          setIsBoardReady(true);
        });

        // Colyseus fires the initial onStateChange before joinById resolves, so
        // by the time we registered the listener above the initial patch is gone.
        // Bootstrap from room.state directly to unblock spectators joining an
        // in-progress game where no further state changes will occur.
        if (currentRoom.state) {
          const s = currentRoom.state as unknown as GameState;
          setGameState(extractGameState(s, currentRoom.name || ""));
          setIsBoardReady(true);
        }

        // Handle room events
        currentRoom.onLeave((code) => {
          setDisconnectedCode(code);
          if (code !== 1000) {
            setError(`Disconnected (code: ${code})`);
          }
        });

        currentRoom.onError((code, message) => {
          setError(message || `Error: ${code}`);
        });

        setIsConnecting(false);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Failed to connect";
        if (errorMsg.toLowerCase().includes("locked") || errorMsg.toLowerCase().includes("full")) {
          setError("This room is full. Spectator mode is not available for this game type.");
        } else {
          // Always surface connection errors — the previous guard `!errorMsg.includes("room")`
          // incorrectly suppressed Colyseus "room not found" errors, causing infinite loading.
          setError(errorMsg || "Could not connect to room");
        }
        setIsConnecting(false);
      }
    }

    connectToRoom();

    return () => {
      cancelled = true;
      if (currentRoom) {
        if (explicitLeaveRef.current) {
          // User clicked "Leave Room" / "Play Again" — consented leave, server
          // removes the player immediately (no reconnect window needed).
          currentRoom.leave();
        } else {
          // In-app navigation (lobby link, back button, etc.) — non-consented
          // disconnect so the server calls allowReconnection and holds the seat
          // for RECONNECT_TIMEOUT seconds. The per-room token in localStorage
          // lets the player resume their seat if they return within the window.
          currentRoom.leave(false);
        }
      }
    };
  }, [roomId, playerName, router]);

  const resolvedGameType = gameType || normalizeGameType(room?.name);
  const isWaiting = gameState?.status === "waiting";
  const isPlaying = gameState?.status === "in_progress";
  const isFinished = gameState?.status === "finished";
  const isMyTurn = gameState?.currentTurnId === playerId;
  const myRole = gameState?.players?.get(playerId || "");
  const isSpectator = myRole?.isSpectator || false;
  // Materialize the players map as an array once per render so the lobby/waiting
  // JSX can iterate without re-deriving it on every cell.
  const players: PlayerInfo[] = gameState?.players ? Array.from(gameState.players.values()) : [];
  const isAmHost = myRole?.isHost === true;

  // Debug logging
  // Debug turn logic
  const debugTurnInfo = {
    playerId,
    sessionId: room?.sessionId,
    currentTurnId: gameState?.currentTurnId,
    isMyTurn,
    gameStatus: gameState?.status,
    turnComparison: `${gameState?.currentTurnId} === ${playerId} = ${gameState?.currentTurnId === playerId}`,
    myRole: myRole
      ? {
          id: myRole.id,
          displayName: myRole.displayName,
          isSpectator: myRole.isSpectator,
          wasInitialPlayer: myRole.wasInitialPlayer,
          isBot: myRole.isBot,
          wallsRemaining: myRole.wallsRemaining,
          x: myRole.x,
          y: myRole.y,
        }
      : null,
    isSpectator,
    gameStatePlayers: gameState?.players
      ? Array.from(gameState.players.values()).map((p) => ({
          id: p.id,
          displayName: p.displayName,
          isSpectator: p.isSpectator,
          wasInitialPlayer: p.wasInitialPlayer,
          isBot: p.isBot,
          wallsRemaining: p.wallsRemaining,
          x: p.x,
          y: p.y,
        }))
      : [],
    roomId,
  };

  // Only log debug info when gameState changes or on first load
  useEffect(() => {
    console.log("GameRoomPage state update:", debugTurnInfo);
  }, [gameState?.status, gameState?.currentTurnId, playerId]);

  // Auto-ready for 1v1 bot games only (RPS, Connect4, Quoridor)
  // Multi-bot games (Sequence, Blackjack, Splendor, MonopolyDeal) require manual ready
  useEffect(() => {
    if (!room || !gameState || isSpectator) return;
    if (gameState.status !== "waiting") return;

    // Check if there's exactly one bot (1v1 game)
    const players = gameState.players ? Array.from(gameState.players.values()) : [];
    const botPlayers = players.filter((p) => p.isBot);
    const humanPlayers = players.filter((p) => !p.isBot);

    // Only auto-ready if exactly 1 bot and 1 human (1v1 games)
    const is1v1BotGame = botPlayers.length === 1 && humanPlayers.length === 1;

    // Check if we're not already ready
    const me = gameState.players?.get(playerId || "");
    const alreadyReady = me?.isReady;

    if (is1v1BotGame && !alreadyReady) {
      console.log("Auto-readying for 1v1 bot game");
      // Small delay for smooth transition (400ms matches the loading animation)
      setTimeout(() => {
        room.send("ready");
      }, 400);
    }
  }, [room, gameState, isSpectator, playerId]);

  // When the game ends, the reconnect token is no longer useful. Clear it so
  // the player doesn't accidentally reconnect to a finished room on next visit.
  useEffect(() => {
    if (gameState?.status === "finished") {
      clearReconnectToken(roomId);
    }
  }, [gameState?.status, roomId]);

  // Open victory modal when game finishes
  useEffect(() => {
    if (isFinished) setVictoryModalOpen(true);
  }, [isFinished]);

  // Define callbacks after isSpectator is available
  const handleReady = useCallback(() => {
    if (room && !isSpectator) {
      room.send("ready");
    }
  }, [room, isSpectator]);

  const getShareUrl = useCallback(() => {
    if (typeof window === "undefined") return "";
    return storeRoomSlug ? `${window.location.origin}/game/${storeRoomSlug}` : window.location.href;
  }, [storeRoomSlug]);

  const handleCopyLink = useCallback(async () => {
    const url = getShareUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Fallback for HTTP or restricted contexts
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }, [getShareUrl]);

  const handleLeave = useCallback(async () => {
    // Mark as explicit leave so the cleanup sends a consented leave (code 1000),
    // which clears the player's seat on the server immediately.
    explicitLeaveRef.current = true;
    clearReconnectToken(roomId);
    try {
      await leaveRoom();
    } catch (error) {
      console.error("Failed to leave room:", error);
    }
    // Always navigate to lobby, even if leaving fails
    router.push("/lobby");
  }, [leaveRoom, router, roomId]);

  const handleConnect4Move = useCallback(
    (column: number) => {
      if (room && !isSpectator) room.send("move", { column });
    },
    [room, isSpectator]
  );

  const handleRPSChoice = useCallback(
    (choice: RPSChoice) => {
      if (room && !isSpectator) room.send("move", { choice });
    },
    [room, isSpectator]
  );

  const handleQuoridorMove = useCallback(
    (x: number, y: number) => {
      console.log("Sending Quoridor move:", {
        type: "move",
        x,
        y,
        playerId,
        isMyTurn,
        room: !!room,
        isSpectator,
      });
      if (room && !isSpectator) room.send("move", { type: "move", x, y });
    },
    [room, isSpectator, playerId, isMyTurn]
  );

  const handleQuoridorWall = useCallback(
    (x: number, y: number, orientation: "horizontal" | "vertical") => {
      console.log("Sending Quoridor wall:", {
        type: "wall",
        x,
        y,
        orientation,
        playerId,
        isMyTurn,
        room: !!room,
        isSpectator,
      });
      if (room && !isSpectator) room.send("move", { type: "wall", x, y, orientation });
    },
    [room, isSpectator, playerId, isMyTurn]
  );

  const handleSequenceMove = useCallback(
    (cardIndex: number, boardX: number, boardY: number) => {
      if (room && !isSpectator) room.send("move", { cardIndex, boardX, boardY });
    },
    [room, isSpectator]
  );

  const handleCatanAction = useCallback(
    (action: string, data: Record<string, unknown>) => {
      if (room && !isSpectator) room.send("move", { action, ...data });
    },
    [room, isSpectator]
  );

  const handleSplendorAction = useCallback(
    (action: string, data: Record<string, unknown>) => {
      if (room && !isSpectator) room.send("move", { action, ...data });
    },
    [room, isSpectator]
  );

  const handleMonopolyDealAction = useCallback(
    (action: string, data: Record<string, unknown>) => {
      if (room && !isSpectator) room.send("move", { action, ...data });
    },
    [room, isSpectator]
  );

  const handleBlackjackAction = useCallback(
    (action: string, data: Record<string, unknown>) => {
      if (room && !isSpectator) room.send("move", { action, ...data });
    },
    [room, isSpectator]
  );

  const handleSendChat = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (room && chatInput.trim()) {
        room.send("chat", { message: chatInput.trim() });
        setChatInput("");
      }
    },
    [room, chatInput]
  );

  const handlePlayAgain = useCallback(async () => {
    const targetGame = gameType || normalizeGameType(room?.name);
    if (isReplaying || !targetGame) return;
    setIsReplaying(true);
    // Explicit leave path — clear old room's reconnect token and mark consented.
    explicitLeaveRef.current = true;
    if (room?.roomId) clearReconnectToken(room.roomId);
    clearSession();

    try {
      const isBotRoom = room?.name?.includes("_bot");
      let newRoomId: string | null = null;
      if (isBotRoom) {
        newRoomId = await createBotRoom(targetGame, "medium");
      } else {
        newRoomId = await createRoom(targetGame);
      }
      if (newRoomId) {
        router.push(`/game/${newRoomId}`);
      }
    } finally {
      setIsReplaying(false);
    }
  }, [isReplaying, gameType, room, createBotRoom, createRoom, router]);

  // Slug routing: roomId is a human-readable slug — let SlugResolverClient handle it.
  // All hooks above have already been called unconditionally (required by Rules of Hooks).
  if (roomId && isRoomSlug(roomId)) {
    return <SlugResolverClient slug={roomId} />;
  }

  // Loading state
  if (isConnecting) {
    const MAX_RECONNECT_ATTEMPTS = 5;
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col items-center justify-center min-h-[400px]">
          <div className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-surface-400">
            {reconnectAttempts > 0
              ? `Reconnecting... (Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`
              : "Connecting to room..."}
          </p>
          {reconnectAttempts > 0 && (
            <p className="text-surface-500 text-sm mt-2">
              Please wait while we try to restore your connection
            </p>
          )}
        </div>
      </div>
    );
  }

  // Error state (connection failed or room not found)
  if ((error && !room) || (!isConnecting && !room && !error)) {
    const displayError = error || "This room does not exist or has been closed.";
    const isRoomNotFound =
      displayError.toLowerCase().includes("not found") ||
      displayError.toLowerCase().includes("no longer exist") ||
      displayError.toLowerCase().includes("timed out") ||
      !error;
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="card p-8 max-w-md mx-auto text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-error/20 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-error"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-semibold mb-2">
            {isRoomNotFound ? "Room Not Found" : "Connection Failed"}
          </h2>
          <p className="text-surface-400 mb-6">{displayError}</p>
          <Button onClick={() => router.push("/lobby")}>Back to Lobby</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-2 sm:px-4 py-4 sm:py-8">
      {/* Error toast */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed top-20 left-1/2 -translate-x-1/2 bg-error/90 text-white px-6 py-3 rounded-xl shadow-lg z-50"
        >
          {error}
        </motion.div>
      )}

      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <Link
              href="/lobby"
              className="text-surface-400 hover:text-surface-200 text-sm inline-flex items-center gap-1 mb-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 19l-7-7m0 0l7-7m-7 7h18"
                />
              </svg>
              Back to Lobby
            </Link>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-display font-bold">
                {resolvedGameType ? gameLabels[resolvedGameType] || "Game Room" : "Game Room"}
              </h1>
              {isSpectator && (
                <span className="px-3 py-1 bg-surface-700 text-surface-300 text-sm rounded-full border border-surface-600">
                  👁️ Spectator
                </span>
              )}
            </div>
          </div>
          <div className="text-right">
            <p className="text-surface-500 text-xs font-mono">Room: {roomId.slice(0, 8)}</p>
            <p className="text-surface-400 text-sm mt-1">
              {!gameState
                ? "Connecting..."
                : isWaiting
                  ? "Waiting..."
                  : isPlaying
                    ? "In Progress"
                    : isFinished
                      ? "Finished"
                      : "Loading..."}
              {disconnectedCode !== null ? ` • Disconnected (${disconnectedCode})` : ""}
            </p>
          </div>
        </div>

        {/* Game Container */}
        <div className="card p-2 sm:p-8 max-w-4xl mx-auto">
          {/* Loading state - when gameState is not yet available */}
          {!gameState && (
            <div className="text-center py-12">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center mx-auto mb-6 animate-spin">
                <svg
                  className="w-8 h-8 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </div>
              <h2 className="text-xl font-semibold mb-2">Loading Game...</h2>
              <p className="text-surface-400 mb-6">
                Connecting to game room and synchronizing game state.
              </p>
              <div className="p-4 bg-surface-800/50 rounded-xl max-w-sm mx-auto">
                <p className="text-sm text-surface-400 mb-2">Share this link:</p>
                <code className="text-primary-400 text-sm break-all">{getShareUrl()}</code>
                <button
                  onClick={handleCopyLink}
                  className="mt-2 text-xs text-surface-400 hover:text-primary-400 transition-colors"
                >
                  {linkCopied ? "Copied!" : "Copy link"}
                </button>
              </div>
            </div>
          )}

          {/* Waiting state */}
          {isWaiting && gameState && (
            <div className="text-center py-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center mx-auto mb-6">
                <svg
                  className="w-10 h-10 text-white animate-pulse"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <h2 className="text-xl font-semibold mb-2">
                {isSpectator ? "Spectating..." : "Waiting for Players..."}
              </h2>
              <p className="text-surface-400 mb-6">
                {isSpectator
                  ? "You're watching this game. More players can join at any time."
                  : "The game will start when all players are ready."}
              </p>

              {/* Player List */}
              {players.length > 0 && (
                <div className="mb-6 max-w-md mx-auto">
                  <h3 className="text-sm font-semibold text-surface-300 mb-3 text-left">
                    Players ({players.filter((p) => !p.isSpectator).length})
                  </h3>
                  <div className="space-y-2">
                    {players
                      .filter((p) => !p.isSpectator)
                      .map((player, index) => (
                        <motion.div
                          key={player.id}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: index * 0.1 }}
                          className="flex items-center justify-between p-3 bg-surface-800 rounded-lg"
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg ${
                                player.isBot
                                  ? "bg-gradient-to-br from-purple-500 to-pink-500"
                                  : "bg-gradient-to-br from-primary-500 to-accent-500"
                              }`}
                            >
                              {player.isBot ? "🤖" : player.displayName.charAt(0).toUpperCase()}
                            </div>
                            <div className="text-left">
                              <p className="font-medium text-white flex items-center gap-2">
                                {player.displayName}
                                {player.isHost && (
                                  <span
                                    className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-300"
                                    title="Room host"
                                  >
                                    👑
                                  </span>
                                )}
                                {player.isBot && (
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300">
                                    Bot
                                  </span>
                                )}
                                {player.id === playerId && (
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-primary-500/20 text-primary-300">
                                    You
                                  </span>
                                )}
                              </p>
                              <p className="text-xs text-surface-400">
                                {player.isReady ? "✓ Ready" : "Not ready"}
                              </p>
                            </div>
                          </div>
                          {isAmHost && player.id !== playerId && (
                            <button
                              className="text-surface-400 hover:text-error transition-colors p-2"
                              title="Kick player"
                              onClick={() => {
                                room?.send("kick_player", { playerId: player.id });
                              }}
                            >
                              <svg
                                className="w-5 h-5"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M6 18L18 6M6 6l12 12"
                                />
                              </svg>
                            </button>
                          )}
                        </motion.div>
                      ))}
                  </div>

                  {/* Add Bot Button */}
                  {isAmHost && players.filter((p) => !p.isSpectator).length < 4 && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3 }}
                      className="mt-4"
                    >
                      <Button
                        onClick={() => room?.send("add_bot", {})}
                        variant="secondary"
                        size="sm"
                        className="w-full"
                      >
                        <svg
                          className="w-4 h-4 mr-2"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 4v16m8-8H4"
                          />
                        </svg>
                        Add Bot
                      </Button>
                    </motion.div>
                  )}
                </div>
              )}

              {!isSpectator && (
                <div className="mb-6">
                  <Button onClick={handleReady} variant="primary" size="lg">
                    {players.find((p) => p.id === playerId)?.isReady ? "Unready" : "Ready"}
                  </Button>
                </div>
              )}
              <div className="p-4 bg-surface-800/50 rounded-xl max-w-sm mx-auto">
                <p className="text-sm text-surface-400 mb-2">Share this link:</p>
                <code className="text-primary-400 text-sm break-all">{getShareUrl()}</code>
                <button
                  onClick={handleCopyLink}
                  className="mt-2 text-xs text-surface-400 hover:text-primary-400 transition-colors"
                >
                  {linkCopied ? "Copied!" : "Copy link"}
                </button>
              </div>
            </div>
          )}

          {/* Game content - when loaded and in progress or finished */}
          {(isPlaying || isFinished) && gameState && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            >
              {/* Connect 4 */}
              {resolvedGameType === GameType.CONNECT4 && (
                <>
                  {gameState ? (
                    <Connect4Board
                      board={gameState.board || []}
                      currentTurn={gameState.currentTurnId}
                      playerId={playerId || ""}
                      player1Id={gameState.player1Id || ""}
                      player2Id={gameState.player2Id || ""}
                      isMyTurn={isMyTurn}
                      onColumnClick={handleConnect4Move}
                      winnerId={gameState.winnerId}
                      isFinished={isFinished}
                      turnStartedAt={gameState.turnStartedAt}
                      turnTimeLimit={gameState.turnTimeLimit}
                    />
                  ) : null}
                </>
              )}

              {/* RPS */}
              {resolvedGameType === GameType.ROCK_PAPER_SCISSORS && gameState && (
                <RPSGame
                  roundNumber={gameState.roundNumber || 1}
                  targetScore={gameState.targetScore || 3}
                  player1Score={gameState.player1Score || 0}
                  player2Score={gameState.player2Score || 0}
                  player1Choice={gameState.player1Choice || ""}
                  player2Choice={gameState.player2Choice || ""}
                  player1Committed={gameState.player1Committed || false}
                  player2Committed={gameState.player2Committed || false}
                  phase={gameState.phase || "commit"}
                  roundWinnerId={gameState.roundWinnerId || ""}
                  playerId={playerId || ""}
                  player1Id={gameState.player1Id || ""}
                  onChoice={handleRPSChoice}
                  turnStartedAt={gameState.turnStartedAt}
                  turnTimeLimit={gameState.turnTimeLimit}
                  players={gameState.players}
                />
              )}

              {/* Quoridor */}
              {(isPlaying || isFinished) && resolvedGameType === GameType.QUORIDOR && gameState && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
                  <QuoridorBoard
                    boardSize={gameState.boardSize || 9}
                    players={gameState.players || new Map()}
                    walls={gameState.walls || []}
                    currentTurnId={gameState.currentTurnId}
                    playerId={playerId || ""}
                    isMyTurn={isMyTurn}
                    onMove={handleQuoridorMove}
                    onPlaceWall={handleQuoridorWall}
                    turnStartedAt={gameState.turnStartedAt}
                    turnTimeLimit={gameState.turnTimeLimit}
                    winnerId={gameState.winnerId}
                    isFinished={isFinished}
                  />
                </div>
              )}

              {/* Sequence */}
              {resolvedGameType === GameType.SEQUENCE && gameState && (
                <SequenceBoard
                  chips={gameState.chips || []}
                  hand={gameState.players?.get(playerId || "")?.hand || []}
                  currentTurnId={gameState.currentTurnId}
                  playerId={playerId || ""}
                  teamId={gameState.players?.get(playerId || "")?.teamId || 0}
                  team1Sequences={gameState.team1Sequences || 0}
                  team2Sequences={gameState.team2Sequences || 0}
                  sequencesToWin={gameState.sequencesToWin || 2}
                  isMyTurn={isMyTurn}
                  onPlayCard={handleSequenceMove}
                />
              )}

              {/* Catan */}
              {resolvedGameType === GameType.CATAN && gameState && (
                <CatanBoard
                  tiles={gameState.tiles || []}
                  vertices={gameState.vertices || new Map()}
                  edges={gameState.edges || new Map()}
                  players={gameState.players || new Map()}
                  currentTurnId={gameState.currentTurnId}
                  playerId={playerId || ""}
                  phase={gameState.phase || "roll"}
                  lastDiceRoll={gameState.lastDiceRoll || 0}
                  isMyTurn={isMyTurn}
                  onAction={handleCatanAction}
                />
              )}

              {/* Splendor */}
              {resolvedGameType === GameType.SPLENDOR && (
                <>
                  {gameState ? (
                    <SplendorBoard
                      bank={{
                        white: gameState.bankWhite || 0,
                        blue: gameState.bankBlue || 0,
                        green: gameState.bankGreen || 0,
                        red: gameState.bankRed || 0,
                        black: gameState.bankBlack || 0,
                        gold: gameState.bankGold || 0,
                      }}
                      tier1Cards={gameState.tier1Cards || []}
                      tier2Cards={gameState.tier2Cards || []}
                      tier3Cards={gameState.tier3Cards || []}
                      nobles={gameState.nobles || []}
                      players={gameState.players || new Map()}
                      currentTurnId={gameState.currentTurnId}
                      playerId={playerId || ""}
                      phase={gameState.phase || "take_gems"}
                      isMyTurn={isMyTurn}
                      onAction={handleSplendorAction}
                    />
                  ) : null}
                </>
              )}

              {/* Monopoly Deal */}
              {resolvedGameType === GameType.MONOPOLY_DEAL && gameState && (
                <MonopolyDealBoard
                  players={gameState.players || new Map()}
                  currentTurnId={gameState.currentTurnId}
                  playerId={playerId || ""}
                  phase={gameState.phase || "draw"}
                  deckRemaining={gameState.deckRemaining || 0}
                  discardPile={gameState.discardPile || []}
                  actionStack={gameState.actionStack || []}
                  activeResponderId={gameState.activeResponderId || ""}
                  isMyTurn={isMyTurn}
                  onAction={handleMonopolyDealAction}
                />
              )}

              {/* Blackjack */}
              {resolvedGameType === GameType.BLACKJACK && gameState && (
                <BlackjackBoard
                  players={gameState.players || new Map()}
                  dealerHand={gameState.dealerHand || []}
                  dealerValue={gameState.dealerValue || 0}
                  dealerBusted={gameState.dealerBusted || false}
                  dealerBlackjack={gameState.dealerBlackjack || false}
                  currentTurnId={gameState.currentTurnId}
                  playerId={playerId || ""}
                  phase={gameState.phase || "betting"}
                  handNumber={gameState.handNumber || 1}
                  buttonPlayerId={gameState.buttonPlayerId || ""}
                  eliminationHands={gameState.eliminationHands || [8, 16, 25]}
                  minBet={gameState.minBet || 10}
                  maxBet={gameState.maxBet || 500}
                  allowSecretBets={gameState.allowSecretBets !== false}
                  isMyTurn={isMyTurn}
                  onAction={handleBlackjackAction}
                />
              )}
            </motion.div>
          )}

          {/* Victory overlay modal — dismissible, shows game behind */}
          <AnimatePresence>
            {victoryModalOpen &&
              isFinished &&
              gameState &&
              (() => {
                const winnerPlayer = gameState.winnerId
                  ? gameState.players?.get(gameState.winnerId)
                  : null;
                const isWinner = gameState.winnerId === playerId;
                const isDraw = gameState.isDraw;

                const statsRows: Array<{ label: string; value: string }> = [];
                if (resolvedGameType === GameType.ROCK_PAPER_SCISSORS) {
                  statsRows.push({
                    label: "Final Score",
                    value: `${gameState.player1Score ?? 0} – ${gameState.player2Score ?? 0}`,
                  });
                  const diff = Math.abs(
                    (gameState.player1Score ?? 0) - (gameState.player2Score ?? 0)
                  );
                  statsRows.push({ label: "Point Differential", value: `+${diff}` });
                  statsRows.push({
                    label: "Rounds Played",
                    value: String(gameState.roundNumber ?? 0),
                  });
                } else if (resolvedGameType === GameType.CONNECT4) {
                  statsRows.push({ label: "Total Moves", value: String(gameState.moveCount ?? 0) });
                } else if (resolvedGameType === GameType.SEQUENCE) {
                  statsRows.push({
                    label: "Team 1 Sequences",
                    value: String(gameState.team1Sequences ?? 0),
                  });
                  statsRows.push({
                    label: "Team 2 Sequences",
                    value: String(gameState.team2Sequences ?? 0),
                  });
                  statsRows.push({
                    label: "Needed to Win",
                    value: String(gameState.sequencesToWin ?? 2),
                  });
                } else if (resolvedGameType === GameType.SPLENDOR) {
                  statsRows.push({
                    label: "Points to Win",
                    value: String(gameState.pointsToWin ?? 15),
                  });
                } else if (resolvedGameType === GameType.BLACKJACK) {
                  statsRows.push({
                    label: "Hand Reached",
                    value: String(gameState.handNumber ?? 0),
                  });
                } else if (resolvedGameType === GameType.MONOPOLY_DEAL) {
                  statsRows.push({ label: "Sets to Win", value: String(gameState.setsToWin ?? 3) });
                }

                return (
                  <motion.div
                    key="victory-modal"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-50 flex items-center justify-center px-4"
                  >
                    {/* Backdrop — click outside to dismiss */}
                    <div
                      className="absolute inset-0 bg-surface-950/75 backdrop-blur-sm cursor-pointer"
                      onClick={() => setVictoryModalOpen(false)}
                    />

                    <motion.div
                      key="victory-card"
                      initial={{ opacity: 0, scale: 0.9, y: 20 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9, y: 20 }}
                      transition={{ duration: 0.25, ease: "easeOut" }}
                      className="relative card max-w-sm w-full p-6 text-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Close button */}
                      <button
                        onClick={() => setVictoryModalOpen(false)}
                        className="absolute top-3 right-3 text-surface-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-surface-700"
                        aria-label="Close"
                      >
                        <svg
                          className="w-5 h-5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>

                      {/* Result icon */}
                      <div
                        className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 ${
                          isDraw ? "bg-surface-700" : isWinner ? "bg-success/20" : "bg-error/20"
                        }`}
                      >
                        <span className="text-3xl">{isDraw ? "🤝" : isWinner ? "🏆" : "😔"}</span>
                      </div>

                      {/* Headline */}
                      <h2 className="text-2xl font-bold mb-1">
                        {isDraw ? "It's a Draw!" : isWinner ? "You Won!" : "You Lost"}
                      </h2>

                      {/* Winner name with crown */}
                      {!isDraw && winnerPlayer && (
                        <p className="text-surface-300 mb-4 flex items-center justify-center gap-1.5">
                          <span className="text-yellow-400">👑</span>
                          <span className="font-semibold">{winnerPlayer.displayName}</span>
                          <span className="text-surface-400 text-sm">wins</span>
                        </p>
                      )}
                      {isDraw && (
                        <p className="text-surface-400 mb-4 text-sm">Great game! It was close.</p>
                      )}

                      {/* Stats */}
                      {statsRows.length > 0 && (
                        <div className="mb-5 rounded-xl bg-surface-800/60 divide-y divide-surface-700/50">
                          {statsRows.map(({ label, value }) => (
                            <div
                              key={label}
                              className="flex items-center justify-between px-4 py-2.5 text-sm"
                            >
                              <span className="text-surface-400">{label}</span>
                              <span className="font-semibold text-white">{value}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex gap-3 justify-center">
                        <Button variant="primary" onClick={handlePlayAgain} isLoading={isReplaying}>
                          Play Again
                        </Button>
                        <Button variant="secondary" onClick={handleLeave}>
                          Back to Lobby
                        </Button>
                      </div>

                      <p className="mt-3 text-xs text-surface-500">
                        Click outside or press × to view the final board
                      </p>
                    </motion.div>
                  </motion.div>
                );
              })()}
          </AnimatePresence>
        </div>

        {/* Actions */}
        {isFinished && !victoryModalOpen && gameState && (
          <div className="mt-6 flex gap-3 justify-center">
            <Button variant="primary" onClick={handlePlayAgain} isLoading={isReplaying}>
              Play Again
            </Button>
            <Button variant="secondary" onClick={handleLeave}>
              Back to Lobby
            </Button>
          </div>
        )}
        {!isFinished && gameState && (
          <div className="mt-6 flex justify-center">
            <Button variant="ghost" onClick={handleLeave}>
              Leave Room
            </Button>
          </div>
        )}
      </motion.div>

      {/* Chat toggle button */}
      <button
        onClick={() => setIsChatOpen(!isChatOpen)}
        className="fixed bottom-4 right-4 w-14 h-14 rounded-full bg-primary-500 hover:bg-primary-400 text-white shadow-lg flex items-center justify-center z-40 transition-colors"
      >
        {isChatOpen ? (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        ) : (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
        )}
        {chatMessages.length > 0 && !isChatOpen && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-error text-white text-xs rounded-full flex items-center justify-center">
            {chatMessages.length > 9 ? "9+" : chatMessages.length}
          </span>
        )}
      </button>

      {/* Chat panel */}
      {isChatOpen && (
        <motion.div
          initial={{ opacity: 0, x: 100 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 100 }}
          className="fixed bottom-20 right-4 w-80 h-96 bg-surface-900 rounded-2xl shadow-2xl flex flex-col z-40 border border-surface-700"
        >
          {/* Chat header */}
          <div className="px-4 py-3 border-b border-surface-700 flex items-center justify-between">
            <span className="font-medium text-sm">Chat</span>
            <button
              onClick={() => setIsChatOpen(false)}
              className="text-surface-400 hover:text-white transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Chat messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {chatMessages.length === 0 ? (
              <div className="text-center text-surface-500 text-sm py-8">
                No messages yet. Say hi!
              </div>
            ) : (
              chatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`text-sm ${msg.senderId === playerId ? "text-right" : "text-left"}`}
                >
                  <span className="text-xs text-surface-500 block mb-0.5">
                    {msg.senderId === playerId ? "You" : msg.senderName}
                  </span>
                  <span
                    className={`inline-block px-3 py-1.5 rounded-xl max-w-[85%] ${
                      msg.senderId === playerId
                        ? "bg-primary-500 text-white"
                        : "bg-surface-800 text-surface-200"
                    }`}
                  >
                    {msg.content}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Chat input */}
          <form onSubmit={handleSendChat} className="p-3 border-t border-surface-700">
            <div className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 px-3 py-2 rounded-lg bg-surface-800 border border-surface-700 text-sm focus:outline-none focus:border-primary-500"
                maxLength={200}
              />
              <button
                type="submit"
                disabled={!chatInput.trim()}
                className="px-3 py-2 rounded-lg bg-primary-500 hover:bg-primary-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                  />
                </svg>
              </button>
            </div>
          </form>
        </motion.div>
      )}
    </div>
  );
}
