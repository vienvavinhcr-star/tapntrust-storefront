import type { MagicLinkMailer } from "./auth";

export const ZEPTOMAIL_AU_EMAIL_ENDPOINT = "https://api.zeptomail.com.au/v1.1/email";

type ZeptoMailFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type SafeMailFailure = {
  provider: "zeptomail" | "unknown";
  code: "provider_rejected" | "provider_unavailable" | "unknown_failure";
  status?: number;
};

export class MagicLinkDeliveryError extends Error {
  readonly code: "provider_rejected" | "provider_unavailable";
  readonly status?: number;

  constructor(code: "provider_rejected" | "provider_unavailable", status?: number) {
    super("Magic-link delivery failed");
    this.name = "MagicLinkDeliveryError";
    this.code = code;
    this.status = status;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character] || character);
}

export function safeMailFailure(error: unknown): SafeMailFailure {
  if (error instanceof MagicLinkDeliveryError) {
    return {
      provider: "zeptomail",
      code: error.code,
      ...(error.status === undefined ? {} : { status: error.status })
    };
  }
  return { provider: "unknown", code: "unknown_failure" };
}

export function createZeptoMailMagicLinkMailer(
  apiKey: string,
  fromEmail: string,
  fetcher: ZeptoMailFetch = fetch
): MagicLinkMailer {
  return {
    async sendMagicLink(email, magicUrl) {
      if (!apiKey || !fromEmail) throw new MagicLinkDeliveryError("provider_unavailable");

      const safeUrl = escapeHtml(magicUrl);
      let response: Response;
      try {
        response = await fetcher(ZEPTOMAIL_AU_EMAIL_ENDPOINT, {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Zoho-enczapikey ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            from: { address: fromEmail, name: "Tapntrust Support" },
            to: [{ email_address: { address: email, name: "Tapntrust customer" } }],
            reply_to: [{ address: fromEmail, name: "Tapntrust Support" }],
            subject: "Your Tapntrust Insights sign-in link",
            textbody: `Open your Tapntrust Insights dashboard: ${magicUrl}\n\nThis single-use link expires in 15 minutes. If you did not request it, you can ignore this email.`,
            htmlbody: `<p>Open your Tapntrust Insights dashboard:</p><p><a href="${safeUrl}">Sign in to Tapntrust Insights</a></p><p>This single-use link expires in 15 minutes. If you did not request it, you can ignore this email.</p>`,
            track_clicks: false,
            track_opens: false
          })
        });
      } catch {
        throw new MagicLinkDeliveryError("provider_unavailable");
      }

      if (!response.ok) {
        throw new MagicLinkDeliveryError("provider_rejected", response.status);
      }
    }
  };
}
