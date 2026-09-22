const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

// Records what came in on an "other" (empty/miscellaneous) gate entry —
// e.g. packing material, spare parts, stationery — and where it was put.
// Deliberately NOT part of the formal Inventory/Lot system (that's for
// raw material & finished goods only); this is just a simple log so
// Admin/Warehouse can see what miscellaneous items arrived, how much,
// and where they were stored.
class GateEntryMiscItem extends Model {}

GateEntryMiscItem.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    gate_entry_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      references: { model: "gate_entry", key: "id" },
    },
    item_name: { type: DataTypes.STRING(150), allowNull: false },
    qty: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    unit: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "nos" },
    // Free text on purpose — "Warehouse 2, Rack 3", "Admin store room",
    // "Left with Production", etc. This is a log, not a bin-level stock
    // system.
    storage_location: { type: DataTypes.STRING(150), allowNull: true },
    remarks: { type: DataTypes.STRING(255), allowNull: true },
    created_by: {
      type: DataTypes.BIGINT,
      allowNull: true,
      references: { model: "users", key: "id" },
    },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  },
  {
    sequelize,
    modelName: "GateEntryMiscItem",
    tableName: "gate_entry_misc_item",
    timestamps: true,
    underscored: true,
    paranoid: false,
  }
);

module.exports = GateEntryMiscItem;