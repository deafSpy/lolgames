import { Client, Room } from "colyseus.js";
import type { Schema } from "@colyseus/schema";

// Singleton client instance
let client: Client | null = null;

const GAME_SERVER_URL = process.env.NEXT_PUBLIC_GAME_SERVER_URL || "ws://localhost:3002";

/**
 * Get or create the Colyseus client instance
 */
export function getClient(): Client {
  if (!client) {
    client = new Client(GAME_SERVER_URL);
  }
  return client;
}

/**
 * Join or create a room by name
 */
export async function joinOrCreate<T extends Schema>(
  roomName: string,
  options?: Record<string, unknown>
): Promise<Room<T>> {
  const colyseusClient = getClient();
  return await colyseusClient.joinOrCreate<T>(roomName, options);
}

/**
 * Join a specific room by ID
 */
export async function joinById<T extends Schema>(
  roomId: string,
  options?: Record<string, unknown>
): Promise<Room<T>> {
  const colyseusClient = getClient();
  return await colyseusClient.joinById<T>(roomId, options);
}

/**
 * Create a new room
 */
export async function create<T extends Schema>(
  roomName: string,
  options?: Record<string, unknown>
): Promise<Room<T>> {
  const colyseusClient = getClient();
  return await colyseusClient.create<T>(roomName, options);
}

/**
 * Room listing interface
 */
export interface RoomListing {
  roomId: string;
  clients: number;
  maxClients: number;
  spectatorCount?: number;
  name: string;
  metadata?: Record<string, unknown>;
}

/**
 * Subscribe to room list changes using Server-Sent Events (SSE).
 *
 * Native EventSource auto-reconnects with a fixed delay; we wrap it so the
 * client backs off exponentially (1s → 2s → 4s → … capped at 30s) on
 * transient disconnects, and resets on a successful open. Returns a cleanup
 * function that hard-closes the underlying connection and stops backoff.
 */
export function subscribeToLobbyUpdates(
  callback: (rooms: RoomListing[]) => void,
  onConnectionChange?: (connected: boolean) => void
): () => void {
  const httpUrl = GAME_SERVER_URL.replace("ws://", "http://").replace("wss://", "https://");
  const streamUrl = `${httpUrl}/api/lobby/stream`;

  const INITIAL_BACKOFF_MS = 1_000;
  const MAX_BACKOFF_MS = 30_000;

  let eventSource: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = INITIAL_BACKOFF_MS;
  let stopped = false;

  const handleEventData = (raw: string) => {
    try {
      const data = JSON.parse(raw);
      if (data.type === "initial" || data.type === "update" || data.type === "full_refresh") {
        callback(data.lobbies || []);
      } else if (data.type === "created" || data.type === "updated" || data.type === "deleted") {
        // Incremental events: re-pull authoritative room list. Keeps client
        // simple at the cost of one extra GET; fine for Phase 1 volumes.
        getAvailableRooms().then(callback).catch(console.error);
      }
    } catch (error) {
      console.error("Error parsing lobby update:", error);
    }
  };

  const connect = () => {
    if (stopped) return;

    const es = new EventSource(streamUrl);
    eventSource = es;

    es.onopen = () => {
      backoffMs = INITIAL_BACKOFF_MS;
      console.log("Lobby SSE connection established");
      onConnectionChange?.(true);
    };

    es.onmessage = (event) => handleEventData(event.data);

    es.onerror = () => {
      if (stopped) return;
      console.warn("Lobby SSE disconnected, scheduling reconnect in", backoffMs, "ms");
      onConnectionChange?.(false);

      // Tear down the dead connection so the browser doesn't double-retry.
      try {
        es.close();
      } catch {
        // ignore
      }
      if (eventSource === es) eventSource = null;

      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        connect();
      }, backoffMs);
    };
  };

  connect();

  return () => {
    stopped = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    onConnectionChange?.(false);
  };
}

/**
 * Get available rooms by name - using HTTP endpoint
 */
