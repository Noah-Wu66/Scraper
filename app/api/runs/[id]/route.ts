import { fail, ok } from "@/lib/http";
import { requireUser } from "@/lib/services/auth";
import { getRunById } from "@/lib/services/runs";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(_: Request, context: Context) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const run = await getRunById(user, id);
    return ok(run);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "读取失败", 400);
  }
}
