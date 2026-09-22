// Every physical stock quantity in this app — bag_size × bag_count,
// weighbridge weights, Inventory.balance_qty, warehouse capacity — is
// stored internally in KILOGRAMS. The UI displays these in Qtl wherever
// a field is labeled "(Qtl)", using the standard conversion: 1000kg = 1 ton.
//
// Bag size itself stays in kg everywhere (it's a small, human-scale number
// like 25kg or 50kg) — only aggregate stock/qty totals get converted.

export const KG_PER_TON = 1000;

/** Convert a raw kg value (as stored/returned by the backend) to Qtl for display. */
export function kgToQtl(kg) {
  const value = Number(kg);
  if (!Number.isFinite(value)) return 0;
  return Math.round((value / KG_PER_TON) * 100) / 100; // 2 decimal places
}

/** Convert a Qtl value (as typed by a user) to kg for sending to the backend. */
export function QtlToKg(Qtl) {
  const value = Number(Qtl);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * KG_PER_TON * 100) / 100;
}

/** Format a raw kg value as a Qtl string for display, e.g. "1.00 Qtl". */
export function formatQtl(kg, { withUnit = false } = {}) {
  const Qtl = kgToQtl(kg);
  return withUnit ? `${Qtl} Qtl` : String(Qtl);
}