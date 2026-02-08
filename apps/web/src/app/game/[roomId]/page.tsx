"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useParams, useRouter } from "next/navigation";
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

  const { playerName, leaveRoom, room: existingRoom, createRoom, createBotRoom } = useGameStore();

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

  // Helper function to register message handlers
  const registerMessageHandlers = useCallback((room: Room<Schema>) => {
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

    room.onMessage("choices_revealed", (data: { player1Choice: string; player2Choice: string }) => {
      console.log("Choices revealed:", data);
    });

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

    room.onMessage("error", (data) => {
      setError(data.message);
      setTimeout(() => setError(null), 3000);
    });
  }, []);

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
    } else if (roomName === "catan") {
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
    } else if (roomName === "splendor") {
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
    } else if (roomName === "monopoly_deal") {
      plainState.deckRemaining = s.deckRemaining;
      plainState.activeResponderId = s.activeResponderId;
      plainState.setsToWin = s.setsToWin;
      if (s.discardPile) {
        plainState.discardPile = Array.from(s.discardPile!);
      }
      if (s.actionStack) {
        plainState.actionStack = Array.from(s.actionStack!);
      }
    } else if (roomName === "blackjack") {
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
    const MAX_RECONNECT_ATTEMPTS = 5;
    const RECONNECT_DELAY_MS = 2000; // Start with 2 second delay

    async function connectToRoom() {
      setIsConnecting(true);
      setError(null);
      setReconnectAttempts(0);
      setIsBoardReady(false); // Reset board ready state when connecting

      try {
        // If we already have an active room in the store for this roomId, reuse it and skip a new join.
        if (existingRoom && existingRoom.roomId === roomId) {
          const currentRoomRef = existingRoom;
          setRoom(currentRoomRef);
          setPlayerId(currentRoomRef.sessionId);
          setGameType(normalizeGameType(currentRoomRef.name));

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

        // Check for existing session
        const session = getSession();

        // For now, skip reconnection logic and just join as new player
        // TODO: Fix reconnection token validation issue
        clearSession(); // ensure stale tokens don't lock the seat

        // Get auth user ID if signed in
        const authUserId = useAuthStore.getState().user?.id;
        const browserSessionId = getBrowserSessionId();

        currentRoom = await joinById(roomId, {
          playerName,
          userId: authUserId,
          browserSessionId,
        });

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

        // Register message handlers
        registerMessageHandlers(currentRoom);

        // Set up state listener
        currentRoom.onStateChange((state) => {
          const s = state as unknown as GameState;
          const plainState = extractGameState(s, currentRoom?.name || "");
          setGameState(plainState);
          setIsBoardReady(true);
        });

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
        // Only show error if it's not a "room not found" or connection error during reconnection attempts
        // This gives users time to reconnect naturally through server retry logic
        if (!errorMsg.includes("room") && reconnectAttempts === 0) {
          setError(errorMsg);
        }
        setIsConnecting(false);
      }
    }

    connectToRoom();

    return () => {
      if (currentRoom) {
        currentRoom.leave();
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

  // Define callbacks after isSpectator is available
  const handleReady = useCallback(() => {
    if (room && !isSpectator) {
      room.send("ready");
    }
  }, [room, isSpectator]);

  const handleLeave = useCallback(async () => {
    try {
      await leaveRoom();
    } catch (error) {
      console.error("Failed to leave room:", error);
    }
    // Always navigate to lobby, even if leaving fails
    router.push("/lobby");
  }, [leaveRoom, router]);

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
    clearSession();

    try {
      const isBotRoom = room?.name?.includes("_bot");
      let newRoomId: string | null = null;
      if (
        isBotRoom &&
        (targetGame === GameType.CONNECT4 || targetGame === GameType.ROCK_PAPER_SCISSORS)
      ) {
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

  // Error state
  if (error && !room) {
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
          <h2 className="text-xl font-semibold mb-2">Connection Failed</h2>
          <p className="text-surface-400 mb-6">{error}</p>
          <Button onClick={() => router.push("/lobby")}>Back to Lobby</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
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
        <div className="card p-8 max-w-4xl mx-auto">
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
                <code className="text-primary-400 text-sm break-all">
                  {typeof window !== "undefined" ? window.location.href : ""}
                </code>
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
              {!isSpectator && (
                <div className="mb-6">
                  <Button onClick={handleReady} variant="primary">
                    Ready
                  </Button>
                </div>
              )}
              <div className="p-4 bg-surface-800/50 rounded-xl max-w-sm mx-auto">
                <p className="text-sm text-surface-400 mb-2">Share this link:</p>
                <code className="text-primary-400 text-sm break-all">
                  {typeof window !== "undefined" ? window.location.href : ""}
                </code>
              </div>
            </div>
          )}

          {/* Game content - when loaded and in progress */}
          {isPlaying && gameState && (
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
              {isPlaying && resolvedGameType === GameType.ROCK_PAPER_SCISSORS && gameState && (
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
              {resolvedGameType === GameType.SEQUENCE && (
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
              {isPlaying && resolvedGameType === GameType.CATAN && gameState && (
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
              {isPlaying && resolvedGameType === GameType.SPLENDOR && (
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
              {isPlaying && resolvedGameType === GameType.MONOPOLY_DEAL && gameState && (
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
              {isPlaying && resolvedGameType === GameType.BLACKJACK && gameState && (
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

          {/* Game finished modal */}
          {isFinished && gameState && (
            <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
              <div className="absolute inset-0 bg-surface-950/70 backdrop-blur-sm" />
              <div className="relative card max-w-md w-full p-6 text-center">
                <div
                  className={`w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 ${
                    gameState.isDraw
                      ? "bg-surface-700"
                      : gameState.winnerId === playerId
                        ? "bg-success/20"
                        : "bg-error/20"
                  }`}
                >
                  {gameState.isDraw ? (
                    <span className="text-4xl">🤝</span>
                  ) : gameState.winnerId === playerId ? (
                    <span className="text-4xl">🏆</span>
                  ) : (
                    <span className="text-4xl">😔</span>
                  )}
                </div>
                <h2 className="text-2xl font-bold mb-2">
                  {gameState.isDraw
                    ? "It's a Draw!"
                    : gameState.winnerId === playerId
                      ? "You Won!"
                      : "You Lost"}
                </h2>
                <p className="text-surface-400 mb-6">
                  {gameState.isDraw
                    ? "Great game! It was close."
                    : gameState.winnerId === playerId
                      ? "Congratulations!"
                      : "Better luck next time!"}
                </p>
                <div className="flex gap-4 justify-center">
                  <Button variant="primary" onClick={handlePlayAgain} isLoading={isReplaying}>
                    Play Again
                  </Button>
                  <Button variant="secondary" onClick={handleLeave}>
                    Back to Lobby
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
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
