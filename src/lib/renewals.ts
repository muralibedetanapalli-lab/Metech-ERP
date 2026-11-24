/** Renewal helpers shared by screens, reports and tests. Dates are calendar days (UTC midnight of the IST date). */

export const RENEWAL_CATEGORIES = {
  DOMAIN: "Domain",
  HOSTING: "Hosting",
  SSL: "SSL certificate",
  EMAIL: "Email / workspace",
  SOFTWARE: "Software / SaaS",
  CLOUD: "Cloud",
  LICENSE: "Licence / registration",
  OTHER: "Other",
} as const;
export type RenewalCategory = keyof typeof RENEWAL_CATEGORIES;

export const CYCLES: { months: number; label: string }[] = [
  { months: 1, label: "Monthly" },
  { months: 3, label: "Quarterly" },
  { months: 6, label: "Half-yearly" },
  { months: 12, label: "Yearly" },
  { months: 24, label: "Every 2 years" },
  { months: 36, label: "Every 3 years" },
  { months: 60, label: "Every 5 years" },
  { months: 120, label: "Every 10 years" },
  { months: 0, label: "No fixed cycle" },
];
export const cycleLabel = (m: number) => CYCLES.find((c) => c.months === m)?.label ?? `Every ${m} months`;

const DAY = 86_400_000;
const toDay = (d: Date | string) => {
  const x = typeof d === "string" ? new Date(`${d.slice(0, 10)}T00:00:00.000Z`) : d;
  return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
};

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export const daysBetween = (from: Date | string, to: Date | string) => Math.round((toDay(to) - toDay(from)) / DAY);

/** Add calendar months, clamping to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(d: Date, months: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last)));
}

/** Years, months and days from `from` to `to` (to ≥ from), counted on the calendar. */
export function calendarDiff(from: Date | string, to: Date | string) {
  const a = new Date(toDay(from));
  const b = new Date(toDay(to));
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (addMonths(a, months).getTime() > b.getTime()) months--;
  const days = daysBetween(addMonths(a, months), b);
  return { years: Math.floor(months / 12), months: months % 12, days };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export type Urgency = "expired" | "due" | "soon" | "ok" | "cancelled";

/**
 * Remaining time to a renewal date, as a label ("1 year 2 months left", "12 days left", "Expires today",
 * "Expired 3 days ago") with an urgency: expired, due (≤ 7 days), soon (within the reminder window), ok.
 */
export function timeLeft(renewalDate: Date | string, today: Date | string, remindDays = 30) {
  const days = daysBetween(today, renewalDate);
  if (days < 0) {
    const ago = -days;
    return { days, label: `Expired ${ago < 60 ? plural(ago, "day") : longSpan(renewalDate, today)} ago`, urgency: "expired" as Urgency };
  }
  if (days === 0) return { days, label: "Expires today", urgency: "due" as Urgency };
  const label = days < 60 ? `${plural(days, "day")} left` : `${longSpan(today, renewalDate)} left`;
  return { days, label, urgency: (days <= 7 ? "due" : days <= remindDays ? "soon" : "ok") as Urgency };
}

function longSpan(from: Date | string, to: Date | string) {
  const d = calendarDiff(from, to);
  const parts = [d.years ? plural(d.years, "year") : "", d.months ? plural(d.months, "month") : "", !d.years && d.days ? plural(d.days, "day") : ""].filter(Boolean);
  return parts.join(" ") || plural(daysBetween(from, to), "day");
}

/** Share of the current term already used, 0–100 (term = cycle before the renewal date, or since start). */
export function termProgress(r: { startDate: Date; renewalDate: Date; cycleMonths: number }, today: Date | string) {
  const termStart = r.cycleMonths > 0 ? addMonths(r.renewalDate, -r.cycleMonths) : r.startDate;
  const start = termStart.getTime() < r.startDate.getTime() ? r.startDate : termStart;
  const total = daysBetween(start, r.renewalDate);
  if (total <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((daysBetween(start, today) * 100) / total)));
}

/** Cost per year before GST, for comparing monthly and multi-year plans. */
export const yearlyCost = (amount: number, cycleMonths: number) => (cycleMonths > 0 ? Math.round((amount * 12) / cycleMonths) : 0);

export const urgencyTone = (u: Urgency) => (u === "expired" || u === "due" ? "red" : u === "soon" ? "amber" : u === "cancelled" ? "default" : "green") as "red" | "amber" | "green" | "default";
