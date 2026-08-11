// Must stay in sync with the ENUM on
// rice-mill-backend/models/varietyMaster.model.js (`grain_type`) and the
// check in controllers/masterSettings.controller.js (type === "variety").
export const GRAIN_TYPES = [
  { value: "long", label: "Long" },
  { value: "medium", label: "Medium" },
  { value: "short", label: "Short" },
];