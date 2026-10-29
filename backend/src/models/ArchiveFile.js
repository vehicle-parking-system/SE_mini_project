const mongoose = require("mongoose");

// Manifest of the log archive (archive.js): one entry per file written. The checksum is taken when
// the file is written and checked every time it is read, so a changed or damaged file is reported
// instead of trusted.
const archiveFileSchema = new mongoose.Schema({
  collectionName: { type: String, required: true }, // accesslogs | auditlogs
  day: { type: String, required: true }, //            UTC day the entries are from, YYYY-MM-DD
  file: { type: String, required: true, unique: true }, // relative to ARCHIVE_DIR
  count: { type: Number, required: true },
  bytes: { type: Number, required: true },
  sha256: { type: String, required: true },
  firstAt: { type: Date, required: true },
  lastAt: { type: Date, required: true },
  archivedAt: { type: Date, required: true },
}, { versionKey: false });

archiveFileSchema.index({ collectionName: 1, day: 1 });

archiveFileSchema.methods.toPublic = function toPublic() {
  return { id: this.id, collection: this.collectionName, day: this.day, file: this.file, count: this.count, bytes: this.bytes,
    sha256: this.sha256, firstAt: this.firstAt.toISOString(), lastAt: this.lastAt.toISOString(),
    archivedAt: this.archivedAt.toISOString() };
};

module.exports = mongoose.model("ArchiveFile", archiveFileSchema, "archivefiles");
