import type { Collection } from "mongodb";

import { getDb } from "@/lib/mongodb";
import type {
  RecordDocument,
  RunArtifactDocument,
  RunDocument,
  ScheduleDocument,
  SessionDocument,
  SourceDocument,
  UserDocument,
} from "@/lib/types";

export async function usersCollection(): Promise<Collection<UserDocument>> {
  return (await getDb()).collection<UserDocument>("users");
}

export async function sessionsCollection(): Promise<Collection<SessionDocument>> {
  return (await getDb()).collection<SessionDocument>("sessions");
}

export async function sourcesCollection(): Promise<Collection<SourceDocument>> {
  return (await getDb()).collection<SourceDocument>("sources");
}

export async function schedulesCollection(): Promise<Collection<ScheduleDocument>> {
  return (await getDb()).collection<ScheduleDocument>("schedules");
}

export async function runsCollection(): Promise<Collection<RunDocument>> {
  return (await getDb()).collection<RunDocument>("runs");
}

export async function runArtifactsCollection(): Promise<Collection<RunArtifactDocument>> {
  return (await getDb()).collection<RunArtifactDocument>("run_artifacts");
}

export async function recordsCollection(): Promise<Collection<RecordDocument>> {
  return (await getDb()).collection<RecordDocument>("records");
}
