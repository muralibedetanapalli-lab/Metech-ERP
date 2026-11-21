/** All accounting dates are calendar days stored as UTC midnight (the IST date the user picked). */

export const todayIso = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/** Start of the Indian financial year (1 April) containing the given ISO date. */
export function fyStartIso(iso = todayIso()) {
  const [y, m] = iso.split("-").map(Number);
  return `${m >= 4 ? y : y - 1}-04-01`;
}

export const monthStartIso = (iso = todayIso()) => `${iso.slice(0, 7)}-01`;

const valid = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : undefined);

/** Read ?from=&to= (defaults: financial year to date) into an inclusive Date range. */
export function dateRange(sp: { from?: string; to?: string }, defaults: { from?: string; to?: string } = {}) {
  const fromIso = valid(sp.from) ?? defaults.from ?? fyStartIso();
  const toIso = valid(sp.to) ?? defaults.to ?? todayIso();
  return {
    fromIso,
    toIso,
    from: new Date(`${fromIso}T00:00:00.000Z`),
    to: new Date(`${toIso}T23:59:59.999Z`),
  };
}

export const dayDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** A date some hours after now (kept out of render bodies for the React purity lint). */
export const hoursFromNow = (h: number) => new Date(new Date().getTime() + h * 3_600_000);
