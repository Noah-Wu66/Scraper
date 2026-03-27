import { fail, ok } from "@/lib/http";
import { requireUser } from "@/lib/services/auth";
import { deleteSource, getSourceForUser, updateSource } from "@/lib/services/sources";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(_: Request, context: Context) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const source = await getSourceForUser(user, id);
    return ok(source);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "读取失败", 400);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = await request.json();
    const source = await updateSource(user, id, body);
    return ok(source);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "更新失败", 400);
  }
}

export async function DELETE(_: Request, context: Context) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    await deleteSource(user, id);
    return ok({ success: true });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "删除失败", 400);
  }
}
