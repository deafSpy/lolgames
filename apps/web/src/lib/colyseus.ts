import { Client, Room } from "colyseus.js";
import type { Schema } from "@colyseus/schema";

// Singleton client instance
let client: Client | null = null;

const GAME_SERVER_URL = process.env.NEXT_PUBLIC_GAME_SERVER_URL || "ws://localhost:3001";

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
  name: string;
  metadata?: Record<string, unknown>;
}

/**
 * Get available rooms by name - using HTTP endpoint
 */
export async function getAvailableRooms(roomName?: string): Promise<RoomListing[]> {
  try {
    const httpUrl = GAME_SERVER_URL.replace("ws://", "http://").replace("wss://", "https://");
    const url = roomName ? `${httpUrl}/api/rooms/${roomName}` : `${httpUrl}/api/rooms`;
    console.log("Fetching rooms from URL:", url);
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      // Ensure we don't use cached responses
      cache: "no-store",
    });
    console.log("Matchmaking response status:", response.status);
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
