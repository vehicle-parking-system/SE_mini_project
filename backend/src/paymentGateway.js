// Payment gateway client. Only a sandbox exists so far: it accepts a gateway token
// ("tok_...", created by the gateway's checkout in the browser or the card terminal at the
// gate) and returns the gateway's payment reference. The gateway confirms or fails the
// payment later with a signed webhook (POST /api/payments/webhook).
//
// So that the app works end to end without a real gateway, the sandbox sends that webhook
// itself after a moment when PAYMENT_SANDBOX_AUTOCONFIRM is on (default outside tests);
// "tok_sandbox_decline" is failed instead. The acceptance tests send their own webhooks.
const crypto = require("crypto");
const config = require("./config");
const logger = require("./logger");

const AUTOCONFIRM_DELAY_MS = 1500;
let onGatewayEvent = null;

// Called once at startup with the handler that processes webhook events.
const setEventHandler = (handler) => { onGatewayEvent = handler; };

// -> {gatewayRef}
async function createCharge({ paymentId, amount, token }) {
  const gatewayRef = `pay_${crypto.randomBytes(10).toString("hex")}`;
  logger.info("gateway charge created", { paymentId, amount });
  if (config.paymentSandboxAutoConfirm && onGatewayEvent) {
    const status = token === "tok_sandbox_decline" ? "FAILED" : "CONFIRMED";
    setTimeout(() => onGatewayEvent({ paymentId, status })
      .catch((err) => logger.error("sandbox webhook failed", { paymentId, error: err.message })), AUTOCONFIRM_DELAY_MS).unref();
  }
  return { gatewayRef };
}

// Webhook signature: hex HMAC-SHA256 of the raw request body with PAYMENT_WEBHOOK_SECRET.
function verifySignature(rawBody, signature) {
  if (!rawBody || typeof signature !== "string" || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = crypto.createHmac("sha256", config.paymentWebhookSecret).update(rawBody).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

module.exports = { createCharge, verifySignature, setEventHandler };
