// Isolated fee boundaries; no HTTP server or database required.
const pricing = require("../src/pricing");

describe("fee rules", () => {
  const t0 = new Date("2026-11-02T10:00:00Z");
  const after = (ms) => new Date(t0.getTime() + ms);

  test("duration is rounded to the nearest minute", () => {
    expect(pricing.durationMinutes(t0, after(59 * 60000 + 29999))).toBe(59);
    expect(pricing.durationMinutes(t0, after(59 * 60000 + 30000))).toBe(60);
    expect(pricing.durationMinutes(t0, after(-5000))).toBe(0);
  });

  test.each([[0, 1], [1, 1], [30, 1], [60, 1], [61, 2], [120, 2], [165, 3]])(
    "%i minutes are charged as %i started hour(s)", (minutes, hours) => {
      expect(pricing.chargedHours(minutes)).toBe(hours);
      expect(pricing.feeFor(minutes, 40)).toBe(hours * 40);
    });

  test("a quote describes the stay up to a moment", () => {
    expect(pricing.quote({ entryTime: t0, ratePerHour: 40 }, after(90 * 60000))).toEqual({
      duration: 90, chargedHours: 2, ratePerHour: 40, amount: 80, quotedAt: after(90 * 60000).toISOString(),
    });
  });
});

