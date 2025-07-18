const express = require("express");
const router = express.Router();
const NodeWebcam = require("node-webcam");

// Basic webcam configuration for debugging
const basicWebcamOptions = {
  width: 640,
  height: 480,
  quality: 75,
  frames: 1,
  delay: 0,
  saveShots: true, // Need to save shots for Windows
  output: "jpeg",
  device: false,
  callbackReturn: "location", // Use location instead of buffer for Windows
  verbose: true, // Enable verbose logging for debugging
};

// Global webcam instance
let webcam = null;

// Initialize webcam with error handling
function initBasicWebcam() {
  try {
    console.log("🔧 Initializing basic webcam...");
    webcam = NodeWebcam.create(basicWebcamOptions);
    console.log("✅ Basic webcam initialized successfully");
    return true;
  } catch (error) {
    console.error("❌ Failed to initialize basic webcam:", error);
    return false;
  }
}

// Initialize webcam on module load
const isInitialized = initBasicWebcam();

// Basic status endpoint (no auth for debugging)
router.get("/status", (req, res) => {
  console.log("📊 Basic webcam status requested");
  res.json({
    initialized: isInitialized,
    webcamExists: webcam !== null,
    options: basicWebcamOptions,
    timestamp: new Date().toISOString(),
  });
});

// Basic image capture endpoint (no auth for debugging)
router.get("/capture", (req, res) => {
  console.log("📸 Basic webcam capture requested");

  if (!webcam) {
    console.error("❌ Webcam not initialized");
    return res.status(503).json({
      error: "Webcam not initialized",
      timestamp: new Date().toISOString(),
    });
  }

  const timestamp = Date.now();
  const filename = `basic_capture_${timestamp}`;

  webcam.capture(filename, (err, data) => {
    if (err) {
      console.error("❌ Basic capture failed:", err);
      return res.status(500).json({
        error: "Capture failed",
        details: err.message,
        timestamp: new Date().toISOString(),
      });
    }

    console.log(`✅ Basic capture successful, file: ${data}`);

    // Read the file and send as response
    const fs = require("fs");
    fs.readFile(data, (readErr, imageBuffer) => {
      if (readErr) {
        console.error("❌ Failed to read captured image:", readErr);
        return res.status(500).json({
          error: "Failed to read captured image",
          details: readErr.message,
          timestamp: new Date().toISOString(),
        });
      }

      // Set headers for JPEG image
      res.set({
        "Content-Type": "image/jpeg",
        "Content-Length": imageBuffer.length,
        "Cache-Control": "no-cache",
      });

      res.send(imageBuffer);

      // Clean up the file
      fs.unlink(data, (unlinkErr) => {
        if (unlinkErr) {
          console.error("❌ Failed to delete temp file:", unlinkErr);
        }
      });
    });
  });
});

// Basic MJPEG stream endpoint (no auth for debugging)
router.get("/stream", (req, res) => {
  console.log("🎥 Basic webcam stream requested");

  if (!webcam) {
    console.error("❌ Webcam not initialized for streaming");
    return res.status(503).json({
      error: "Webcam not initialized",
      timestamp: new Date().toISOString(),
    });
  }

  // Set MJPEG stream headers
  res.writeHead(200, {
    "Content-Type": "multipart/x-mixed-replace; boundary=basicboundary",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    Connection: "keep-alive",
  });

  let streamActive = true;
  let frameCount = 0;
  const fs = require("fs");

  // Function to capture and send a frame
  const sendFrame = () => {
    if (!streamActive) return;

    const timestamp = Date.now();
    const filename = `basic_frame_${timestamp}_${frameCount}`;

    webcam.capture(filename, (err, data) => {
      if (err) {
        console.error("❌ Stream frame capture error:", err);
        return;
      }

      if (!streamActive) return;

      // Read the file and send it
      fs.readFile(data, (readErr, imageBuffer) => {
        if (readErr) {
          console.error("❌ Failed to read stream frame:", readErr);
          return;
        }

        if (!streamActive) return;

        try {
          // Write MJPEG boundary and headers
          res.write("--basicboundary\r\n");
          res.write("Content-Type: image/jpeg\r\n");
          res.write(`Content-Length: ${imageBuffer.length}\r\n\r\n`);

          // Write image data
          res.write(imageBuffer);
          res.write("\r\n");

          frameCount++;
          if (frameCount % 10 === 0) {
            console.log(`📊 Streamed ${frameCount} frames`);
          }

          // Clean up the file immediately after sending
          fs.unlink(data, (unlinkErr) => {
            if (unlinkErr) {
              console.error("❌ Failed to delete temp stream file:", unlinkErr);
            }
          });
        } catch (writeError) {
          console.error("❌ Error writing stream frame:", writeError);
          streamActive = false;
        }
      });
    });
  };

  // Start streaming at 2 FPS (500ms interval) for better reliability
  const streamInterval = setInterval(sendFrame, 500);

  // Handle client disconnect
  req.on("close", () => {
    console.log(
      `🔌 Basic stream client disconnected (${frameCount} frames sent)`
    );
    streamActive = false;
    clearInterval(streamInterval);
  });

  req.on("end", () => {
    console.log(`🏁 Basic stream ended (${frameCount} frames sent)`);
    streamActive = false;
    clearInterval(streamInterval);
  });

  // Send first frame after a short delay
  setTimeout(sendFrame, 100);
});

