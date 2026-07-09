const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class MachineMaintenance extends Model {}

MachineMaintenance.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    machine_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "machine_master", key: "id" } },
    maintenance_type: { type: DataTypes.ENUM("preventive", "breakdown"), allowNull: false },
    start_time: { type: DataTypes.DATE },
    end_time: { type: DataTypes.DATE },
    cost: { type: DataTypes.DECIMAL(10, 2) },
    performed_by: { type: DataTypes.STRING(100) },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "MachineMaintenance",
    tableName: "machine_maintenance",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = MachineMaintenance;
