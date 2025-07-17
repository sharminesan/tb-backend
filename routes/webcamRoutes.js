const express = require("express");
const router = express.Router();
const NodeWebcam = require("node-webcam");
const fs = require("fs");
const path = require("path");
const { authenticateAndVerifyEmail } = require("../middleware/auth");

// Webcam configuration
const webcamOptions = {
  // Picture related options
  width: 640,
  height: 480,
  quality: 100,

  // Number of frames to capture
  frames: 1,

  // Delay in seconds to take shot
  delay: 0,

  // Save shots in memory
  saveShots: true,

  // [jpeg, png] support varies
  output: "jpeg",

  // Which camera to use
  // Use first camera by default
  device: false,

  // [location, buffer, base64]
  callbackReturn: "buffer",

  // Logging
  verbose: false,
};

// Create webcam instance
let webcam = null;
let isWebcamInitialized = false;
let webcamError = null;

// Initialize webcam
function initializeWebcam() {
  try {
    webcam = NodeWebcam.create(webcamOptions);
    isWebcamInitialized = true;
    webcamError = null;
    console.log("✅ Webcam initialized successfully");
  } catch (error) {
    console.error("❌ Failed to initialize webcam:", error.message);
    webcamError = error.message;
    isWebcamInitialized = false;
  }
}

// Initialize on module load
initializeWebcam();

// Webcam status endpoint
router.get("/status", authenticateAndVerifyEmail, (req, res) => {
  res.json({
    isInitialized: isWebcamInitialized,
    error: webcamError,
    options: webcamOptions,
    user: req.user.email,
    timestamp: Date.now(),
  });
});

// Capture single image from webcam
router.get("/capture", authenticateAndVerifyEmail, (req, res) => {
  if (!isWebcamInitialized) {
    return res.status(503).json({
      error: "Webcam not initialized",
      details: webcamError,
      user: req.user.email,
    });
  }

  console.log(`📸 Capturing image for user: ${req.user.email}`);

  webcam.capture("capture", (err, data) => {
    if (err) {
      console.error("❌ Webcam capture error:", err);
      return res.status(500).json({
        error: "Failed to capture image",
        details: err.message,
        user: req.user.email,
      });
    }

    // Set appropriate headers for image response
    res.set({
      "Content-Type": "image/jpeg",
      "Content-Length": data.length,
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });

    // Send the image buffer
    res.send(data);
    console.log(`✅ Image captured and sent to user: ${req.user.email}`);
  });
});

// Simple image stream endpoint (MJPEG-like)
router.get("/stream", async (req, res) => {
  // Handle authentication for stream (can be via header or query param)
  let user = null;
  try {
    // Try header-based auth first
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const idToken = authHeader.split("Bearer ")[1];
      const { verifyToken } = require("../admin");
      const decodedToken = await verifyToken(idToken);
      user = decodedToken;
    } else if (req.query.auth) {
      // Try query parameter auth for image streams
      const { verifyToken } = require("../admin");
      const decodedToken = await verifyToken(req.query.auth);
      user = decodedToken;
    }

    if (!user) {
      return res.status(401).json({
        error: "Authentication required",
        message: "Please provide Firebase Bearer token",
      });
    }

    // Check email verification
    const { authenticateAndVerifyEmail } = require("../middleware/auth");
    const OTPService = require("../services/otpService");
    const otpService = new OTPService();

    const isEmailVerified = await otpService.isEmailVerified(user.email);
    if (!isEmailVerified) {
      return res.status(403).json({
        error: "Email verification required",
        message: "Please verify your email with OTP first",
      });
    }
  } catch (authError) {
    return res.status(401).json({
      error: "Invalid authentication token",
      details: authError.message,
    });
  }

  if (!isWebcamInitialized) {
    return res.status(503).json({
      error: "Webcam not initialized",
      details: webcamError,
      user: user.email,
    });
  }

  console.log(`🎥 Starting webcam stream for user: ${user.email}`);

  // Set headers for multipart stream
  res.writeHead(200, {
    "Content-Type": "multipart/x-mixed-replace; boundary=myboundary",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    Connection: "keep-alive",
  });

  let streamInterval;
  let isStreaming = true;

  // Function to capture and send frame
  const sendFrame = () => {
    if (!isStreaming) return;

    webcam.capture("stream_frame", (err, data) => {
      if (err) {
        console.error("❌ Stream capture error:", err);
        return;
      }

      if (!isStreaming) return;

      try {
        // Write boundary and headers
        res.write(`--myboundary\r\n`);
        res.write(`Content-Type: image/jpeg\r\n`);
        res.write(`Content-Length: ${data.length}\r\n\r\n`);

        // Write image data
        res.write(data);
        res.write("\r\n");
      } catch (writeError) {
        console.error("❌ Error writing stream data:", writeError);
        isStreaming = false;
        clearInterval(streamInterval);
      }
    });
  };

  // Start streaming at ~10 FPS
  streamInterval = setInterval(sendFrame, 100);

  // Handle client disconnect
  req.on("close", () => {
    console.log(`🔌 Client disconnected from webcam stream: ${user.email}`);
    isStreaming = false;
    clearInterval(streamInterval);
  });

  req.on("end", () => {
    console.log(`🏁 Stream ended for user: ${user.email}`);
    isStreaming = false;
    clearInterval(streamInterval);
  });

  // Send initial frame
  sendFrame();
});

// Test webcam functionality
router.post("/test", authenticateAndVerifyEmail, (req, res) => {
  if (!isWebcamInitialized) {
    return res.status(503).json({
      error: "Webcam not initialized",
      details: webcamError,
      user: req.user.email,
    });
  }

  console.log(`🧪 Testing webcam for user: ${req.user.email}`);

  webcam.capture("test", (err, data) => {
    if (err) {
      console.error("❌ Webcam test failed:", err);
      return res.status(500).json({
        success: false,
        error: "Webcam test failed",
        details: err.message,
        user: req.user.email,
      });
    }

    res.json({
      success: true,
      message: "Webcam test successful",
      imageSize: data.length,
      user: req.user.email,
      timestamp: Date.now(),
    });
  });
});

// Reinitialize webcam
router.post("/reinitialize", authenticateAndVerifyEmail, (req, res) => {
  console.log(`🔄 Reinitializing webcam for user: ${req.user.email}`);

  initializeWebcam();

  res.json({
    success: isWebcamInitialized,
    error: webcamError,
    user: req.user.email,
    timestamp: Date.now(),
  });
});

// List available cameras (Windows-specific)
router.get("/devices", authenticateAndVerifyEmail, (req, res) => {
  console.log(`📋 Listing webcam devices for user: ${req.user.email}`);

  // For Windows, we can try to get device list using PowerShell
  const { exec } = require("child_process");

  exec(
    'powershell "Get-PnpDevice -Class Camera | Select-Object FriendlyName, Status"',
    (error, stdout, stderr) => {
      if (error) {
        console.error("❌ Failed to list cameras:", error);
        return res.status(500).json({
          error: "Failed to list camera devices",
          details: error.message,
          user: req.user.email,
        });
      }

      // Parse PowerShell output
      const devices = [];
      const lines = stdout.split("\n").filter((line) => line.trim());

      for (let i = 2; i < lines.length; i++) {
        // Skip header lines
        const line = lines[i].trim();
        if (line) {
          const parts = line.split(/\s{2,}/); // Split on multiple spaces
          if (parts.length >= 2) {
            devices.push({
              name: parts[0],
              status: parts[1],
            });
          }
        }
      }

      res.json({
        devices,
        user: req.user.email,
        timestamp: Date.now(),
      });
    }
  );
});

module.exports = router;
