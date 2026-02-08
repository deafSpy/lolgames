import { GameType } from "@multiplayer/shared";
import { getBrowserSessionId } from "./colyseus";

const GAME_SERVER_URL = process.env.NEXT_PUBLIC_GAME_SERVER_URL || "ws://localhost:3001";

export interface RemoteHistoryEntry {
  id: string;
  roomId: string;
  gameType: GameType;
  result: "win" | "loss" | "draw" | "aborted";
  opponent: string;
  opponentIds: string[];
  vsBot: boolean;
  endedAt: number;
  durationMs?: number;
}

export async function fetchHistory(token?: string | null): Promise<RemoteHistoryEntry[]> {
  console.log("🔍 fetchHistory called with token:", token ? "present" : "null");
  const httpUrl = GAME_SERVER_URL.replace("ws://", "http://").replace("wss://", "https://");
  const params = new URLSearchParams();
  const browserSessionId = getBrowserSessionId();
  if (browserSessionId) {
    params.set("browserSessionId", browserSessionId);
  }

  const url = `${httpUrl}/history?${params.toString()}`;
  console.log("🔍 fetchHistory URL:", url);
  console.log("🔍 fetchHistory headers:", { hasToken: !!token, browserSessionId });

  const response = await fetch(url, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Accept: "application/json",
    },
    cache: "no-store",
  });

  console.log("🔍 fetchHistory response status:", response.status);

  if (!response.ok) {
    throw new Error(`Failed to load history (${response.status})`);
  }

  const body = (await response.json()) as { games: RemoteHistoryEntry[] };
  console.log("🔍 fetchHistory received games:", body.games?.length || 0);
  return body.games || [];
}
