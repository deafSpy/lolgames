# Authentication Setup Guide

This guide will help you set up the authentication system with Google OAuth for the multiplayer games platform.

## Prerequisites

- Node.js 20+
- pnpm 9+
- A Google Cloud Console account (for OAuth)

## Step 1: Generate Auth Secrets

The authentication system requires three secrets:

1. **AUTH_SALT**: Used to hash passwords
2. **JWT_SECRET**: Used to sign JWT tokens
3. **SESSION_SECRET**: Used to sign session cookies (for OAuth flow)

### Generate Secrets

Run this command three times to generate three different secrets:

```bash
openssl rand -base64 32
```

Or use this one-liner to generate all three at once:

```bash
echo "AUTH_SALT=$(openssl rand -base64 32)"
echo "JWT_SECRET=$(openssl rand -base64 32)"
echo "SESSION_SECRET=$(openssl rand -base64 32)"
```

⚠️ **IMPORTANT**: Keep these secrets safe! Never commit them to version control or expose them publicly.

## Step 2: Set Up Google OAuth (Optional but Recommended)

### 2.1 Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select an existing one
3. Enable the Google+ API (may be required for OAuth)

### 2.2 Create OAuth 2.0 Credentials

1. Navigate to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth client ID**
3. Select **Web application**
4. Set the following:
   - **Name**: Multiplayer Games Platform (or any name you prefer)
   - **Authorized JavaScript origins**: 
     - `http://localhost:3001` (development)
     - Your production backend URL (for production)
   - **Authorized redirect URIs**:
     - `http://localhost:3001/auth/provider/google/callback` (development)
     - `https://your-domain.com/auth/provider/google/callback` (production)
5. Click **Create**
6. Copy the **Client ID** and **Client Secret**

### 2.3 Configure Different Environments

For production, you'll want to create a separate OAuth application:

1. Create a new OAuth client ID for production
2. Set the redirect URI to your production domain: `https://your-domain.com/auth/provider/google/callback`
3. Use different Client ID and Secret for production

## Step 3: Configure Environment Variables

1. Copy the example environment file:

```bash
cp .env.example .env
```

2. Edit `.env` and fill in your secrets:

```env
# Required Auth Secrets (use the secrets you generated)
AUTH_SALT=your-generated-salt-here
JWT_SECRET=your-generated-jwt-secret-here
SESSION_SECRET=your-generated-session-secret-here

# Google OAuth (use the credentials from Google Cloud Console)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Backend URL (important for OAuth redirects)
BACKEND_URL=http://localhost:3001
```

3. For production, update `BACKEND_URL` to your production domain:

```env
BACKEND_URL=https://your-domain.com
```

## Step 4: Test the Setup

1. Start the development servers:

```bash
pnpm dev
```

2. Open the frontend at http://localhost:3000
3. Try the following:
   - Click "Sign In" in the navigation bar
   - Test email/password registration
   - Test Google OAuth login (if configured)
   - View your profile and game history

## Features

### For All Users (Including Guests)

- ✅ Game history for the last 10 games
- ✅ History includes games against bots
- ✅ Persistent across browser sessions (using browserSessionId)

### For Authenticated Users

- ✅ Email/password authentication
- ✅ Google OAuth login
- ✅ Persistent identity across devices
- ✅ Display name customization
- ✅ Game history synced to account

## Architecture

### Guest User Tracking

Guest users are tracked using a `browserSessionId` stored in `sessionStorage`. This ensures:
- Each browser tab/window has a unique identity
- History is preserved during the session
- Multiple tabs don't share the same player identity

### Authenticated User Tracking

Authenticated users have a persistent `userId` that:
- Works across all devices
- Syncs game history to the account
- Can be upgraded from guest account

### History Recording

Game history is recorded for:
- All multiplayer games (human vs human)
- All bot games (human vs bot)
- Both authenticated and guest users
- Last 10 games are kept in memory (50 in buffer)

## Security Best Practices

1. **Never commit secrets to version control**: Add `.env` to `.gitignore`
2. **Rotate secrets if compromised**: See implications in the Colyseus auth documentation
3. **Use HTTPS in production**: Essential for secure OAuth flow
4. **Limit access to secrets**: Only share with trusted team members
5. **Different secrets per environment**: Development and production should use different secrets

## Troubleshooting

### Google OAuth Not Working

1. Verify redirect URI matches exactly in Google Cloud Console
2. Check that `BACKEND_URL` is correct in `.env`
3. Ensure `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set
4. Check server logs for OAuth-related errors

### JWT Token Invalid

1. Verify `JWT_SECRET` is set correctly
2. Check that the secret hasn't been changed (this invalidates all tokens)
3. Try signing out and signing in again

### Game History Not Showing

1. Check browser console for API errors
2. Verify `/history` endpoint is accessible
3. Ensure `browserSessionId` is being sent for guests
4. Check server logs for history recording

## API Endpoints

### Client-Side (via `client.auth`)

- `registerWithEmailAndPassword(email, password, options)`
- `signInWithEmailAndPassword(email, password)`
- `signInAnonymously(options)`
- `signInWithProvider('google')`
- `sendPasswordResetEmail(email)`
- `getUserData()`
- `signOut()`

### Backend HTTP Endpoints

- `GET /auth/...` - Auth routes (managed by @colyseus/auth)
- `GET /history` - Get game history for current user
- `GET /health` - Health check

## Next Steps

1. Customize email templates in `html/` directory (for password reset, email confirmation)
2. Integrate with a real email service (e.g., Resend, SendGrid)
3. Add database persistence for user data and game history
4. Implement email verification flow
5. Add more OAuth providers (Discord, Twitter, GitHub, etc.)

## Resources

- [Colyseus Auth Documentation](https://docs.colyseus.io/colyseus/server/authentication/)
- [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
- [Grant OAuth Library](https://github.com/simov/grant) (200+ providers supported)
