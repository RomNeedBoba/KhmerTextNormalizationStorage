const jwt = require("jsonwebtoken");
const users = require("../config/users.config");

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

exports.login = async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "");

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required." });
  }

  const user = users.find((u) => normalizeEmail(u.email) === email);

  if (!user || user.password !== password) {
    return res.status(401).json({ message: "Invalid email or password." });
  }

  const payload = { email: user.email, role: user.role };

  const token = jwt.sign(payload, process.env.JWT_SECRET || "dev_secret_change_me", {
    expiresIn: "7d",
  });

  return res.json({
    ok: true,
    token,
    user: { email: user.email, role: user.role },
  });
};
