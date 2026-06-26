"use client";

import { Suspense, useCallback } from "react";
import { motion } from "framer-motion";
import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { GameType, GameStatus, type LobbyRoom } from "@multiplayer/shared";
import { Button } from "@/components/ui/Button";
import { useGameStore } from "@/stores/gameStore";

const gameLabels: Record<GameType, string> = {
  [GameType.CONNECT4]: "Connect 4",
  [GameType.ROCK_PAPER_SCISSORS]: "Rock Paper Scissors",
  [GameType.QUORIDOR]: "Quoridor",
  [GameType.SEQUENCE]: "Sequence",
  [GameType.CATAN]: "Catan",
  [GameType.SPLENDOR]: "Splendor",
  [GameType.MONOPOLY_DEAL]: "Monopoly Deal",
  [GameType.BLACKJACK]: "Blackjack",
};

const gameColors: Record<GameType, string> = {
  [GameType.CONNECT4]: "from-red-500 to-amber-500",
  [GameType.ROCK_PAPER_SCISSORS]: "from-violet-500 to-purple-500",
  [GameType.QUORIDOR]: "from-emerald-500 to-teal-500",
  [GameType.SEQUENCE]: "from-blue-500 to-cyan-500",
  [GameType.CATAN]: "from-orange-500 to-yellow-500",
  [GameType.SPLENDOR]: "from-pink-500 to-rose-500",
  [GameType.MONOPOLY_DEAL]: "from-green-500 to-emerald-600",
  [GameType.BLACKJACK]: "from-slate-700 to-slate-900",
};

const gamePlayerCounts: Record<GameType, string> = {
  [GameType.CONNECT4]: "2 players",
  [GameType.ROCK_PAPER_SCISSORS]: "2 players",
  [GameType.QUORIDOR]: "2 players",
  [GameType.SEQUENCE]: "2–4 players",
  [GameType.CATAN]: "2–4 players",
  [GameType.SPLENDOR]: "2–4 players",
  [GameType.MONOPOLY_DEAL]: "2–5 players",
  [GameType.BLACKJACK]: "1–7 players",
};

export default function LobbyPage() {
  return (
    <Suspense fallback={<LobbyLoadingSkeleton />}>
      <LobbyContent />
    </Suspense>
  );
}

function LobbyLoadingSkeleton() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="animate-pulse">
        <div className="h-10 bg-surface-800 rounded w-48 mb-4" />
        <div className="h-6 bg-surface-800 rounded w-64 mb-8" />
        <div className="flex gap-2 mb-6">
          <div className="h-10 bg-surface-800 rounded-full w-24" />
          <div className="h-10 bg-surface-800 rounded-full w-24" />
          <div className="h-10 bg-surface-800 rounded-full w-24" />
        </div>
        <div className="space-y-3">
          <div className="h-20 bg-surface-800 rounded-xl" />
          <div className="h-20 bg-surface-800 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

function LobbyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const showCreate = searchParams.get("create") === "true";
  const preselectedGame = searchParams.get("game");
  const errorParam = searchParams.get("error");
  const errorSlug = searchParams.get("slug");

  const {
    availableRooms,
    isLoadingRooms,
    isConnecting,
    connectionError,
    subscribeToLobby,
    fetchRooms,
    createRoom,
    createBotRoom,
    joinRoom,
  } = useGameStore();

  const [isCreating, setIsCreating] = useState(showCreate || !!preselectedGame);
  const [isJoiningByCode, setIsJoiningByCode] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [gameFilter, setGameFilter] = useState<GameType | null>(null);

  // Subscribe to real-time lobby updates via Server-Sent Events (SSE)
  useEffect(() => {
    console.log("Lobby: Subscribing to real-time updates");
    const unsubscribe = subscribeToLobby((connected) => {
      setIsConnected(connected);
    });
    return () => {
      console.log("Lobby: Unsubscribing from updates");
      unsubscribe();
    };
  }, [subscribeToLobby]);

  // Manual refresh handler
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await fetchRooms();
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchRooms]);

  const handleCreateRoom = useCallback(
    async (
      gameType: GameType,
      vsBot = false,
      difficulty: "easy" | "medium" | "hard" = "medium"
    ) => {
      setIsCreating(false);
      const roomId = vsBot ? await createBotRoom(gameType, difficulty) : await createRoom(gameType);
      if (roomId) {
        router.push(`/game/${roomId}`);
      }
    },
    [createRoom, createBotRoom, router]
  );

  const handleJoinRoom = useCallback(
    async (roomId: string) => {
      const success = await joinRoom(roomId);
      if (success) {
        router.push(`/game/${roomId}`);
      }
    },
    [joinRoom, router]
  );

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Connection Error Toast */}
      {connectionError && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed top-20 left-1/2 -translate-x-1/2 bg-error/90 text-white px-6 py-3 rounded-xl shadow-lg z-50"
        >
          {connectionError}
        </motion.div>
      )}

      {/* Slug-redirect error toast */}
      {errorParam && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed top-20 left-1/2 -translate-x-1/2 bg-warning/90 text-white px-6 py-3 rounded-xl shadow-lg z-50 text-sm"
        >
          {errorParam === "full"
            ? `Room "${errorSlug}" is full.`
            : errorParam === "finished"
              ? `Room "${errorSlug}" has already finished.`
              : `Room "${errorSlug}" is unavailable.`}
        </motion.div>
      )}

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8"
      >
        <div>
          <h1 className="text-3xl font-display font-bold">Game Lobby</h1>
          <p className="text-surface-400 mt-1">
            Find a game or create your own room
            <span
              className={`ml-2 text-xs transition-colors ${
                isConnected ? "text-success" : "text-surface-500"
              }`}
              title={isConnected ? "Connected to live updates" : "Connecting..."}
            >
              ● {isConnected ? "Live" : "Connecting..."}
            </span>
          </p>
        </div>
        <div className="flex gap-3">
          <Button
            onClick={handleRefresh}
            variant="ghost"
            size="lg"
            disabled={isRefreshing || isConnecting}
            isLoading={isRefreshing}
            className="hidden sm:flex"
            title="Manually refresh lobby list"
          >
            <svg
              className={`w-5 h-5 ${isRefreshing ? "animate-spin" : ""}`}
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
          </Button>
          <Button
            onClick={() => setIsJoiningByCode(true)}
            variant="secondary"
            size="lg"
            disabled={isConnecting}
          >
            Join Room
          </Button>
          <Button
            onClick={() => setIsCreating(true)}
            variant="primary"
            size="lg"
            isLoading={isConnecting}
          >
            Create Room
          </Button>
        </div>
      </motion.div>

      {/* Loading State */}
      {isLoadingRooms && availableRooms.length === 0 && (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="card p-4 animate-pulse">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-surface-700" />
                <div className="flex-1">
                  <div className="h-5 bg-surface-700 rounded w-32 mb-2" />
                  <div className="h-4 bg-surface-700 rounded w-24" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Game Filter Chips */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => setGameFilter(null)}
          className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
            gameFilter === null
              ? "bg-primary-500 text-white"
              : "bg-surface-800 text-surface-300 hover:bg-surface-700"
          }`}
        >
          All Games
        </button>
        {Object.entries(gameLabels).map(([type, label]) => (
          <button
            key={type}
            onClick={() =>
              setGameFilter(gameFilter === (type as GameType) ? null : (type as GameType))
            }
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              gameFilter === type
                ? "bg-primary-500 text-white"
                : "bg-surface-800 text-surface-300 hover:bg-surface-700"
            }`}
          >
            {type === GameType.ROCK_PAPER_SCISSORS ? "RPS" : label}
          </button>
        ))}
      </div>

      {/* Room List */}
      {!isLoadingRooms || availableRooms.length > 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="space-y-3"
        >
          {availableRooms.filter((r) => gameFilter === null || r.gameType === gameFilter).length ===
          0 ? (
            <div className="card p-12 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-surface-800 flex items-center justify-center">
                <svg
                  className="w-8 h-8 text-surface-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                  />
                </svg>
              </div>
              <p className="text-surface-400 mb-4">No rooms available</p>
              <p className="text-surface-500 text-sm mb-6">Be the first to create a game!</p>
              <div className="flex gap-3 justify-center">
                <Button
                  onClick={() => setIsJoiningByCode(true)}
                  variant="secondary"
                  disabled={isConnecting}
                >
                  Join Room
                </Button>
                <Button onClick={() => setIsCreating(true)}>Create a Room</Button>
              </div>
            </div>
          ) : (
            availableRooms
              .filter((r) => gameFilter === null || r.gameType === gameFilter)
              .map((room, index) => (
                <motion.div
                  key={room.roomId}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.05 * index }}
                >
                  <RoomCard
                    room={room}
                    onJoin={() => handleJoinRoom(room.roomId)}
                    isJoining={isConnecting}
                  />
                </motion.div>
              ))
          )}
        </motion.div>
      ) : null}

      {/* Create Room Modal */}
      {isCreating && (
        <CreateRoomModal
          onClose={() => setIsCreating(false)}
          onCreate={handleCreateRoom}
          isCreating={isConnecting}
          preselectedGame={(preselectedGame as GameType) || undefined}
        />
      )}

      {/* Join Room Modal */}
      {isJoiningByCode && (
        <JoinRoomModal
          onClose={() => setIsJoiningByCode(false)}
          onJoin={(roomCode) => {
            setIsJoiningByCode(false);
            router.push(`/game/${roomCode.trim()}`);
          }}
        />
      )}
    </div>
  );
}

