# 🎧 Stereo Split Music Player

> Play two distinct songs simultaneously — one fully in your left ear and one fully in your right ear — using native browser Web Audio API channel merging.

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Vercel-brightgreen?style=for-the-badge&logo=vercel)](https://your-app-url.vercel.app)

*(Live Demo link placeholder — update URL after Vercel deployment)*

---

## 🚀 Key Features

- **True Channel Separation**: Native Web Audio API routing (`AudioBufferSourceNode` -> `GainNode` -> `ChannelMergerNode` -> `audioContext.destination`) ensuring 100% left/right ear channel isolation.
- **Royalty-Free Audio Streaming**: Search and stream full tracks via the Jamendo v3.0 API with CORS-enabled PCM array decoding.
- **Spotify Catalog Browsing**: Search Spotify track metadata (titles, artists, album art).
- **Custom Audio Uploads**: Upload local MP3, WAV, FLAC, or OGG files directly into the Web Audio API decoder with MIME and file size guards.
- **Pairing History & Favorites**: Save track pairings to PostgreSQL, toggle favorites, and manage playback history.
- **Public Shareable Links**: Generate read-only shareable URLs (`/share/[slug]`) for any track pairing.
- **Synchronized Listening Rooms**: Real-time room synchronized playback between multiple remote users using NTP-style high-precision clock offset calculation over WebSockets *(Requires local Node.js WebSocket server setup; not enabled in hosted production demo)*.

---

## 🛠️ Tech Stack

- **Framework**: Next.js 16 (App Router) + TypeScript (Strict Mode)
- **Styling**: Tailwind CSS
- **Database & ORM**: PostgreSQL + Prisma ORM
- **Authentication**: NextAuth.js (Google OAuth provider)
- **Audio Engine**: Native Web Audio API (`AudioContext`, `ChannelMergerNode`, `GainNode`) — zero third-party audio abstractions
- **Real-Time Engine**: Node.js + `ws` WebSocket server (`src/server/wsServer.ts`)

---

## 🎵 Architectural Note: Web Audio API vs DRM (Spotify / YouTube vs Jamendo)

### The Technical Constraint
Commercial streaming platforms like **Spotify**, **Apple Music**, and **YouTube** protect raw audio streams using **Digital Rights Management (DRM)** and **Encrypted Media Extensions (EME)**. They render audio through encrypted browser element pipelines and **do not expose raw PCM sample buffers (`AudioBuffer` or CORS-accessible media streams)** to browser JavaScript. Without raw PCM sample buffers, Web Audio API nodes (`ChannelMergerNode`, `AudioContext.decodeAudioData`) cannot split audio into separate left/right physical ear channels.

### The Solution
- **Spotify API**: Used exclusively for catalog search, metadata discovery, and album artwork lookup.
- **Jamendo API**: Serves royalty-free audio files with open `Access-Control-Allow-Origin: *` CORS headers, allowing the browser to fetch raw audio array buffers, decode them via `audioCtx.decodeAudioData()`, and feed them into our dual-channel stereo split audio graph.

---

## ⚠️ Known Limitations & Deployment Notes

1. **API Rate Limiting**: Search endpoints (`/api/search/jamendo`, `/api/search/spotify`) and pairing creation (`POST /api/pairings`) employ an in-memory fixed-window rate limiter (30 requests/min per IP for search, 10/min for pairings).
2. **WebSocket Sync Rooms in Local Development**: Real-time rooms run on a standalone Node.js WebSocket process (`src/server/wsServer.ts`) on port 8080. When `NEXT_PUBLIC_SYNC_ROOMS_ENABLED` is unset or not `"true"`, the room UI and WebSocket connection logic are completely removed from the client render bundle for production deployment.

---

## ⚙️ Environment Configuration

Create a `.env.local` file in the root directory:

```env
# Database & Auth
DATABASE_URL="postgresql://user:pass@host:5432/dbname"
NEXTAUTH_SECRET="your-nextauth-secret"
NEXTAUTH_URL="http://localhost:3000"
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"

# Music APIs
JAMENDO_CLIENT_ID="your-jamendo-client-id"
SPOTIFY_CLIENT_ID="your-spotify-client-id"
SPOTIFY_CLIENT_SECRET="your-spotify-client-secret"

# Feature Flags (Local Development Only)
NEXT_PUBLIC_SYNC_ROOMS_ENABLED="true"
```

---

## 🧪 Getting Started

```bash
# Install dependencies
npm install

# Run Prisma database migrations
npx prisma migrate dev

# Start Next.js development server
npm run dev

# Start WebSocket Room server (optional for room sync)
npm run ws-server
```
