import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";

/**
 * PATCH API handler for toggling the favorite status (`isFavorite`) of a pairing.
 * 
 * WHAT: Accepts `{ isFavorite: boolean }` and updates the target Pairing record if owned by the logged-in user.
 * WHY: Enables starring/unstarring track pairings from the user's history page.
 * 
 * @param {Request} req - HTTP request with JSON body `{ isFavorite: boolean }`.
 * @param {object} params - Dynamic route parameters containing `id`.
 * @returns {Promise<NextResponse>} JSON response with updated Pairing.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user || !session.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = await req.json();
    const { isFavorite } = body;

    if (typeof isFavorite !== "boolean") {
      return NextResponse.json({ error: "isFavorite must be a boolean" }, { status: 400 });
    }

    const pairing = await prisma.pairing.findUnique({
      where: { id },
    });

    if (!pairing || pairing.userId !== session.user.id) {
      return NextResponse.json({ error: "Pairing not found or forbidden" }, { status: 404 });
    }

    const updated = await prisma.pairing.update({
      where: { id },
      data: { isFavorite },
    });

    return NextResponse.json({ pairing: updated });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to update pairing: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}

/**
 * GET API handler for retrieving a specific pairing by ID.
 * 
 * WHAT: Fetches a single Pairing record by ID if owned by the logged-in user.
 * WHY: Enforces strict user authorization before exposing private pairing details.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user || !session.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const pairing = await prisma.pairing.findUnique({
      where: { id },
    });

    if (!pairing || pairing.userId !== session.user.id) {
      return NextResponse.json({ error: "Pairing not found or forbidden" }, { status: 404 });
    }

    return NextResponse.json({ pairing });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch pairing: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}

/**
 * DELETE API handler for deleting a specific pairing by ID.
 * 
 * WHAT: Deletes a single Pairing record by ID if owned by the logged-in user.
 * WHY: Enforces strict user authorization BEFORE modifying or deleting database rows.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user || !session.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const pairing = await prisma.pairing.findUnique({
      where: { id },
    });

    if (!pairing || pairing.userId !== session.user.id) {
      return NextResponse.json({ error: "Pairing not found or forbidden" }, { status: 404 });
    }

    await prisma.pairing.delete({
      where: { id },
    });

    return NextResponse.json({ message: "Pairing deleted successfully", id });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to delete pairing: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}