function RoomCard({
  room,
  onJoin,
  isJoining,
}: {
  room: LobbyRoom;
  onJoin: () => void;
  isJoining: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const timeAgo = Math.floor((Date.now() - room.createdAt) / 60000);
  const isFull = room.playerCount >= room.maxPlayers;
  const isInProgress = room.status === GameStatus.IN_PROGRESS;

  const handleCopySlug = useCallback(() => {
    if (!room.roomSlug) return;
    const url = `${window.location.origin}/game/${room.roomSlug}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [room.roomSlug]);

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gameColors[room.gameType]} flex items-center justify-center text-white font-bold`}
          >
            {gameLabels[room.gameType].charAt(0)}
          </div>
          <div>
            <div className="font-medium text-white">{room.hostName}</div>
            <div className="text-xs text-surface-400 flex items-center gap-2">
              {gameLabels[room.gameType]}
              {room.vsBot && (
                <span className="inline-flex items-center rounded-full bg-accent/20 px-1.5 py-0.5 text-xs text-accent">
                  🤖 Bot
                </span>
              )}
            </div>
          </div>
        </div>
        {isInProgress && (
          <span className="text-xs px-2 py-1 rounded-full bg-success/20 text-success border border-success/50">
            In Progress
          </span>
        )}
      </div>

      <div className="flex items-center justify-between">
        <div className="text-sm text-surface-400">
          <span className={isFull ? "text-error" : room.playerCount > 0 ? "text-success" : ""}>
            {room.playerCount}/{room.maxPlayers} players
          </span>
          {room.spectatorCount > 0 && (
            <>
              <span className="mx-1">·</span>
              <span className="text-surface-500">👁 {room.spectatorCount}</span>
            </>
          )}
          <span className="mx-2">•</span>
          <span>{timeAgo}m ago</span>
        </div>

        <div className="flex items-center gap-2">
          {room.roomSlug && (
            <button
              onClick={handleCopySlug}
              title={copied ? "Copied!" : "Copy invite link"}
              className="text-surface-400 hover:text-accent transition-colors p-1 rounded"
            >
              {copied ? (
                <svg
                  className="w-4 h-4 text-success"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
              )}
            </button>
          )}
          <Button
            onClick={onJoin}
            variant={isInProgress ? "secondary" : isFull ? "ghost" : "primary"}
            size="sm"
            disabled={isJoining}
            isLoading={isJoining}
          >
            {isInProgress ? "Spectate" : isFull ? "Full" : "Join"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CreateRoomModal({
  onClose,
  onCreate,
  isCreating,
  preselectedGame,
}: {
  onClose: () => void;
  onCreate: (gameType: GameType, vsBot?: boolean, difficulty?: "easy" | "medium" | "hard") => void;
  isCreating: boolean;
  preselectedGame?: GameType;
}) {
  const [selectedGame, setSelectedGame] = useState<GameType | null>(preselectedGame || null);
  const [mode, setMode] = useState<"select" | "options">(preselectedGame ? "options" : "select");
  const [vsBot, setVsBot] = useState(false);
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("medium");

  const availableGames = [
    GameType.CONNECT4,
    GameType.ROCK_PAPER_SCISSORS,
    GameType.QUORIDOR,
    GameType.SEQUENCE,
    GameType.CATAN,
    GameType.SPLENDOR,
    GameType.MONOPOLY_DEAL,
    GameType.BLACKJACK,
  ];
  const botSupported =
    selectedGame === GameType.CONNECT4 ||
    selectedGame === GameType.ROCK_PAPER_SCISSORS ||
    selectedGame === GameType.QUORIDOR ||
    selectedGame === GameType.SEQUENCE ||
    selectedGame === GameType.CATAN ||
    selectedGame === GameType.SPLENDOR ||
    selectedGame === GameType.MONOPOLY_DEAL ||
    selectedGame === GameType.BLACKJACK;

  const handleGameSelect = (gameType: GameType) => {
    setSelectedGame(gameType);
    setMode("options");
  };

  const handleCreate = () => {
    if (selectedGame) {
      const useBot = botSupported && vsBot;
      onCreate(selectedGame, useBot, difficulty);
    }
  };

  const handleBack = () => {
    setMode("select");
    setSelectedGame(null);
    setVsBot(false);
    setDifficulty("medium");
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 bg-surface-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Create a Room"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="card p-6 w-full max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {mode === "select" ? (
          <>
            <h2 className="text-xl font-display font-semibold mb-4">Create a Room</h2>
            <p className="text-surface-400 text-sm mb-6">Choose a game to create a new room</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-96 overflow-y-auto">
              {availableGames.map((gameType) => (
                <button
                  key={gameType}
                  onClick={() => handleGameSelect(gameType)}
                  disabled={isCreating}
                  className="p-4 rounded-xl bg-surface-800 hover:bg-surface-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex flex-col items-center gap-3 text-center group"
                >
                  <div
                    className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${gameColors[gameType]} flex items-center justify-center text-white font-bold text-2xl shadow-lg group-hover:scale-110 transition-transform`}
                  >
                    {gameLabels[gameType].charAt(0)}
                  </div>
                  <div>
                    <div className="font-medium text-white group-hover:text-primary-400 transition-colors">
                      {gameLabels[gameType]}
                    </div>
                    <div className="text-sm text-surface-400">{gamePlayerCounts[gameType]}</div>
                    {(gameType === GameType.CONNECT4 ||
                      gameType === GameType.ROCK_PAPER_SCISSORS ||
                      gameType === GameType.QUORIDOR ||
                      gameType === GameType.SEQUENCE ||
                      gameType === GameType.CATAN ||
                      gameType === GameType.SPLENDOR ||
                      gameType === GameType.MONOPOLY_DEAL) && (
                      <div className="text-xs px-2 py-0.5 rounded-full bg-primary-500/20 text-primary-400 mt-1 inline-block">
                        🤖 Bot Available
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-6">
              <button
                onClick={handleBack}
                className="p-2 rounded-lg hover:bg-surface-800 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
              </button>
              <div>
                <h2 className="text-xl font-display font-semibold">
                  {selectedGame ? gameLabels[selectedGame] : "Game"}
                </h2>
                <p className="text-surface-400 text-sm">Choose game mode</p>
              </div>
            </div>

            {/* Play mode selection */}
            <div className="space-y-3 mb-6">
              <button
                onClick={() => setVsBot(false)}
                className={`w-full p-4 rounded-xl transition-colors flex items-center gap-4 text-left ${
                  !vsBot
                    ? "bg-primary-500/20 border-2 border-primary-500"
                    : "bg-surface-800 hover:bg-surface-700 border-2 border-transparent"
                }`}
              >
                <div className="w-10 h-10 rounded-lg bg-surface-700 flex items-center justify-center text-xl">
                  👥
                </div>
                <div>
                  <div className="font-medium">Play vs Human</div>
                  <div className="text-sm text-surface-400">Wait for another player to join</div>
                </div>
              </button>

              <button
                onClick={() => botSupported && setVsBot(true)}
                disabled={!botSupported}
                className={`w-full p-4 rounded-xl transition-colors flex items-center gap-4 text-left ${
                  vsBot && botSupported
                    ? "bg-primary-500/20 border-2 border-primary-500"
                    : "bg-surface-800 hover:bg-surface-700 border-2 border-transparent"
                } ${!botSupported ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <div className="w-10 h-10 rounded-lg bg-surface-700 flex items-center justify-center text-xl">
                  🤖
                </div>
                <div>
                  <div className="font-medium">Play vs Bot</div>
                  <div className="text-sm text-surface-400">
                    {botSupported ? "Practice against AI" : "Not available for this game"}
                  </div>
                </div>
              </button>
            </div>

            {/* Bot difficulty selection - only for games that support it (not RPS) */}
            {vsBot && botSupported && selectedGame !== GameType.ROCK_PAPER_SCISSORS && (
              <div className="mb-6">
                <label className="text-sm text-surface-400 mb-2 block">Bot Difficulty</label>
                <div className="flex gap-2">
                  {(["easy", "medium", "hard"] as const).map((d) => (
                    <button
                      key={d}
                      onClick={() => setDifficulty(d)}
                      className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium capitalize transition-colors ${
                        difficulty === d
                          ? "bg-primary-500 text-white"
                          : "bg-surface-800 text-surface-400 hover:bg-surface-700"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <Button
              onClick={handleCreate}
              variant="primary"
              className="w-full"
              isLoading={isCreating}
            >
              {vsBot ? "Start Game" : "Create Room"}
            </Button>
          </>
        )}

        <div className="mt-6 flex justify-end">
          <Button variant="ghost" onClick={onClose} disabled={isCreating}>
            Cancel
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function JoinRoomModal({
  onClose,
  onJoin,
}: {
  onClose: () => void;
  onJoin: (roomCode: string) => void;
}) {
  const [roomCode, setRoomCode] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = roomCode.trim();
    if (trimmed) {
      onJoin(trimmed);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 bg-surface-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Join a Room"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="card p-6 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-display font-semibold mb-2">Join a Room</h2>
        <p className="text-surface-400 text-sm mb-6">Enter the room code or share link to join</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="room-code-input" className="text-sm text-surface-400 mb-2 block">
              Room Code
            </label>
            <input
              id="room-code-input"
              type="text"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. abc-def-ghi"
              autoFocus
              autoComplete="off"
              className="w-full px-4 py-3 rounded-xl bg-surface-800 border border-surface-700 text-white placeholder-surface-500 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-colors"
            />
          </div>

          <div className="flex gap-3">
            <Button type="submit" variant="primary" className="flex-1" disabled={!roomCode.trim()}>
              Join Room
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
