import { listRecords } from "@/lib/services/records";
import { buildFlatWorkbook, buildLegacyWorkbook } from "@/lib/services/export";
import { fail } from "@/lib/http";
import { requireUser } from "@/lib/services/auth";
import { listSources } from "@/lib/services/sources";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const sources = await listSources(user);
    const allowedSourceIds = new Set(sources.map((item) => item.id));
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get("mode") || "flat";
    const requestedSourceIds = searchParams.getAll("sourceId");
    const sourceIds = requestedSourceIds.length > 0
      ? requestedSourceIds.filter((item) => allowedSourceIds.has(item))
      : Array.from(allowedSourceIds);
    const records = await listRecords({
      sourceIds,
      kinds: searchParams.getAll("kind"),
      q: searchParams.get("q") || "",
      limit: Number(searchParams.get("limit") || 1000),
    });
    const buffer = mode === "legacy" ? buildLegacyWorkbook(records) : buildFlatWorkbook(records);

    return new Response(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${mode === "legacy" ? "legacy-report" : "records"}.xlsx"`,
      },
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "导出失败", 400);
  }
}
