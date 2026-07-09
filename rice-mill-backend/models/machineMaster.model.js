const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class MachineMaster extends Model {}

MachineMaster.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    machine_code: { type: DataTypes.STRING(30), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(100), allowNull: false },
    type: { type: DataTypes.ENUM("huller", "separator", "shiner", "color_sorter", "grader", "dryer", "other"), allowNull: false },
    capacity_per_hr: { type: DataTypes.DECIMAL(10, 2) },
    install_date: { type: DataTypes.DATEONLY },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "MachineMaster",
    tableName: "machine_master",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = MachineMaster;
