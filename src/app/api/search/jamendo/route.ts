import { NextResponse } from "next/server";

/**
 * Interface representing a normalized Jamendo search result track object.
 */
export interface JamendoSearchResult {
  id: string;
  name: string;
  artistName: string;
  albumArt: string;
  audioUrl: string;
  isPlayable: true;
  bpm?: number;
}

/**
 * Queries the Jamendo v3.0 tracks API once and returns parsed results.
 *
 * WHAT: Fires a single fetch to Jamendo with `cache: "no-store"`.
 * WHY: `cache: "no-store"` is required for two reasons:
 *   1. Jamendo audio stream URLs are signed tokens that expire within minutes,
 *      so a cached URL sent to the Web Audio API would fail to decode.
 *   2. Without it, Next.js App Router caches the first response (which may be
 *      an empty success from Jamendo's free-tier rate limiting) and returns it
 *      on every subsequent call — hiding real results behind a stale cache hit.
 *
 * @param url - Fully constructed Jamendo API URL.
 * @returns Parsed JSON body, or null if the HTTP response was not OK.
 */
async function fetchJamendo(url: string): Promise<{ results: JamendoSearchResult[] | null; httpOk: boolean }> {
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    return { results: null, httpOk: false };
  }

  const data = await response.json();

  if (!data.results || !Array.isArray(data.results)) {
    return { results: [], httpOk: true };
  }

  const results: JamendoSearchResult[] = data.results.map((track: {
    id: string;
    name: string;
    artist_name: string;
    image: string;
    audio: string;
  }) => ({
    id: String(track.id),
    name: track.name || "Unknown Track",
    artistName: track.artist_name || "Unknown Artist",
    albumArt: track.image || "/file.svg",
    audioUrl: track.audio,
    isPlayable: true,
  }));

  return { results, httpOk: true };
}

/**
 * GET API route handler for Jamendo royalty-free track search.
 *
 * WHAT: Accepts a `q` search query string, queries the Jamendo v3.0 REST API endpoint,
 * and formats the result into a clean payload containing streamable CORS audio URLs.
 *
 * WHY: Jamendo hosts royalty-free audio tracks with open CORS access. Unlike DRM-protected
 * services (Spotify/Apple Music), Jamendo stream URLs can be decoded into Web Audio
 * `AudioBuffer` PCM nodes. This route acts as a thin proxy to keep the client ID
 * server-side and normalize the shape of the response.
 *
 * RETRY LOGIC: Jamendo's free-tier API intermittently returns `{status:"success", results:[]}` —
 * a valid 200 response with zero tracks and no error code. This is a known quirk of their
 * load balancer. We retry up to MAX_RETRIES times (200ms apart) before giving up, which
 * makes the user-facing search reliable without hammering the API aggressively.
 *
 * @param {Request} req - Next.js HTTP Request context.
 * @returns {Promise<NextResponse>} JSON response containing normalized track array.
 */
import { checkRateLimit, getClientIp, rateLimitExceededResponse } from "@/lib/rateLimit";

export async function GET(req: Request) {
  const ip = getClientIp(req);
  const rateLimit = checkRateLimit(ip, 30, 60_000);
  if (!rateLimit.allowed) {
    return rateLimitExceededResponse(rateLimit.retryAfterMs);
  }

  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q");

  if (!query || query.trim() === "") {
    return NextResponse.json({ results: [] });
  }

  const clientId = process.env.JAMENDO_CLIENT_ID;

  if (!clientId || clientId.trim() === "" || clientId === "your_jamendo_client_id_here") {
    return NextResponse.json(
      {
        results: [],
        warning: "Jamendo API Client ID is not configured in .env.local. Add JAMENDO_CLIENT_ID to enable Jamendo search.",
      },
      { status: 200 }
    );
  }

  const jamendoUrl = `https://api.jamendo.com/v3.0/tracks/?client_id=${clientId}&format=json&limit=15&search=${encodeURIComponent(
    query
  )}&audioformat=mp32`;

  /**
   * Retry constants.
   * MAX_RETRIES: total attempts (1 initial + 2 retries = 3 total).
   * RETRY_DELAY_MS: pause between retries to avoid flooding Jamendo.
   */
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 200;

  try {
    let lastResults: JamendoSearchResult[] = [];

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const { results, httpOk } = await fetchJamendo(jamendoUrl);

      if (!httpOk) {
        // Non-200 HTTP — surface a warning immediately, no point retrying.
        return NextResponse.json(
          { results: [], warning: "Jamendo API returned a non-200 status. Try again shortly." },
          { status: 200 }
        );
      }

      if (results && results.length > 0) {
        // Got real results — return immediately.
        return NextResponse.json({ results });
      }

      lastResults = results ?? [];

      if (attempt < MAX_RETRIES) {
        // Jamendo returned an empty success — wait briefly before retrying.
        // This handles the known free-tier intermittency where their load balancer
        // occasionally responds with results_count:0 despite valid queries.
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }

    // All retries exhausted with empty results.
    return NextResponse.json({ results: lastResults });
  } catch (err) {
    return NextResponse.json(
      {
        results: [],
        warning: `Jamendo search failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 200 }
    );
  }
}
