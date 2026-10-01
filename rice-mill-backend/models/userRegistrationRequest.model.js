const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class UserRegistrationRequest extends Model {}

// A public sign-up ("Register" on the login page) doesn't create a User
// directly — it lands here as "pending" until an admin approves it (and
// picks a role + page permissions for it) or rejects it. Deliberately
// separate from the existing POST /api/auth/register (which still creates
// a User immediately and is left untouched) so that flow's behavior
// doesn't change for anything already using it.
UserRegistrationRequest.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(100), allowNull: false },
    mobile: { type: DataTypes.STRING(15), allowNull: false },
    email: { type: DataTypes.STRING(100), allowNull: false, validate: { isEmail: true } },
    // Hashed immediately on submission — never store the plain password,
    // even temporarily while the request is pending.
    password_hash: { type: DataTypes.STRING(255), allowNull: false },
    status: {
      type: DataTypes.ENUM("pending", "approved", "rejected"),
      allowNull: false,
      defaultValue: "pending",
    },
    rejection_reason: { type: DataTypes.STRING(255), allowNull: true },
    // Set once approved, pointing at the real User record that got created.
    created_user_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    reviewed_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    reviewed_at: { type: DataTypes.DATE, allowNull: true },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  },
  {
    sequelize,
    modelName: "UserRegistrationRequest",
    tableName: "user_registration_requests",
    timestamps: true,
    underscored: true,
    paranoid: false,
  }
);

module.exports = UserRegistrationRequest;