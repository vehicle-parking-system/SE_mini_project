// TLS 1.2+ enforcement (VPS-SR-001). The HTTPS listener runs on a throwaway self-signed certificate
// made with openssl for this run; those tests are skipped if openssl isn't installed.
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const tls = require("tls");
const request = require("supertest");
const { createApp } = require("../src/app");
const transport = require("../src/transport");

function makeCertificate() {
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vps-tls-"));
    const [certFile, keyFile] = [path.join(dir, "cert.pem"), path.join(dir, "key.pem")];
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost",
      "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1", "-keyout", keyFile, "-out", certFile], { stdio: "ignore" });
    return { dir, certFile, keyFile };
  } catch {
    return null;
  }
}

// -> {protocol, cipher} once the handshake completes, or {error: code}
function handshake(port, options) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host: "127.0.0.1", port, rejectUnauthorized: false, ...options }, () => {
      resolve({ protocol: socket.getProtocol(), cipher: socket.getCipher().standardName });
      socket.end();
    });
    socket.on("error", (err) => resolve({ error: err.code }));
  });
}

function get(port, urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const lib = options.plain ? http : require("https");
    lib.get({ host: "127.0.0.1", port, path: urlPath, rejectUnauthorized: false, headers: { host: "localhost" } }, (res) => {
      res.resume();
      res.on("end", () => resolve(res));
    }).on("error", reject);
  });
}

const cert = makeCertificate();
const describeTls = cert ? describe : describe.skip;

describeTls("the API terminating TLS itself", () => {
  let servers;
  beforeAll(async () => {
    const https = { certFile: cert.certFile, keyFile: cert.keyFile, redirectPort: 0, enforce: true, hstsMaxAgeSeconds: 31536000 };
    servers = await transport.listen(createApp({ https }), { port: 0, https });
  });
  afterAll(() => {
    servers.server.close();
    servers.redirect.close();
    fs.rmSync(cert.dir, { recursive: true, force: true });
  });
  const port = () => servers.server.address().port;

  test("TLS 1.2 and 1.3 are accepted", async () => {
    expect(await handshake(port(), { minVersion: "TLSv1.3" })).toEqual(expect.objectContaining({ protocol: "TLSv1.3" }));
    const v12 = await handshake(port(), { maxVersion: "TLSv1.2" });
    expect(v12.protocol).toBe("TLSv1.2");
    expect(v12.cipher).toMatch(/^TLS_ECDHE_.*_(GCM_SHA\d+|CHACHA20_POLY1305_SHA256)$/);
  });

  test("TLS 1.0 and 1.1 are refused by the server", async () => {
    // the client is allowed to offer them; the server answers with a protocol_version alert
    for (const version of ["TLSv1", "TLSv1.1"]) {
      expect(await handshake(port(), { minVersion: version, maxVersion: version, ciphers: "DEFAULT@SECLEVEL=0" }))
        .toEqual({ error: "ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION" });
    }
  });

  test("TLS 1.2 without forward secrecy or AEAD is refused", async () => {
    for (const cipher of ["AES128-SHA", "AES256-SHA256", "ECDHE-RSA-AES128-SHA"]) {
      expect((await handshake(port(), { maxVersion: "TLSv1.2", ciphers: cipher })).error).toBeTruthy();
    }
  });

  test("responses tell browsers to use HTTPS only", async () => {
    const res = await get(port(), "/api/health");
    expect(res.statusCode).toBe(200);
    expect(res.headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
  });

  test("plain HTTP is redirected to HTTPS", async () => {
    const res = await get(servers.redirect.address().port, "/api/facilities?x=1", { plain: true });
    expect(res.statusCode).toBe(308);
    expect(res.headers.location).toBe(`https://localhost:${port()}/api/facilities?x=1`);
  });
});

describe("TLS terminated by a load balancer", () => {
  const app = createApp({ trustProxy: 1, https: { enforce: true, hstsMaxAgeSeconds: 600 } });
  const over = (proto) => ({ "x-forwarded-proto": proto, host: "parking.example.com" });

  test("a GET that reached the balancer over HTTP is redirected to HTTPS", async () => {
    const res = await request(app).get("/api/facilities?x=1").set(over("http"));
    expect(res.status).toBe(308);
    expect(res.headers.location).toBe("https://parking.example.com/api/facilities?x=1");
  });

  test("a request with a body sent over HTTP is refused, not redirected", async () => {
    const res = await request(app).post("/api/auth/login").set(over("http")).send({ email: "a@b.c", password: "x" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("HTTPS_REQUIRED");
  });

  test("HTTPS requests go through with HSTS; health checks may use plain HTTP", async () => {
    const res = await request(app).get("/api/health").set(over("https"));
    expect(res.status).toBe(200);
    expect(res.headers["strict-transport-security"]).toBe("max-age=600; includeSubDomains");
    const check = await request(app).get("/api/health").set(over("http"));
    expect(check.status).toBe(200);
    expect(check.headers["strict-transport-security"]).toBeUndefined();
  });
});

describe("TLS configuration", () => {
  test("outbound connections need TLS 1.2 or later", () => {
    const before = tls.DEFAULT_MIN_VERSION;
    transport.enforceOutboundTls();
    expect(tls.DEFAULT_MIN_VERSION).toBe("TLSv1.2");
    tls.DEFAULT_MIN_VERSION = before;
  });

  test.each([
    ["mongodb://localhost:27017/vps", null],
    ["mongodb://user:pw@127.0.0.1:27017,localhost:27018/vps", null],
    ["mongodb+srv://user:pw@cluster0.example.net/vps", null],
    ["mongodb://db.example.net:27017/vps?tls=true", null],
    ["mongodb://db.example.net:27017/vps?ssl=true&replicaSet=rs0", null],
    ["mongodb://db.example.net:27017/vps", "remote host without TLS"],
    ["mongodb://localhost,db.example.net/vps", "remote host without TLS"],
    ["mongodb+srv://cluster0.example.net/vps?tls=false", "turns TLS off"],
  ])("MongoDB URL %s", (url, problem) => {
    const found = transport.mongoUrlProblem(url);
    if (problem) expect(found).toMatch(problem);
    else expect(found).toBeNull();
  });

  // config.js is loaded in a fresh process with the given environment
  const loadConfig = (env) => spawnSync(process.execPath, ["-e", "require('./src/config')"], {
    cwd: path.join(__dirname, ".."), encoding: "utf8",
    env: { PATH: process.env.PATH, NODE_ENV: "production", JWT_SECRET: "j", PAYMENT_WEBHOOK_SECRET: "w",
      MONGO_URL: "mongodb://localhost/vps", ...env },
  });

  test("production refuses to start without TLS, or with a remote database without TLS", () => {
    expect(loadConfig({}).stderr).toMatch(/TLS is required in production/);
    expect(loadConfig({ TLS_TERMINATED_BY_PROXY: "true" }).stderr).toMatch(/needs TRUST_PROXY/);
    expect(loadConfig({ TLS_TERMINATED_BY_PROXY: "true", TRUST_PROXY: "1", MONGO_URL: "mongodb://db.example.net/vps" }).stderr)
      .toMatch(/remote host without TLS/);
    expect(loadConfig({ TLS_CERT_FILE: "/x/cert.pem" }).stderr).toMatch(/both TLS_CERT_FILE and TLS_KEY_FILE/);
    expect(loadConfig({ TLS_TERMINATED_BY_PROXY: "true", TRUST_PROXY: "1" }).status).toBe(0);
  });
});
