const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class User extends Model {}

User.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    // Named unique constraints (a string, not `unique: true`) instead of
    // Sequelize auto-generating an index name — with `unique: true`,
    // sync({ alter: true }) can't reliably recognize its own previously
    // created index as already satisfying the constraint, so every
    // restart added ANOTHER auto-named unique index for these columns.
    // That's what was hitting MySQL's 64-index-per-table limit and
    // aborting schema sync for the whole app on every restart. A fixed
    // name makes it idempotent — sync recognizes "this exact index already
    // exists" and leaves it alone.
    username: { type: DataTypes.STRING(50), allowNull: false, unique: "users_username_unique" },
    email: { type: DataTypes.STRING(100), allowNull: false, unique: "users_email_unique", validate: { isEmail: true } },
    phone: { type: DataTypes.STRING(15), unique: "users_phone_unique" },
    password_hash: { type: DataTypes.STRING(255), allowNull: false },
    role_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "roles", key: "id" } },
    employee_code: { type: DataTypes.STRING(30), unique: "users_employee_code_unique" },
    is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, 
    refresh_token: {
  type: DataTypes.TEXT,
  allowNull: true,
},
  },
  {
    sequelize,
    modelName: "User",
    tableName: "users",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = User;