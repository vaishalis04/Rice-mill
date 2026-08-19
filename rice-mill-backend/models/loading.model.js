const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class Loading extends Model {}

// Outbound loading capture at the gate (Gate Sales-Loading flow).
// One Loading row per gate entry (entry_type = "sales"). This is a
// simplified, quantity-only capture of "this truck was loaded with X kg
// against this Sales Order" — it does NOT pick discrete FinishedGoods/
// packing-unit rows the way the full Dispatch module does. For granular
// per-bag/per-pallet allocation and challan-PDF generation, use the
// separate Dispatch module instead; this is meant for the gate operator
// to record the load quickly and let the truck move on to check-out.
Loading.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    loading_no: { type: DataTypes.STRING(30), allowNull: false, unique: true },
    gate_entry_id: { type: DataTypes.BIGINT, allowNull: false, unique: true, references: { model: "gate_entry", key: "id" } },
    so_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "sales_order", key: "id" } },
    loaded_qty: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    loaded_at: { type: DataTypes.DATE },
    loading_operator_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    remarks: { type: DataTypes.STRING(255), allowNull: true },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } },
  },
  {
    sequelize,
    modelName: "Loading",
    tableName: "loading",
    timestamps: true,
    underscored: true,
    paranoid: false,
  }
);

module.exports = Loading;