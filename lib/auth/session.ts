import { randomBytes } from "node:crypto";

import { cookies } from "next/headers";
import { ObjectId } from "mongodb";

import { sessionsCollection, usersCollection } from "@/lib/db/collections";
import { sha256 } from "@/lib/utils";

const SESSION_COOKIE_NAME = "cpec_session";
const ROLE_COOKIE_NAME = "cpec_role";
const SESSION_DAYS = 7;

export async function createSession(userId: string, role: string) {
  const token = randomBytes(32).toString("hex");
  const tokenHash = sha256(token);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  const sessions = await sessionsCollection();
  await sessions.insertOne({
    userId: new ObjectId(userId),
    tokenHash,
    expiresAt,
    createdAt,
    updatedAt: createdAt,
    lastSeenAt: createdAt,
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  cookieStore.set(ROLE_COOKIE_NAME, role, {
    httpOnly: false,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  return token;
}

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    const sessions = await sessionsCollection();
    await sessions.deleteOne({ tokenHash: sha256(token) });
  }

  cookieStore.delete(SESSION_COOKIE_NAME);
  cookieStore.delete(ROLE_COOKIE_NAME);
}

export async function getCurrentAuthUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }

  const sessions = await sessionsCollection();
  const session = await sessions.findOne({
    tokenHash: sha256(token),
    expiresAt: { $gt: new Date() },
  });

  if (!session) {
    cookieStore.delete(SESSION_COOKIE_NAME);
    cookieStore.delete(ROLE_COOKIE_NAME);
    return null;
  }

  await sessions.updateOne(
    { _id: session._id },
    { $set: { lastSeenAt: new Date(), updatedAt: new Date() } },
  );

  const users = await usersCollection();
  const user = await users.findOne({ _id: session.userId });
  if (!user || user.status !== "active") {
    return null;
  }

  return {
    id: String(user._id),
    username: user.username,
    role: user.role,
    status: user.status,
  };
}
