import { config as loadEnv } from "dotenv";

// Ensure environment variables are loaded
console.log("🔧 Current working directory:", process.cwd());
console.log("🔧 Loading .env file...");
const envResult = loadEnv({ path: ".env", debug: true });
console.log("🔧 dotenv result:", envResult);
console.log("🔧 Environment after loading:", {
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ? "SET" : "NOT SET",
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ? "SET" : "NOT SET",
  JWT_SECRET: process.env.JWT_SECRET ? "SET" : "NOT SET",
});

import type { FastifyInstance } from "fastify";
import fastifyExpress from "@fastify/express";
import { auth, JWT } from "@colyseus/auth";
import { nanoid } from "nanoid";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { userService, type User } from "./services/userService.js";
import { database } from "./services/database.js";

// In-memory fallback if database is disabled
const usersByEmail = new Map<string, User>();
const usersById = new Map<string, User>();

function toUserPayload(user: User) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    verified: !user.is_anonymous,
    provider: user.auth_provider || "password",
    createdAt: user.created_at.getTime(),
    avatarUrl: user.avatar_url,
  };
}

export async function registerAuth(app: FastifyInstance) {
  console.log("🔐 Starting auth registration...");

  // Force reload environment variables
  console.log("🔧 Force reloading .env...");
  const forceResult = loadEnv({ path: ".env", override: true });
  console.log("🔧 Force reload result:", forceResult);

  console.log("🔐 Environment variables loaded:", {
    JWT_SECRET: !!process.env.JWT_SECRET,
    GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: !!process.env.GOOGLE_CLIENT_SECRET,
    BACKEND_URL: process.env.BACKEND_URL,
    NODE_ENV: process.env.NODE_ENV,
  });

  // Verify JWT secret is available
  if (!process.env.JWT_SECRET) {
    throw new Error(
      "JWT_SECRET environment variable is required. Please check that .env file exists in the server directory."
    );
  }

  // Set JWT secret - required for @colyseus/auth
  JWT.settings.secret = process.env.JWT_SECRET;
  console.log("✅ JWT secret configured");

  auth.backend_url =
    config.nodeEnv === "production"
      ? process.env.BACKEND_URL || "https://your-game.io"
      : `http://${config.host}:${config.port}`;

  console.log("🔗 Auth backend URL set to:", auth.backend_url);
  console.log(
    "🔗 Expected Google OAuth callback URL:",
    `${auth.backend_url}/auth/provider/google/callback`
  );

  auth.settings.onFindUserById = async (id: string) => {
    console.log("🔍 onFindUserById called with:", id);
    // Use database if enabled
    if (config.database.enabled && database.connected) {
      const user = await userService.getUserById(id);
      if (!user) {
        throw new Error("User not found");
      }
      const payload = toUserPayload(user);
      console.log("🔍 onFindUserById returning:", payload);
      return payload;
    } else {
      // In-memory fallback
      const record = usersById.get(id);
      if (!record) {
        throw new Error("User not found");
      }
      return toUserPayload(record);
    }
  };

  auth.settings.onFindUserByEmail = async (email: string) => {
    console.log("🔍 onFindUserByEmail called with:", email);
    // Use database if enabled, otherwise fallback to in-memory
    if (config.database.enabled && database.connected) {
      const user = await userService.getUserByEmail(email);
      if (!user) {
        console.log("🔍 onFindUserByEmail: User not found");
        throw new Error("User not found");
      }
      if (!user.password_hash) {
        console.log("🔍 onFindUserByEmail: User has no password");
        throw new Error("User account is missing password");
      }
      console.log("🔍 onFindUserByEmail returning password hash for:", user.email);

      // IMPORTANT: Return BOTH password (for verification) AND full user data
      // This way @colyseus/auth can use the user data for the JWT
      const payload = {
        password: user.password_hash,
        ...toUserPayload(user), // Spread the full user payload
      };
      console.log("🔍 onFindUserByEmail also returning user data for JWT");
      return payload;
    } else {
      // In-memory fallback
      const user = usersByEmail.get(email.toLowerCase());
      if (!user) {
        throw new Error("User not found");
      }
      if (!user.password_hash) {
        throw new Error("User account is missing password");
      }

      // IMPORTANT: Return BOTH password (for verification) AND full user data
      const payload = {
        password: user.password_hash,
        ...toUserPayload(user), // Spread the full user payload
      };
      return payload;
    }
  };

  auth.settings.onRegisterWithEmailAndPassword = async (email, password, options) => {
    const normalizedEmail = email.toLowerCase();
    console.log("🔍 onRegisterWithEmailAndPassword called:", {
      email: normalizedEmail,
      hasOptions: !!options,
    });

    // Use database if enabled
    if (config.database.enabled && database.connected) {
      // Check if user already exists
      const existingUser = await userService.getUserByEmail(normalizedEmail);
      if (existingUser) {
        throw new Error("Email already registered");
      }

      // Create new user
      const user = await userService.createUser({
        email: normalizedEmail,
        displayName: options?.displayName || normalizedEmail.split("@")[0],
        passwordHash: password, // Colyseus auth already hashes it
        provider: "password",
      });

      const payload = toUserPayload(user);
      console.log("🔍 onRegisterWithEmailAndPassword returning payload:", payload);

      // IMPORTANT: Return just the ID so @colyseus/auth can store it in the JWT
      // Then onParseToken will hydrate it with full user data
      console.log("🔍 onRegisterWithEmailAndPassword ACTUALLY returning ID:", user.id);
      return { id: user.id };
    } else {
      // In-memory fallback
      if (usersByEmail.has(normalizedEmail)) {
        throw new Error("Email already registered");
      }

      const userId = nanoid();
      const record: User = {
        id: userId,
        email: normalizedEmail,
        password_hash: password,
        display_name: options?.displayName || normalizedEmail.split("@")[0],
        is_anonymous: false,
        auth_provider: "password",
        created_at: new Date(),
        updated_at: new Date(),
      };

      usersByEmail.set(normalizedEmail, record);
      usersById.set(userId, record);
      return toUserPayload(record);
    }
  };

  auth.settings.onRegisterAnonymously = async (options) => {
    // Use database if enabled
    if (config.database.enabled && database.connected) {
      const browserSessionId = options?.browserSessionId || nanoid();
      // Generate guest name with 4-digit random number (e.g., "Guest7382")
      const guestNumber = Math.floor(1000 + Math.random() * 9000);
      const displayName = options?.displayName || `Guest${guestNumber}`;

      const user = await userService.getOrCreateGuest(browserSessionId, displayName);
      return toUserPayload(user);
    } else {
      // In-memory fallback
      const userId = nanoid();
      const guestNumber = Math.floor(1000 + Math.random() * 9000);
      const record: User = {
        id: userId,
        display_name: options?.displayName || `Guest${guestNumber}`,
        is_anonymous: true,
        auth_provider: "anonymous",
        browser_session_id: userId,
        created_at: new Date(),
        updated_at: new Date(),
      };
      usersById.set(userId, record);
      return toUserPayload(record);
    }
  };

  auth.settings.onForgotPassword = async (email: string, html: string) => {
    // Demo only - in production, integrate with an email provider.
    logger.info({ email, htmlPreview: html.slice(0, 120) }, "Password reset email would be sent");
  };

  auth.settings.onResetPassword = async (email: string, password: string) => {
    // Use database if enabled
    if (config.database.enabled && database.connected) {
      const user = await userService.getUserByEmail(email.toLowerCase());
      if (!user) {
        throw new Error("user_not_found");
      }
      await userService.updateUser(user.id, { password_hash: password });
      return true;
    } else {
      // In-memory fallback
      const record = usersByEmail.get(email.toLowerCase());
      if (!record) {
        throw new Error("user_not_found");
      }
      record.password_hash = password;
      return true;
    }
  };

  auth.settings.onSendEmailConfirmation = async (email: string, html: string, link: string) => {
    logger.info({ email, link }, "Email confirmation would be sent");
  };

  auth.settings.onEmailConfirmed = async (email: string) => {
    // Use database if enabled
    if (config.database.enabled && database.connected) {
      const user = await userService.getUserByEmail(email.toLowerCase());
      if (user) {
        await userService.updateUser(user.id, { is_anonymous: false } as any);
      }
      return true;
    } else {
      // In-memory fallback
      const record = usersByEmail.get(email.toLowerCase());
      if (record) {
        record.is_anonymous = false;
      }
      return true;
    }
  };

  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

  console.log("🔐 Google OAuth debug:");
  console.log("  GOOGLE_CLIENT_ID exists:", !!googleClientId);
  console.log("  GOOGLE_CLIENT_SECRET exists:", !!googleClientSecret);
  console.log(
    "  GOOGLE_CLIENT_ID value:",
    googleClientId ? googleClientId.substring(0, 20) + "..." : "undefined"
  );
  console.log(
    "  GOOGLE_CLIENT_SECRET value:",
    googleClientSecret ? googleClientSecret.substring(0, 10) + "..." : "undefined"
  );

  if (googleClientId && googleClientSecret) {
    console.log("✅ Adding Google OAuth provider...");
    try {
      auth.oauth.addProvider("google", {
        key: googleClientId,
        secret: googleClientSecret,
        scope: ["profile", "email"],
      });
      console.log("✅ Google OAuth provider added successfully");
    } catch (error) {
      console.error("❌ Failed to add Google OAuth provider:", error);
      if (error instanceof Error) {
        console.error("❌ Error details:", error.message);
      }
    }
  } else {
    console.log("⚠️ Google OAuth credentials missing - Google sign-in disabled");
  }

  auth.oauth.onCallback(async (data, providerId) => {
    console.log("🔍 OAuth callback triggered:", { providerId, hasProfile: !!data.profile });

    if (providerId !== "google") return data.profile || data;
    const profile = data.profile || data;
    const email = (profile.email as string | undefined)?.toLowerCase();
    const googleId = profile.id || nanoid();
    const avatarUrl = profile.picture || profile.photos?.[0]?.value;

    console.log("🔍 Google profile data:", {
      email,
      name: profile.name,
      displayName: profile.displayName,
      googleId: googleId?.substring(0, 10) + "...",
      avatarUrl: avatarUrl?.substring(0, 30) + "...",
    });

    // Use database if enabled
    if (config.database.enabled && database.connected) {
      const displayName = profile.name || profile.displayName || profile.email || "Google User";
      const user = await userService.getOrCreateUser(
        email!,
        displayName,
        "google",
        googleId,
        avatarUrl
      );

      console.log("🔍 User created/retrieved from database:", {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        isAnonymous: user.is_anonymous,
        authProvider: user.auth_provider,
        avatarUrl: user.avatar_url?.substring(0, 30),
      });

      const payload = toUserPayload(user);
      console.log("🔍 Returning payload to client:", payload);
      return payload;
    } else {
      // In-memory fallback
      let record: User | undefined;
      if (email && usersByEmail.has(email)) {
        record = usersByEmail.get(email);
        // Update avatar if it changed
        if (avatarUrl) {
          record!.avatar_url = avatarUrl;
        }
      } else {
        const userId = nanoid();
        record = {
          id: userId,
          email,
          display_name: profile.name || profile.displayName || profile.email || "Google User",
          is_anonymous: false,
          auth_provider: "google",
          google_id: googleId,
          avatar_url: avatarUrl,
          created_at: new Date(),
          updated_at: new Date(),
        };
        if (email) usersByEmail.set(email, record);
        usersById.set(userId, record);
      }
      return toUserPayload(record!);
    }
  });

  auth.settings.onParseToken = async (data) => {
    console.log("🔍 onParseToken called with:", JSON.stringify(data, null, 2));

    // If data has an 'id', try to fetch full user data
    if (data && typeof data === "object" && "id" in data && typeof data.id === "string") {
      console.log("🔍 Token contains ID, fetching full user data...");
      try {
        if (config.database.enabled && database.connected) {
          const user = await userService.getUserById(data.id);
          if (user) {
            const fullPayload = toUserPayload(user);
            console.log("🔍 Fetched and returning full payload:", fullPayload);
            return fullPayload;
          }
        } else {
          const user = usersById.get(data.id);
          if (user) {
            const fullPayload = toUserPayload(user);
            console.log("🔍 Fetched and returning full payload (in-memory):", fullPayload);
            return fullPayload;
          }
        }
      } catch (error) {
        console.error("🔍 Failed to fetch user data:", error);
      }
    }

    // Strip sensitive fields before sending to clients
    if (typeof data === "object" && data !== null) {
      const { password, password_hash, ...rest } = data as Record<string, unknown>;
      console.log("🔍 onParseToken returning (cleaned):", rest);
      return rest;
    }

    console.log("🔍 onParseToken returning as-is:", data);
    return data;
  };

  auth.settings.onGenerateToken = async (userdata) => {
    console.log("🔍 onGenerateToken called with:", JSON.stringify(userdata, null, 2));

    // WORKAROUND: If userdata is empty or only has iat, this is a bug in @colyseus/auth
    // We need to ensure the user data is included in the JWT
    if (
      !userdata ||
      Object.keys(userdata).length === 0 ||
      (Object.keys(userdata).length === 1 && "iat" in userdata)
    ) {
      console.warn("⚠️  onGenerateToken received empty userdata - this is a @colyseus/auth bug");
      console.warn("⚠️  JWT will only contain timestamp");
    }

    const token = JWT.sign(userdata);
    console.log("🔍 onGenerateToken created token");
    return token;
  };

  console.log("🔧 Registering fastify-express plugin...");
  await app.register(fastifyExpress);
  console.log("✅ fastify-express plugin registered");

  console.log("🔐 Mounting auth routes at:", auth.prefix);
  console.log("🔐 Available OAuth providers:", Object.keys(auth.oauth.providers || {}));
  const authRoutes = auth.routes();
  if (authRoutes) {
    app.use(auth.prefix, authRoutes);
    console.log("✅ Auth routes mounted");
  } else {
    console.warn("⚠️  No auth routes available");
  }

  console.log("🔐 Auth routes registered:", {
    prefix: auth.prefix,
    backend: auth.backend_url,
    availableRoutes: typeof auth.routes === "function" ? "routes available" : "no routes",
  });

  logger.info({ prefix: auth.prefix, backend: auth.backend_url }, "Auth routes registered");
}