export async function getAvailableRooms(roomName?: string): Promise<RoomListing[]> {
  try {
    const httpUrl = GAME_SERVER_URL.replace("ws://", "http://").replace("wss://", "https://");
    const url = roomName ? `${httpUrl}/api/rooms/${roomName}` : `${httpUrl}/api/rooms`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      // Ensure we don't use cached responses
      cache: "no-store",
    });
    if (!response.ok) {
      console.warn(`Failed to fetch rooms: ${response.status} ${response.statusText}`);
      return [];
    }
    const rooms = await response.json();
    console.log("Raw rooms data from server:", rooms);
    return Array.isArray(rooms) ? rooms : [];
  } catch (error) {
    console.error("Error fetching rooms:", error);
    return [];
  }
}

export interface SlugLookupResult {
  roomId: string;
  roomSlug: string;
  name: string;
  clients: number;
  maxClients: number;
  locked: boolean;
  private: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Look up a room by its human-readable slug.
 * Returns null when the slug doesn't exist or the request fails.
 */
export async function lookupRoomBySlug(slug: string): Promise<SlugLookupResult | null> {
  try {
    const httpUrl = GAME_SERVER_URL.replace("ws://", "http://").replace("wss://", "https://");
    const response = await fetch(`${httpUrl}/api/rooms/slug/${encodeURIComponent(slug)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as SlugLookupResult;
  } catch {
    return null;
  }
}

/**
 * Reconnect to a room using cached session data
 */
export async function reconnect<T extends Schema>(reconnectionToken: string): Promise<Room<T>> {
  const colyseusClient = getClient();
  return await colyseusClient.reconnect<T>(reconnectionToken);
}

// Session storage helpers
const SESSION_KEY = "multiplayer_session";
const BROWSER_SESSION_KEY = "browser_session_id";

interface SessionData {
  roomId: string;
  sessionId: string;
  reconnectionToken: string;
  gameType: string;
  browserSessionId: string; // Unique ID for this browser instance
}

/**
 * Get or create a unique browser session ID
 * This ensures each new browser instance/tab has a different player ID
 */
export function getBrowserSessionId(): string {
  if (typeof window === "undefined") return "";

  let sessionId = sessionStorage.getItem(BROWSER_SESSION_KEY);
  if (!sessionId) {
    // Generate a unique ID for this browser session (not persisted across browser restart)
    sessionId = `browser_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    sessionStorage.setItem(BROWSER_SESSION_KEY, sessionId);
  }
  return sessionId;
}

/**
 * Save session data for reconnection
 */
export function saveSession(data: SessionData): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
  }
}

/**
 * Get saved session data
 */
export function getSession(): SessionData | null {
  if (typeof window === "undefined") return null;
  const data = localStorage.getItem(SESSION_KEY);
  if (!data) return null;

  const sessionData = JSON.parse(data) as SessionData;
  // Validate browser session matches - if different browser session, don't reconnect
  if (sessionData.browserSessionId !== getBrowserSessionId()) {
    return null;
  }

  return sessionData;
}

/**
 * Clear saved session
 */
export function clearSession(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem(SESSION_KEY);
  }
}

// Per-room reconnect token storage — keyed by roomId so tokens survive
// component unmounts without being clobbered by other room sessions.
const RECONNECT_TOKEN_PREFIX = "lolgames_reconnect_";

/**
 * Persist a Colyseus reconnection token for a specific room.
 * Survives component unmount and same-tab navigation.
 */
export function saveReconnectToken(roomId: string, token: string): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(`${RECONNECT_TOKEN_PREFIX}${roomId}`, token);
  }
}

/**
 * Retrieve a persisted reconnect token for a room. Returns null if missing or
 * if the stored value doesn't match the expected "roomId:token" format (which
 * can happen when reconnectionToken was undefined at save time and localStorage
 * stringified it as the literal string "undefined").
 */
export function getReconnectToken(roomId: string): string | null {
  if (typeof window === "undefined") return null;
  const token = localStorage.getItem(`${RECONNECT_TOKEN_PREFIX}${roomId}`);
  if (!token || !token.includes(":")) return null;
  return token;
}

/**
 * Remove the persisted reconnect token for a room (explicit leave or game end).
 */
export function clearReconnectToken(roomId: string): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem(`${RECONNECT_TOKEN_PREFIX}${roomId}`);
  }
}
