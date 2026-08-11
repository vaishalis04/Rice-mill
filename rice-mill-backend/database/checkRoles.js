require("dotenv").config();
const sequelize = require("../config/db");
const { Role } = require("../models/index");

(async () => {
  try {
    await sequelize.authenticate();
    console.log("Connected to database:", sequelize.config.database);
    console.log("Host:", sequelize.config.host, "Port:", sequelize.config.port);

    const roles = await Role.findAll();
    console.log(`\nFound ${roles.length} roles:`);
    roles.forEach(r => console.log(`  id=${r.id}  role_name="${r.role_name}"`));

    process.exit(0);
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
})();