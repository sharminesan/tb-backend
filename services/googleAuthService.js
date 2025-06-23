// Google Authenticator Service for TOTP (Time-based One-Time Password)
const admin = require("firebase-admin");
const speakeasy = require("speakeasy");
const qrcode = require("qrcode");

class GoogleAuthenticatorService {
  constructor() {
    this.db = admin.firestore();
  }

  // Generate a secret for a user and store it in Firestore
  async generateSecret(email, serviceName = "TurtleBot Controller") {
    try {
      // Generate a secret key for the user
      const secret = speakeasy.generateSecret({
        name: `${serviceName} (${email})`,
        issuer: serviceName,
        length: 32,
      });

      // Store the secret in Firestore
      await this.db.collection("user_totp_secrets").doc(email).set({
        secret: secret.base32,
        tempSecret: secret.base32, // Temporary until verified
        isEnabled: false,
        createdAt: new Date(),
        backupCodes: this.generateBackupCodes(),
      });

      return {
        secret: secret.base32,
        otpauthUrl: secret.otpauth_url,
        manualEntryKey: secret.base32,
      };
    } catch (error) {
      console.error("Error generating TOTP secret:", error);
      throw new Error("Failed to generate authenticator secret");
    }
  }

  // Generate QR code for the secret
  async generateQRCode(otpauthUrl) {
    try {
      const qrCodeDataURL = await qrcode.toDataURL(otpauthUrl);
      return qrCodeDataURL;
    } catch (error) {
      console.error("Error generating QR code:", error);
      throw new Error("Failed to generate QR code");
    }
  }

  // Verify TOTP token and enable 2FA
  async verifyAndEnable(email, token) {
    try {
      const userDoc = await this.db
        .collection("user_totp_secrets")
        .doc(email)
        .get();

      if (!userDoc.exists) {
        throw new Error("No authenticator setup found for this user");
      }

      const userData = userDoc.data();
      const secret = userData.tempSecret || userData.secret;

      // Verify the token
      const verified = speakeasy.totp.verify({
        secret: secret,
        encoding: "base32",
        token: token,
        window: 2, // Allow 2-step time window for clock drift
      });

      if (verified) {
        // Enable 2FA and move temp secret to permanent
        await this.db.collection("user_totp_secrets").doc(email).update({
          secret: secret,
          isEnabled: true,
          enabledAt: new Date(),
          tempSecret: admin.firestore.FieldValue.delete(),
        });

        // Also update user session to mark 2FA as enabled
        await this.db.collection("user_sessions").doc(email).set(
          {
            twoFactorEnabled: true,
            twoFactorVerified: true,
            lastTOTPVerification: new Date(),
          },
          { merge: true }
        );

        console.log(`Google Authenticator enabled for user: ${email}`);
        return true;
      } else {
        throw new Error("Invalid authenticator code");
      }
    } catch (error) {
      console.error("Error verifying TOTP:", error);
      throw error;
    }
  }

  // Verify TOTP token for login
  async verifyTOTP(email, token) {
    try {
      const userDoc = await this.db
        .collection("user_totp_secrets")
        .doc(email)
        .get();

      if (!userDoc.exists) {
        throw new Error("Two-factor authentication not set up for this user");
      }

      const userData = userDoc.data();

      if (!userData.isEnabled) {
        throw new Error("Two-factor authentication not enabled for this user");
      }

      // Verify the token
      const verified = speakeasy.totp.verify({
        secret: userData.secret,
        encoding: "base32",
        token: token,
        window: 2, // Allow 2-step time window for clock drift
      });

      if (verified) {
        // Update last verification time
        await this.db.collection("user_sessions").doc(email).set(
          {
            twoFactorVerified: true,
            lastTOTPVerification: new Date(),
          },
          { merge: true }
        );

        console.log(`TOTP verified for user: ${email}`);
        return true;
      } else {
        throw new Error("Invalid authenticator code");
      }
    } catch (error) {
      console.error("Error verifying TOTP:", error);
      throw error;
    }
  }

  // Check if user has 2FA enabled
  async isTwoFactorEnabled(email) {
    try {
      const userDoc = await this.db
        .collection("user_totp_secrets")
        .doc(email)
        .get();
      return userDoc.exists && userDoc.data().isEnabled === true;
    } catch (error) {
      console.error("Error checking 2FA status:", error);
      return false;
    }
  }

