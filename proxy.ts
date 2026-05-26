import { NextResponse, type NextRequest } from "next/server";

const IS_DEV = process.env.NODE_ENV === "development";
const DEV_ALLOWED = IS_DEV || process.env.ALLOW_DEV_DASHBOARD === "true";

const SCRIPT_SRC = IS_DEV
  ? "'self' 'unsafe-inline' 'unsafe-eval'"
  : "'self' 'unsafe-inline'";

const CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self' https://mcp.cumbuca.com https://idc.cumbuca.com https://api.anthropic.com",
  `script-src ${SCRIPT_SRC}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data: https://fonts.gstatic.com",
].join("; ");

export function proxy(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/dev") && !DEV_ALLOWED) {
    return new NextResponse(null, { status: 404 });
  }

  const res = NextResponse.next();
  res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Content-Security-Policy", CSP);
  return res;
}

export const config = {
  matcher: ["/((?!_next|favicon.ico).*)"],
};
