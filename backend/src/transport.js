// TLS 1.2+ for every connection (VPS-SR-001): client ↔ API, API ↔ MongoDB and API ↔ payment gateway.
//
// Inbound, either:
// - the API terminates TLS itself (TLS_CERT_FILE and TLS_KEY_FILE): HTTPS on PORT with TLS 1.2 as the
//   minimum and only forward-secret AEAD cipher suites; with HTTP_REDIRECT_PORT, plain HTTP there is
//   redirected to HTTPS; or
// - a load balancer terminates it (TLS_TERMINATED_BY_PROXY=true, with TRUST_PROXY set): requests the
//   proxy says arrived over plain HTTP are redirected (GET/HEAD) or refused (anything else, since its
//   body has already crossed the network unencrypted).
// Either way, HTTPS responses carry Strict-Transport-Security so browsers never fall back to HTTP.
// In production the API refuses to start with neither.
//
// Outbound: Node's default minimum TLS version is pinned to 1.2 for every client the process opens
// (MongoDB driver, gateway and other HTTPS calls), and in production a MongoDB URL for a remote host
// must have TLS on.
const fs = require("fs");
const http = require("http");
const https = require("https");
const tls = require("tls");
const logger = require("./logger");
const { ApiError } = require("./errors");

const MIN_VERSION = "TLSv1.2";
// TLS 1.3 suites, then TLS 1.2 ECDHE with AES-GCM or ChaCha20 only (forward secrecy, AEAD)
const CIPHERS = [
  "TLS_AES_256_GCM_SHA384", "TLS_CHACHA20_POLY1305_SHA256", "TLS_AES_128_GCM_SHA256",
  "ECDHE-ECDSA-AES256-GCM-SHA384", "ECDHE-RSA-AES256-GCM-SHA384", "ECDHE-ECDSA-CHACHA20-POLY1305",
  "ECDHE-RSA-CHACHA20-POLY1305", "ECDHE-ECDSA-AES128-GCM-SHA256", "ECDHE-RSA-AES128-GCM-SHA256",
].join(":");
// Load balancer health checks reach the API directly, over plain HTTP
const PLAIN_HTTP_ALLOWED = new Set(["/api/health"]);
const HOST_RE = /^[a-z0-9.-]+$/i;

function enforceOutboundTls() {
  tls.DEFAULT_MIN_VERSION = MIN_VERSION;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// A MongoDB URL must use TLS unless every host in it is this machine. mongodb+srv:// turns TLS on by default.
// (A list of hosts isn't a valid WHATWG URL, so the string is taken apart by hand.)
function mongoUrlProblem(url) {
  const parts = /^mongodb(\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)(?:\/[^?]*)?(?:\?(.*))?$/.exec(url ?? "");
  if (!parts) return "MONGO_URL is not a valid MongoDB connection string";
  const [, srv, hostList, query] = parts;
  const params = new URLSearchParams(query ?? "");
  const tlsParam = params.get("tls") ?? params.get("ssl");
  if (tlsParam === "false") return "MONGO_URL turns TLS off";
  if (srv || tlsParam === "true") return null;
  const hosts = hostList.split(",").map((h) => h.replace(/:\d+$/, ""));
  return hosts.every((h) => LOCAL_HOSTS.has(h)) ? null : "MONGO_URL connects to a remote host without TLS; add tls=true";
}

function tlsServerOptions({ certFile, keyFile, caFile }) {
  return { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile), ...(caFile && { ca: fs.readFileSync(caFile) }),
    minVersion: MIN_VERSION, ciphers: CIPHERS, honorCipherOrder: true };
}

// The checks the app makes on each request; options come from config.https
function requireHttps({ enforce, hstsMaxAgeSeconds }) {
  return (req, res, next) => {
    if (req.secure) {
      res.set("Strict-Transport-Security", `max-age=${hstsMaxAgeSeconds}; includeSubDomains`);
      return next();
    }
    if (!enforce || PLAIN_HTTP_ALLOWED.has(req.path)) return next();
    const host = req.hostname;
    if (["GET", "HEAD"].includes(req.method) && host && HOST_RE.test(host)) {
      return res.redirect(308, `https://${host}${req.originalUrl}`);
    }
    next(new ApiError(403, "HTTPS_REQUIRED", "Use HTTPS. This request was sent unencrypted and has been refused"));
  };
}

// Plain-HTTP listener that only redirects to the HTTPS port
function redirectServer(httpsPort) {
  return http.createServer((req, res) => {
    const host = (req.headers.host || "").replace(/:\d+$/, "");
    if (!HOST_RE.test(host)) {
      res.writeHead(400).end();
      return;
    }
    res.writeHead(308, { Location: `https://${host}${httpsPort === 443 ? "" : `:${httpsPort}`}${req.url}` }).end();
  });
}

// Starts the API: HTTPS when certificates are configured (plus the redirect listener), plain HTTP otherwise.
// -> {server, redirect?}, both listening
async function listen(app, { port, https: opts }) {
  const listenOn = (server, p) => new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(p, () => resolve(server));
  });
  if (!opts.certFile) {
    const server = await listenOn(http.createServer(app), port);
    logger.info("VPS API listening", { port: server.address().port, protocol: "http", tlsAtProxy: opts.terminatedByProxy });
    return { server };
  }
  const server = await listenOn(https.createServer(tlsServerOptions(opts), app), port);
  const result = { server };
  logger.info("VPS API listening", { port: server.address().port, protocol: "https", minVersion: MIN_VERSION });
  if (opts.redirectPort !== null) {
    result.redirect = await listenOn(redirectServer(server.address().port), opts.redirectPort);
    logger.info("HTTP to HTTPS redirect listening", { port: result.redirect.address().port });
  }
  return result;
}

module.exports = { MIN_VERSION, CIPHERS, enforceOutboundTls, mongoUrlProblem, requireHttps, redirectServer, listen };
