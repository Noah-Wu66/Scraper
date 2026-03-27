import type { ObjectId } from "mongodb";

export type UserRole = "admin" | "member";
export type UserStatus = "active" | "disabled";
export type SourceScope = "system" | "private";
export type RunStatus = "queued" | "running" | "completed" | "failed";
export type RunTrigger = "manual" | "schedule" | "webhook";
export type ScheduleType = "daily" | "weekly";
export type SourceKind =
  | "weibo_posts"
  | "weibo_topics"
  | "yangshipin_videos"
  | "wechat_csv"
  | "xcrawl_search"
  | "xcrawl_scrape"
  | "xcrawl_map"
  | "xcrawl_crawl";
export type RecordKind =
  | "weibo_post"
  | "weibo_topic"
  | "yangshipin_video"
  | "wechat_article"
  | "xcrawl_search_result"
  | "xcrawl_scrape_result"
  | "xcrawl_map_result"
  | "xcrawl_crawl_result";

export interface UserDocument {
  _id?: ObjectId;
  username: string;
  passwordHash: string;
  passwordSalt: string;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date | null;
}

export interface SessionDocument {
  _id?: ObjectId;
  userId: ObjectId;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt: Date;
}

export interface SourceDocument {
  _id?: ObjectId;
  kind: SourceKind;
  scope: SourceScope;
  name: string;
  ownerId?: ObjectId | null;
  enabled: boolean;
  config: Record<string, unknown>;
  lastRunAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScheduleDocument {
  _id?: ObjectId;
  sourceId: ObjectId;
  enabled: boolean;
  type: ScheduleType;
  timezone: string;
  hour: number;
  minute: number;
  weekday?: number | null;
  nextRunAt: Date | null;
  lastRunAt?: Date | null;
  lockUntil?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RunDocument {
  _id?: ObjectId;
  sourceId: ObjectId;
  sourceKind: SourceKind;
  trigger: RunTrigger;
  status: RunStatus;
  requestedBy?: ObjectId | null;
  externalTaskId?: string | null;
  idempotencyKey?: string | null;
  errorMessage?: string | null;
  stats?: Record<string, unknown> | null;
  createdAt: Date;
  startedAt?: Date | null;
  completedAt?: Date | null;
  updatedAt: Date;
}

export interface RunArtifactDocument {
  _id?: ObjectId;
  runId: ObjectId;
  sourceId: ObjectId;
  artifactType: "request" | "response" | "webhook" | "upload";
  payload: Record<string, unknown>;
  createdAt: Date;
}

export interface RecordDocument {
  _id?: ObjectId;
  sourceId: ObjectId;
  runId: ObjectId;
  kind: RecordKind;
  title: string;
  url: string;
  publishedAt?: Date | null;
  dedupeKey: string;
  metrics: Record<string, number | null>;
  payload: Record<string, unknown>;
  firstSeenAt: Date;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
  status: UserStatus;
}
