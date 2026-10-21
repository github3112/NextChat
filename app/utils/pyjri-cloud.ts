import type { ChatSession } from "../store/chat";

export type PyjriCloudUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
};

export type UserD1Connection = {
  connected: boolean;
  accountId: string | null;
  databaseId: string | null;
};

export type RemoteChatRecord = {
  chat_id: string;
  revision: number;
  payload: string | null;
  deleted_at: number | null;
  updated_at: number;
};

export class PyjriCloudError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "PyjriCloudError";
  }
}

export function chatNeedsUpload(chat: object, syncedFingerprint?: string): boolean {
  return JSON.stringify(chat) !== syncedFingerprint;
}

export function getPyjriCloudUrl(): string {
  return (process.env.NEXT_PUBLIC_PYJRI_API_URL ?? "").replace(/\/+$/, "");
}

export function isPyjriCloudConfigured(): boolean {
  return Boolean(getPyjriCloudUrl());
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const baseUrl = getPyjriCloudUrl();
  if (!baseUrl) {
    throw new Error("Pyjri Cloud API URL is not configured");
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  let body: { error?: string } & T;
  try {
    body = (await response.json()) as { error?: string } & T;
  } catch {
    throw new PyjriCloudError("Pyjri Cloud returned an invalid response", 502);
  }

  if (!response.ok) {
    throw new PyjriCloudError(
      typeof body.error === "string" ? body.error : "Pyjri Cloud request failed",
      response.status,
    );
  }
  return body;
}

export async function signInWithGoogle(): Promise<void> {
  const baseUrl = getPyjriCloudUrl();
  if (!baseUrl) throw new Error("Pyjri Cloud API URL is not configured");

  const result = await request<{ url?: string }>("/api/auth/sign-in/social", {
    method: "POST",
    body: JSON.stringify({
      provider: "google",
      callbackURL: window.location.href,
    }),
  });
  if (!result.url) throw new Error("Google sign-in did not return a redirect");

  const redirect = new URL(result.url);
  if (
    redirect.protocol !== "https:" ||
    redirect.hostname !== "accounts.google.com"
  ) {
    throw new Error("Google sign-in returned an invalid redirect");
  }
  window.location.assign(redirect.toString());
}

export async function getPyjriCloudUser(): Promise<PyjriCloudUser | null> {
  const result = await request<{
    user?: PyjriCloudUser;
    session?: unknown;
  }>("/api/auth/get-session");
  return result.user ?? null;
}

export async function signOutOfPyjriCloud(): Promise<void> {
  await request("/api/auth/sign-out", { method: "POST" });
}

export async function deletePyjriCloudAccount(
  retainRemoteChats: boolean,
): Promise<{ deleted: boolean; remoteChatsDeleted: boolean }> {
  return request("/v1/account", {
    method: "DELETE",
    body: JSON.stringify({
      confirmation: "DELETE",
      retainRemoteChats,
    }),
  });
}

export async function getUserD1Connection(): Promise<UserD1Connection> {
  return request<UserD1Connection>("/v1/cloudflare/connection");
}

export async function connectUserD1(input: {
  accountId: string;
  databaseId: string;
  token: string;
}): Promise<UserD1Connection> {
  return request<UserD1Connection>("/v1/cloudflare/connection", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function disconnectUserD1(): Promise<void> {
  await request("/v1/cloudflare/connection", { method: "DELETE" });
}

export async function listRemoteChats(
  cursor = "",
): Promise<{ records: RemoteChatRecord[]; nextCursor: string | null }> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return request(`/v1/chats${query}`);
}

export async function writeRemoteChat(
  chat: ChatSession,
  expectedRevision: number,
): Promise<{ revision: number; updatedAt: number }> {
  return request(`/v1/chats/${encodeURIComponent(chat.id)}`, {
    method: "PUT",
    body: JSON.stringify({ chat, expectedRevision }),
  });
}

export async function deleteRemoteChat(
  chatId: string,
  expectedRevision: number,
): Promise<{ revision: number; deletedAt: number }> {
  return request(`/v1/chats/${encodeURIComponent(chatId)}`, {
    method: "DELETE",
    body: JSON.stringify({ expectedRevision }),
  });
}
