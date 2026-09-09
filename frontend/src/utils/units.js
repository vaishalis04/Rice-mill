// Every physical stock quantity in this app — bag_size × bag_count,
// weighbridge weights, Inventory.balance_qty, warehouse capacity — is
// stored internally in KILOGRAMS. The UI displays these in TONS wherever
// a field is labeled "(Tons)", using the standard conversion: 1000kg = 1 ton.
//
// Bag size itself stays in kg everywhere (it's a small, human-scale number
// like 25kg or 50kg) — only aggregate stock/qty totals get converted.

export const KG_PER_TON = 1000;

/** Convert a raw kg value (as stored/returned by the backend) to tons for display. */
export function kgToTons(kg) {
  const value = Number(kg);
  if (!Number.isFinite(value)) return 0;
  return Math.round((value / KG_PER_TON) * 100) / 100; // 2 decimal places
}

/** Convert a tons value (as typed by a user) to kg for sending to the backend. */
export function tonsToKg(tons) {
  const value = Number(tons);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * KG_PER_TON * 100) / 100;
}

/** Format a raw kg value as a tons string for display, e.g. "1.00 tons". */
export function formatTons(kg, { withUnit = false } = {}) {
  const tons = kgToTons(kg);
  return withUnit ? `${tons} tons` : String(tons);
}