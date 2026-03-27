import { fail, ok } from "@/lib/http";
import { requireUser } from "@/lib/services/auth";
import { createSource, listSources } from "@/lib/services/sources";

export async function GET() {
  try {
    const user = await requireUser();
    const sources = await listSources(user);
    return ok(sources);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "读取失败", 401);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const source = await createSource(user, {
      kind: body.kind,
      name: body.name,
      config: body.config || {},
      schedule: body.schedule || null,
    });
    return ok(source);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "创建失败", 400);
  }
}
