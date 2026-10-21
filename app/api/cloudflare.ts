import { getServerSideConfig } from "@/app/config/server";
import { ModelProvider, OpenaiPath } from "@/app/constant";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "./auth";

const MODEL_ID = "@cf/zai-org/glm-4.7-flash";
const ALLOWED_PATHS = new Set([
  OpenaiPath.ChatPath,
  OpenaiPath.ListModelPath,
]);

export async function handle(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  if (req.method === "OPTIONS") {
    return NextResponse.json({ body: "OK" }, { status: 200 });
  }

  const subpath = params.path.join("/");
  if (
    !ALLOWED_PATHS.has(subpath) ||
    (subpath === OpenaiPath.ChatPath && req.method !== "POST") ||
    (subpath === OpenaiPath.ListModelPath && req.method !== "GET")
  ) {
    return NextResponse.json(
      { error: "Cloudflare Workers AI path or method is not allowed" },
      { status: 405 },
    );
  }

  const config = getServerSideConfig();
  if (!config.cloudflareAccountId || !config.cloudflareApiToken) {
    return NextResponse.json(
      {
        error:
          "Cloudflare Workers AI is not configured. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.",
      },
      { status: 503 },
    );
  }

  if (!/^[a-f0-9]{32}$/i.test(config.cloudflareAccountId)) {
    return NextResponse.json(
      { error: "CLOUDFLARE_ACCOUNT_ID must be a 32-character account ID." },
      { status: 500 },
    );
  }

  const authResult = auth(req, ModelProvider.Cloudflare);
  if (authResult.error) {
    return NextResponse.json(authResult, { status: 401 });
  }

  if (subpath === OpenaiPath.ListModelPath) {
    return NextResponse.json({
      object: "list",
      data: [
        {
          id: MODEL_ID,
          object: "model",
          root: MODEL_ID,
          capabilities: ["chat.completions"],
          context_window: 131072,
        },
      ],
    });
  }

  let body: string | undefined;
  if (subpath === OpenaiPath.ChatPath) {
    body = await req.text();
    try {
      const payload = JSON.parse(body) as {
        model?: string;
        messages?: unknown;
      };
      if (
        payload.model !== MODEL_ID ||
        !Array.isArray(payload.messages)
      ) {
        return NextResponse.json(
          {
            error: `Only ${MODEL_ID} chat-completions requests are supported.`,
          },
          { status: 400 },
        );
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        return NextResponse.json(
          { error: "Request body must be valid JSON." },
          { status: 400 },
        );
      }
      throw error;
    }
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${config.cloudflareAccountId}/ai/${subpath}`;
  const response = await fetch(url, {
    method: req.method,
    headers: {
      Authorization: req.headers.get("Authorization") ?? "",
      "Content-Type": "application/json",
    },
    body,
    redirect: "manual",
  });

  const headers = new Headers(response.headers);
  headers.delete("www-authenticate");
  headers.delete("content-encoding");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Accel-Buffering", "no");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
