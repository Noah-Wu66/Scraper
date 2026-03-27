import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/register"];
const ADMIN_PATHS = ["/dashboard/users", "/dashboard/settings"];
const SESSION_COOKIE_NAME = "cpec_session";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const role = request.cookies.get("cpec_role")?.value;

  if (pathname === "/") {
    return NextResponse.redirect(new URL(session ? "/dashboard" : "/login", request.url));
  }

  if (PUBLIC_PATHS.some((item) => pathname.startsWith(item))) {
    if (session) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }

    return NextResponse.next();
  }

  if (pathname.startsWith("/dashboard")) {
    if (!session) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    if (ADMIN_PATHS.some((item) => pathname.startsWith(item)) && role !== "admin") {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/login/:path*", "/register/:path*", "/dashboard/:path*"],
};
