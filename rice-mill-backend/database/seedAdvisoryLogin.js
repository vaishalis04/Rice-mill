require("dotenv").config();
const bcrypt = require("bcryptjs");
const { Role, User } = require("../models/index");

const EMAIL = "14@gmail.com";
const PASSWORD = "role14@14";
const USERNAME = "advisory_user";

(async () => {
  try {
    const [role] = await Role.findOrCreate({
      where: { role_name: "advisory" },
      defaults: {
        role_name: "advisory",
        description: "Advisory Trucks and Payment Settlement Advice",
      },
    });

    const password_hash = await bcrypt.hash(PASSWORD, 10);
    const existing = await User.findOne({ where: { email: EMAIL } });

    if (existing) {
      await existing.update({
        password_hash,
        role_id: role.id,
        is_active: true,
        is_deleted: false,
      });
      console.log(`✅ Updated Advisory login for ${EMAIL} (role id: ${role.id})`);
    } else {
      const [usernameTaken, employeeCodeTaken] = await Promise.all([
        User.findOne({ where: { username: USERNAME } }),
        User.findOne({ where: { employee_code: USERNAME.toUpperCase() } }),
      ]);
      const suffix = EMAIL.split("@")[0];

      await User.create({
        username: usernameTaken ? `${USERNAME}_${suffix}` : USERNAME,
        email: EMAIL,
        password_hash,
        role_id: role.id,
        employee_code: employeeCodeTaken ? `${USERNAME.toUpperCase()}_${suffix}` : USERNAME.toUpperCase(),
        is_active: true,
        is_deleted: false,
      });
      console.log(`✅ Created Advisory login for ${EMAIL} (role id: ${role.id})`);
    }

    process.exit(0);
  } catch (err) {
    console.error("❌ Advisory login seed failed:", err.message);
    process.exit(1);
  }
})();