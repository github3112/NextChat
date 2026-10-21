import { drizzle } from "drizzle-orm/d1";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import * as schema from "./schema";

export interface Env {
  AUTH_DB: D1Database;
  APP_ORIGIN: string;
  AUTH_BASE_URL: string;
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  DATA_ENCRYPTION_KEY: string;
}

export function createAuth(env: Env) {
  return betterAuth({
    appName: "Pyjri",
    baseURL: env.AUTH_BASE_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(drizzle(env.AUTH_DB, { schema }), {
      provider: "sqlite",
    }),
    trustedOrigins: [env.APP_ORIGIN],
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        scope: ["openid", "email", "profile"],
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: env.AUTH_BASE_URL.startsWith("https://"),
      },
    },
  });
}

export function isAuthConfigured(env: Env): boolean {
  return Boolean(
    env.AUTH_BASE_URL &&
      env.APP_ORIGIN &&
      env.BETTER_AUTH_SECRET &&
      env.GOOGLE_CLIENT_ID &&
      env.GOOGLE_CLIENT_SECRET,
  );
}
