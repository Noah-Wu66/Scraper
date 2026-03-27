import { ObjectId } from "mongodb";

import { hashPassword } from "@/lib/auth/password";
import {
  recordsCollection,
  runArtifactsCollection,
  runsCollection,
  schedulesCollection,
  sessionsCollection,
  sourcesCollection,
  usersCollection,
} from "@/lib/db/collections";
import { getEnv } from "@/lib/env";
import { SYSTEM_SOURCE_DEFAULTS } from "@/lib/system-sources";

let bootstrapPromise: Promise<void> | null = null;

export async function ensureBootstrap() {
  if (!bootstrapPromise) {
    bootstrapPromise = runBootstrap();
  }

  return bootstrapPromise;
}

async function runBootstrap() {
  await Promise.all([
    ensureIndexes(),
    ensureBootstrapAdmin(),
    ensureSystemSources(),
  ]);
}

async function ensureIndexes() {
  const [users, sessions, sources, schedules, runs, records, artifacts] = await Promise.all([
    usersCollection(),
    sessionsCollection(),
    sourcesCollection(),
    schedulesCollection(),
    runsCollection(),
    recordsCollection(),
    runArtifactsCollection(),
  ]);

  await Promise.all([
    users.createIndex({ username: 1 }, { unique: true }),
    sessions.createIndex({ tokenHash: 1 }, { unique: true }),
    sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    sources.createIndex({ kind: 1, scope: 1, ownerId: 1 }),
    schedules.createIndex({ nextRunAt: 1, enabled: 1 }),
    runs.createIndex({ sourceId: 1, createdAt: -1 }),
    runs.createIndex(
      { externalTaskId: 1 },
      {
        unique: true,
        partialFilterExpression: { externalTaskId: { $type: "string" } },
      },
    ),
    runs.createIndex(
      { idempotencyKey: 1 },
      {
        unique: true,
        partialFilterExpression: { idempotencyKey: { $type: "string" } },
      },
    ),
    records.createIndex({ sourceId: 1, dedupeKey: 1 }, { unique: true }),
    artifacts.createIndex({ runId: 1, createdAt: -1 }),
  ]);
}

async function ensureBootstrapAdmin() {
  const env = getEnv();
  if (!env.BOOTSTRAP_ADMIN_USERNAME || !env.BOOTSTRAP_ADMIN_PASSWORD) {
    return;
  }

  const users = await usersCollection();
  const adminExists = await users.findOne({ role: "admin" });
  if (adminExists) {
    return;
  }

  const password = await hashPassword(env.BOOTSTRAP_ADMIN_PASSWORD);
  const now = new Date();
  await users.insertOne({
    username: env.BOOTSTRAP_ADMIN_USERNAME,
    passwordHash: password.hash,
    passwordSalt: password.salt,
    role: "admin",
    status: "active",
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
  });
}

async function ensureSystemSources() {
  const sources = await sourcesCollection();
  const now = new Date();
  for (const item of SYSTEM_SOURCE_DEFAULTS) {
    const exists = await sources.findOne({ kind: item.kind, scope: "system" });
    if (exists) {
      continue;
    }

    await sources.insertOne({
      _id: new ObjectId(),
      kind: item.kind,
      name: item.name,
      scope: item.scope,
      enabled: item.enabled,
      ownerId: null,
      config: item.config,
      lastRunAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }
}
