import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, isValidSession } from "./lib/auth";

/**
 * Gate the whole app behind the session cookie, except the login page,
 * the login API, and static assets.
 */
const PUBLIC_PATHS = ["/login", "/api/login", "/favicon.ico"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/")) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/assets")
  ) {
    return NextResponse.next();
  }

  // If no password is configured, the app is open (local dev).
  if (!process.env.APP_PASSWORD) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (await isValidSession(token)) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
