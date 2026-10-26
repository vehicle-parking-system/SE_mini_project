// Adds demo parking facilities so slot search can be tried before the admin console
// (Lot / Zone / Slot configuration) exists. Does nothing if any facility exists already.
//   MONGO_URL=mongodb://localhost:27017/vps npm run seed:demo
const mongoose = require("mongoose");
const config = require("../src/config");
const Facility = require("../src/models/Facility");
const { createFacility } = require("../src/facilities");

const slots = (prefix, count, vehicleType, firstDistance, step = 5) =>
  Array.from({ length: count }, (_, i) => ({
    number: `${prefix}-${String(i + 1).padStart(2, "0")}`, vehicleType, distance: firstDistance + i * step,
  }));

const DEMO = [
  {
    name: "City Centre Parking", address: "MG Road, Bengaluru", openTime: "06:00", closeTime: "23:00",
    zones: [
      { key: "ground", name: "Zone A (Ground)", slots: slots("A", 8, "CAR", 10) },
      { name: "Zone B (Level 1)", slots: [...slots("B", 6, "CAR", 40), ...slots("BK", 6, "BIKE", 35, 2)] },
    ],
    // ₹ per started hour; ground-floor car slots cost more
    rates: [{ vehicleType: "CAR", ratePerHour: 40 }, { zone: "ground", vehicleType: "CAR", ratePerHour: 50 },
      { vehicleType: "BIKE", ratePerHour: 20 }],
  },
  {
    name: "Airport Long-Stay", address: "Kempegowda International Airport", openTime: "00:00", closeTime: "23:59",
    zones: [
      { name: "Zone P1", slots: [...slots("P1", 10, "CAR", 20), ...slots("T", 3, "TRUCK", 80, 10)] },
    ],
    rates: [{ vehicleType: "CAR", ratePerHour: 30 }, { vehicleType: "TRUCK", ratePerHour: 100 }],
  },
];

async function main() {
  await mongoose.connect(config.mongoUrl);
  if (await Facility.exists({})) {
    console.log("Facilities already exist; nothing to do.");
  } else {
    for (const def of DEMO) {
      const { facility } = await createFacility(def);
      console.log(`Created ${facility.name}`);
    }
  }
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
