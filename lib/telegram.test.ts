import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Telegram API wrapper", () => {
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;

  beforeEach(() => {
    vi.resetModules();
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.TELEGRAM_BOT_TOKEN = originalToken;
  });

  it("treats HTTP 200 ok:false responses as delivery failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, description: "chat not found" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { sendMessage } = await import("./telegram");

    await expect(sendMessage("123", "hello")).rejects.toThrow("chat not found");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.telegram.org/bottest-token/sendMessage",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
