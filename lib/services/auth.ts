import { ObjectId } from "mongodb";

import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession, getCurrentAuthUser } from "@/lib/auth/session";
import { usersCollection } from "@/lib/db/collections";
import { ensureBootstrap } from "@/lib/bootstrap";
import type { AuthUser } from "@/lib/types";

export async function registerUser(input: { username: string; password: string }) {
  await ensureBootstrap();

  const username = input.username.trim();
  const password = input.password.trim();
  if (username.length < 3) {
    throw new Error("账号至少 3 个字符");
  }
  if (password.length < 6) {
    throw new Error("密码至少 6 位");
  }

  const users = await usersCollection();
  const existing = await users.findOne({ username });
  if (existing) {
    throw new Error("这个账号已存在");
  }

  const now = new Date();
  const passwordData = await hashPassword(password);
  const firstUser = await users.countDocuments();
  const result = await users.insertOne({
    username,
    passwordHash: passwordData.hash,
    passwordSalt: passwordData.salt,
    role: firstUser === 0 ? "admin" : "member",
    status: "active",
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
  });

  const user = await users.findOne({ _id: result.insertedId });
  if (!user) {
    throw new Error("注册失败");
  }

  await createSession(String(user._id), user.role);
  return {
    id: String(user._id),
    username: user.username,
    role: user.role,
    status: user.status,
  } satisfies AuthUser;
}

export async function loginUser(input: { username: string; password: string }) {
  await ensureBootstrap();

  const users = await usersCollection();
  const user = await users.findOne({ username: input.username.trim() });
  if (!user || user.status !== "active") {
    throw new Error("账号或密码不对");
  }

  const passed = await verifyPassword(input.password, user.passwordSalt, user.passwordHash);
  if (!passed) {
    throw new Error("账号或密码不对");
  }

  await users.updateOne(
    { _id: user._id },
    { $set: { lastLoginAt: new Date(), updatedAt: new Date() } },
  );

  await createSession(String(user._id), user.role);
  return {
    id: String(user._id),
    username: user.username,
    role: user.role,
    status: user.status,
  } satisfies AuthUser;
}

export async function logoutUser() {
  await destroySession();
}

export async function requireUser() {
  await ensureBootstrap();
  const user = await getCurrentAuthUser();
  if (!user) {
    throw new Error("请先登录");
  }

  return user;
}

export function requireAdmin(user: AuthUser) {
  if (user.role !== "admin") {
    throw new Error("只有管理员可以操作");
  }
}

export async function listUsers(currentUser: AuthUser) {
  requireAdmin(currentUser);
  const users = await usersCollection();
  return users
    .find({}, { sort: { createdAt: -1 } })
    .map((item) => ({
      id: String(item._id),
      username: item.username,
      role: item.role,
      status: item.status,
      createdAt: item.createdAt,
      lastLoginAt: item.lastLoginAt ?? null,
    }))
    .toArray();
}

export async function updateUserStatus(currentUser: AuthUser, userId: string, status: "active" | "disabled") {
  requireAdmin(currentUser);
  const users = await usersCollection();
  await users.updateOne(
    { _id: new ObjectId(userId) },
    { $set: { status, updatedAt: new Date() } },
  );
}
