// Log retention and archival (VPS-NF-004) against a real MongoDB, with the archive in a temporary directory.
// Uses MONGO_URL with its own database name; skipped when MONGO_URL is not set.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const zlib = require("zlib");

const ARCHIVE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "vps-archive-"));
process.env.ARCHIVE_DIR = ARCHIVE_DIR; // before config.js is loaded

const mongoose = require("mongoose");
const request = require("supertest");
const { createApp } = require("../src/app");
const { createAccount } = require("../src/accounts");
const { signToken } = require("../src/auth");
const accessLog = require("../src/accessLog");
const archive = require("../src/archive");
const clock = require("../src/clock");
const AccessLog = require("../src/models/AccessLog");
const ArchiveFile = require("../src/models/ArchiveFile");
const AuditLog = require("../src/models/AuditLog");
const Payment = require("../src/models/Payment");

const MONGO_URL = process.env.MONGO_URL;
const describeDb = MONGO_URL ? describe : describe.skip;
const NOW = new Date("2026-11-02T06:00:00Z");
const daysAgo = (n, hour = 12) => new Date(Date.parse(`${new Date(NOW.getTime() - n * 86400000).toISOString().slice(0, 10)}T${hour}:00:00Z`));
const day = (n) => daysAgo(n).toISOString().slice(0, 10);

