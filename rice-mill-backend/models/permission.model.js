const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class Permission extends Model {}

Permission.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    module: { type: DataTypes.STRING(50), allowNull: false },
    action: { type: DataTypes.ENUM("create", "read", "update", "delete", "approve"), allowNull: false },
    code: { type: DataTypes.STRING(100), allowNull: false, unique: "permissions_code_unique" },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  },
  {
    sequelize,
    modelName: "Permission",
    tableName: "permissions",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
    indexes: [
      { name: "permissions_module_action_unique", unique: true, fields: ["module", "action"] },
    ],
  }
);

module.exports = Permission;