// ---------------------------------------------------------------------------
// Units — ONE place that defines how weights and quantities are measured.
//
//   * Every quantity in this ERP is in QUINTALS (Qtl).   1 Qtl = 100 kg.
//   * Only the BAG / PACK SIZE is in kg (25 kg, 50 kg ...).
//   * Total quantity of a bag line   = bag size (kg) x number of bags / 100   -> Qtl
//   * Number of bags in a quantity   = quantity (Qtl) x 100 / bag size (kg)
//   * Weighbridge weights, gross / tare / net, stay in kg (that is what the scale
//     reads); a quantity taken from them is converted with kgToQtl().
//   * Finished-goods rows keep their weight in kg (FinishedGoods.qty); convert with
//     kgToQtl() whenever a Qtl figure is needed.
//
// Never write 1000 (or 0.001) for a weight conversion anywhere else — import from here.
// ---------------------------------------------------------------------------
const KG_PER_QTL = 100;

// Weighbridge tolerance: the scale net weight may be this many Qtl MORE or LESS than the
// quantity recorded at loading / unloading (+/-). Beyond it the second weighment is refused.
// This is the ONE number to change (e.g. 0.5 for +/-50 kg).
const SCALE_TOLERANCE_QTL = 50;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round = (v, dp = 3) => {
  const f = 10 ** dp;
  return Math.round(num(v) * f) / f;
};

/** kg -> Qtl */
const kgToQtl = (kg) => num(kg) / KG_PER_QTL;
/** Qtl -> kg */
const qtlToKg = (qtl) => num(qtl) * KG_PER_QTL;
/** bags of a given size -> Qtl:  bag size (kg) x bags / 100 */
const bagsToQtl = (bagSizeKg, bags) => (num(bagSizeKg) * num(bags)) / KG_PER_QTL;
/** Qtl -> whole bags of a given size (null when there is no bag size, i.e. bulk) */
const qtlToBags = (qtl, bagSizeKg) =>
  num(bagSizeKg) > 0 ? Math.floor((num(qtl) * KG_PER_QTL) / num(bagSizeKg) + 0.0001) : null;

module.exports = { KG_PER_QTL, SCALE_TOLERANCE_QTL, kgToQtl, qtlToKg, bagsToQtl, qtlToBags, round };