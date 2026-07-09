const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class Notification extends Model {}

Notification.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    user_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    role_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "roles", key: "id" } },
    channel: { type: DataTypes.ENUM("app", "sms", "whatsapp"), allowNull: false }, // note #11
    message: { type: DataTypes.TEXT, allowNull: false },
    notif_status: { type: DataTypes.ENUM("pending", "sent", "failed"), defaultValue: "pending" }, // renamed from generic "status"
    sent_at: { type: DataTypes.DATE, allowNull: true },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  },
  {
    sequelize,
    modelName: "Notification",
    tableName: "notifications",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = Notification;
