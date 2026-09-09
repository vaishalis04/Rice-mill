require("dotenv").config();
const bcrypt = require("bcrypt");
const { Role, User } = require("../models/index");

const SALT_ROUNDS = 10;

const users = [
  { email: "2@gmail.com",  password: "role2@2",   role_name: "purchase",    username: "purchase_user" },
  { email: "3@gmail.com",  password: "role3@3",   role_name: "gate",        username: "gate_user" },
  { email: "4@gmail.com",  password: "role4@4",   role_name: "lab",         username: "lab_user" },
  { email: "5@gmail.com",  password: "role5@5",   role_name: "warehouse",   username: "warehouse_user" },
  { email: "6@gmail.com",  password: "role6@6",   role_name: "weighbridge", username: "weighbridge_user" },
  { email: "7@gmail.com",  password: "role7@7",   role_name: "sales",       username: "sales_user" },
  { email: "8@gmail.com",  password: "role8@8",   role_name: "weighbridge", username: "weighbridge_user_8" },
  { email: "11@gmail.com", password: "role11@11", role_name: "weighbridge", username: "weighbridge_user_11" },
  { email: "9@gmail.com",  password: "role9@9",   role_name: "admin",       username: "admin_user" },
  { email: "10@gmail.com", password: "role10@10", role_name: "production",  username: "production_user" },
];

(async () => {
  try {
    for (const u of users) {
      const [role] = await Role.findOrCreate({
        where: { role_name: u.role_name },
        defaults: { role_name: u.role_name },
      });

      const existing = await User.findOne({ where: { email: u.email } });
      if (existing) {
        const password_hash = await bcrypt.hash(u.password, SALT_ROUNDS);
        existing.username = u.username;
        existing.password_hash = password_hash;
        existing.role_id = role.id;
        existing.employee_code = u.username.toUpperCase();
        existing.is_active = true;
        existing.is_deleted = false;
        await existing.save();
        console.log(`✅ Updated: ${u.email} (role: ${u.role_name}, id: ${role.id})`);
        continue;
      }

      const password_hash = await bcrypt.hash(u.password, SALT_ROUNDS);
      const usernameTaken = await User.findOne({ where: { username: u.username } });
      const employeeCode = u.username.toUpperCase();
      const employeeCodeTaken = await User.findOne({ where: { employee_code: employeeCode } });
      const username = usernameTaken ? `${u.username}_${u.email.split("@")[0]}` : u.username;
      const resolvedEmployeeCode = employeeCodeTaken ? `${employeeCode}_${u.email.split("@")[0]}` : employeeCode;

      await User.create({
        username,
        email: u.email,
        password_hash,
        role_id: role.id,
        employee_code: resolvedEmployeeCode,
        is_active: true,
        is_deleted: false,
      });

      console.log(`✅ Created: ${u.email}  (role: ${u.role_name}, id: ${role.id})`);
    }
    console.log("\n🎉 All role logins seeded.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Seed failed:", err.message);
    console.error(err);
    process.exit(1);
  }
})();