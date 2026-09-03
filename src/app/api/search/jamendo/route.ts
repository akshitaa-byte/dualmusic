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
}

/**
 * GET API route handler for Jamendo royalty-free track search.
 * 
 * WHAT: Accepts a `q` search query string, queries the Jamendo v3.0 REST API endpoint,
 * and formats the result into a clean payload containing streamable CORS audio URLs.
 * WHY: Jamendo hosts royalty-free audio tracks with open CORS access. Unlike DRM-protected services
 * (Spotify/Apple Music), Jamendo stream URLs can be decoded into Web Audio `AudioBuffer` PCM nodes.
 * 
 * @param {Request} req - Next.js HTTP Request context.
 * @returns {Promise<NextResponse>} JSON response containing normalized track array.
 */
export async function GET(req: Request) {
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

  try {
    const jamendoUrl = `https://api.jamendo.com/v3.0/tracks/?client_id=${clientId}&format=json&limit=10&search=${encodeURIComponent(
      query
    )}&audioformat=mp32`;

    const response = await fetch(jamendoUrl);

    if (!response.ok) {
      return NextResponse.json(
        {
          results: [],
          warning: `Jamendo API returned status ${response.status}`,
        },
        { status: 200 }
      );
    }

    const data = await response.json();

    if (!data.results || !Array.isArray(data.results)) {
      return NextResponse.json({ results: [] });
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

    return NextResponse.json({ results });
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
