const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

// Visitor gate pass (Gate Management) — for normal visits (no vehicle,
// no material), distinct from GateEntry which is for trucks (purchase/
// sales/other). A gate pass is issued on check-in and closed on check-out.
class Visitor extends Model {}

Visitor.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    gate_pass_no: { type: DataTypes.STRING(30), allowNull: false, unique: "visitor_gate_pass_no_unique" }, // sequential, e.g. GP-20260908-001
    visitor_name: { type: DataTypes.STRING(100), allowNull: false },
    purpose: { type: DataTypes.STRING(255), allowNull: false },
    no_of_persons: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    phone: { type: DataTypes.STRING(20), allowNull: true },
    to_meet: { type: DataTypes.STRING(100), allowNull: true }, // who/which department they're visiting
    check_in_time: { type: DataTypes.DATE, allowNull: false },
    check_out_time: { type: DataTypes.DATE, allowNull: true },
    status: {
      type: DataTypes.ENUM("checked_in", "checked_out"),
      allowNull: false,
      defaultValue: "checked_in",
    },
    remarks: { type: DataTypes.STRING(255), allowNull: true },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } },
  },
  {
    sequelize,
    modelName: "Visitor",
    tableName: "visitors_log",
    timestamps: true,
    underscored: true,
    paranoid: false,
    indexes: [
      { fields: ["status"] },
    ],
  }
);

module.exports = Visitor;