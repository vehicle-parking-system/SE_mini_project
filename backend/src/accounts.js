// User & Vehicle Management: creating accounts and attaching vehicles.
const User = require("./models/User");
const Vehicle = require("./models/Vehicle");
const { hashPassword } = require("./auth");
const { conflict } = require("./errors");

const isDuplicateKey = (err) => err?.code === 11000;

async function assertPlatesFree(plates) {
  const taken = await Vehicle.find({ plateNumber: { $in: plates } }, "plateNumber");
  if (taken.length) throw conflict(`Vehicle ${taken[0].plateNumber} is already registered to an account`);
}

async function addVehicles(ownerId, vehicles) {
  if (!vehicles.length) return [];
  await assertPlatesFree(vehicles.map((v) => v.plateNumber));
  try {
    return await Vehicle.insertMany(vehicles.map((v) => ({ ...v, owner: ownerId })), { ordered: true });
  } catch (err) {
    if (isDuplicateKey(err)) throw conflict("That vehicle is already registered to an account");
    throw err;
  }
}

// Creates the user and their vehicles. Vehicles are checked first so a taken plate
// doesn't leave a half-created account behind.
async function createAccount({ name, email, phone, password, role = "DRIVER", vehicles = [] }) {
  if (await User.exists({ email })) throw conflict("An account with this email already exists");
  if (vehicles.length) await assertPlatesFree(vehicles.map((v) => v.plateNumber));

  let user;
  try {
    user = await User.create({ name, email, phone, role, passwordHash: await hashPassword(password) });
  } catch (err) {
    if (isDuplicateKey(err)) throw conflict("An account with this email already exists");
    throw err;
  }
  try {
    return { user, vehicles: await addVehicles(user._id, vehicles) };
  } catch (err) {
    await User.deleteOne({ _id: user._id });
    throw err;
  }
}

module.exports = { createAccount, addVehicles };
