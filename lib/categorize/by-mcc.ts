import { MCC_TO_CATEGORY } from "./mcc-map";

/** Returns category slug for an MCC, or null if not mapped. */
export function categoryForMcc(mcc: number | null | undefined): string | null {
  if (mcc == null) return null;
  return MCC_TO_CATEGORY[mcc] ?? null;
}
