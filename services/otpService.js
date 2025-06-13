// OTP Service for generating and validating OTPs
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

class OTPService {
  constructor() {
    this.db = admin.firestore();
    this.setupEmailTransporter();
  }
  setupEmailTransporter() {
    // Configure your email service (Gmail example)
    this.transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER, // Your email
        pass: process.env.EMAIL_PASS, // Your app password
      },
    });
  }

  // Generate 6-digit OTP
  generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  // Store OTP in Firestore
  async storeOTP(email, otp) {
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await this.db.collection("otps").doc(email).set({
      otp,
      expiresAt,
      attempts: 0,
      createdAt: new Date(),
    });
  }

  // Send OTP via email
  async sendOTPEmail(email, otp) {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: "TurtleBot - Email Verification Code",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">TurtleBot Controller</h1>
          </div>
          
          <div style="background: #f8fafc; padding: 40px; border-radius: 0 0 10px 10px;">
            <h2 style="color: #1f2937; text-align: center; margin-bottom: 30px;">Email Verification</h2>
            
            <p style="color: #4b5563; font-size: 16px; line-height: 1.5; margin-bottom: 30px;">
              Hello! We received a login request for your TurtleBot account. Please use the verification code below to complete your login:
            </p>
            
            <div style="background: white; border: 2px solid #e5e7eb; border-radius: 10px; padding: 30px; text-align: center; margin: 30px 0;">
              <div style="font-size: 36px; font-weight: bold; color: #667eea; letter-spacing: 8px; font-family: 'Courier New', monospace;">
                ${otp}
              </div>
            </div>
            
            <p style="color: #6b7280; font-size: 14px; text-align: center; margin-top: 30px;">
              This code will expire in 10 minutes. If you didn't request this, please ignore this email.
            </p>
            
            <div style="border-top: 1px solid #e5e7eb; margin-top: 30px; padding-top: 20px; text-align: center;">
              <p style="color: #9ca3af; font-size: 12px; margin: 0;">
                TurtleBot Controller System - Secure Robot Control Platform
              </p>
            </div>
          </div>
        </div>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log(`OTP email sent successfully to ${email}`);
      return true;
    } catch (error) {
      console.error("Error sending OTP email:", error);
      throw new Error("Failed to send verification email");
    }
  }

  // Verify OTP
  async verifyOTP(email, providedOTP) {
    const otpDoc = await this.db.collection("otps").doc(email).get();

    if (!otpDoc.exists) {
      throw new Error("No OTP found for this email");
    }

    const otpData = otpDoc.data();
    const now = new Date();

    // Check if OTP has expired
    if (now > otpData.expiresAt.toDate()) {
      await this.db.collection("otps").doc(email).delete();
      throw new Error("OTP has expired");
    }

    // Check if too many attempts
    if (otpData.attempts >= 3) {
      await this.db.collection("otps").doc(email).delete();
      throw new Error("Too many invalid attempts. Please request a new OTP");
    }

    // Verify OTP
    if (otpData.otp === providedOTP) {
      // OTP is correct - delete it and mark user as verified
      await this.db.collection("otps").doc(email).delete();
      await this.markUserAsVerified(email);
      return true;
    } else {
      // Increment attempts
      await this.db
        .collection("otps")
        .doc(email)
        .update({
          attempts: admin.firestore.FieldValue.increment(1),
        });
      throw new Error("Invalid OTP");
    }
  }

  // Mark user as verified in Firestore
  async markUserAsVerified(email) {
    await this.db.collection("user_sessions").doc(email).set(
      {
        emailVerified: true,
        verifiedAt: new Date(),
        lastLogin: new Date(),
      },
      { merge: true }
    );
  }
  // Check if user's email is verified
  async isEmailVerified(email) {
    const sessionDoc = await this.db
      .collection("user_sessions")
      .doc(email)
      .get();
    return sessionDoc.exists && sessionDoc.data().emailVerified === true;
  }

  // Reset user's email verification status (called on logout)
  async resetEmailVerification(email) {
    try {
      await this.db.collection("user_sessions").doc(email).set(
        {
          emailVerified: false,
          verificationResetAt: new Date(),
          lastLogout: new Date(),
        },
        { merge: true }
      );
      console.log(`Email verification reset for user: ${email}`);
      return true;
    } catch (error) {
      console.error("Error resetting email verification:", error);
      throw new Error("Failed to reset email verification status");
    }
  }

  // Clean up expired OTPs (run this periodically)
  async cleanupExpiredOTPs() {
    const now = new Date();
    const snapshot = await this.db
      .collection("otps")
      .where("expiresAt", "<", now)
      .get();

    const batch = this.db.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    await batch.commit();
    console.log(`Cleaned up ${snapshot.size} expired OTPs`);
  }
}

module.exports = OTPService;
