import { fail, ok } from "@/lib/http";
import { requireUser } from "@/lib/services/auth";

export async function GET() {
  try {
    const user = await requireUser();
    return ok(user);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "未登录", 401);
  }
}
