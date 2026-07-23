// One-off seed script for the Production module's "Machine master with 10 seed
// machines" requirement. Run with: node database/seedMachines.js
require("dotenv").config();
const { MachineMaster } = require("../models/index");

const machines = [
  { machine_code: "DRY-01", name: "Paddy Dryer 1", type: "dryer", capacity_per_hr: 8000 },
  { machine_code: "HUL-01", name: "Huller / Milling Machine 1", type: "huller", capacity_per_hr: 6000 },
  { machine_code: "HUL-02", name: "Huller / Milling Machine 2", type: "huller", capacity_per_hr: 6000 },
  { machine_code: "SEP-01", name: "Destoner / Separator 1", type: "separator", capacity_per_hr: 7000 },
  { machine_code: "SHI-01", name: "Shiner / Whitener - Pass 1", type: "shiner", capacity_per_hr: 5500 },
  { machine_code: "SHI-02", name: "Shiner / Whitener - Pass 2", type: "shiner", capacity_per_hr: 5500 },
  { machine_code: "SHI-03", name: "Shiner / Whitener - Pass 3", type: "shiner", capacity_per_hr: 5500 },
  { machine_code: "CS-01", name: "Color Sorter 1", type: "color_sorter", capacity_per_hr: 4000 },
  { machine_code: "GR-01", name: "Length Grader 1", type: "grader", capacity_per_hr: 4500 },
  { machine_code: "OTH-01", name: "Bagging / Weighing Unit 1", type: "other", capacity_per_hr: 3000 },
];

(async () => {
  try {
    for (const m of machines) {
      const [record, created] = await MachineMaster.findOrCreate({
        where: { machine_code: m.machine_code },
        defaults: { ...m, install_date: new Date().toISOString().slice(0, 10) },
      });
      console.log(`${created ? "Created" : "Already exists"}: ${record.machine_code} — ${record.name}`);
    }
    console.log("Machine seed complete.");
    process.exit(0);
  } catch (err) {
    console.error("Machine seed failed:", err.message);
    process.exit(1);
  }
})();
