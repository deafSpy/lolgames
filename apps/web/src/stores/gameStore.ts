"use client";

import { create } from "zustand";
import type { Room } from "colyseus.js";
import type { Schema } from "@colyseus/schema";
import { GameStatus, GameType, type LobbyRoom } from "@multiplayer/shared";
import {
  joinOrCreate,
  joinById,
  getAvailableRooms,
  saveSession,
  clearSession,
  saveReconnectToken,
  clearReconnectToken,
  create as createRoomDirect,
  getBrowserSessionId,
  subscribeToLobbyUpdates,
  type RoomListing,
} from "@/lib/colyseus";
import { useAuthStore } from "./authStore";

// Valid GameType wire values (e.g. "connect4", "rps"), used to validate
// untrusted room metadata coming off the lobby stream / REST listing.
const VALID_GAME_TYPES = new Set<string>(Object.values(GameType));

/**
 * Normalize a game type from room metadata or a room name into a valid
 * GameType. Bot rooms carry a "_bot" suffix (e.g. "quoridor_bot") that is not
 * a valid GameType, so it must be stripped; any unknown value falls back to
 * CONNECT4 so the lobby never renders an undefined label/color.
 */
/**
 * Authoritative seat count per game type.
 * Used to correct the lobby listing when the server returns maxClients=100
 * (the spectator-inclusive cap) instead of the real game seat count.
 */
const GAME_MAX_PLAYERS: Record<string, number> = {
  connect4: 2,
  rps: 2,
  quoridor: 4,
  sequence: 4,
  catan: 4,
  splendor: 4,
  monopoly_deal: 5,
  blackjack: 7,
};

function normalizeGameType(rawGameType: unknown, roomName?: string): GameType {
  for (const candidate of [typeof rawGameType === "string" ? rawGameType : undefined, roomName]) {
    if (!candidate) continue;
    const stripped = candidate.replace("_bot", "");
    if (VALID_GAME_TYPES.has(stripped)) {
      return stripped as GameType;
    }
  }
  return GameType.CONNECT4;
}

interface GameStore {
  // Connection state
  room: Room<Schema> | null;
  isConnecting: boolean;
  connectionError: string | null;
  roomSlug: string | null;

  // Lobby state
  availableRooms: LobbyRoom[];
  isLoadingRooms: boolean;

  // Player state
  playerId: string | null;
  playerName: string;

  // Actions
  setPlayerName: (name: string) => void;
  fetchRooms: (gameType?: string) => Promise<void>;
  subscribeToLobby: (onConnectionChange?: (connected: boolean) => void) => () => void;
  createRoom: (gameType: GameType, options?: Record<string, unknown>) => Promise<string | null>;
  createBotRoom: (
    gameType: GameType,
    difficulty?: "easy" | "medium" | "hard"
  ) => Promise<string | null>;
  joinRoom: (roomId: string) => Promise<boolean>;
  leaveRoom: () => Promise<void>;
  sendMessage: (type: string, data?: Record<string, unknown>) => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  // Initial state
  room: null,
  isConnecting: false,
  connectionError: null,
  roomSlug: null,
  availableRooms: [],
  isLoadingRooms: true,
  playerId: null,
  playerName: `Guest_${Math.random().toString(36).substring(2, 6)}`,

  setPlayerName: (name: string) => {
    set({ playerName: name });
  },

  subscribeToLobby: (onConnectionChange?: (connected: boolean) => void) => {
    console.log("Subscribing to lobby updates via SSE");
    return subscribeToLobbyUpdates((lobbies) => {
      console.log("Received lobby update:", lobbies.length, "rooms");
      const lobbyRooms: LobbyRoom[] = lobbies.map((room) => {
        // Normalize game type from metadata or room name (strips the "_bot"
        // suffix on bot rooms; unknown values fall back to CONNECT4).
        const gameType = normalizeGameType(room.metadata?.gameType, room.name);

        // Get status from metadata, fallback to checking player count
        const status =
          (room.metadata?.status as GameStatus) ||
          (room.clients >= room.maxClients ? GameStatus.IN_PROGRESS : GameStatus.WAITING);

        return {
          roomId: room.roomId,
          gameType,
          hostName: (room.metadata?.hostName as string) || "Unknown",
          playerCount: room.clients,
          maxPlayers:
            GAME_MAX_PLAYERS[normalizeGameType(room.metadata?.gameType, room.name)] ??
            room.maxClients,
          spectatorCount: room.spectatorCount ?? 0,
          status,
          createdAt: (room.metadata?.createdAt as number) || Date.now(),
          vsBot: room.name?.includes("_bot") || false,
          roomSlug: (room.metadata?.roomSlug as string) || undefined,
        };
      });
      set({ availableRooms: lobbyRooms, isLoadingRooms: false });
    }, onConnectionChange);
  },

