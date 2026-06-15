import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import type { AddressInfo } from "net";

import {
  __emitLobbyEventForTest,
  publishLobbyUpdate,
  registerLobbyStreamRoutes,
} from "./lobby-stream.js";

/**
 * Phase 1 SSE smoke tests.
 *
 * These tests run with Redis disabled, so the endpoint takes the polling
 * fallback path. They verify:
 *   - The endpoint registers, returns text/event-stream, and emits an
 *     `initial` payload (empty when Redis is down, never throws).
 *   - `publishLobbyUpdate` is a no-op when Redis is down — does not throw
 *     and does not block.
 *   - `__emitLobbyEventForTest` is callable (process-wide fanout exists)
 *     even when no clients are listening.
 */
describe("lobby-stream SSE endpoint (Redis disabled / fallback path)", () => {
  let app: ReturnType<typeof Fastify>;
  let baseUrl: string;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    await registerLobbyStreamRoutes(app);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns text/event-stream and emits an initial snapshot", async () => {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/lobby/stream`, {
      signal: controller.signal,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.body).not.toBeNull();

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    let buffer = "";
    let firstEvent: string | null = null;
    const deadline = Date.now() + 5_000;

    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const match = buffer.match(/^data: (.+)\n\n/m);
      if (match) {
        firstEvent = match[1];
        break;
      }
    }

    controller.abort();
    try {
      await reader.cancel();
    } catch {
      // expected on abort
    }

    expect(firstEvent).not.toBeNull();
    const parsed = JSON.parse(firstEvent!);
    expect(parsed.type).toBe("initial");
    // Redis disabled in test env → safe-empty list.
    expect(Array.isArray(parsed.lobbies)).toBe(true);
    expect(parsed.lobbies).toHaveLength(0);
  });

  it("publishLobbyUpdate is a safe no-op when Redis is down", async () => {
    await expect(
      publishLobbyUpdate({ type: "created", roomId: "abc", lobby: {} })
    ).resolves.toBeUndefined();
  });

  it("__emitLobbyEventForTest does not throw with no listeners", () => {
    expect(() => __emitLobbyEventForTest({ type: "updated", roomId: "abc" })).not.toThrow();
  });
});
