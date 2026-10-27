const mongoose = require("mongoose");

// A lease so that a scheduled job runs on one API instance at a time: whoever sets `until`
// to the future first holds it until then or until it releases it.
const jobLockSchema = new mongoose.Schema({ _id: { type: String }, until: { type: Date, required: true }, holder: { type: String } },
  { versionKey: false });

module.exports = mongoose.model("JobLock", jobLockSchema, "joblocks");
