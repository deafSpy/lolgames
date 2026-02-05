# Quick Setup Guide

This guide will help you get the authentication system up and running quickly.

## Prerequisites Checklist

- [ ] Node.js 20+ installed
- [ ] pnpm 9+ installed
- [ ] OpenSSL available (for generating secrets)

## Quick Setup (5 minutes)

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Generate Auth Secrets

Run this command to generate all required secrets at once:

```bash
echo "# Auth Secrets (Generated $(date))" > .env
echo "AUTH_SALT=$(openssl rand -base64 32)" >> .env
echo "JWT_SECRET=$(openssl rand -base64 32)" >> .env
echo "SESSION_SECRET=$(openssl rand -base64 32)" >> .env
echo "" >> .env
echo "# Server Configuration" >> .env
echo "PORT=3001" >> .env
echo "HOST=0.0.0.0" >> .env
echo "NODE_ENV=development" >> .env
echo "CORS_ORIGIN=http://localhost:3000" >> .env
echo "BACKEND_URL=http://localhost:3001" >> .env
echo "" >> .env
echo "# Google OAuth (Optional - Leave empty to skip)" >> .env
echo "GOOGLE_CLIENT_ID=" >> .env
echo "GOOGLE_CLIENT_SECRET=" >> .env
```

This will create a `.env` file with all required secrets.

### 3. Start the Development Servers

```bash
pnpm dev
```

This starts both:
- Frontend: http://localhost:3000
- Backend: http://localhost:3001

### 4. Test the System

1. Open http://localhost:3000 in your browser
2. You should be able to:
   - Play games as a guest
   - View your game history (last 10 games)
   - Sign in with email/password (create account button)

## Optional: Set Up Google OAuth

If you want to enable Google OAuth login:

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or select existing)
3. Go to **APIs & Services** → **Credentials**
4. Create **OAuth 2.0 Client ID**
5. Add authorized redirect URI: `http://localhost:3001/auth/provider/google/callback`
6. Copy Client ID and Client Secret to `.env`:

```bash
GOOGLE_CLIENT_ID=your-client-id-here
GOOGLE_CLIENT_SECRET=your-client-secret-here
```

7. Restart the development servers: `pnpm dev`

See [AUTH_SETUP.md](./AUTH_SETUP.md) for detailed instructions.

## Verify Everything Works

### Test Guest Play
1. Open http://localhost:3000
2. Go to Lobby
3. Create a bot game (Connect 4)
4. Play a game
5. Go to Profile - you should see the game in your history

### Test Email/Password Auth
1. Click "Sign In" in the navbar
2. Switch to "Create Account" tab
3. Enter email and password
4. Create account
5. You should be signed in and see your name in the navbar

### Test Google OAuth (if configured)
1. Click "Sign In" in the navbar
2. Click "Continue with Google"
3. Sign in with your Google account
4. You should be signed in and see your name in the navbar

## Common Issues

### Server won't start

**Error**: Missing environment variable

**Fix**: Make sure you ran step 2 to generate secrets

### Google OAuth redirect error

**Error**: redirect_uri_mismatch

**Fix**: Make sure the redirect URI in Google Console exactly matches:
```
http://localhost:3001/auth/provider/google/callback
```

### Can't see game history

**Error**: History is empty

**Fix**: Make sure you completed a game (not just joined/created a room)

## What's Next?

- Read [AUTH_SETUP.md](./AUTH_SETUP.md) for detailed auth documentation
- Read [README.md](./README.md) for project overview
- Check the code in `apps/web/src/components/auth/` for auth UI components
- Check the code in `apps/server/src/auth.ts` for backend auth configuration

## Need Help?

- Check server logs in the terminal where you ran `pnpm dev`
- Check browser console (F12) for client-side errors
- Review the Colyseus Auth documentation: https://docs.colyseus.io/colyseus/server/authentication/

## Summary

You now have:
- ✅ Email/password authentication
- ✅ Google OAuth (if configured)
- ✅ Guest play with history tracking
- ✅ Profile page with last 10 games
- ✅ Bot games included in history
- ✅ Auth state integrated with game rooms

Happy gaming! 🎮
