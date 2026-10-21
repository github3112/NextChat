import { chatNeedsUpload } from "../app/utils/pyjri-cloud";

describe("chatNeedsUpload", () => {
  const chat = {
    id: "chat-1",
    messages: [{ id: "message-1", content: "hello" }],
  };

  test("uploads local chats that have no synced fingerprint", () => {
    expect(chatNeedsUpload(chat)).toBe(true);
  });

  test("skips chats whose content matches the synced fingerprint", () => {
    expect(chatNeedsUpload(chat, JSON.stringify(chat))).toBe(false);
  });

  test("uploads chats changed since the last successful sync", () => {
    expect(
      chatNeedsUpload(chat, JSON.stringify({ ...chat, messages: [] })),
    ).toBe(true);
  });
});