  // Check if user's 2FA is verified for current session
  async isTwoFactorVerified(email) {
    try {
      const sessionDoc = await this.db
        .collection("user_sessions")
        .doc(email)
        .get();
      if (!sessionDoc.exists) return false;

      const sessionData = sessionDoc.data();
      const now = new Date();
      const lastVerification = sessionData.lastTOTPVerification?.toDate();

      // Consider 2FA verified if done within last 24 hours
      const hoursSinceVerification = lastVerification
        ? (now - lastVerification) / (1000 * 60 * 60)
        : Infinity;

      return (
        sessionData.twoFactorVerified === true && hoursSinceVerification < 24
      );
    } catch (error) {
      console.error("Error checking 2FA verification status:", error);
      return false;
    }
  }

  // Disable 2FA for a user
  async disableTwoFactor(email, totpToken) {
    try {
      // First verify the current TOTP to ensure user has access
      await this.verifyTOTP(email, totpToken);

      // Remove TOTP secret
      await this.db.collection("user_totp_secrets").doc(email).delete();

      // Update user session
      await this.db.collection("user_sessions").doc(email).set(
        {
          twoFactorEnabled: false,
          twoFactorVerified: false,
          lastTOTPVerification: admin.firestore.FieldValue.delete(),
        },
        { merge: true }
      );

      console.log(`Two-factor authentication disabled for user: ${email}`);
      return true;
    } catch (error) {
      console.error("Error disabling 2FA:", error);
      throw error;
    }
  }

  // Generate backup codes for account recovery
  generateBackupCodes(count = 8) {
    const codes = [];
    for (let i = 0; i < count; i++) {
      // Generate 8-digit backup codes
      const code = Math.floor(10000000 + Math.random() * 90000000).toString();
      codes.push(code);
    }
    return codes;
  }

  // Verify backup code
  async verifyBackupCode(email, backupCode) {
    try {
      const userDoc = await this.db
        .collection("user_totp_secrets")
        .doc(email)
        .get();

      if (!userDoc.exists) {
        throw new Error("No authenticator setup found");
      }

      const userData = userDoc.data();
      const backupCodes = userData.backupCodes || [];

      if (backupCodes.includes(backupCode)) {
        // Remove used backup code
        const updatedCodes = backupCodes.filter((code) => code !== backupCode);

        await this.db.collection("user_totp_secrets").doc(email).update({
          backupCodes: updatedCodes,
        });

        // Mark as verified in session
        await this.db.collection("user_sessions").doc(email).set(
          {
            twoFactorVerified: true,
            lastTOTPVerification: new Date(),
            usedBackupCode: true,
          },
          { merge: true }
        );

        console.log(`Backup code used for user: ${email}`);
        return true;
      } else {
        throw new Error("Invalid backup code");
      }
    } catch (error) {
      console.error("Error verifying backup code:", error);
      throw error;
    }
  }

  // Reset 2FA verification status (called on logout)
  async resetTwoFactorVerification(email) {
    try {
      await this.db.collection("user_sessions").doc(email).set(
        {
          twoFactorVerified: false,
          lastTOTPVerification: admin.firestore.FieldValue.delete(),
        },
        { merge: true }
      );

      console.log(`Two-factor verification reset for user: ${email}`);
      return true;
    } catch (error) {
      console.error("Error resetting 2FA verification:", error);
      throw error;
    }
  }

  // Get user's backup codes
  async getBackupCodes(email) {
    try {
      const userDoc = await this.db
        .collection("user_totp_secrets")
        .doc(email)
        .get();

      if (!userDoc.exists) {
        throw new Error("No authenticator setup found");
      }

      return userDoc.data().backupCodes || [];
    } catch (error) {
      console.error("Error retrieving backup codes:", error);
      throw error;
    }
  }

  // Generate new backup codes
  async regenerateBackupCodes(email, totpToken) {
    try {
      // Verify current TOTP first
      await this.verifyTOTP(email, totpToken);

      const newBackupCodes = this.generateBackupCodes();

      await this.db.collection("user_totp_secrets").doc(email).update({
        backupCodes: newBackupCodes,
        backupCodesRegeneratedAt: new Date(),
      });

      console.log(`Backup codes regenerated for user: ${email}`);
      return newBackupCodes;
    } catch (error) {
      console.error("Error regenerating backup codes:", error);
      throw error;
    }
  }
}

module.exports = GoogleAuthenticatorService;
