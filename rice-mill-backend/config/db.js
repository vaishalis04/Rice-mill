const { Sequelize } = require("sequelize");
require("dotenv").config();

const sequelize = new Sequelize(
  process.env.DB_NAME || "rice_mill_erp",
  process.env.DB_USER || "root",
  process.env.DB_PASSWORD || "Aman@123456",
  {
    host: process.env.DB_HOST || "127.0.0.1",
    port: process.env.DB_PORT || 3306,
    dialect: "mysql",
    logging: false,
  }
);

module.exports = sequelize;
