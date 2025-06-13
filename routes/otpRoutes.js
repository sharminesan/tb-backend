// OTP Routes for handling OTP verification
const express = require("express");
const router = express.Router();
const OTPService = require("../services/otpService");
const { authenticateFirebaseToken } = require("../middleware/auth");

const otpService = new OTPService();

// Send OTP endpoint
router.post("/send-otp", authenticateFirebaseToken, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Verify that the authenticated user matches the email
    if (req.user.email !== email) {
      return res.status(403).json({ error: "Unauthorized: Email mismatch" });
    }

    // Generate and store OTP
    const otp = otpService.generateOTP();
    await otpService.storeOTP(email, otp);

    // Send OTP via email
    await otpService.sendOTPEmail(email, otp);

    res.json({
      success: true,
      message: "OTP sent successfully",
      email: email,
    });
  } catch (error) {
    console.error("Error sending OTP:", error);
    res.status(500).json({
      error: "Failed to send OTP",
      details: error.message,
    });
  }
});

// Verify OTP endpoint
router.post("/verify-otp", authenticateFirebaseToken, async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: "Email and OTP are required" });
    }

    // Verify that the authenticated user matches the email
    if (req.user.email !== email) {
      return res.status(403).json({ error: "Unauthorized: Email mismatch" });
    }

    // Verify OTP
    await otpService.verifyOTP(email, otp);

    res.json({
      success: true,
      message: "Email verified successfully",
      email: email,
    });
  } catch (error) {
    console.error("Error verifying OTP:", error);

    // Return specific error messages for different cases
    if (error.message.includes("expired")) {
      res
        .status(400)
        .json({ error: "OTP has expired. Please request a new one." });
    } else if (error.message.includes("Invalid OTP")) {
      res.status(400).json({ error: "Invalid OTP. Please try again." });
    } else if (error.message.includes("Too many invalid attempts")) {
      res.status(400).json({
        error: "Too many invalid attempts. Please request a new OTP.",
      });
    } else if (error.message.includes("No OTP found")) {
      res
        .status(400)
        .json({ error: "No OTP found. Please request a new one." });
    } else {
      res.status(500).json({
        error: "Failed to verify OTP",
        details: error.message,
      });
    }
  }
});

// Check verification status endpoint
router.get(
  "/verification-status",
  authenticateFirebaseToken,
  async (req, res) => {
    try {
      const email = req.user.email;
      const isVerified = await otpService.isEmailVerified(email);

      res.json({
        email: email,
        emailVerified: isVerified,
      });
    } catch (error) {
      console.error("Error checking verification status:", error);
      res.status(500).json({
        error: "Failed to check verification status",
        details: error.message,
      });
    }
  }
);

// Resend OTP endpoint (same as send-otp but with rate limiting)
router.post("/resend-otp", authenticateFirebaseToken, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Verify that the authenticated user matches the email
    if (req.user.email !== email) {
      return res.status(403).json({ error: "Unauthorized: Email mismatch" });
    }

    // Check if there's an existing OTP that's still valid (rate limiting)
    const admin = require("firebase-admin");
    const db = admin.firestore();
    const existingOTP = await db.collection("otps").doc(email).get();

    if (existingOTP.exists) {
      const otpData = existingOTP.data();
      const timeSinceCreated =
        Date.now() - otpData.createdAt.toDate().getTime();

      // Don't allow resend within 1 minute
      if (timeSinceCreated < 60000) {
        return res.status(429).json({
          error: "Please wait before requesting another OTP",
          waitTime: Math.ceil((60000 - timeSinceCreated) / 1000),
        });
      }
    }

    // Generate and store new OTP
    const otp = otpService.generateOTP();
    await otpService.storeOTP(email, otp);

    // Send OTP via email
    await otpService.sendOTPEmail(email, otp);

    res.json({
      success: true,
      message: "OTP resent successfully",
      email: email,
    });
  } catch (error) {
    console.error("Error resending OTP:", error);
    res.status(500).json({
      error: "Failed to resend OTP",
      details: error.message,
    });
  }
});

module.exports = router;
