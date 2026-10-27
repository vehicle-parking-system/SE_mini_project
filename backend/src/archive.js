// Log retention and archival (VPS-NF-004: transaction and access logs are kept for at least a year,
// with automated archival and retrieval).
//
// - Transactions (payments, refunds) and receipts are business records: they stay in the database and
//   are never archived away or deleted.
// - Access and audit logs stay in the database for LOG_HOT_DAYS. After that, a daily job moves them to
//   gzip-compressed NDJSON (Extended JSON, so ids and dates round-trip) files under ARCHIVE_DIR, one
//   file per collection, day and run: <collection>/<year>/<day>--<run>.ndjson.gz.
// - A file is written to a temporary name, synced, renamed, then read back and checked (entry count
//   and SHA-256) before its manifest entry is stored and only then are the entries deleted from the
//   database. A crash at any point leaves the entries in the database or in a verified file; the next
//   run skips entries already in a file, so nothing is lost or archived twice.
// - Files older than LOG_RETENTION_DAYS (at least 365) are deleted with their manifest entries.
// - Retrieval searches the database and the archive together and checks every file it reads against
//   its manifest checksum; a file that doesn't match is reported, not used.
// - The job takes a lease (JobLock) so only one API instance runs it at a time.
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const zlib = require("zlib");
const { promisify } = require("util");
const mongoose = require("mongoose");
const clock = require("./clock");
const config = require("./config");
const logger = require("./logger");
const AccessLog = require("./models/AccessLog");
const ArchiveFile = require("./models/ArchiveFile");
const AuditLog = require("./models/AuditLog");
const JobLock = require("./models/JobLock");
const { isId } = require("./slotSearch");
const { badRequest } = require("./errors");

const { EJSON } = mongoose.mongo.BSON;
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const DAY_MS = 86400000;
const LOCK_MS = 3600000;
const SOURCES = { access: AccessLog, audit: AuditLog };
const MAX_RESULTS = 5000;
const MAX_SEARCH_DAYS = 400;
const FILE_ENTRIES = 20000; // at most this many entries per file, so a busy day never has to fit in memory at once
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const utcDay = (date) => date.toISOString().slice(0, 10);
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

// Holds the archive lease until `until`; false if another instance has it
async function acquireLock(holder, now) {
  try {
    const lock = await JobLock.findOneAndUpdate({ _id: "archive", until: { $lte: now } }, { until: new Date(now.getTime() + LOCK_MS), holder },
      { upsert: true, new: true });
    return lock.holder === holder;
  } catch (err) {
    if (err.code === 11000) return false; // the lease exists and hasn't expired
    throw err;
  }
}
const releaseLock = (holder) => JobLock.updateOne({ _id: "archive", holder }, { until: new Date(0) });

async function writeVerified(dir, relative, buffer, count) {
  const full = path.join(dir, relative);
  await fs.mkdir(path.dirname(full), { recursive: true });
  const temp = `${full}.tmp`;
  const handle = await fs.open(temp, "wx");
  try {
    await handle.writeFile(buffer);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temp, full);
  const readBack = await fs.readFile(full);
  const lines = (await gunzip(readBack)).toString("utf8").split("\n").filter(Boolean);
  if (sha256(readBack) !== sha256(buffer) || lines.length !== count) throw new Error(`archive file ${relative} failed verification`);
}

// Ids already in files from earlier runs for that day: entries a run archived but stopped before deleting
async function idsArchivedBefore(dir, collectionName, day, runId) {
  const ids = new Set();
  for (const f of await ArchiveFile.find({ collectionName, day })) {
    if (f.file.includes(runId)) continue;
    for (const doc of await readFile(dir, f, { verify: false })) ids.add(String(doc._id));
  }
  return ids;
}

