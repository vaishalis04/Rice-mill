require("dotenv").config();
const sequelize = require("../config/db");
const { Role } = require("../models/index");

// Matches frontend/src/constants/roles.js exactly
const roles = [
  { id: 2, role_name: "purchase" },
  { id: 3, role_name: "gate" },
  { id: 4, role_name: "lab" },
  { id: 5, role_name: "warehouse" },
  { id: 7, role_name: "sales" },
  { id: 8, role_name: "dispatch" },
  { id: 9, role_name: "admin" },
  { id: 10, role_name: "production" },
];

(async () => {
  try {
    await sequelize.authenticate();
    for (const r of roles) {
      await sequelize.query(
        "INSERT INTO roles (id, role_name, created_at, updated_at) VALUES (?, ?, NOW(), NOW())",
        { replacements: [r.id, r.role_name] }
      );
      console.log(`✅ Role id=${r.id} -> ${r.role_name}`);
    }
    console.log("\n🎉 Roles seeded with exact IDs.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Failed:", err.message);
    process.exit(1);
  }
})();