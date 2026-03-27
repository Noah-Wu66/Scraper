import { MongoClient } from "mongodb";

import { getEnv } from "@/lib/env";

declare global {
  // eslint-disable-next-line no-var
  var __mongoClientPromise__: Promise<MongoClient> | undefined;
}

export async function getMongoClient() {
  if (!globalThis.__mongoClientPromise__) {
    const { MONGO_URI } = getEnv();
    globalThis.__mongoClientPromise__ = new MongoClient(MONGO_URI).connect();
  }

  return globalThis.__mongoClientPromise__;
}

export async function getDb() {
  const client = await getMongoClient();
  return client.db();
}
