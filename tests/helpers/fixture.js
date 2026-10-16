// Seed data posted to /api/test/reset before every test. Keys (e.g. "carNear")
// are fixture names; the backend returns the real IDs it created under the
// same keys in {ids}.

const PASSWORD = "Test@12345";
const RATE_PER_HOUR = 40; // ₹, car / Zone A

const fixture = {
  users: [
    { key: "driver", role: "DRIVER", name: "Test Driver", email: "driver@test.vps", password: PASSWORD,
      vehicles: [{ key: "car1", plateNumber: "KA01AB1234", vehicleType: "CAR" }] },
    { key: "driver2", role: "DRIVER", name: "Second Driver", email: "driver2@test.vps", password: PASSWORD,
      vehicles: [{ key: "car2", plateNumber: "KA02CD5678", vehicleType: "CAR" }] },
    { key: "attendant", role: "ATTENDANT", name: "Test Attendant", email: "attendant@test.vps", password: PASSWORD },
    { key: "admin", role: "ADMIN", name: "Test Admin", email: "admin@test.vps", password: PASSWORD },
  ],
  facilities: [
    {
      key: "main", name: "Main Facility", openTime: "06:00", closeTime: "23:00",
      gates: [{ key: "gateIn", type: "ENTRY" }, { key: "gateOut", type: "EXIT" }],
      refundPolicy: { fullRefundIfCancelledMinutesBefore: 60 },
      reservationGraceMinutes: 15,
      zones: [{
        key: "zoneA", name: "Zone A",
        // distance = metres from the entry gate; used to check nearest-slot allocation
        slots: [
          { key: "carOccupied", number: "A-01", vehicleType: "CAR", distance: 10, status: "OCCUPIED" },
          { key: "carNear", number: "A-02", vehicleType: "CAR", distance: 20 },
          { key: "carFar", number: "A-03", vehicleType: "CAR", distance: 30 },
          { key: "bikeNearest", number: "A-B1", vehicleType: "BIKE", distance: 5 },
        ],
      }],
      rates: [{ zone: "zoneA", vehicleType: "CAR", ratePerHour: RATE_PER_HOUR },
              { zone: "zoneA", vehicleType: "BIKE", ratePerHour: 20 }],
    },
    {
      // single car slot: used for "facility full" and concurrency tests
      key: "small", name: "Small Facility", openTime: "00:00", closeTime: "23:59",
      gates: [{ key: "smallIn", type: "ENTRY" }],
      refundPolicy: { fullRefundIfCancelledMinutesBefore: 60 },
      reservationGraceMinutes: 15,
      zones: [{ key: "zoneS", name: "Zone S", slots: [{ key: "onlySlot", number: "S-01", vehicleType: "CAR", distance: 5 }] }],
      rates: [{ zone: "zoneS", vehicleType: "CAR", ratePerHour: RATE_PER_HOUR }],
    },
  ],
};

// Fee rule assumed by TC-Exit-01: every started hour is charged in full.
// The SRS only says "within rounding rules" — change this once the rule is fixed.
const expectedFee = (minutes, ratePerHour = RATE_PER_HOUR) => Math.ceil(minutes / 60) * ratePerHour;

module.exports = { fixture, PASSWORD, RATE_PER_HOUR, expectedFee };
