import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./auth";
import { createAuth, isAuthConfigured } from "./auth";
import { CloudflareD1Error, queryUserD1 } from "./cloudflare-d1";
import { decryptSecret, encryptSecret } from "./crypto";

type Variables = {
  userId: string;
};

type ChatRow = {
  chat_id: string;
  revision: number;
  payload: string | null;
  deleted_at: number | null;
  updated_at: number;
};

type ConnectionRow = {
  account_id: string;
  database_id: string;
  token_ciphertext: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use(
  "*",
  async (context, next) => {
    const origin = context.req.header("Origin");
    if (origin && origin !== context.env.APP_ORIGIN) {
      return context.json({ error: "Origin not allowed" }, 403);
    }
    await next();
  },
  cors({
    origin: (origin, context) =>
      origin === context.env.APP_ORIGIN ? origin : "",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    maxAge: 600,
  }),
);

app.onError((error, context) => {
  console.error("[Pyjri API]", error.name);
  return context.json({ error: "Internal server error" }, 500);
});

app.get("/health", (context) => context.json({ status: "ok" }));

app.all("/api/auth/*", (context) => {
  if (!isAuthConfigured(context.env)) {
    return context.json({ error: "Authentication is not configured" }, 503);
  }
  return createAuth(context.env).handler(context.req.raw);
});

app.use("/v1/*", async (context, next) => {
  if (!isAuthConfigured(context.env)) {
    return context.json({ error: "Authentication is not configured" }, 503);
  }

  const session = await createAuth(context.env).api.getSession({
    headers: context.req.raw.headers,
  });
  if (!session) {
    return context.json({ error: "Authentication required" }, 401);
  }

  context.set("userId", session.user.id);
  await next();
});

app.get("/v1/account", (context) =>
  context.json({ userId: context.get("userId") }),
);

app.delete("/v1/account", async (context) => {
  const rawBody = await context.req.text();
  if (rawBody.length > 1_000) {
    return context.json({ error: "Request is too large" }, 413);
  }

  let body: { confirmation?: unknown; retainRemoteChats?: unknown };
  try {
    body = JSON.parse(rawBody) as {
      confirmation?: unknown;
      retainRemoteChats?: unknown;
    };
  } catch {
    return context.json({ error: "Invalid JSON body" }, 400);
  }
  if (
    body.confirmation !== "DELETE" ||
    typeof body.retainRemoteChats !== "boolean"
  ) {
    return context.json({ error: "Invalid account deletion confirmation" }, 400);
  }

  const userId = context.get("userId");
  const connection = await getConnection(context.env, userId);
  if (connection && !body.retainRemoteChats) {
    try {
      await queryUserD1(
        connection.accountId,
        connection.databaseId,
        connection.token,
        "DELETE FROM pyjri_chats WHERE user_id = ?",
        [userId],
      );
    } catch (error) {
      if (error instanceof CloudflareD1Error) {
        return context.json(
          {
            error:
              "Could not remove chats from your D1 database; your Pyjri account remains active.",
          },
          422,
        );
      }
      throw error;
    }
  }

  await context.env.AUTH_DB.batch([
    context.env.AUTH_DB.prepare("DELETE FROM session WHERE userId = ?").bind(userId),
    context.env.AUTH_DB.prepare("DELETE FROM account WHERE userId = ?").bind(userId),
    context.env.AUTH_DB.prepare("DELETE FROM cloudflare_connections WHERE user_id = ?").bind(userId),
    context.env.AUTH_DB.prepare("DELETE FROM model_credentials WHERE user_id = ?").bind(userId),
    context.env.AUTH_DB.prepare('DELETE FROM "user" WHERE id = ?').bind(userId),
  ]);

  return context.json({
    deleted: true,
    remoteChatsDeleted: !connection || !body.retainRemoteChats,
  });
});

app.get("/v1/cloudflare/connection", async (context) => {
  const connection = await context.env.AUTH_DB.prepare(
    "SELECT account_id, database_id FROM cloudflare_connections WHERE user_id = ?",
  )
    .bind(context.get("userId"))
    .first<{ account_id: string; database_id: string }>();

  return context.json({
    connected: Boolean(connection),
    accountId: connection?.account_id ?? null,
    databaseId: connection?.database_id ?? null,
  });
});

app.post("/v1/cloudflare/connection", async (context) => {
  if (!context.env.DATA_ENCRYPTION_KEY) {
    return context.json({ error: "Secret encryption is not configured" }, 503);
  }

  const rawBody = await context.req.text();
  if (rawBody.length > 8_192) {
    return context.json({ error: "Request is too large" }, 413);
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return context.json({ error: "Invalid JSON body" }, 400);
  }

  const accountId =
    typeof body.accountId === "string" ? body.accountId.trim() : "";
  const databaseId =
    typeof body.databaseId === "string" ? body.databaseId.trim() : "";
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (
    !/^[a-f0-9]{32}$/i.test(accountId) ||
    !/^[a-f0-9-]{36}$/i.test(databaseId) ||
    token.length < 20 ||
    token.length > 2_000
  ) {
    return context.json({ error: "Invalid Cloudflare D1 connection details" }, 400);
  }

  try {
    await queryUserD1(
      accountId,
      databaseId,
      token,
      "SELECT 1 AS pyjri_connection_check",
    );
    await queryUserD1(
      accountId,
      databaseId,
      token,
      `CREATE TABLE IF NOT EXISTS pyjri_chats (
        user_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        payload TEXT,
        deleted_at INTEGER,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, chat_id)
      )`,
    );
  } catch (error) {
    if (error instanceof CloudflareD1Error) {
      return context.json(
        { error: "Could not access that D1 database with this token" },
        422,
      );
    }
    throw error;
  }

  const encryptedToken = await encryptSecret(
    token,
    context.env.DATA_ENCRYPTION_KEY,
    `cloudflare-token:${context.get("userId")}`,
  );
  const now = Date.now();
  await context.env.AUTH_DB.prepare(
    `INSERT INTO cloudflare_connections
      (user_id, account_id, database_id, token_ciphertext, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       account_id = excluded.account_id,
       database_id = excluded.database_id,
       token_ciphertext = excluded.token_ciphertext,
       updated_at = excluded.updated_at`,
  )
    .bind(
      context.get("userId"),
      accountId,
      databaseId,
      encryptedToken,
      now,
      now,
    )
    .run();

  return context.json({ connected: true, accountId, databaseId });
});

app.delete("/v1/cloudflare/connection", async (context) => {
  await context.env.AUTH_DB.prepare(
    "DELETE FROM cloudflare_connections WHERE user_id = ?",
  )
    .bind(context.get("userId"))
    .run();

  return context.json({ disconnected: true, remoteDataRetained: true });
});

app.get("/v1/credentials", async (context) => {
  const rows = await context.env.AUTH_DB.prepare(
    "SELECT provider, updated_at FROM model_credentials WHERE user_id = ? ORDER BY provider",
  )
    .bind(context.get("userId"))
    .all<{ provider: string; updated_at: number }>();

  return context.json({
    credentials: rows.results.map(({ provider, updated_at }) => ({
      provider,
      updatedAt: updated_at,
    })),
  });
});

app.put("/v1/credentials/:provider", async (context) => {
  if (!context.env.DATA_ENCRYPTION_KEY) {
    return context.json({ error: "Secret encryption is not configured" }, 503);
  }

  const provider = context.req.param("provider");
  if (!/^[a-z0-9-]{1,40}$/.test(provider)) {
    return context.json({ error: "Invalid provider" }, 400);
  }

  const rawBody = await context.req.text();
  if (rawBody.length > 8_192) {
    return context.json({ error: "Request is too large" }, 413);
  }

  let body: { key?: unknown };
  try {
    body = JSON.parse(rawBody) as { key?: unknown };
  } catch {
    return context.json({ error: "Invalid JSON body" }, 400);
  }
  if (typeof body.key !== "string" || !body.key.trim() || body.key.length > 5_000) {
    return context.json({ error: "Invalid credential" }, 400);
  }

  const userId = context.get("userId");
  const ciphertext = await encryptSecret(
    body.key.trim(),
    context.env.DATA_ENCRYPTION_KEY,
    `model-key:${userId}:${provider}`,
  );
  const now = Date.now();
  await context.env.AUTH_DB.prepare(
    `INSERT INTO model_credentials (user_id, provider, secret_ciphertext, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, provider) DO UPDATE SET
       secret_ciphertext = excluded.secret_ciphertext,
       updated_at = excluded.updated_at`,
  )
    .bind(userId, provider, ciphertext, now)
    .run();

  return context.json({ provider, updatedAt: now });
});

app.delete("/v1/credentials/:provider", async (context) => {
  await context.env.AUTH_DB.prepare(
    "DELETE FROM model_credentials WHERE user_id = ? AND provider = ?",
  )
    .bind(context.get("userId"), context.req.param("provider"))
    .run();

  return context.json({ deleted: true });
});

async function getConnection(
  env: Env,
  userId: string,
): Promise<{ accountId: string; databaseId: string; token: string } | null> {
  if (!env.DATA_ENCRYPTION_KEY) {
    throw new Error("Secret encryption is not configured");
  }

  const connection = await env.AUTH_DB.prepare(
    `SELECT account_id, database_id, token_ciphertext
     FROM cloudflare_connections WHERE user_id = ?`,
  )
    .bind(userId)
    .first<ConnectionRow>();
  if (!connection) return null;

  const token = await decryptSecret(
    connection.token_ciphertext,
    env.DATA_ENCRYPTION_KEY,
    `cloudflare-token:${userId}`,
  );
  return {
    accountId: connection.account_id,
    databaseId: connection.database_id,
    token,
  };
}

async function getRemoteChat(
  connection: NonNullable<Awaited<ReturnType<typeof getConnection>>>,
  userId: string,
  chatId: string,
): Promise<ChatRow | null> {
  const { results } = await queryUserD1<ChatRow>(
    connection.accountId,
    connection.databaseId,
    connection.token,
    `SELECT chat_id, revision, payload, deleted_at, updated_at
     FROM pyjri_chats WHERE user_id = ? AND chat_id = ?`,
    [userId, chatId],
  );
  return results[0] ?? null;
}

app.get("/v1/chats", async (context) => {
  const connection = await getConnection(context.env, context.get("userId"));
  if (!connection) {
    return context.json({ error: "Connect a Cloudflare D1 database first" }, 409);
  }

  const cursor = context.req.query("cursor") ?? "";
  const { results } = await queryUserD1<ChatRow>(
    connection.accountId,
    connection.databaseId,
    connection.token,
    `SELECT chat_id, revision, payload, deleted_at, updated_at
     FROM pyjri_chats
     WHERE user_id = ? AND chat_id > ?
     ORDER BY chat_id
     LIMIT 101`,
    [context.get("userId"), cursor],
  );
  const hasMore = results.length > 100;
  const records = results.slice(0, 100);

  return context.json({
    records,
    nextCursor: hasMore ? records[records.length - 1].chat_id : null,
  });
});

app.put("/v1/chats/:chatId", async (context) => {
  const connection = await getConnection(context.env, context.get("userId"));
  if (!connection) {
    return context.json({ error: "Connect a Cloudflare D1 database first" }, 409);
  }

  const chatId = context.req.param("chatId");
  if (chatId.length < 1 || chatId.length > 128) {
    return context.json({ error: "Invalid chat ID" }, 400);
  }

  const rawBody = await context.req.text();
  if (rawBody.length > 1_000_000) {
    return context.json({ error: "Chat is too large" }, 413);
  }

  let body: { expectedRevision?: unknown; chat?: unknown };
  try {
    body = JSON.parse(rawBody) as { expectedRevision?: unknown; chat?: unknown };
  } catch {
    return context.json({ error: "Invalid JSON body" }, 400);
  }
  if (
    !Number.isInteger(body.expectedRevision) ||
    (body.expectedRevision as number) < 0 ||
    !body.chat ||
    typeof body.chat !== "object" ||
    (body.chat as { id?: unknown }).id !== chatId
  ) {
    return context.json({ error: "Invalid chat update" }, 400);
  }

  const userId = context.get("userId");
  const expectedRevision = body.expectedRevision as number;
  const payload = JSON.stringify(body.chat);
  const now = Date.now();
  const write =
    expectedRevision === 0
      ? await queryUserD1<{ revision: number }>(
          connection.accountId,
          connection.databaseId,
          connection.token,
          `INSERT INTO pyjri_chats
            (user_id, chat_id, revision, payload, deleted_at, updated_at)
           VALUES (?, ?, 1, ?, NULL, ?)
           ON CONFLICT(user_id, chat_id) DO NOTHING
           RETURNING revision`,
          [userId, chatId, payload, now],
        )
      : await queryUserD1<{ revision: number }>(
          connection.accountId,
          connection.databaseId,
          connection.token,
          `UPDATE pyjri_chats
           SET revision = revision + 1, payload = ?, deleted_at = NULL, updated_at = ?
           WHERE user_id = ? AND chat_id = ? AND revision = ?
           RETURNING revision`,
          [payload, now, userId, chatId, expectedRevision],
        );

  if (write.results.length === 0) {
    const remote = await getRemoteChat(connection, userId, chatId);
    return context.json({ error: "revision_conflict", remote }, 409);
  }
  return context.json({ revision: write.results[0].revision, updatedAt: now });
});

app.delete("/v1/chats/:chatId", async (context) => {
  const connection = await getConnection(context.env, context.get("userId"));
  if (!connection) {
    return context.json({ error: "Connect a Cloudflare D1 database first" }, 409);
  }

  const chatId = context.req.param("chatId");
  const rawBody = await context.req.text();
  if (rawBody.length > 1_000) {
    return context.json({ error: "Request is too large" }, 413);
  }

  let body: { expectedRevision?: unknown };
  try {
    body = JSON.parse(rawBody) as { expectedRevision?: unknown };
  } catch {
    return context.json({ error: "Invalid JSON body" }, 400);
  }
  if (
    !Number.isInteger(body.expectedRevision) ||
    (body.expectedRevision as number) < 0
  ) {
    return context.json({ error: "Invalid expected revision" }, 400);
  }

  const userId = context.get("userId");
  const expectedRevision = body.expectedRevision as number;
  const now = Date.now();
  const write =
    expectedRevision === 0
      ? await queryUserD1<{ revision: number }>(
          connection.accountId,
          connection.databaseId,
          connection.token,
          `INSERT INTO pyjri_chats
            (user_id, chat_id, revision, payload, deleted_at, updated_at)
           VALUES (?, ?, 1, NULL, ?, ?)
           ON CONFLICT(user_id, chat_id) DO NOTHING
           RETURNING revision`,
          [userId, chatId, now, now],
        )
      : await queryUserD1<{ revision: number }>(
          connection.accountId,
          connection.databaseId,
          connection.token,
          `UPDATE pyjri_chats
           SET revision = revision + 1, payload = NULL, deleted_at = ?, updated_at = ?
           WHERE user_id = ? AND chat_id = ? AND revision = ?
           RETURNING revision`,
          [now, now, userId, chatId, expectedRevision],
        );

  if (write.results.length === 0) {
    const remote = await getRemoteChat(connection, userId, chatId);
    return context.json({ error: "revision_conflict", remote }, 409);
  }
  return context.json({ revision: write.results[0].revision, deletedAt: now });
});

export default app;
