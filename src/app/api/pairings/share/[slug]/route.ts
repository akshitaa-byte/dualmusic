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
      include: {
        user: {
          select: {
            name: true,
            image: true,
          },
        },
      },
    });

    if (!pairing) {
      return NextResponse.json({ error: "Pairing not found" }, { status: 404 });
    }

    // Increment playCount asynchronously for public view stats
    await prisma.pairing.update({
      where: { id: pairing.id },
      data: { playCount: { increment: 1 } },
    });

    return NextResponse.json({ pairing });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch shared pairing: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
