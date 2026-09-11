import { describe, expect, it, vi } from "vitest";
import {
  createZeptoMailMagicLinkMailer,
  MagicLinkDeliveryError,
  ZEPTOMAIL_AU_EMAIL_ENDPOINT
} from "../src/zeptomail";

describe("ZeptoMail magic-link transport", () => {
  it("sends the expected authenticated request through the AU endpoint", async () => {
    const apiKey = `test-only-${crypto.randomUUID()}`;
    const recipient = `account-${crypto.randomUUID()}@example.invalid`;
    const magicUrl = `https://go.tapntrust.com/auth/verify?token=${crypto.randomUUID()}`;
    let capturedInput: RequestInfo | URL | undefined;
    let capturedInit: RequestInit | undefined;
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedInput = input;
      capturedInit = init;
      return new Response(JSON.stringify({ message: "OK" }), { status: 201 });
    };

    const mailer = createZeptoMailMagicLinkMailer(apiKey, "contact@tapntrust.com", fetcher);
    await expect(mailer.sendMagicLink(recipient, magicUrl)).resolves.toBeUndefined();

    expect(capturedInput).toBe(ZEPTOMAIL_AU_EMAIL_ENDPOINT);
    expect(capturedInit?.method).toBe("POST");
    const headers = new Headers(capturedInit?.headers);
    expect(headers.get("Authorization")).toBe(`Zoho-enczapikey ${apiKey}`);
    expect(headers.get("Content-Type")).toBe("application/json");

    const payload = JSON.parse(String(capturedInit?.body));
    expect(payload).toEqual(expect.objectContaining({
      from: { address: "contact@tapntrust.com", name: "Tapntrust Support" },
      to: [{ email_address: { address: recipient, name: "Tapntrust customer" } }],
      reply_to: [{ address: "contact@tapntrust.com", name: "Tapntrust Support" }],
      subject: "Your Tapntrust Insights sign-in link",
      track_clicks: false,
      track_opens: false
    }));
    expect(payload.textbody).toContain(magicUrl);
    expect(payload.htmlbody).toContain(magicUrl.replace(/&/g, "&amp;"));
  });

  it("handles a non-2xx response without exposing the API key or provider response", async () => {
    const apiKey = `test-only-${crypto.randomUUID()}`;
    const providerDetail = `provider-detail-${crypto.randomUUID()}`;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const mailer = createZeptoMailMagicLinkMailer(
      apiKey,
      "contact@tapntrust.com",
      async () => new Response(providerDetail, { status: 401 })
    );

    try {
      let failure: unknown;
      try {
        await mailer.sendMagicLink(
          `account-${crypto.randomUUID()}@example.invalid`,
          "https://go.tapntrust.com/auth/verify?token=safe-test-token"
        );
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(MagicLinkDeliveryError);
      expect(failure).toMatchObject({
        message: "Magic-link delivery failed",
        code: "provider_rejected",
        status: 401
      });
      const exposedError = JSON.stringify(failure);
      expect(exposedError).not.toContain(apiKey);
      expect(exposedError).not.toContain(providerDetail);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
