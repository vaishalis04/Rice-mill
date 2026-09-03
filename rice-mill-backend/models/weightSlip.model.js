const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class WeightSlip extends Model {}

WeightSlip.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    gate_entry_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "gate_entry", key: "id" } },
    slip_no: { type: DataTypes.STRING(30), allowNull: false, unique: "weight_slip_slip_no_unique" },
    gross_weight: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    tare_weight: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    net_weight: {
      type: DataTypes.VIRTUAL,
      get() {
        const g = this.getDataValue("gross_weight");
        const t = this.getDataValue("tare_weight");
        if (g == null || t == null) return null;
        return Number(g) - Number(t);
      },
    }, // improvement: derive instead of storing a value that can drift
    weighed_at: { type: DataTypes.DATE },
    weighbridge_operator_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "WeightSlip",
    tableName: "weight_slip",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = WeightSlip;