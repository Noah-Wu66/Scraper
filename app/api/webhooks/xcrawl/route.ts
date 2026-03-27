import { getEnv } from "@/lib/env";
import { fail, ok } from "@/lib/http";
import { processXcrawlWebhook } from "@/lib/services/runs";

export async function POST(request: Request) {
  try {
    const env = getEnv();
    const secret = request.headers.get("x-webhook-secret");
    if (secret !== env.XCRAWL_WEBHOOK_SECRET) {
      return fail("未授权", 401);
    }
    const payload = await request.json();
    await processXcrawlWebhook(payload);
    return ok({ success: true });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Webhook 处理失败", 400);
  }
}