// Moves one collection's entries older than `cutoff` into files, a day (and at most FILE_ENTRIES) at a time.
async function archiveCollection(Model, cutoff, { dir, runId, now }) {
  const collectionName = Model.collection.collectionName;
  const earlier = new Map(); // day -> ids archived by earlier runs
  let files = 0;
  let entries = 0;
  for (;;) {
    const oldest = await Model.findOne({ at: { $lt: cutoff } }, "at").sort({ at: 1 }).lean();
    if (!oldest) break;
    const day = utcDay(oldest.at);
    const dayEnd = new Date(Math.min(Date.parse(`${day}T00:00:00Z`) + DAY_MS, cutoff.getTime()));
    const docs = await Model.find({ at: { $gte: new Date(`${day}T00:00:00Z`), $lt: dayEnd } }).sort({ at: 1, _id: 1 })
      .limit(FILE_ENTRIES).lean();
    if (!earlier.has(day)) earlier.set(day, await idsArchivedBefore(dir, collectionName, day, runId));
    const fresh = docs.filter((d) => !earlier.get(day).has(String(d._id)));

    if (fresh.length) {
      const relative = path.join(collectionName, day.slice(0, 4), `${day}--${runId}-${files + 1}.ndjson.gz`);
      const buffer = await gzip(Buffer.from(`${fresh.map((d) => EJSON.stringify(d, { relaxed: false })).join("\n")}\n`));
      await writeVerified(dir, relative, buffer, fresh.length);
      await ArchiveFile.create({ collectionName, day, file: relative, count: fresh.length, bytes: buffer.length, sha256: sha256(buffer),
        firstAt: fresh[0].at, lastAt: fresh.at(-1).at, archivedAt: now });
      files += 1;
      entries += fresh.length;
    }
    await Model.deleteMany({ _id: { $in: docs.map((d) => d._id) } });
  }
  return { files, entries };
}

// Deletes archive files past the retention period
async function purgeExpired(dir, now, retentionDays) {
  const before = utcDay(new Date(now.getTime() - retentionDays * DAY_MS));
  const expired = await ArchiveFile.find({ day: { $lt: before } });
  for (const f of expired) {
    await fs.rm(path.join(dir, f.file), { force: true });
    await f.deleteOne();
  }
  return expired.length;
}

// The daily job. -> {ran, archived:{access:{files, entries}, audit:{...}}, purgedFiles}
async function runArchive({ now = clock.now(), dir = config.archiveDir, hotDays = config.logHotDays,
  retentionDays = config.logRetentionDays } = {}) {
  const runId = `${now.toISOString().replace(/[-:.]/g, "")}-${crypto.randomBytes(3).toString("hex")}`;
  if (!(await acquireLock(runId, now))) return { ran: false, reason: "Another archive run is in progress" };
  try {
    const cutoff = new Date(now.getTime() - hotDays * DAY_MS);
    const archived = {};
    for (const [name, Model] of Object.entries(SOURCES)) archived[name] = await archiveCollection(Model, cutoff, { dir, runId, now });
    const purgedFiles = await purgeExpired(dir, now, retentionDays);
    const result = { ran: true, cutoff: cutoff.toISOString(), archived, purgedFiles };
    logger.info("log archive run", { cutoff: result.cutoff, accessEntries: archived.access.entries, auditEntries: archived.audit.entries,
      files: archived.access.files + archived.audit.files, purgedFiles });
    await AuditLog.create({ event: "LOGS_ARCHIVED", at: now, details: { cutoff, ...archived, purgedFiles } });
    return result;
  } finally {
    await releaseLock(runId);
  }
}

// A file's entries; with verify, throws if it no longer matches its manifest checksum
async function readFile(dir, file, { verify = true } = {}) {
  const buffer = await fs.readFile(path.join(dir, file.file));
  if (verify && sha256(buffer) !== file.sha256) throw new Error("checksum mismatch");
  // relaxed: numbers come back as plain numbers; dates and ids still as Date and ObjectId
  return (await gunzip(buffer)).toString("utf8").split("\n").filter(Boolean).map((line) => EJSON.parse(line, { relaxed: true }));
}

