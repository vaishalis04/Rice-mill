const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class ReasonCodeMaster extends Model {}

ReasonCodeMaster.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    category: { type: DataTypes.ENUM("rejection", "downtime", "waste"), allowNull: false },
    code: { type: DataTypes.STRING(30), allowNull: false },
    description: { type: DataTypes.STRING(255) },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "ReasonCodeMaster",
    tableName: "reason_code_master",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
    indexes: [
      { unique: true, fields: ["category", "code"] },
    ],
  }
);

module.exports = ReasonCodeMaster;
