import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";
import { generateShareSlug } from "@/lib/slug";

/**
 * POST API handler for saving or updating audio track pairings.
 * 
 * WHAT: Accepts track A & track B details from the request body. If the user is logged in,
 * checks whether an identical pairing already exists for this user. If found, increments `playCount`;
 * otherwise, creates a new `Pairing` record with a unique `shareSlug`.
 * WHY: Tracks user listening history without duplicating rows when the same user plays the same pairing multiple times.
 * 
 * @param {Request} req - HTTP request containing JSON body.
 * @returns {Promise<NextResponse>} JSON response with saved/updated Pairing record.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user || !session.user.id) {
    return NextResponse.json({ error: "Unauthorized. Please sign in to save pairings." }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { trackASource, trackAId, trackAName, trackBSource, trackBId, trackBName } = body;

    if (!trackASource || !trackAName || !trackBSource || !trackBName) {
      return NextResponse.json({ error: "Missing required track parameters" }, { status: 400 });
    }

    const userId = session.user.id;

    // Search for existing matching pairing for this user
    const existingPairing = await prisma.pairing.findFirst({
      where: {
        userId,
        trackASource,
        trackAId: trackAId || null,
        trackAName,
        trackBSource,
        trackBId: trackBId || null,
        trackBName,
      },
    });

    if (existingPairing) {
      const updated = await prisma.pairing.update({
        where: { id: existingPairing.id },
        data: {
          playCount: { increment: 1 },
        },
      });
      return NextResponse.json({ pairing: updated, isNew: false });
    }

    const shareSlug = generateShareSlug();

    const created = await prisma.pairing.create({
      data: {
        userId,
        trackASource,
        trackAId: trackAId || null,
        trackAName,
        trackBSource,
        trackBId: trackBId || null,
        trackBName,
        shareSlug,
      },
    });

    return NextResponse.json({ pairing: created, isNew: true }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to save pairing: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}

/**
 * GET API handler for retrieving all pairings owned by the logged-in user.
 * 
 * WHAT: Fetches all `Pairing` records for `session.user.id` sorted by creation date descending.
 * WHY: Powers the user's history page (`/history`).
 * 
 * @returns {Promise<NextResponse>} JSON response containing list of Pairing records.
 */
export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session || !session.user || !session.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const pairings = await prisma.pairing.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ pairings });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch pairings: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
