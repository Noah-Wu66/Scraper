import { fail, ok } from "@/lib/http";
import { listUsers, requireUser } from "@/lib/services/auth";

export async function GET() {
  try {
    const user = await requireUser();
    const items = await listUsers(user);
    return ok(items);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "读取失败", 401);
  }
}
