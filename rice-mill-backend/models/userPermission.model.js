const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class UserPermission extends Model {}

// Direct, per-user grants — same Permission rows RolePermission points at,
// but attached straight to a User instead of to their Role. A user's
// *effective* permissions are the union of their role's grants and these
// (see auth.controller.js myPermissions and auth.middleware.js
// requirePermission). Used so an admin can hand one specific user access to
// an extra page (e.g. one Warehouse user who also needs PO Approval)
// without creating a whole new role for it, and to attach page permissions
// directly when approving a self-registered user.
UserPermission.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    user_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "users", key: "id" } },
    permission_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "permissions", key: "id" } },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  },
  {
    sequelize,
    modelName: "UserPermission",
    tableName: "user_permissions",
    timestamps: true,
    underscored: true,
    paranoid: false,
    indexes: [
      { name: "user_permissions_user_id_permission_id_unique", unique: true, fields: ["user_id", "permission_id"] },
    ],
  }
);

module.exports = UserPermission;