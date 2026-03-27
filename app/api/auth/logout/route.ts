import { fail, ok } from "@/lib/http";
import { logoutUser } from "@/lib/services/auth";

export async function POST() {
  try {
    await logoutUser();
    return ok({ success: true });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "退出失败", 400);
  }
}
