import { fail, ok } from "@/lib/http";
import { requireUser } from "@/lib/services/auth";
import { getSourceForUser } from "@/lib/services/sources";
import { triggerSourceRun } from "@/lib/services/runs";

type Context = {
  params: Promise<{ id: string }>;
};

export async function POST(_: Request, context: Context) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const source = await getSourceForUser(user, id);
    if (!source.enabled) {
      throw new Error("这个数据源已停用");
    }
    const result = await triggerSourceRun(source, "manual", user);
    return ok(result);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "执行失败", 400);
  }
}
