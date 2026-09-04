# DUAL

A web player that lets you pick two songs and play them at the same time—one strictly in your left ear, the other strictly in your right ear—using the native Web Audio API.

[Live demo link coming soon]
*(Add a screenshot or GIF here)*

## Why I built this

I built DUAL because I was curious about channel routing in the Web Audio API and wanted to test whether two completely separate audio tracks could be mixed and panned cleanly in the browser without channel bleed. It also gave me a chance to build a synchronized real-time playback system using NTP clock-offset algorithms over WebSockets.

## Features

- Hard left/right ear channel separation using an AudioContext channel merger graph
- Audio search and streaming powered by the Jamendo API
- Local audio file upload support (MP3, WAV, FLAC, OGG)
- Independent time seek sliders, volume controls, and playback state for left and right tracks
- LLM-powered vibe pairing suggestions with Groq, verified via Spotify metadata, and tempo-matched with real-time browser BPM detection
- Saved pairing history and favorite management with Google sign-in
- Public share links for track pairings
- Optional real-time synchronized room playback between two remote listeners over WebSockets

## Tech stack

- Next.js (App Router, TypeScript)
- Tailwind CSS
- Web Audio API (AudioContext, ChannelMergerNode, GainNode)
- Prisma and PostgreSQL
- NextAuth.js (Google OAuth)
- Node.js and `ws` for the WebSocket sync server

## How audio decoding and streaming work

Commercial streaming APIs like Spotify and YouTube protect their streams with DRM and Encrypted Media Extensions (EME). Because they output audio through encrypted browser elements, JavaScript cannot access their raw PCM sample buffers. Without those raw buffers, the Web Audio API cannot split the audio across separate left and right channels.

To handle this, DUAL uses Spotify strictly for metadata, search index, and album art lookup. The actual audio playback streams from Jamendo (which serves CORS-enabled audio files) or local uploads. The browser fetches the array buffer, decodes it into PCM data via `AudioContext.decodeAudioData()`, and routes it directly into the left or right gain node.

## Known limitations

- Fixed-window rate limiting is active on public API endpoints (30 search requests per minute, 10 pairing creation requests per minute).
- Synchronized rooms require a separate Node.js WebSocket process (`src/server/wsServer.ts`) running on port 8080. If `NEXT_PUBLIC_SYNC_ROOMS_ENABLED` is not set to `"true"`, room sync controls are excluded from the client build.

## Setup

```bash
# Install dependencies
npm install

# Run database migrations
npx prisma migrate dev

# Start development server
npm run dev

# Start WebSocket sync server (optional)
npm run ws-server
```

## Environment variables

Create a `.env.local` file in the root directory:

```env
DATABASE_URL="postgresql://user:pass@host:5432/dbname"
NEXTAUTH_SECRET="your-nextauth-secret"
NEXTAUTH_URL="http://localhost:3000"
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"

JAMENDO_CLIENT_ID="your-jamendo-client-id"
SPOTIFY_CLIENT_ID="your-spotify-client-id"
SPOTIFY_CLIENT_SECRET="your-spotify-client-secret"

GROQ_API_KEY="your-groq-api-key"

NEXT_PUBLIC_SYNC_ROOMS_ENABLED="true"
```
