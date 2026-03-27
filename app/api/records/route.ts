import { fail, ok } from "@/lib/http";
import { requireUser } from "@/lib/services/auth";
import { listRecords } from "@/lib/services/records";
import { listSources } from "@/lib/services/sources";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const sources = await listSources(user);
    const allowedSourceIds = new Set(sources.map((item) => item.id));
    const { searchParams } = new URL(request.url);
    const requestedSourceIds = searchParams.getAll("sourceId");
    const sourceIds = requestedSourceIds.length > 0
      ? requestedSourceIds.filter((item) => allowedSourceIds.has(item))
      : Array.from(allowedSourceIds);
    const kinds = searchParams.getAll("kind");
    const q = searchParams.get("q") || "";
    const items = await listRecords({
      sourceIds,
      kinds,
      q,
      limit: Number(searchParams.get("limit") || 200),
    });
    return ok(items);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "读取失败", 401);
  }
}