  fetchRooms: async (gameType?: string) => {
    set({ isLoadingRooms: true });
    try {
      console.log("Fetching rooms for gameType:", gameType);
      const rooms = await getAvailableRooms(gameType);
      console.log("Fetched rooms:", rooms);
      const lobbyRooms: LobbyRoom[] = rooms.map((room: RoomListing) => {
        // Normalize game type from metadata or room name (strips the "_bot"
        // suffix on bot rooms; unknown values fall back to CONNECT4).
        const gameType = normalizeGameType(room.metadata?.gameType, room.name);

        // Get status from metadata, fallback to checking player count
        const status =
          (room.metadata?.status as GameStatus) ||
          (room.clients >= room.maxClients ? GameStatus.IN_PROGRESS : GameStatus.WAITING);

        return {
          roomId: room.roomId,
          gameType,
          hostName: (room.metadata?.hostName as string) || "Unknown",
          playerCount: room.clients,
          maxPlayers:
            GAME_MAX_PLAYERS[normalizeGameType(room.metadata?.gameType, room.name)] ??
            room.maxClients,
          spectatorCount: room.spectatorCount ?? 0,
          status,
          createdAt: (room.metadata?.createdAt as number) || Date.now(),
          vsBot: room.name?.includes("_bot") || false,
          roomSlug: (room.metadata?.roomSlug as string) || undefined,
        };
      });
      console.log("Mapped lobby rooms:", lobbyRooms);
      set({ availableRooms: lobbyRooms });
    } catch (error) {
      console.error("Failed to fetch rooms:", error);
    } finally {
      set({ isLoadingRooms: false });
    }
  },

  createRoom: async (gameType: GameType, options = {}) => {
    clearSession(); // avoid stale reconnection tokens when creating
    const { playerName } = get();
    const authUserId = useAuthStore.getState().user?.id;
    const browserSessionId = getBrowserSessionId();
    set({ isConnecting: true, connectionError: null });

    try {
      // Force a new roomId each time by using create (not joinOrCreate)
      const room = await createRoomDirect(gameType, {
        ...options,
        playerName,
        hostName: playerName,
        createdAt: Date.now(),
        browserSessionId,
        userId: authUserId,
      });

      setupRoomListeners(room, set);
      room.onMessage("room_info", (data: { roomSlug?: string }) => {
        if (data.roomSlug) set({ roomSlug: data.roomSlug });
      });
      saveSession({
        roomId: room.roomId,
        sessionId: room.sessionId,
        reconnectionToken: room.reconnectionToken,
        gameType,
        browserSessionId: getBrowserSessionId(),
      });
      if (room.reconnectionToken) saveReconnectToken(room.roomId, room.reconnectionToken);

      set({
        room,
        playerId: room.sessionId,
        isConnecting: false,
      });
      scheduleSlugFallback(room.roomId);

      return room.roomId;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create room";
      set({ connectionError: message, isConnecting: false });
      return null;
    }
  },

