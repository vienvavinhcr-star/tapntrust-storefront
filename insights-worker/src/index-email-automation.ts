import baseHandler from "./index";
import {
  handleUpdatedOrderInsightsEmail,
  processPaidOrderQuickGuide,
  type OrderEmailAutomationEnv
} from "./order-email-automation";

type EmailAutomationWorkerEnv = Env & OrderEmailAutomationEnv;

export default {
  async fetch(request, env, ctx) {
    const workerEnv = env as EmailAutomationWorkerEnv;
    const url = new URL(request.url);

    if (url.pathname === "/api/shopify/webhooks/orders-updated") {
      return handleUpdatedOrderInsightsEmail(request, workerEnv);
    }

    if (url.pathname === "/api/shopify/webhooks/orders-paid") {
      const emailAutomationRequest = request.clone();
      const response = await baseHandler.fetch(request, env, ctx);
      if (response.ok) {
        ctx.waitUntil(processPaidOrderQuickGuide(emailAutomationRequest, workerEnv).catch((error) => {
          console.error(JSON.stringify({
            event: "order_quick_guide_failed",
            reason: error instanceof Error ? error.message : "unknown_error"
          }));
        }));
      }
      return response;
    }

    return baseHandler.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    return baseHandler.scheduled(event, env, ctx);
  }
} satisfies ExportedHandler<Env>;
