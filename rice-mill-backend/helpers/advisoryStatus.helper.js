// Single source of truth for the Advisory Trucks "Status" dropdown.
// Used by controllers/advisoryTruck.controller.js (validation + options sent
// to the page) and controllers/reports.controller.js (label on the Daily
// Outward report) so the two can never drift apart.
//
// Stored value (GateEntry.advisory_status) is the short key on the left;
// the label is what people see. Allowed keys depend on the truck's
// GateEntry.entry_type:
//   sales    -> Sales (Outbound) trucks
//   purchase -> Purchase trucks
//   other    -> Empty / Misc trucks
// "completed" is special: a truck marked completed is hidden from the
// Advisory Trucks list (it is NOT deleted — reports still see it).

const STATUS_LABELS = {
  at_transit: "At Transit",
  at_location: "At Location",
  unload_complete: "Unload Complete",
  receivable_pending: "Receivable Pending",
  on_hold: "On Hold",
  pending_payment: "Pending Payment",
  payment_pending: "Payment Pending",
  completed: "Completed",
};

const COMPLETED_STATUS = "completed";

const STATUS_KEYS_BY_ENTRY_TYPE = {
  sales: ["at_transit", "at_location", "unload_complete", "receivable_pending", "completed"],
  purchase: ["unload_complete", "on_hold", "pending_payment", "completed"],
  other: ["payment_pending", "completed"],
};

const statusOptionsFor = (entryType) =>
  (STATUS_KEYS_BY_ENTRY_TYPE[entryType] || []).map((value) => ({ value, label: STATUS_LABELS[value] }));

const isValidStatusFor = (entryType, status) =>
  (STATUS_KEYS_BY_ENTRY_TYPE[entryType] || []).includes(status);

module.exports = { STATUS_LABELS, COMPLETED_STATUS, STATUS_KEYS_BY_ENTRY_TYPE, statusOptionsFor, isValidStatusFor };