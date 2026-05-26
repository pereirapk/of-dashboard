import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, signOut } from "@/lib/auth";
import { getDb } from "@/lib/mongo";
import { decrypt } from "@/lib/crypto";
import { revokeConsentForConnection } from "@/lib/mcp/revoke-consent";

const BodySchema = z.object({ confirm: z.literal(true) });

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "confirm flag required" },
      { status: 400 }
    );
  }
  const userId = session.user.id;
  const db = await getDb();

  // 1. Revoke each active connection's consent
  const connections = await db
    .collection("bank_connections")
    .find({ userId, status: "active" })
    .toArray();
  const revoked: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const conn of connections) {
    try {
      const at = decrypt(
        conn.encryptedAccessToken as string,
        "OPENFINANCE_TOKEN_KEY"
      );
      await revokeConsentForConnection({
        db,
        userId,
        bankConnectionId: String(conn._id),
        accessToken: at,
      });
      revoked.push({ id: String(conn._id), ok: true });
    } catch (err) {
      revoked.push({
        id: String(conn._id),
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 2. Wipe app data collections
  const wipeOrder = [
    "transactions",
    "balance_snapshots",
    "mcp_call_logs",
    "sync_runs",
    "bank_accounts",
    "bank_connections",
    "user_categories",
    "user_profiles",
  ];
  for (const c of wipeOrder) {
    await db.collection(c).deleteMany({ userId });
  }

  // 3. Wipe Auth.js rows for this user
  await db.collection("sessions").deleteMany({ userId });
  await db.collection("accounts").deleteMany({ userId });
  try {
    await db.collection("users").deleteOne({ _id: userId as unknown as never });
  } catch {
    // ignore — the user row may be keyed differently by the adapter
  }

  // 4. Sign out — try signOut() but don't fail the response if it throws
  try {
    await signOut({ redirect: false });
  } catch {
    /* ignore */
  }

  return NextResponse.json({ ok: true, revoked });
}
