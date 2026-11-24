import { describe, expect, it } from "vitest";
import { addMonths, calendarDiff, daysBetween, termProgress, timeLeft, yearlyCost } from "@/lib/renewals";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("renewal dates", () => {
  it("adds months with month-end clamping", () => {
    expect(addMonths(d("2026-01-31"), 1).toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(addMonths(d("2028-01-31"), 1).toISOString().slice(0, 10)).toBe("2028-02-29");
    expect(addMonths(d("2026-11-24"), 12).toISOString().slice(0, 10)).toBe("2027-11-24");
    expect(addMonths(d("2026-11-24"), -12).toISOString().slice(0, 10)).toBe("2025-11-24");
  });

  it("counts calendar differences and days", () => {
    expect(calendarDiff("2026-11-24", "2028-02-10")).toEqual({ years: 1, months: 2, days: 17 });
    expect(daysBetween("2026-11-24", "2026-12-24")).toBe(30);
    expect(daysBetween("2026-11-24", "2026-11-20")).toBe(-4);
  });

  it("labels the time left and how urgent it is", () => {
    expect(timeLeft(d("2028-02-10"), "2026-11-24")).toMatchObject({ label: "1 year 2 months left", urgency: "ok" });
    expect(timeLeft(d("2027-03-01"), "2026-11-24")).toMatchObject({ label: "3 months 5 days left", urgency: "ok" });
    expect(timeLeft(d("2027-01-10"), "2026-11-24")).toMatchObject({ days: 47, label: "47 days left", urgency: "ok" });
    expect(timeLeft(d("2026-12-20"), "2026-11-24")).toMatchObject({ days: 26, label: "26 days left", urgency: "soon" });
    expect(timeLeft(d("2026-11-25"), "2026-11-24")).toMatchObject({ label: "1 day left", urgency: "due" });
    expect(timeLeft(d("2026-11-24"), "2026-11-24")).toMatchObject({ label: "Expires today", urgency: "due" });
    expect(timeLeft(d("2026-11-21"), "2026-11-24")).toMatchObject({ days: -3, label: "Expired 3 days ago", urgency: "expired" });
    expect(timeLeft(d("2026-05-01"), "2026-11-24").label).toBe("Expired 6 months 23 days ago");
    expect(timeLeft(d("2026-12-20"), "2026-11-24", 15).urgency).toBe("ok");
  });

  it("shows how much of the term is used and the yearly cost", () => {
    const r = { startDate: d("2024-01-01"), renewalDate: d("2027-01-01"), cycleMonths: 12 };
    expect(termProgress(r, "2026-07-02")).toBe(50);
    expect(termProgress({ ...r, cycleMonths: 0 }, "2025-07-02")).toBe(50);
    expect(termProgress(r, "2027-06-01")).toBe(100);
    expect(yearlyCost(100_00, 1)).toBe(1_200_00);
    expect(yearlyCost(3_000_00, 36)).toBe(1_000_00);
    expect(yearlyCost(500_00, 0)).toBe(0);
  });
});