describeDb("log retention and archival", () => {
  const server = createApp().listen(0);
  const api = request(server);
  const tokens = {};
  let adminId;
  const as = (key) => ({ authorization: `Bearer ${tokens[key]}` });
  const search = (query) => api.get("/api/admin/logs").set(as("admin")).query(query);

  beforeAll(async () => {
    const url = new URL(MONGO_URL);
    url.pathname = "/vps_backend_archive";
    await mongoose.connect(url.toString());
  });
  beforeEach(async () => {
    await mongoose.connection.db.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
    fs.rmSync(ARCHIVE_DIR, { recursive: true, force: true });
    accessLog.clear();
    clock.set(NOW);
    const { user: admin } = await createAccount({ name: "Adm", email: "adm@example.com", password: "Secret123", role: "ADMIN" });
    const { user: driver } = await createAccount({ name: "Drv", email: "drv@example.com", password: "Secret123" });
    Object.assign(tokens, { admin: signToken(admin), driver: signToken(driver) });
    adminId = admin.id;

    const access = (n, status = 200) => ({ at: daysAgo(n), method: "GET", path: `/api/facilities/${n}`, status, userId: admin._id, role: "ADMIN" });
    await AccessLog.insertMany([access(200), access(200, 403), access(200), access(100), access(100), access(10), access(10)]);
    await AuditLog.insertMany([
      { event: "ACCOUNT_LOCKED", actorId: driver._id, at: daysAgo(200), details: { lockedUntil: daysAgo(200, 13) } },
      { event: "LOGIN_FAILED", actorId: driver._id, at: daysAgo(200, 11) },
      { event: "LOGIN_FAILED", actorId: driver._id, at: daysAgo(10) },
    ]);
    await Payment.create({ session: new mongoose.Types.ObjectId(), facility: new mongoose.Types.ObjectId(), method: "AT_GATE", amount: 80,
      status: "CONFIRMED", gatewayRef: "pay_old", quotedAt: daysAgo(300), confirmedAt: daysAgo(300) });
  });
  afterAll(async () => {
    clock.reset();
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
    server.closeAllConnections();
    server.close();
    fs.rmSync(ARCHIVE_DIR, { recursive: true, force: true });
  });

  test("every API request is kept in the access log, without query strings; health checks are left out", async () => {
    await AccessLog.deleteMany({});
    await api.get("/api/users/me?secret=x").set(as("admin")).expect(200);
    await api.get("/api/admin/logs").set(as("driver")).expect(403);
    await api.get("/api/health").expect(200);
    await accessLog.flush();

    const logs = await AccessLog.find().sort({ at: 1, path: 1 });
    expect(logs.map((l) => [l.method, l.path, l.status, l.role])).toEqual(
      expect.arrayContaining([["GET", "/api/users/me", 200, "ADMIN"], ["GET", "/api/admin/logs", 403, "DRIVER"]]));
    expect(logs).toHaveLength(2);
    expect(logs[0].userId.toString()).toBeTruthy();
    // the test clock runs on from NOW
    expect(logs.every((l) => l.ip && Math.abs(l.at.getTime() - NOW.getTime()) < 60000)).toBe(true);
  });

  test("entries past the hot window move to verified files; recent ones and transactions stay", async () => {
    const res = await api.post("/api/admin/archives/run").set(as("admin"));
    expect(res.status).toBe(200);
    expect(res.body.archived).toEqual({ access: { files: 2, entries: 5 }, audit: { files: 1, entries: 2 } });

    expect(await AccessLog.countDocuments({ at: { $lt: daysAgo(90) } })).toBe(0);
    expect(await AccessLog.countDocuments({ at: daysAgo(10) })).toBe(2);
    expect(await AuditLog.countDocuments({ event: "LOGIN_FAILED" })).toBe(1);
    expect(await Payment.countDocuments({ gatewayRef: "pay_old" })).toBe(1);

    const files = await ArchiveFile.find({ collectionName: "accesslogs" }).sort({ day: 1 });
    expect(files.map((f) => [f.day, f.count])).toEqual([[day(200), 3], [day(100), 2]]);
    const raw = fs.readFileSync(path.join(ARCHIVE_DIR, files[0].file));
    expect(require("crypto").createHash("sha256").update(raw).digest("hex")).toBe(files[0].sha256);
    // Extended JSON: dates and ids keep their types
    const lines = zlib.gunzipSync(raw).toString().trim().split("\n").map((l) => mongoose.mongo.BSON.EJSON.parse(l));
    expect(lines.map((l) => l.status)).toEqual([200, 403, 200]);
    expect(lines[0].at).toEqual(daysAgo(200));
    expect(lines[0]._id).toBeInstanceOf(mongoose.mongo.ObjectId);

    const status = (await api.get("/api/admin/archives").set(as("admin"))).body;
    expect(status).toEqual(expect.objectContaining({ hotDays: 90, retentionDays: 400 }));
    expect(status.totals.accesslogs).toEqual(expect.objectContaining({ files: 2, entries: 5 }));
    expect(status.lastRun.event).toBe("LOGS_ARCHIVED");
  });

  test("a search reads the database and the archive together", async () => {
    await archive.runArchive({ now: NOW });
    const res = await search({ type: "access", from: day(365), to: day(0), path: "/api/facilities/" });
    expect(res.status).toBe(200);
    expect(res.body.sources).toEqual({ database: 2, archive: 5 });
    expect(res.body.integrity).toEqual([]);
    expect(res.body.logs.map((l) => l.source)).toEqual(["database", "database", "archive", "archive", "archive", "archive", "archive"]);
    expect(res.body.logs.at(-1)).toEqual(expect.objectContaining({ path: "/api/facilities/200", userId: adminId, source: "archive" }));

    const forbidden = await search({ type: "access", from: day(365), to: day(0), status: "403" });
    expect(forbidden.body.logs).toEqual([expect.objectContaining({ status: 403, source: "archive" })]);
    const locks = await search({ type: "audit", from: day(365), to: day(0), event: "ACCOUNT_LOCKED" });
    expect(locks.body.logs).toEqual([expect.objectContaining({ event: "ACCOUNT_LOCKED", source: "archive",
      details: { lockedUntil: daysAgo(200, 13).toISOString() } })]);
    const byPath = await search({ type: "access", from: day(365), to: day(0), path: "/api/facilities/10" });
    expect(byPath.body.logs.map((l) => l.path)).toEqual(["/api/facilities/10", "/api/facilities/10", "/api/facilities/100",
      "/api/facilities/100"]);
  });

  test("running again archives nothing twice, even after a run that stopped before deleting", async () => {
    await archive.runArchive({ now: NOW });
    const first = await ArchiveFile.find().lean();
    expect((await archive.runArchive({ now: NOW })).archived.access).toEqual({ files: 0, entries: 0 });

    // as if the last run had written its file but crashed before deleting the entries
    const archived = (await search({ type: "access", from: day(200), to: day(200) })).body.logs;
    await AccessLog.insertMany(archived.map((l) => ({ _id: l.id, at: l.at, method: l.method, path: l.path, status: l.status })));
    const again = await archive.runArchive({ now: NOW });
    expect(again.archived.access).toEqual({ files: 0, entries: 0 });
    expect(await AccessLog.countDocuments({ at: { $lt: daysAgo(90) } })).toBe(0);
    expect(await ArchiveFile.countDocuments()).toBe(first.length);
    expect((await search({ type: "access", from: day(200), to: day(200) })).body.logs).toHaveLength(3);
  });

  test("a changed or missing archive file is reported, not trusted", async () => {
    await archive.runArchive({ now: NOW });
    const [old, newer] = await ArchiveFile.find({ collectionName: "accesslogs" }).sort({ day: 1 });
    fs.appendFileSync(path.join(ARCHIVE_DIR, old.file), "tampered");
    fs.rmSync(path.join(ARCHIVE_DIR, newer.file));
    const res = await search({ type: "access", from: day(365), to: day(0), path: "/api/facilities/" });
    expect(res.body.integrity).toEqual(expect.arrayContaining([{ file: old.file, error: "checksum mismatch" },
      { file: newer.file, error: "missing" }]));
    expect(res.body.sources).toEqual({ database: 2, archive: 0 });
  });

  test("archive files are deleted once older than the retention period, and not before", async () => {
    await archive.runArchive({ now: NOW });
    // 250 days on: the 200-day-old files are 450 days old (past 400), the 100-day-old ones 350
    const later = await archive.runArchive({ now: new Date(NOW.getTime() + 250 * 86400000) });
    expect(later.purgedFiles).toBe(2); // access and audit files from 200 days ago
    const left = await ArchiveFile.find().sort({ day: 1 });
    expect(left[0].day).toBe(day(100));
    expect(fs.existsSync(path.join(ARCHIVE_DIR, "accesslogs", day(200).slice(0, 4)))).toBe(true);
    expect(fs.readdirSync(path.join(ARCHIVE_DIR, "accesslogs", day(200).slice(0, 4))).some((f) => f.startsWith(day(200)))).toBe(false);
  });

  test("only one run at a time", async () => {
    const [a, b] = await Promise.all([archive.runArchive({ now: NOW }), archive.runArchive({ now: NOW })]);
    expect([a.ran, b.ran].sort()).toEqual([false, true]);
  });

  test("logs can't be kept for less than a year", () => {
    const load = (env) => spawnSync(process.execPath, ["-e", "require('./src/config')"], {
      cwd: path.join(__dirname, ".."), encoding: "utf8", env: { PATH: process.env.PATH, NODE_ENV: "test", ...env } });
    expect(load({ LOG_RETENTION_DAYS: "200" }).stderr).toMatch(/at least 365/);
    expect(load({ LOG_HOT_DAYS: "400", LOG_RETENTION_DAYS: "365" }).stderr).toMatch(/LOG_HOT_DAYS must be less/);
    expect(load({ LOG_RETENTION_DAYS: "730" }).status).toBe(0);
  });

  test("only admins can search logs or run the archive", async () => {
    expect((await search({ type: "access", from: day(1), to: day(0) }).set(as("driver"))).status).toBe(403);
    expect((await api.post("/api/admin/archives/run").set(as("driver"))).status).toBe(403);
    const bad = await search({ type: "files", from: "2026-13-01", to: day(0), limit: "0" });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.details).sort()).toEqual(["from", "limit", "type"]);
  });
});
