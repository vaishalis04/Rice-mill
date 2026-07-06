const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class RolePermission extends Model {}

RolePermission.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    role_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "roles", key: "id" } },
    permission_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "permissions", key: "id" } },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  },
  {
    sequelize,
    modelName: "RolePermission",
    tableName: "role_permissions",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
    indexes: [
      { unique: true, fields: ["role_id", "permission_id"] },
    ],
  }
);

module.exports = RolePermission;
