// Google Authenticator Routes
const express = require("express");
const router = express.Router();
const GoogleAuthenticatorService = require("../services/googleAuthService");
const { verifyToken } = require("../admin");

const googleAuthService = new GoogleAuthenticatorService();

// Middleware to verify Firebase token
async function authenticateFirebaseUser(req, res, next) {
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
    return res.status(401).json({ error: "Invalid Firebase token" });
  }
}

// Setup Google Authenticator - Generate QR code
router.post("/setup", authenticateFirebaseUser, async (req, res) => {
  try {
    const email = req.user.email;

    // Check if user already has 2FA enabled
    const isEnabled = await googleAuthService.isTwoFactorEnabled(email);
    if (isEnabled) {
      return res.status(400).json({
        error: "Two-factor authentication is already enabled for this account",
      });
    }

    // Generate secret and QR code
    const secretData = await googleAuthService.generateSecret(email);
    const qrCodeDataURL = await googleAuthService.generateQRCode(
      secretData.otpauthUrl
    );

    res.json({
      success: true,
      message: "Scan this QR code with Google Authenticator app",
      qrCode: qrCodeDataURL,
      manualEntryKey: secretData.manualEntryKey,
      backupCodes: null, // Will be provided after verification
      instructions: {
        step1: "Install Google Authenticator app on your phone",
        step2: "Scan the QR code or manually enter the key",
        step3: "Enter the 6-digit code from the app to complete setup",
      },
    });
  } catch (error) {
    console.error("Error setting up Google Authenticator:", error);
    res.status(500).json({
      error: "Failed to setup Google Authenticator",
      details: error.message,
    });
  }
});

// Verify and enable Google Authenticator
router.post("/verify-setup", authenticateFirebaseUser, async (req, res) => {
  try {
    const email = req.user.email;
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: "TOTP token is required" });
    }

    // Verify token and enable 2FA
    await googleAuthService.verifyAndEnable(email, token);

    // Get backup codes
    const backupCodes = await googleAuthService.getBackupCodes(email);

    res.json({
      success: true,
      message: "Google Authenticator enabled successfully!",
      backupCodes: backupCodes,
      warning:
        "Save these backup codes in a secure place. They can be used to access your account if you lose your authenticator device.",
    });
  } catch (error) {
    console.error("Error verifying Google Authenticator setup:", error);
    res.status(400).json({
      error: "Failed to verify authenticator code",
      details: error.message,
    });
  }
});

// Verify TOTP for login/access
router.post("/verify", authenticateFirebaseUser, async (req, res) => {
  try {
    const email = req.user.email;
    const { token, backupCode } = req.body;

    if (!token && !backupCode) {
      return res.status(400).json({
        error: "Either TOTP token or backup code is required",
      });
    }

    let verified = false;
    let method = "";

    if (backupCode) {
      // Verify backup code
      await googleAuthService.verifyBackupCode(email, backupCode);
      verified = true;
      method = "backup_code";
    } else {
      // Verify TOTP token
      await googleAuthService.verifyTOTP(email, token);
      verified = true;
      method = "totp";
    }

    res.json({
      success: true,
      message: "Two-factor authentication verified successfully",
      method: method,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error verifying TOTP:", error);
    res.status(400).json({
      error: "Invalid authentication code",
      details: error.message,
    });
  }
});

// Check 2FA status
router.get("/status", authenticateFirebaseUser, async (req, res) => {
  try {
    const email = req.user.email;

    const isEnabled = await googleAuthService.isTwoFactorEnabled(email);
    const isVerified = await googleAuthService.isTwoFactorVerified(email);

    res.json({
      success: true,
      twoFactorEnabled: isEnabled,
      twoFactorVerified: isVerified,
      user: email,
    });
  } catch (error) {
    console.error("Error checking 2FA status:", error);
    res.status(500).json({
      error: "Failed to check two-factor authentication status",
      details: error.message,
    });
  }
});

// Disable 2FA
router.post("/disable", authenticateFirebaseUser, async (req, res) => {
  try {
    const email = req.user.email;
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        error: "TOTP token is required to disable two-factor authentication",
      });
    }

    await googleAuthService.disableTwoFactor(email, token);

    res.json({
      success: true,
      message: "Two-factor authentication disabled successfully",
    });
  } catch (error) {
    console.error("Error disabling 2FA:", error);
    res.status(400).json({
      error: "Failed to disable two-factor authentication",
      details: error.message,
    });
  }
});

// Get backup codes
router.get("/backup-codes", authenticateFirebaseUser, async (req, res) => {
  try {
    const email = req.user.email;

    const backupCodes = await googleAuthService.getBackupCodes(email);

    res.json({
      success: true,
      backupCodes: backupCodes,
      message: "Keep these codes secure. Each code can only be used once.",
    });
  } catch (error) {
    console.error("Error retrieving backup codes:", error);
    res.status(500).json({
      error: "Failed to retrieve backup codes",
      details: error.message,
    });
  }
});

// Regenerate backup codes
router.post(
  "/regenerate-backup-codes",
  authenticateFirebaseUser,
  async (req, res) => {
    try {
      const email = req.user.email;
      const { token } = req.body;

      if (!token) {
        return res.status(400).json({
          error: "TOTP token is required to regenerate backup codes",
        });
      }

      const newBackupCodes = await googleAuthService.regenerateBackupCodes(
        email,
        token
      );

      res.json({
        success: true,
        backupCodes: newBackupCodes,
        message: "New backup codes generated. Old codes are no longer valid.",
      });
    } catch (error) {
      console.error("Error regenerating backup codes:", error);
      res.status(400).json({
        error: "Failed to regenerate backup codes",
        details: error.message,
      });
    }
  }
);

module.exports = router;
