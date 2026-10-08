// ---------------------------------------------------------------------------
// Units — ONE place that defines how weights and quantities are measured.
//
//   * Every quantity in this ERP is in QUINTALS (Qtl).   1 Qtl = 100 kg.
//   * Only the BAG / PACK SIZE is in kg (25 kg, 50 kg ...).
//   * Total quantity of a bag line = bag size (kg) x number of bags / 100   -> Qtl
//   * Number of bags in a quantity = quantity (Qtl) x 100 / bag size (kg)
//
// The backend (helpers/units.js) uses the same constant and already returns
// stock / order / loading quantities in Qtl — show those as they are. Convert
// only values that really are kg: weighbridge weights, bag size x bags.
// Never write 1000 for a weight conversion in a page — import from here.
// ---------------------------------------------------------------------------

export const KG_PER_QTL = 100;

// Weighbridge tolerance (+/- Qtl) between the scale net weight and the recorded load / unload.
// Keep in step with SCALE_TOLERANCE_QTL in the backend helpers/units.js.
export const SCALE_TOLERANCE_QTL = 50;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** kg -> Qtl (2 decimals, for display). */
export function kgToQtl(kg) {
  return Math.round((num(kg) / KG_PER_QTL) * 100) / 100;
}

/** Qtl -> kg. */
export function QtlToKg(Qtl) {
  return Math.round(num(Qtl) * KG_PER_QTL * 100) / 100;
}

/** bag size (kg) x bags -> Qtl, 3 decimals (1 kg = 0.01 Qtl, so this is exact). */
export function bagsToQtl(bagSizeKg, bags) {
  return Math.round(((num(bagSizeKg) * num(bags)) / KG_PER_QTL) * 1000) / 1000;
}

/** Qtl -> whole bags of a given size (0 when there is no bag size). */
export function qtlToBags(Qtl, bagSizeKg) {
  return num(bagSizeKg) > 0 ? Math.floor((num(Qtl) * KG_PER_QTL) / num(bagSizeKg) + 0.0001) : 0;
}

/** Format a raw kg value as a Qtl string, e.g. "1.25" or "1.25 Qtl". */
export function formatQtl(kg, { withUnit = false } = {}) {
  const Qtl = kgToQtl(kg);
  return withUnit ? `${Qtl} Qtl` : String(Qtl);
}