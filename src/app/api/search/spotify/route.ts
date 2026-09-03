import { NextResponse } from "next/server";

/**
 * Interface representing a normalized Spotify catalog metadata search result.
 */
export interface SpotifySearchResult {
  id: string;
  name: string;
  artistName: string;
  albumArt: string;
  isPlayable: false;
}

/**
 * In-memory OAuth Access Token cache for Spotify API Client Credentials.
 * 
 * WHY: Requesting a new Client Credentials access token on every catalog search wastes network RTT
 * and risks triggering Spotify OAuth rate limits. Caching the token in server memory and renewing
 * only when expired preserves efficiency.
 */
let cachedSpotifyToken: string | null = null;
let tokenExpiresAt = 0;

/**
 * Fetches or returns a valid Spotify Client Credentials Access Token.
 * 
 * WHAT: Checks if `cachedSpotifyToken` is valid; if expired or absent, performs an OAuth POST request
 * to `https://accounts.spotify.com/api/token` using HTTP Basic Authentication (`clientId:clientSecret`).
 * WHY: Spotify Web API endpoints require a valid Bearer token for catalog metadata requests.
 * 
 * @returns {Promise<string | null>} Bearer access token string or null if unconfigured/failed.
 */
async function getSpotifyAccessToken(): Promise<string | null> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (
    !clientId ||
    !clientSecret ||
    clientId === "your_spotify_client_id_here" ||
    clientSecret === "your_spotify_client_secret_here"
  ) {
    return null;
  }

  // Return cached token if still valid (with a 60-second buffer before expiration)
  if (cachedSpotifyToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedSpotifyToken;
  }

  try {
    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${authHeader}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    cachedSpotifyToken = data.access_token;
    tokenExpiresAt = Date.now() + data.expires_in * 1000;

    return cachedSpotifyToken;
  } catch {
    return null;
  }
}

/**
 * GET API route handler for Spotify track metadata search.
 * 
 * WHAT: Accepts a `q` search query string, fetches a Spotify Client Credentials token, queries the Spotify
 * Search API catalog (`/v1/search`), and returns metadata ONLY (track title, artist, album art).
 * WHY: Spotify stream data is protected by Digital Rights Management (DRM) & Encrypted Media Extensions (EME).
 * Spotify raw PCM audio buffers are NEVER exposed to browser JavaScript or Web Audio API nodes.
 * Spotify is strictly utilized for browsing and metadata discovery.
 * 
 * @param {Request} req - Next.js HTTP Request context.
 * @returns {Promise<NextResponse>} JSON response containing track metadata array (isPlayable: false).
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q");

  if (!query || query.trim() === "") {
    return NextResponse.json({ results: [] });
  }

  const token = await getSpotifyAccessToken();

  if (!token) {
    return NextResponse.json(
      {
        results: [],
        warning:
          "Spotify API Client credentials are not configured in .env.local. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to enable Spotify metadata search.",
      },
      { status: 200 }
    );
  }

  try {
    const spotifyUrl = `https://api.spotify.com/v1/search?q=${encodeURIComponent(
      query
    )}&type=track&limit=10`;

    const response = await fetch(spotifyUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          results: [],
          warning: `Spotify API returned status ${response.status}`,
        },
        { status: 200 }
      );
    }

    const data = await response.json();

    if (!data.tracks || !Array.isArray(data.tracks.items)) {
      return NextResponse.json({ results: [] });
    }

    const results: SpotifySearchResult[] = data.tracks.items.map(
      (track: {
        id: string;
        name: string;
        artists: { name: string }[];
        album: { images: { url: string }[] };
      }) => ({
        id: track.id,
        name: track.name || "Unknown Track",
        artistName: track.artists?.map((a) => a.name).join(", ") || "Unknown Artist",
        albumArt: track.album?.images?.[0]?.url || "/file.svg",
        isPlayable: false,
      })
    );

    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json(
      {
        results: [],
        warning: `Spotify search failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 200 }
    );
  }
}
