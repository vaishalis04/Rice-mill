// Consistent API response shape helper.
// TODO: wire this into controllers instead of inline res.json(...) calls.

const success = (res, data = null, msg = "Success", status = 200) =>
  res.status(status).json({ success: true, msg, data });

const failure = (res, msg = "Something went wrong", status = 500) =>
  res.status(status).json({ success: false, msg });

module.exports = { success, failure };
