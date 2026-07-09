const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class Dryer extends Model {}

Dryer.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    batch_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "production_batch", key: "id" } },
    machine_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "machine_master", key: "id" } },
    start_time: { type: DataTypes.DATE },
    end_time: { type: DataTypes.DATE },
    moisture_before: { type: DataTypes.DECIMAL(5, 2) },
    moisture_after: { type: DataTypes.DECIMAL(5, 2) },
    recheck_status: { type: DataTypes.ENUM("pending", "passed", "failed"), defaultValue: "pending" },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "Dryer",
    tableName: "dryer",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = Dryer;
