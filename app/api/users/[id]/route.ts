import { fail, ok } from "@/lib/http";
import { requireUser, updateUserStatus } from "@/lib/services/auth";

type Context = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = await request.json();
    await updateUserStatus(user, id, body.status);
    return ok({ success: true });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "更新失败", 400);
  }
}
