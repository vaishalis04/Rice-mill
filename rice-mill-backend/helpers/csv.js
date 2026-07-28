// Minimal CSV serializer — no external dependency needed for flat report rows.

const escapeCsvValue = (val) => {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
};

// columns: [{ key, label }]; rows: [{ key: value, ... }]
const toCsv = (rows, columns) => {
  const header = columns.map((c) => escapeCsvValue(c.label)).join(",");
  const lines = rows.map((row) => columns.map((c) => escapeCsvValue(row[c.key])).join(","));
  return [header, ...lines].join("\n");
};

// Sets headers and sends a CSV file as a download.
const sendCsv = (res, filename, csvString) => {
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.status(200).send(csvString);
};

module.exports = { toCsv, sendCsv };
