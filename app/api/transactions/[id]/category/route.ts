import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/mongo";
import { CATEGORY_SLUGS } from "@/lib/seed/categories";
import { isUserCategorySlug } from "@/lib/repositories/user-categories";

const BodySchema = z.object({
  category: z.union([z.string().min(1).max(80), z.null()]),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }
  const { id } = await ctx.params;
  let objectId: ObjectId;
  try {
    objectId = new ObjectId(id);
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_id" },
      { status: 400 }
    );
  }
  let parsedBody: { category: string | null };
  try {
    const raw = (await req.json()) as unknown;
    const result = BodySchema.safeParse(raw);
    if (!result.success) {
      return NextResponse.json(
        { ok: false, error: result.error.message },
        { status: 400 }
      );
    }
    parsedBody = result.data;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_body" },
      { status: 400 }
    );
  }

  const db = await getDb();

  if (parsedBody.category !== null) {
    const slug = parsedBody.category;
    const isSeedSlug = CATEGORY_SLUGS.has(slug);
    if (!isSeedSlug) {
      const isUser = await isUserCategorySlug(db, session.user.id, slug);
      if (!isUser) {
        return NextResponse.json(
          { ok: false, error: "unknown_category" },
          { status: 400 }
        );
      }
    }
  }
  const result = await db.collection("transactions").updateOne(
    { _id: objectId, userId: session.user.id },
    {
      $set: {
        category: parsedBody.category,
        categorySource: parsedBody.category ? "user" : null,
        categorizedAt: parsedBody.category ? new Date() : null,
        updatedAt: new Date(),
      },
    }
  );
  if (result.matchedCount === 0) {
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true });
}
