import { config as loadEnv } from "dotenv";

// Ensure environment variables are loaded
console.log('🔧 Current working directory:', process.cwd());
console.log('🔧 Loading .env file...');
const envResult = loadEnv({ path: '.env', debug: true });
console.log('🔧 dotenv result:', envResult);
console.log('🔧 Environment after loading:', {
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ? 'SET' : 'NOT SET',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ? 'SET' : 'NOT SET',
  JWT_SECRET: process.env.JWT_SECRET ? 'SET' : 'NOT SET'
});

import type { FastifyInstance } from "fastify";
import fastifyExpress from "@fastify/express";
import { auth, JWT } from "@colyseus/auth";
import { nanoid } from "nanoid";
import { config } from "./config.js";
import { logger } from "./logger.js";
import type { ParticipantIdentity } from "./services/historyService.js";

interface UserRecord extends ParticipantIdentity {
  email?: string;
  password?: string;
  verified?: boolean;
  provider?: string;
  createdAt: number;
}

const usersByEmail = new Map<string, UserRecord>();
const usersById = new Map<string, UserRecord>();

function toUserPayload(user: UserRecord) {
  return {
    id: user.userId || user.identity,
    email: user.email,
    displayName: user.displayName,
    verified: user.verified ?? false,
    provider: user.provider ?? "password",
    createdAt: user.createdAt,
  };
}

export async function registerAuth(app: FastifyInstance) {
  console.log('🔐 Starting auth registration...');

  // Force reload environment variables
  console.log('🔧 Force reloading .env...');
  const forceResult = loadEnv({ path: '.env', override: true });
  console.log('🔧 Force reload result:', forceResult);

  console.log('🔐 Environment variables loaded:', {
    JWT_SECRET: !!process.env.JWT_SECRET,
    GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: !!process.env.GOOGLE_CLIENT_SECRET,
    BACKEND_URL: process.env.BACKEND_URL,
    NODE_ENV: process.env.NODE_ENV
  });

  // Verify JWT secret is available
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is required. Please check that .env file exists in the server directory.');
  }

  // Set JWT secret - required for @colyseus/auth
  JWT.settings.secret = process.env.JWT_SECRET;
  console.log('✅ JWT secret configured');

  auth.backend_url =
    config.nodeEnv === "production"
      ? process.env.BACKEND_URL || "https://your-game.io"
      : `http://${config.host}:${config.port}`;

  console.log('🔗 Auth backend URL set to:', auth.backend_url);
  console.log('🔗 Expected Google OAuth callback URL:', `${auth.backend_url}/auth/provider/google/callback`);

  auth.settings.onFindUserByEmail = async (email: string) => {
    const user = usersByEmail.get(email.toLowerCase());
    if (!user) {
      throw new Error("User not found");
    }
    // Colyseus auth expects an object with at least a password field
    // The password field must exist for authentication to work
    if (!user.password) {
      throw new Error("User account is missing password");
    }
    return {
      password: user.password
    };
  };

  auth.settings.onRegisterWithEmailAndPassword = async (email, password, options) => {
    const normalizedEmail = email.toLowerCase();
    if (usersByEmail.has(normalizedEmail)) {
      throw new Error("Email already registered");
    }

    const userId = nanoid();
    const record: UserRecord = {
      identity: `user:${userId}`,
      userId,
      email: normalizedEmail,
      password,
      displayName: options?.displayName || normalizedEmail.split("@")[0],
      verified: false,
      createdAt: Date.now(),
      provider: "password",
    };

    usersByEmail.set(normalizedEmail, record);
    usersById.set(userId, record);
    return toUserPayload(record);
  };

  auth.settings.onRegisterAnonymously = async (options) => {
    const userId = nanoid();
    const record: UserRecord = {
      identity: `guest:${userId}`,
      userId,
      displayName: options?.displayName || `Guest_${userId.slice(0, 6)}`,
      createdAt: Date.now(),
      provider: "anonymous",
    };
    usersById.set(userId, record);
    return toUserPayload(record);
  };

  auth.settings.onForgotPassword = async (email: string, html: string) => {
    // Demo only - in production, integrate with an email provider.
    logger.info({ email, htmlPreview: html.slice(0, 120) }, "Password reset email would be sent");
  };

  auth.settings.onResetPassword = async (email: string, password: string) => {
    const record = usersByEmail.get(email.toLowerCase());
    if (!record) {
      throw new Error("user_not_found");
    }
    record.password = password;
    return true;
  };

  auth.settings.onSendEmailConfirmation = async (email: string, html: string, link: string) => {
    logger.info({ email, link }, "Email confirmation would be sent");
  };

  auth.settings.onEmailConfirmed = async (email: string) => {
    const record = usersByEmail.get(email.toLowerCase());
    if (record) {
      record.verified = true;
    }
    return true;
  };

  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

  console.log('🔐 Google OAuth debug:');
  console.log('  GOOGLE_CLIENT_ID exists:', !!googleClientId);
  console.log('  GOOGLE_CLIENT_SECRET exists:', !!googleClientSecret);
  console.log('  GOOGLE_CLIENT_ID value:', googleClientId ? googleClientId.substring(0, 20) + '...' : 'undefined');
  console.log('  GOOGLE_CLIENT_SECRET value:', googleClientSecret ? googleClientSecret.substring(0, 10) + '...' : 'undefined');

  if (googleClientId && googleClientSecret) {
    console.log('✅ Adding Google OAuth provider...');
    try {
      auth.oauth.addProvider("google", {
        key: googleClientId,
        secret: googleClientSecret,
        scope: ["profile", "email"]
      });
      console.log('✅ Google OAuth provider added successfully');
    } catch (error) {
      console.error('❌ Failed to add Google OAuth provider:', error);
      console.error('❌ Error details:', error.message);
    }
  } else {
    console.log('⚠️ Google OAuth credentials missing - Google sign-in disabled');
  }

  auth.oauth.onCallback(async (data, providerId) => {
    if (providerId !== "google") return data.profile || data;
    const profile = data.profile || data;
    const email = (profile.email as string | undefined)?.toLowerCase();
    const userId = profile.id || nanoid();

    let record: UserRecord | undefined;
    if (email && usersByEmail.has(email)) {
      record = usersByEmail.get(email);
    } else {
      record = {
        identity: `user:${userId}`,
        userId,
        email,
        displayName: profile.name || profile.displayName || profile.email || "Google User",
        verified: true,
        provider: "google",
        createdAt: Date.now(),
      };
      if (email) usersByEmail.set(email, record);
      usersById.set(userId, record);
    }
    return toUserPayload(record!);
  });

  auth.settings.onParseToken = async (data) => {
    // Strip sensitive fields before sending to clients.
    // Password is never included in tokens by default, this is defensive.
    const { password, ...rest } = data as Record<string, unknown>;
    return rest;
  };

  auth.settings.onGenerateToken = async (userdata) => {
    return JWT.sign(userdata);
  };

  console.log('🔧 Registering fastify-express plugin...');
  await app.register(fastifyExpress);
  console.log('✅ fastify-express plugin registered');

  console.log('🔐 Mounting auth routes at:', auth.prefix);
  console.log('🔐 Available OAuth providers:', Object.keys(auth.oauth.providers || {}));
  app.use(auth.prefix, auth.routes());
  console.log('✅ Auth routes mounted');

  console.log('🔐 Auth routes registered:', {
    prefix: auth.prefix,
    backend: auth.backend_url,
    availableRoutes: auth.routes ? 'routes available' : 'no routes'
  });

  logger.info({ prefix: auth.prefix, backend: auth.backend_url }, "Auth routes registered");
}
