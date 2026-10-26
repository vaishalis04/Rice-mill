const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

// "Composite Report" (Incoming Approval Slip): generated from a tested sample
// (a lab test report). The exposed-sample analysis is copied in from that lab
// test; the composite-sample analysis is entered next to it. It is standalone —
// it never touches gate entries, unloading, loading, production or stock.
class CompositeReport extends Model {}

CompositeReport.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    report_no: { type: DataTypes.STRING(20), allowNull: true }, // CR-00001, set right after create
    lab_test_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      references: { model: "lab_test", key: "id" },
    },
    approval_no: { type: DataTypes.STRING(60), allowNull: true },
    ref_no: { type: DataTypes.STRING(60), allowNull: true },
    report_date: { type: DataTypes.DATEONLY, allowNull: true },
    party_name: { type: DataTypes.STRING(150), allowNull: true },
    truck_no: { type: DataTypes.STRING(40), allowNull: true },
    qty: { type: DataTypes.STRING(60), allowNull: true },
    quality: { type: DataTypes.STRING(150), allowNull: true },
    // The analysis table: [{ name, exposed, composite }]
    params: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
    result_exposed: {
      type: DataTypes.ENUM("approved", "rejected", "non_conforming"),
      allowNull: true,
    },
    result_composite: {
      type: DataTypes.ENUM("approved", "rejected", "non_conforming"),
      allowNull: true,
    },
    remarks: { type: DataTypes.STRING(1000), allowNull: true },
    created_by: {
      type: DataTypes.BIGINT,
      allowNull: true,
      references: { model: "users", key: "id" },
    },
    updated_by: {
      type: DataTypes.BIGINT,
      allowNull: true,
      references: { model: "users", key: "id" },
    },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      references: { model: "plant_master", key: "id" },
    },
  },
  {
    sequelize,
    modelName: "CompositeReport",
    tableName: "composite_report",
    timestamps: true,
    underscored: true,
    paranoid: false,
  },
);

module.exports = CompositeReport;