// Test endpoint to verify webcam is working
router.get("/test", (req, res) => {
  console.log("🧪 Basic webcam test requested");

  if (!webcam) {
    return res.status(503).json({
      success: false,
      error: "Webcam not initialized",
      timestamp: new Date().toISOString(),
    });
  }

  const timestamp = Date.now();
  const filename = `basic_test_${timestamp}`;

  webcam.capture(filename, (err, data) => {
    if (err) {
      console.error("❌ Basic test failed:", err);
      return res.status(500).json({
        success: false,
        error: "Test capture failed",
        details: err.message,
        timestamp: new Date().toISOString(),
      });
    }

    console.log(`✅ Basic test successful, file: ${data}`);

    // Check if file exists and get size
    const fs = require("fs");
    fs.stat(data, (statErr, stats) => {
      if (statErr) {
        console.error("❌ Failed to stat test file:", statErr);
        return res.status(500).json({
          success: false,
          error: "Failed to verify test file",
          details: statErr.message,
          timestamp: new Date().toISOString(),
        });
      }

      // Clean up the test file
      fs.unlink(data, (unlinkErr) => {
        if (unlinkErr) {
          console.error("❌ Failed to delete test file:", unlinkErr);
        }
      });

      res.json({
        success: true,
        message: "Basic webcam test passed",
        imageSize: stats.size,
        filePath: data,
        timestamp: new Date().toISOString(),
      });
    });
  });
});

// Debug endpoint to clean up any leftover files
router.post("/cleanup", (req, res) => {
  console.log("🧹 Cleanup requested");

  const fs = require("fs");
  const path = require("path");

  // Get all files in current directory that start with "basic_"
  fs.readdir(".", (err, files) => {
    if (err) {
      console.error("❌ Failed to read directory:", err);
      return res.status(500).json({
        success: false,
        error: "Failed to read directory",
        details: err.message,
        timestamp: new Date().toISOString(),
      });
    }

    const basicFiles = files.filter(
      (file) => file.startsWith("basic_") && file.endsWith(".jpg")
    );
    console.log(
      `🔍 Found ${basicFiles.length} basic files to clean up:`,
      basicFiles
    );

    let cleanedCount = 0;
    let errors = [];

    if (basicFiles.length === 0) {
      return res.json({
        success: true,
        message: "No files to clean up",
        cleanedCount: 0,
        timestamp: new Date().toISOString(),
      });
    }

    basicFiles.forEach((file) => {
      fs.unlink(file, (unlinkErr) => {
        if (unlinkErr) {
          console.error(`❌ Failed to delete ${file}:`, unlinkErr);
          errors.push(`${file}: ${unlinkErr.message}`);
        } else {
          cleanedCount++;
          console.log(`✅ Deleted ${file}`);
        }

        // Check if all files have been processed
        if (cleanedCount + errors.length === basicFiles.length) {
          res.json({
            success: errors.length === 0,
            message: `Cleanup completed: ${cleanedCount} files deleted`,
            cleanedCount,
            errors: errors.length > 0 ? errors : undefined,
            timestamp: new Date().toISOString(),
          });
        }
      });
    });
  });
});

module.exports = router;
