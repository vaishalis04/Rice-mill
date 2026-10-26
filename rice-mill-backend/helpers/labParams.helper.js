// Quality parameters of a lab test, in one place.
//  - The fixed numeric parameters (all OPTIONAL — only the verdict is mandatory).
//  - Normalising what the form sends (blank -> null, a real 0 stays 0).
//  - Reading a lab test back as an ordered list of { name, value } rows, which the
//    Composite Report uses as its "Exposed Sample Analysis" column.

const NUMERIC_PARAMS = [
  { key: "moisture_pct", label: "Moisture %" },
  { key: "broken_pct", label: "Broken %" },
  { key: "pin_broken_pct", label: "Pin Broken %" },
  { key: "avg_length_mm", label: "Avg Length (mm)" },
  { key: "ddc_pct", label: "DDC %" },
  { key: "kett", label: "Kett" },
  { key: "light_yellow_pct", label: "Light Yellow %" },
  { key: "immature_pct", label: "Immature %" },
  { key: "white_belly_pct", label: "White Belly %" },
  { key: "add_mixing_pct", label: "Add Mixing %" },
  { key: "fm_pct", label: "Foreign Matter %" },
];

const TEXT_PARAMS = [
  { key: "color", label: "Color" },
  { key: "smell", label: "Smell" },
];

// The numeric columns the new optional parameters added (create/update accept these).
const NEW_NUMERIC_KEYS = [
  "pin_broken_pct", "avg_length_mm", "ddc_pct", "kett",
  "light_yellow_pct", "immature_pct", "white_belly_pct", "add_mixing_pct",
];

// "" / null / undefined / junk -> null, but a real 0 stays 0 (0% broken is a valid reading).
const numOrNull = (v) => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// JSON column can round-trip as a raw string (same MariaDB/Sequelize quirk handled elsewhere).
const parseJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

// Keeps only usable custom parameters: a name is needed, the value may be anything short.
const cleanCustomParams = (value) =>
  parseJsonArray(value)
    .map((p) => ({
      name: String((p && p.name) ?? "").trim().slice(0, 60),
      value: String((p && p.value) ?? "").trim().slice(0, 60),
    }))
    .filter((p) => p.name);

const hasValue = (v) => v !== null && v !== undefined && String(v).trim() !== "";

// Plain 2-decimal text for a stored DECIMAL ("12.50" -> "12.5"-style trimming is avoided on purpose).
const fmtNum = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : String(v));

// Ordered [{ name, value }] for every parameter that actually has a reading on this lab test.
const labTestParamRows = (test) => {
  const rows = [];
  NUMERIC_PARAMS.forEach(({ key, label }) => {
    if (hasValue(test[key])) rows.push({ name: label, value: fmtNum(test[key]) });
  });
  TEXT_PARAMS.forEach(({ key, label }) => {
    if (hasValue(test[key])) rows.push({ name: label, value: String(test[key]) });
  });
  cleanCustomParams(test.custom_params).forEach((p) => rows.push({ name: p.name, value: p.value }));
  return rows;
};

module.exports = { NUMERIC_PARAMS, TEXT_PARAMS, NEW_NUMERIC_KEYS, numOrNull, parseJsonArray, cleanCustomParams, hasValue, fmtNum, labTestParamRows };
