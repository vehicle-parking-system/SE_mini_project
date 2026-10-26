const mongoose = require("mongoose");

// Named sequences (e.g. "receipt-2026"), incremented atomically.
const counterSchema = new mongoose.Schema({ _id: { type: String }, seq: { type: Number, default: 0 } });
const Counter = mongoose.model("Counter", counterSchema, "counters");

// -> the next number in the sequence, starting at 1
Counter.next = async (name) => (await Counter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, new: true })).seq;

module.exports = Counter;
