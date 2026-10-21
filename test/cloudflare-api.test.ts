/** @jest-environment node */

import { NextRequest } from "next/server";
import { jest } from "@jest/globals";

const ACCOUNT_ID = "97a7fe55665a759dc82f1bf651f3001b";
const MODEL_ID = "@cf/zai-org/glm-4.7-flash";

describe("Cloudflare Workers AI route", () => {
  const originalEnv = {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    code: process.env.CODE,
  };
  const originalFetch = global.fetch;
  let handle: typeof import("../app/api/cloudflare").handle;
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeAll(async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = ACCOUNT_ID;
    process.env.CLOUDFLARE_API_TOKEN = "test-token";
    process.env.CODE = "";
    jest.resetModules();
    ({ handle } = await import("../app/api/cloudflare"));
  });

  beforeEach(() => {
    fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      new Response('data: {"choices":[]}\n\n', {
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
    global.fetch = fetchMock;
  });

  afterAll(() => {
    global.fetch = originalFetch;
    if (originalEnv.accountId === undefined) {
      delete process.env.CLOUDFLARE_ACCOUNT_ID;
    } else {
      process.env.CLOUDFLARE_ACCOUNT_ID = originalEnv.accountId;
    }
    if (originalEnv.apiToken === undefined) {
      delete process.env.CLOUDFLARE_API_TOKEN;
    } else {
      process.env.CLOUDFLARE_API_TOKEN = originalEnv.apiToken;
    }
    if (originalEnv.code === undefined) {
      delete process.env.CODE;
    } else {
      process.env.CODE = originalEnv.code;
    }
  });

  test("streams the selected model through Cloudflare's OpenAI-compatible API", async () => {
    const requestBody = {
      model: MODEL_ID,
      messages: [{ role: "user", content: "Hello" }],
      stream: true,
    };
    const req = new NextRequest(
      "http://localhost/api/cloudflare/v1/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      },
    );

    const response = await handle(req, {
      params: { path: ["v1", "chat", "completions"] },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(await response.text()).toContain("data: ");
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/v1/chat/completions`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
        body: JSON.stringify(requestBody),
      }),
    );
  });

  test("rejects a different model before making an upstream request", async () => {
    const req = new NextRequest(
      "http://localhost/api/cloudflare/v1/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "@cf/openai/gpt-oss-20b",
          messages: [{ role: "user", content: "Hello" }],
        }),
      },
    );

    const response = await handle(req, {
      params: { path: ["v1", "chat", "completions"] },
    });

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("lists only the configured Cloudflare model without an upstream call", async () => {
    const req = new NextRequest("http://localhost/api/cloudflare/v1/models", {
      method: "GET",
    });

    const response = await handle(req, {
      params: { path: ["v1", "models"] },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [
        {
          id: MODEL_ID,
          capabilities: ["chat.completions"],
          context_window: 131072,
        },
      ],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
