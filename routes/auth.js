const express = require("express");
const {
  setUserRole,
  getUserWithClaims,
  verifyToken,
  admin,
} = require("../admin");
const router = express.Router();

// Middleware to verify Firebase token
const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No token provided" });
    }

    const idToken = authHeader.split("Bearer ")[1];
    const decodedToken = await verifyToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid token" });
  }
};

// Middleware to check if user is admin
const requireAdmin = (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
};

// Add this to your backend routes/auth.js
router.post(
  "/promote-user",
  authenticateUser,
  requireAdmin,
  async (req, res) => {
    console.log("PROMOTE USER");
    try {
      const { email, role } = req.body;

      // Find user by email
      const user = await admin.auth().getUserByEmail(email);

      const validRoles = ["admin", "user", "moderator"];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: "Invalid role" });
      }

      const result = await setUserRole(user.uid, role);
      res.json({ success: true, message: `User ${email} promoted to ${role}` });
    } catch (error) {
      console.error("Error promoting user:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// For first-time setup (modify your assign-role endpoint)
router.post("/assign-role", async (req, res) => {
  try {
    console.log("ASSIGN ROLE");
    const { uid, role, override } = req.body;

    const validRoles = ["admin", "user", "moderator"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    // Allow override for first admin setup
    let assignedRole = role;
    if (!override && (role === "admin" || role === "moderator")) {
      assignedRole = "user"; // Default to user for security
    }

    const result = await setUserRole(uid, assignedRole);
    res.json(result);
  } catch (error) {
    console.error("Error in assign-role:", error);
    res.status(500).json({ error: error.message });
  }
});

// Update user role (admin only)
router.post(
  "/update-role",
  authenticateUser,
  requireAdmin,
  async (req, res) => {
    try {
      const { uid, role } = req.body;

      const validRoles = ["admin", "user", "moderator"];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: "Invalid role" });
      }

      const result = await setUserRole(uid, role);
      res.json(result);
    } catch (error) {
      console.error("Error in update-role:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Get user info with roles (protected)
router.get("/user/:uid", authenticateUser, async (req, res) => {
  try {
    const { uid } = req.params;

    // Users can only get their own info unless they're admin
    if (req.user.uid !== uid && req.user.role !== "admin") {
      return res.status(403).json({ error: "Access denied" });
    }

    const userInfo = await getUserWithClaims(uid);
    res.json(userInfo);
  } catch (error) {
    console.error("Error getting user info:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get all users (admin only)
router.get("/users", authenticateUser, requireAdmin, async (req, res) => {
  try {
    const listUsers = await admin.auth().listUsers();
    const users = listUsers.users.map((user) => ({
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      role: user.customClaims?.role || "user",
      disabled: user.disabled,
      emailVerified: user.emailVerified,
    }));

    res.json({ users });
  } catch (error) {
    console.error("Error listing users:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
