const REQUIRED_KEYS = [
  "MONGO_URI",
  "APP_SESSION_SECRET",
  "APP_BASE_URL",
  "XCRAWL_API_KEY",
  "XCRAWL_WEBHOOK_SECRET",
  "CRON_SECRET",
] as const;

let envCache: AppEnv | null = null;

export interface AppEnv {
  MONGO_URI: string;
  APP_SESSION_SECRET: string;
  APP_BASE_URL: string;
  XCRAWL_API_KEY: string;
  XCRAWL_WEBHOOK_SECRET: string;
  CRON_SECRET: string;
  BOOTSTRAP_ADMIN_USERNAME?: string;
  BOOTSTRAP_ADMIN_PASSWORD?: string;
}

export function getEnv() {
  if (envCache) {
    return envCache;
  }

  const missing = REQUIRED_KEYS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`缺少环境变量: ${missing.join(", ")}`);
  }

  envCache = {
    MONGO_URI: process.env.MONGO_URI!,
    APP_SESSION_SECRET: process.env.APP_SESSION_SECRET!,
    APP_BASE_URL: process.env.APP_BASE_URL!,
    XCRAWL_API_KEY: process.env.XCRAWL_API_KEY!,
    XCRAWL_WEBHOOK_SECRET: process.env.XCRAWL_WEBHOOK_SECRET!,
    CRON_SECRET: process.env.CRON_SECRET!,
    BOOTSTRAP_ADMIN_USERNAME: process.env.BOOTSTRAP_ADMIN_USERNAME,
    BOOTSTRAP_ADMIN_PASSWORD: process.env.BOOTSTRAP_ADMIN_PASSWORD,
  };

  return envCache;
}

export function getEnvStatus() {
  return {
    mongo: Boolean(process.env.MONGO_URI),
    session: Boolean(process.env.APP_SESSION_SECRET),
    baseUrl: Boolean(process.env.APP_BASE_URL),
    xcrawlApiKey: Boolean(process.env.XCRAWL_API_KEY),
    xcrawlWebhookSecret: Boolean(process.env.XCRAWL_WEBHOOK_SECRET),
    cronSecret: Boolean(process.env.CRON_SECRET),
    bootstrapAdmin: Boolean(process.env.BOOTSTRAP_ADMIN_USERNAME && process.env.BOOTSTRAP_ADMIN_PASSWORD),
  };
}
