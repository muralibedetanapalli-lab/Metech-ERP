/** The built-in "Common" cost centre: costs shared by every project, split across projects by revenue share. */
export const COMMON_CODE = "COMMON";
export const COMMON_KIND = "COMMON";

type Centre = { id: string; code?: string; name: string; kind?: string };

export const isCommon = (c: { kind?: string | null }) => c.kind === COMMON_KIND;

/**
 * Options for a "Project / cost centre" picker: Common first (for costs), then projects, departments and branches.
 * Sales pickers leave Common out: income always belongs to a project or stays untagged.
 */
export function centreOptions(centres: Centre[], opts: { common?: boolean } = {}) {
  const common = centres.filter(isCommon);
  const rest = centres.filter((c) => !isCommon(c));
  return [
    ...(opts.common === false ? [] : common.map((c) => ({ value: c.id, label: "Common: shared by all projects" }))),
    ...rest.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` })),
  ];
}
