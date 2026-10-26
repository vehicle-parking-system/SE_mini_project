// Signed QR codes for bookings ("R") and entry tickets ("T"): "VPS1.<kind>.<id>.<signature>".
// The signature is an HMAC of the kind and id, so a code can't be guessed or edited to point at
// someone else's booking or ticket. Codes are computed when needed, never stored.
const crypto = require("crypto");
const config = require("./config");

const PREFIX = "VPS1";

const signature = (kind, id) =>
  crypto.createHmac("sha256", config.qrSecret).update(`${kind}.${id}`).digest("base64url").slice(0, 22);

const sign = (kind, id) => `${PREFIX}.${kind}.${id}.${signature(kind, id)}`;

// -> the id inside a valid code of this kind, or null
function verify(code, kind) {
  if (typeof code !== "string") return null;
  const [prefix, k, id, sig] = code.trim().split(".");
  if (prefix !== PREFIX || k !== kind || !id || !sig) return null;
  const expected = Buffer.from(signature(kind, id));
  const given = Buffer.from(sig);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected) ? id : null;
}

module.exports = {
  bookingCode: (id) => sign("R", id),
  ticketCode: (id) => sign("T", id),
  readBookingCode: (code) => verify(code, "R"),
  readTicketCode: (code) => verify(code, "T"),
};
