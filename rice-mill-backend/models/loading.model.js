const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class Loading extends Model {}

Loading.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    loading_no: { type: DataTypes.STRING(30), allowNull: false, unique: "loading_loading_no_unique" },
    gate_entry_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "gate_entry", key: "id" } },
    // NOT unique any more — a truck can be loaded in more than one pass
    // (e.g. bags arrive in batches) until the linked Sales Order's
    // materials are fully loaded; see loading.controller.js create(),
    // which only lets the gate entry move past "waiting_loading" once
    // every material is fully accounted for.
    so_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "sales_order", key: "id" } },
    // Qtl, 3 decimals — 1 kg is exactly 0.001 Qtl, so small bag counts stay exact.
    loaded_qty: { type: DataTypes.DECIMAL(14, 3), allowNull: false },
    loaded_at: { type: DataTypes.DATE },
    loading_operator_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    remarks: { type: DataTypes.STRING(255), allowNull: true },
    // Per-material breakdown for this loading pass —
    // [{ so_id, material_id, bag_size, bags, qty }]. bag_size (kg) x bags
    // gives qty in Qtl (see loading.controller.js's bagsToQtl), same
    // "physical bag count" convention Unloading uses for
    // Lot.bag_size/accepted_bags, rather than a typed-in quantity with no
    // real bag count behind it.
    items: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
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