  createBotRoom: async (gameType: GameType, difficulty = "medium") => {
    clearSession(); // avoid stale reconnection tokens when creating
    const { playerName } = get();
    const authUserId = useAuthStore.getState().user?.id;
    const browserSessionId = getBrowserSessionId();
    set({ isConnecting: true, connectionError: null });

    try {
      // Games with bot support
      const supportsBot =
        gameType === GameType.CONNECT4 ||
        gameType === GameType.ROCK_PAPER_SCISSORS ||
        gameType === GameType.QUORIDOR ||
        gameType === GameType.SEQUENCE ||
        gameType === GameType.CATAN ||
        gameType === GameType.SPLENDOR ||
        gameType === GameType.MONOPOLY_DEAL ||
        gameType === GameType.BLACKJACK;
      const roomName = supportsBot ? `${gameType}_bot` : gameType;
      // Force a fresh bot room each time
      const room = await createRoomDirect(roomName, {
        playerName,
        hostName: playerName,
        createdAt: Date.now(),
        vsBot: supportsBot,
        difficulty,
        browserSessionId,
        userId: authUserId,
      });

      setupRoomListeners(room, set);
      room.onMessage("room_info", (data: { roomSlug?: string }) => {
        if (data.roomSlug) set({ roomSlug: data.roomSlug });
      });
      saveSession({
        roomId: room.roomId,
        sessionId: room.sessionId,
        reconnectionToken: room.reconnectionToken,
        gameType: roomName,
        browserSessionId: getBrowserSessionId(),
      });
      if (room.reconnectionToken) saveReconnectToken(room.roomId, room.reconnectionToken);

      set({
        room,
        playerId: room.sessionId,
        isConnecting: false,
      });
      scheduleSlugFallback(room.roomId);

      return room.roomId;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create bot game";
      set({ connectionError: message, isConnecting: false });
      return null;
    }
  },

  joinRoom: async (roomId: string) => {
    const { playerName } = get();
    const authUserId = useAuthStore.getState().user?.id;
    const browserSessionId = getBrowserSessionId();
    set({ isConnecting: true, connectionError: null });

    try {
      const room = await joinById(roomId, { playerName, browserSessionId, userId: authUserId });

      setupRoomListeners(room, set);
      room.onMessage("room_info", (data: { roomSlug?: string }) => {
        if (data.roomSlug) set({ roomSlug: data.roomSlug });
      });
      saveSession({
        roomId: room.roomId,
        sessionId: room.sessionId,
        reconnectionToken: room.reconnectionToken,
        gameType: (room.name as GameType) || GameType.CONNECT4,
        browserSessionId: getBrowserSessionId(),
      });
      if (room.reconnectionToken) saveReconnectToken(room.roomId, room.reconnectionToken);

      set({
        room,
        playerId: room.sessionId,
        isConnecting: false,
      });
      scheduleSlugFallback(room.roomId);

      return true;
    } catch (error) {
      let message = "Failed to join room";
      if (error instanceof Error) {
        // Check for common error messages from Colyseus
        if (error.message.includes("not found") || error.message.includes("INVALID_ROOM_ID")) {
          message = `Room ${roomId} not found. It may have ended or the code is incorrect.`;
        } else if (error.message.includes("full") || error.message.includes("ROOM_IS_FULL")) {
          message = "This room is full. Please try another room.";
        } else {
          message = error.message;
        }
      }
      set({ connectionError: message, isConnecting: false });
      return false;
    }
  },

  leaveRoom: async () => {
    const { room } = get();
    if (room) {
      clearReconnectToken(room.roomId);
      await room.leave();
      clearSession();
      set({ room: null, playerId: null, roomSlug: null });
    }
  },

  sendMessage: (type: string, data = {}) => {
    const { room } = get();
    if (room) {
      room.send(type, data);
    }
  },
}));

// REST fallback: if the room_info WebSocket message was missed (race condition
// where server sends it before the client JOIN_ROOM promise resolves), fetch
// the slug from the matchmaker REST API after a short delay.
function scheduleSlugFallback(roomId: string): void {
  setTimeout(async () => {
    if (useGameStore.getState().roomSlug) return;
    try {
      const rooms = await getAvailableRooms();
      const found = rooms.find((r: RoomListing) => r.roomId === roomId);
      const slug = found?.metadata?.roomSlug as string | undefined;
      if (slug) useGameStore.setState({ roomSlug: slug });
    } catch {
      // Non-critical — slug fallback failed silently
    }
  }, 2000);
}

// Helper to set up room event listeners
function setupRoomListeners(room: Room<Schema>, set: (state: Partial<GameStore>) => void) {
  room.onLeave((code) => {
    console.warn("Left room with code:", code);
    clearSession();
    set({ room: null, playerId: null });
  });

  room.onError((code, message) => {
    console.error("Room error:", code, message);
    set({ connectionError: message || `Error code: ${code}` });
  });

  // State change listener - game-specific stores will handle this
  room.onStateChange((state) => {
    // Base state tracking can be added here
    console.warn("State changed:", state);
  });
}
