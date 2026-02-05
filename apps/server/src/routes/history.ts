import { config as loadEnv } from "dotenv";

loadEnv();

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { JWT } from "@colyseus/auth";
import { historyService } from "../services/historyService.js";

interface HistoryQuerystring {
  browserSessionId?: string;
}

export async function registerHistoryRoutes(app: FastifyInstance) {
  app.get(
    "/history",
    async (request: FastifyRequest<{ Querystring: HistoryQuerystring }>, reply: FastifyReply) => {
      const authHeader = request.headers.authorization;
      let identity: string | null = null;

      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.substring("Bearer ".length);
        try {
          const payload = JWT.verify(token) as { id?: string; email?: string };
          identity = payload.id ? `user:${payload.id}` : payload.email ? `user:${payload.email}` : null;
        } catch {
          // Ignore invalid token, fall back to guest lookup.
        }
      }

      if (!identity) {
        const browserSessionId = request.query.browserSessionId;
        if (browserSessionId) {
          identity = `guest:${browserSessionId}`;
        }
      }

      if (!identity) {
        return reply.status(400).send({ error: "identity_required" });
      }

      const games = historyService.getRecentGames(identity, 10);
      return {
        identity,
        games,
      };
    }
  );
}
