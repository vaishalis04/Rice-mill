// One place that knows how a truck's Gate Pass number is built, so the Gate Pass
// PDF and Payment Settlement (which is done "against the GP No.") can never
// disagree about it. The number is derived from the gate entry id, so it is
// stable: reprinting a pass or re-opening a settlement always gives the same GP No.
//
//   Purchase trucks  -> GP-IN-0042
//   Sales trucks     -> GP-OUT-0042
//   Empty/Misc       -> GP-STR-0042

const PREFIX_BY_ENTRY_TYPE = { purchase: "GP-IN", sales: "GP-OUT", other: "GP-STR" };
const ENTRY_TYPE_BY_TAG = { IN: "purchase", OUT: "sales", STR: "other" };

const gpNoFor = (entryType, id) => `${PREFIX_BY_ENTRY_TYPE[entryType] || "GP"}-${String(id).padStart(4, "0")}`;

// "GP-OUT-0042" (any case, any zero padding) -> { entry_type: "sales", id: 42 }, else null.
const parseGpNo = (text) => {
  const m = String(text || "").trim().match(/^GP-(IN|OUT|STR)-0*(\d+)$/i);
  if (!m) return null;
  return { entry_type: ENTRY_TYPE_BY_TAG[m[1].toUpperCase()], id: Number(m[2]) };
};

module.exports = { gpNoFor, parseGpNo, PREFIX_BY_ENTRY_TYPE };