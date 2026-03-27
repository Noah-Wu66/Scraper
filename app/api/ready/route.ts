import { getEnvStatus } from "@/lib/env";
import { getMongoClient } from "@/lib/mongodb";
import { fail, ok } from "@/lib/http";

export async function GET() {
  const envStatus = getEnvStatus();
  try {
    await getMongoClient();
    return ok({
      status: "ok",
      checks: {
        mongodb: true,
        env: envStatus,
      },
    });
  } catch (error) {
    return fail("服务未就绪", 503, {
      mongodb: false,
      env: envStatus,
      message: error instanceof Error ? error.message : "Mongo 连接失败",
    });
  }
}
