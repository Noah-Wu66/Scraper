import { getEnv } from "@/lib/env";
import { fail, ok } from "@/lib/http";
import { runDueSchedules } from "@/lib/services/runs";

export async function GET(request: Request) {
  try {
    const env = getEnv();
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${env.CRON_SECRET}`) {
      return fail("未授权", 401);
    }
    const result = await runDueSchedules();
    return ok(result);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "执行失败", 400);
  }
}
