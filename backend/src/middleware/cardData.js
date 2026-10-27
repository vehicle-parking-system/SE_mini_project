// PCI DSS scope guard (VPS-SR-004, VPS-NF-003). Card details must go straight to the payment
// gateway, which returns a token; this API only ever takes that token. A request whose body
// carries card data anyway — a card field, or anything that looks like a card number — is
// refused before any route runs, so the data is never processed, stored or logged. The refusal
// is logged with the path only.
const logger = require("../logger");
const { ApiError } = require("../errors");

const CARD_FIELD = /^(card|cards|card_?(number|no|num)|pan|cvv2?|cvc2?|csc|security_?code|expiry|exp_?(month|year|date)|expiry_?(month|year|date)|track_?data)$/i;
const MAX_DEPTH = 6;

// 13–19 digits (spaces or dashes allowed) starting like a card scheme (2–6), passing the Luhn check
function looksLikeCardNumber(value) {
  const digits = String(value).replace(/[ -]/g, "");
  if (!/^[2-6]\d{12,18}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

function containsCardData(value, depth = 0) {
  if (depth > MAX_DEPTH || value === null || value === undefined) return false;
  if (typeof value === "string" || typeof value === "number") return looksLikeCardNumber(value);
  if (typeof value !== "object") return false;
  return Object.entries(value).some(([key, v]) =>
    (CARD_FIELD.test(key.replace(/[-\s]/g, "_")) && v !== undefined && v !== null && v !== "") || containsCardData(v, depth + 1));
}

function rejectCardData(req, _res, next) {
  if (req.body && containsCardData(req.body)) {
    logger.warn("card data refused", { method: req.method, path: req.originalUrl.split("?")[0] });
    throw new ApiError(400, "CARD_DATA_REJECTED",
      "Card details must be entered in the payment gateway's checkout, never sent to this service");
  }
  next();
}

module.exports = { rejectCardData, containsCardData, looksLikeCardNumber };
