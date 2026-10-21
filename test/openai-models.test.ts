import { mapOpenAIModels } from "../app/client/platforms/openai";
import { ServiceProvider } from "../app/constant";

describe("mapOpenAIModels", () => {
  test("uses endpoint chat models instead of built-in model definitions", () => {
    const models = mapOpenAIModels([
      { id: "Qwen/Qwen3-4B", object: "model", root: "Qwen/Qwen3-4B" },
      { id: "custom-chat-model", object: "model", root: "custom-chat-model" },
      {
        id: "text-embedding-3-small",
        object: "model",
        root: "text-embedding-3-small",
      },
      {
        id: "Qwen3-Embedding-0.6B",
        object: "model",
        root: "Qwen3-Embedding-0.6B",
      },
      {
        id: "gpt-4o-mini-transcribe",
        object: "model",
        root: "gpt-4o-mini-transcribe",
      },
    ]);

    expect(models.map((model) => model.name)).toEqual([
      "Qwen/Qwen3-4B",
      "custom-chat-model",
    ]);
    expect(models.every((model) => model.available)).toBe(true);
  });

  test("honors explicit endpoint capability metadata", () => {
    const models = mapOpenAIModels([
      {
        id: "custom-model",
        object: "model",
        root: "custom-model",
        capabilities: ["embeddings"],
      },
      {
        id: "another-model",
        object: "model",
        root: "another-model",
        capabilities: ["chat.completions"],
      },
    ]);

    expect(models.map((model) => model.name)).toEqual(["another-model"]);
  });

  test("maps Cloudflare Workers AI models to the Cloudflare provider", () => {
    const [model] = mapOpenAIModels(
      [
        {
          id: "@cf/zai-org/glm-4.7-flash",
          object: "model",
          root: "@cf/zai-org/glm-4.7-flash",
          context_window: 131072,
        },
      ],
      ServiceProvider.Cloudflare,
    );

    expect(model).toMatchObject({
      name: "@cf/zai-org/glm-4.7-flash",
      contextWindow: 131072,
      provider: {
        id: "cloudflare",
        providerName: "Cloudflare",
      },
    });
  });
});
