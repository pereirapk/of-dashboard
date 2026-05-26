import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/mongo";
import {
  createUserCategory,
  ensureUserCategoryIndexes,
  findUserCategoriesByUser,
  type UserCategoryDoc,
} from "@/lib/repositories/user-categories";

let indexesEnsured = false;
async function ensureIndexes() {
  if (indexesEnsured) return;
  const db = await getDb();
  await ensureUserCategoryIndexes(db);
  indexesEnsured = true;
}

const PostSchema = z.object({
  labelPt: z.string().min(1).max(60),
  icon: z.string().max(8).optional().default(""),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  await ensureIndexes();
  const db = await getDb();
  const rows = await findUserCategoriesByUser(db, session.user.id);
  const json = rows.map((r) => serializeUserCategory(r));
  return NextResponse.json({ ok: true, categories: json });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  await ensureIndexes();
  const body = await req.json().catch(() => null);
  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.message },
      { status: 400 }
    );
  }
  const db = await getDb();
  try {
    const doc = await createUserCategory(db, {
      userId: session.user.id,
      labelPt: parsed.data.labelPt,
      icon: parsed.data.icon ?? "",
      color: parsed.data.color,
    });
    return NextResponse.json(
      { ok: true, category: serializeUserCategory(doc) },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}

function serializeUserCategory(r: UserCategoryDoc) {
  return {
    slug: r.slug,
    labelPt: r.labelPt,
    icon: r.icon,
    color: r.color,
    displayOrder: r.displayOrder,
  };
}
