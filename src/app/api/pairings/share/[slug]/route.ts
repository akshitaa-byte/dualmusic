import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Public GET API route handler for retrieving a pairing by its share slug.
 * 
 * WHAT: Looks up a `Pairing` record matching `shareSlug` and increments `playCount`.
 * WHY: Powers public read-only share links (`/share/[slug]`) without requiring user authentication.
 * 
 * @param {Request} req - Next.js Request context.
 * @param {object} params - Dynamic route parameters containing `slug`.
 * @returns {Promise<NextResponse>} JSON response containing pairing record.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  try {
    const pairing = await prisma.pairing.findUnique({
      where: { shareSlug: slug },
      select: {
        id: true,
        trackASource: true,
        trackAId: true,
        trackAName: true,
        trackBSource: true,
        trackBId: true,
        trackBName: true,
        shareSlug: true,
        createdAt: true,
      },
    });

    if (!pairing) {
      return NextResponse.json({ error: "Pairing not found" }, { status: 404 });
    }

    // Increment playCount asynchronously without blocking the response (fire-and-forget)
    void prisma.pairing.update({
      where: { id: pairing.id },
      data: { playCount: { increment: 1 } },
    }).catch(() => {
      // Ignore background increment errors gracefully
    });

    return NextResponse.json({ pairing });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch shared pairing: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
