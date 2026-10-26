const { Op } = require("sequelize");

// Deleting a user is a soft delete (is_deleted = true) — the row stays in the
// table for audit / created_by history. But users.username, users.email and
// users.phone carry DATABASE-level unique indexes, so that deleted row keeps
// "owning" those values and re-creating the same person failed with a bare
// "Validation error" (a unique-constraint violation).
//
// Call this right before creating or updating a user: any SOFT-DELETED user
// still holding one of the given username / email / phone values is renamed so
// the values are free again. Live users are never touched, and the deleted
// row stays recognisable (e.g. "ajay~del12", "del12~ajay@ricemill.com").
// employee_code is not touched: new codes are always generated from the
// highest existing id, so they cannot collide.
const releaseDeletedUserIdentifiers = async ({ username, email, phone } = {}, { exceptId = null, transaction } = {}) => {
  const { User } = require("../models");
  const matches = [];
  if (username) matches.push({ username });
  if (email) matches.push({ email });
  if (phone) matches.push({ phone });
  if (!matches.length) return 0;

  const where = { is_deleted: true, [Op.or]: matches };
  if (exceptId) where.id = { [Op.ne]: exceptId };

  const stale = await User.findAll({ where, transaction });
  for (const u of stale) {
    const tag = `~del${u.id}`;
    await u.update(
      {
        username: `${String(u.username).slice(0, 50 - tag.length)}${tag}`,
        email: `del${u.id}~${u.email}`.slice(0, 100),
        phone: null,
      },
      { validate: false, transaction }
    );
  }
  return stale.length;
};

// Turns a unique-constraint failure into a clear 409 instead of the generic
// "Validation error" (only for the race where a LIVE user took the value).
const uniqueUserError = (err, createError) => {
  if (err && err.name === "SequelizeUniqueConstraintError") {
    const fields = (err.errors || []).map((e) => e.path).filter(Boolean);
    const what = fields.length ? fields.join(" / ") : "username, email or phone";
    return createError(409, `A user with this ${what} already exists`);
  }
  return err;
};

module.exports = { releaseDeletedUserIdentifiers, uniqueUserError };
