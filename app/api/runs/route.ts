import { fail, ok } from "@/lib/http";
import { requireUser } from "@/lib/services/auth";
import { listRuns } from "@/lib/services/runs";

export async function GET() {
  try {
    const user = await requireUser();
    const runs = await listRuns(user);
    return ok(runs);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "读取失败", 401);
  }
}
