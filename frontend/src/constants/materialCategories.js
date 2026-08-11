// Must stay in sync with the ENUM on rice-mill-backend/models/materialMaster.model.js
// (`category`) and the allow-list in controllers/masterSettings.controller.js
// (`validateAndBuildPayload` for type === "material"). If the backend enum
// changes, update this list too — every Material create/edit form in the
// frontend (Purchase Orders quick-add, Admin > Master Settings) reads from
// this single source so they can't drift out of sync with each other.
export const MATERIAL_CATEGORIES = [
  { value: "paddy", label: "Paddy" },
  { value: "rice", label: "Rice" },
  { value: "husk", label: "Husk" },
  { value: "bran", label: "Bran" },
  { value: "broken", label: "Broken" },
  { value: "other", label: "Other" },
];