// GET /api/admin/logs?type=access|audit&from&to&event?&userId?&path?&status?&limit?
// -> {logs:[{...entry, source: database|archive}], sources:{database, archive}, filesRead, integrity:[{file, error}]}
async function searchLogs(query = {}, { dir = config.archiveDir } = {}) {
  const errors = {};
  if (!Object.keys(SOURCES).includes(query.type)) errors.type = "Type must be access or audit";
  for (const f of ["from", "to"]) if (!(typeof query[f] === "string" && DATE_RE.test(query[f]) && !Number.isNaN(Date.parse(query[f])))) errors[f] = "Use a date like 2026-11-02";
  if (query.userId !== undefined && !isId(query.userId)) errors.userId = "Unknown user";
  if (query.status !== undefined && !/^\d{3}$/.test(query.status)) errors.status = "Use an HTTP status, e.g. 403";
  const limit = query.limit === undefined ? 500 : Number(query.limit);
  if (!(Number.isInteger(limit) && limit >= 1 && limit <= MAX_RESULTS)) errors.limit = `Limit must be 1–${MAX_RESULTS}`;
  if (!errors.from && !errors.to) {
    const days = (Date.parse(query.to) - Date.parse(query.from)) / DAY_MS + 1;
    if (days < 1) errors.to = "The end date must not be before the start date";
    else if (days > MAX_SEARCH_DAYS) errors.to = `Search at most ${MAX_SEARCH_DAYS} days at a time`;
  }
  if (Object.keys(errors).length) throw badRequest("Some log search fields are invalid", errors);

  const Model = SOURCES[query.type];
  const start = new Date(`${query.from}T00:00:00Z`);
  const end = new Date(Date.parse(`${query.to}T00:00:00Z`) + DAY_MS);
  const userField = query.type === "access" ? "userId" : "actorId";
  const events = query.event ? String(query.event).split(",") : null;
  const matches = (e) => e.at >= start && e.at < end
    && (!query.userId || String(e[userField]) === query.userId)
    && (!events || events.includes(e.event))
    && (!query.path || e.path?.startsWith(query.path))
    && (!query.status || e.status === Number(query.status));

  const filter = { at: { $gte: start, $lt: end }, ...(query.userId && { [userField]: query.userId }),
    ...(events && { event: { $in: events } }), ...(query.status && { status: Number(query.status) }),
    ...(query.path && { path: { $regex: `^${String(query.path).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` } }) };
  const fromDb = (await Model.find(filter).sort({ at: -1 }).limit(limit).lean()).filter(matches);

  const files = await ArchiveFile.find({ collectionName: Model.collection.collectionName, day: { $gte: query.from, $lte: query.to } })
    .sort({ day: -1 });
  const fromArchive = [];
  const integrity = [];
  for (const file of files) {
    try {
      fromArchive.push(...(await readFile(dir, file)).filter(matches));
    } catch (err) {
      integrity.push({ file: file.file, error: err.code === "ENOENT" ? "missing" : err.message });
      logger.error("archive file failed verification", { file: file.file, error: err.message });
    }
  }

  const present = (e, source) => {
    const doc = new Model(e).toPublic();
    return { ...doc, at: new Date(e.at).toISOString(), source };
  };
  const logs = [...fromDb.map((e) => present(e, "database")), ...fromArchive.map((e) => present(e, "archive"))]
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  return { logs, sources: { database: fromDb.length, archive: fromArchive.length }, filesRead: files.length - integrity.length, integrity };
}

// GET /api/admin/archives -> the retention settings and the archive's manifest
async function archiveStatus() {
  const files = await ArchiveFile.find().sort({ day: -1, collectionName: 1 }).limit(500);
  const lastRun = await AuditLog.findOne({ event: "LOGS_ARCHIVED" }).sort({ at: -1 });
  return { hotDays: config.logHotDays, retentionDays: config.logRetentionDays, lastRun: lastRun?.toPublic() ?? null,
    totals: await ArchiveFile.aggregate([{ $group: { _id: "$collectionName", files: { $sum: 1 }, entries: { $sum: "$count" },
      bytes: { $sum: "$bytes" } } }]).then((rows) => Object.fromEntries(rows.map((r) => [r._id, { files: r.files, entries: r.entries,
      bytes: r.bytes }]))),
    files: files.map((f) => f.toPublic()) };
}

// Runs the job once a day on each instance; the lease makes sure only one of them does the work.
function scheduleArchive() {
  const run = () => runArchive().catch((err) => logger.error("log archive run failed", { error: err.message }));
  setTimeout(run, 60000).unref();
  setInterval(run, DAY_MS).unref();
}

module.exports = { runArchive, searchLogs, archiveStatus, scheduleArchive };
