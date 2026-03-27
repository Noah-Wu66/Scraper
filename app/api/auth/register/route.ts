import { NextResponse } from "next/server";

import { fail, ok } from "@/lib/http";
import { registerUser } from "@/lib/services/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const user = await registerUser({
      username: String(body.username || ""),
      password: String(body.password || ""),
    });
    return ok(user);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "注册失败", 400);
  }
}

export function GET() {
  return NextResponse.json({ ok: false }, { status: 405 });
}
