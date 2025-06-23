// Enhanced Authentication Middleware with Google Authenticator support
const admin = require("firebase-admin");
const OTPService = require("../services/otpService");
const GoogleAuthenticatorService = require("../services/googleAuthService");

const otpService = new OTPService();
const googleAuthService = new GoogleAuthenticatorService();

// Firebase token authentication middleware
const authenticateFirebaseToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ error: "No valid authorization token provided" });
    }

    const token = authHeader.split("Bearer ")[1];

    // Verify the Firebase token
    const decodedToken = await admin.auth().verifyIdToken(token);

    // Add user info to request
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified,
      role: decodedToken.role || "user",
    };

    next();
  } catch (error) {
    console.error("Token verification failed:", error);
    return res.status(401).json({
      error: "Invalid or expired token",
      details: error.message,
    });
  }
};

// OTP verification middleware - use this for routes that require email verification
const requireEmailVerification = async (req, res, next) => {
  try {
    const email = req.user.email;

    if (!email) {
      return res.status(401).json({ error: "No email found in token" });
    }

    // Check if email is verified via OTP
    const isVerified = await otpService.isEmailVerified(email);

    if (!isVerified) {
      return res.status(403).json({
        error: "Email verification required",
        message: "Please verify your email with OTP to access this resource",
        requiresOTP: true,
      });
    }

    next();
  } catch (error) {
    console.error("Email verification check failed:", error);
    return res.status(500).json({
      error: "Failed to verify email status",
      details: error.message,
    });
  }
};

// Google Authenticator (2FA) verification middleware
const requireTwoFactorAuth = async (req, res, next) => {
  try {
    const email = req.user.email;

    if (!email) {
      return res.status(401).json({ error: "No email found in token" });
    }

    // Check if user has 2FA enabled
    const has2FA = await googleAuthService.isTwoFactorEnabled(email);

    if (has2FA) {
      // Check if 2FA is verified for current session
      const is2FAVerified = await googleAuthService.isTwoFactorVerified(email);

      if (!is2FAVerified) {
        return res.status(403).json({
          error: "Two-factor authentication required",
          message:
            "Please verify your Google Authenticator code to access this resource",
          requires2FA: true,
          email: email,
        });
      }
    }

    // Add 2FA status to user object
    req.user.twoFactorEnabled = has2FA;
    req.user.twoFactorVerified = has2FA ? true : null;

    next();
  } catch (error) {
    console.error("Two-factor authentication check failed:", error);
    return res.status(500).json({
      error: "Failed to verify two-factor authentication status",
      details: error.message,
    });
  }
};

// Role-based authorization middleware
const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    const userRole = req.user.role;

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        error: "Insufficient permissions",
        requiredRoles: allowedRoles,
        userRole: userRole,
      });
    }

    next();
  };
};

// Combined middleware: Firebase auth + Email verification
const authenticateAndVerifyEmail = [
  authenticateFirebaseToken,
  requireEmailVerification,
];

// Enhanced middleware: Firebase auth + Email verification + 2FA
const authenticateAndVerifyAll = [
  authenticateFirebaseToken,
  requireEmailVerification,
  requireTwoFactorAuth,
];

module.exports = {
  authenticateFirebaseToken,
  requireEmailVerification,
  requireTwoFactorAuth,
  requireRole,
  authenticateAndVerifyEmail,
  authenticateAndVerifyAll,
  otpService,
  googleAuthService,
};
