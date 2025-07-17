const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const { spawn, exec } = require("child_process");
// Camera state
let cameraProcess = null;
let isStreaming = false;

// Check if camera is available
router.get("/status", async (req, res) => {
  try {
    // First check if FFmpeg is available
    const ffmpegAvailable = await checkFFmpegAvailability();
    if (!ffmpegAvailable) {
      return res.json({
        available: false,
        status: "ffmpeg_missing",
        resolution: "N/A",
        fps: "N/A",
        message:
          "FFmpeg is not installed or not accessible. Please install FFmpeg to use camera features.",
        installation_help: {
          windows:
            "Install using: choco install ffmpeg OR download from https://ffmpeg.org/download.html",
          macos: "Install using: brew install ffmpeg",
          linux: "Install using: sudo apt install ffmpeg",
        },
      });
    }

    // Check for available cameras and get device list
    const devices = await detectCameraDevices();
    const available = devices.length > 0;

    res.json({
      available: available,
      status: available ? "ready" : "no_devices",
      resolution: "640x480",
      fps: 15,
      ffmpeg_available: true,
      platform: process.platform,
      detected_devices: devices,
      device_count: devices.length,
      message: available
        ? `Found ${devices.length} camera device(s). Ready for streaming.`
        : "FFmpeg is available but no camera devices detected.",
      active_device: available ? devices[0] : null,
      streaming: isStreaming,
    });
  } catch (error) {
    res.json({
      available: false,
      error: error.message,
      message: "Camera status check failed",
    });
  }
});

// Camera stream using MJPEG server
router.get("/stream", async (req, res) => {
  try {
    console.log("Camera stream requested");

    // Check if FFmpeg is available first
    const ffmpegAvailable = await checkFFmpegAvailability();
    if (!ffmpegAvailable) {
      return res.status(503).json({
        error: "FFmpeg not available",
        message:
          "FFmpeg is required for camera streaming. Please install FFmpeg and try again.",
        installation_help: {
          windows:
            "choco install ffmpeg OR download from https://ffmpeg.org/download.html",
          macos: "brew install ffmpeg",
          linux: "sudo apt install ffmpeg",
        },
      });
    }

    // Check for camera devices before setting up streaming
    const devices = await detectCameraDevices();
    if (devices.length === 0) {
      return res.status(404).json({
        error: "No cameras found",
        message: "No camera devices detected on this system",
        platform: process.platform,
        suggestion: "Make sure a camera is connected and accessible",
      });
    }

    // Start camera streaming with MJPEG server
    await startMjpegStream(res, devices[0]);
  } catch (error) {
    console.error("Camera stream error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Failed to start camera stream",
        message: error.message,
        details: "Check server logs for more information",
      });
    }
  }
});

// Take snapshot using FFmpeg
router.post("/snapshot", async (req, res) => {
  try {
    console.log("Snapshot requested");

    // Check if FFmpeg is available
    const ffmpegAvailable = await checkFFmpegAvailability();
    if (!ffmpegAvailable) {
      return res.status(503).json({
        error: "FFmpeg not available",
        message:
          "FFmpeg is required for camera snapshots. Please install FFmpeg and try again.",
        installation_help: {
          windows:
            "choco install ffmpeg OR download from https://ffmpeg.org/download.html",
          macos: "brew install ffmpeg",
          linux: "sudo apt install ffmpeg",
        },
      });
    }

    const snapshotPath = path.join(
      __dirname,
      "../temp",
      `snapshot-${Date.now()}.jpg`
    );

    // Ensure temp directory exists
    const tempDir = path.dirname(snapshotPath);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Capture snapshot using FFmpeg
    await captureSnapshot(snapshotPath);

    // Send the captured image
    res.set({
      "Content-Type": "image/jpeg",
      "Content-Disposition": 'attachment; filename="snapshot.jpg"',
    });

    const imageBuffer = fs.readFileSync(snapshotPath);
    res.send(imageBuffer);

    // Clean up temporary file
    fs.unlinkSync(snapshotPath);
  } catch (error) {
    console.error("Snapshot error:", error);
    res
      .status(500)
      .json({ error: "Failed to capture snapshot", details: error.message });
  }
});

// Windows camera troubleshooting endpoint
router.get("/windows-troubleshoot", async (req, res) => {
  if (process.platform !== "win32") {
    return res.json({
      platform: process.platform,
      message: "This endpoint is only available on Windows",
    });
  }

  try {
    console.log("Windows camera troubleshooting requested");

    // Check FFmpeg availability
    const ffmpegAvailable = await checkFFmpegAvailability();

    // Get device list
    const devices = await detectCameraDevices();

    // Test different device access methods
    const testResults = [];

    if (devices.length > 0) {
      const device = devices[0];
      const cameraName = typeof device === "string" ? device : device.name;
      const alternativeName =
        typeof device === "object" ? device.alternativeName : null;

      // Test 1: Friendly name
      testResults.push({
        test: "Friendly Name",
        command: `ffmpeg -f dshow -i video="${cameraName}" -vframes 1 -f null -`,
        device: cameraName,
      });

      // Test 2: Alternative name (if available)
      if (alternativeName) {
        testResults.push({
          test: "Alternative Name",
          command: `ffmpeg -f dshow -i video="${alternativeName}" -vframes 1 -f null -`,
          device: alternativeName,
        });
      }

      // Test 3: Default device
      testResults.push({
        test: "Default Device",
        command: "ffmpeg -f dshow -i video=0 -vframes 1 -f null -",
        device: "video=0",
      });
    }

    res.json({
      platform: "Windows",
      ffmpeg_available: ffmpegAvailable,
      detected_devices: devices,
      device_count: devices.length,
      test_commands: testResults,
      troubleshooting_steps: [
        "1. Make sure your camera is not being used by another application",
        "2. Check Windows Privacy Settings > Camera > Allow apps to access your camera",
        "3. Try running the application as Administrator",
        "4. Check Device Manager for camera driver issues",
        "5. Try the test commands above in Command Prompt to see which works",
        "6. If using a USB camera, try unplugging and reconnecting it",
      ],
      common_issues: [
        "Camera in use by another application",
        "Windows privacy settings blocking access",
        "Insufficient permissions",
        "Driver issues",
        "USB camera not properly connected",
      ],
    });
  } catch (error) {
    res.status(500).json({
      error: "Troubleshooting failed",
      message: error.message,
    });
  }
});

// Test FFmpeg endpoint
router.get("/test-ffmpeg", async (req, res) => {
  try {
    const ffmpegAvailable = await checkFFmpegAvailability();

    if (ffmpegAvailable) {
      res.json({
        status: "success",
        message: "FFmpeg is available and working",
        platform: process.platform,
      });
    } else {
      res.status(503).json({
        status: "error",
        message: "FFmpeg is not available",
        platform: process.platform,
      });
    }
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
});

// FFmpeg installation help endpoint
router.get("/install-help", (req, res) => {
  const platform = process.platform;
  let instructions = {};

  if (platform === "win32") {
    instructions = {
      platform: "Windows",
      methods: [
        {
          name: "Chocolatey (Recommended)",
          command: "choco install ffmpeg",
          prerequisite:
            "Install Chocolatey first: https://chocolatey.org/install",
        },
        {
          name: "Scoop",
          command: "scoop install ffmpeg",
          prerequisite: "Install Scoop first: https://scoop.sh/",
        },
        {
          name: "Direct Download",
          steps: [
            "1. Go to https://ffmpeg.org/download.html",
            '2. Click on "Windows" and download a build',
            "3. Extract the zip file",
            "4. Add the bin folder to your PATH environment variable",
            "5. Restart your terminal/IDE",
          ],
        },
      ],
      verification: "Open a new command prompt and run: ffmpeg -version",
    };
  } else if (platform === "darwin") {
    instructions = {
      platform: "macOS",
      methods: [
        {
          name: "Homebrew (Recommended)",
          command: "brew install ffmpeg",
          prerequisite: "Install Homebrew first: https://brew.sh/",
        },
        {
          name: "MacPorts",
          command: "sudo port install ffmpeg",
          prerequisite: "Install MacPorts first: https://www.macports.org/",
        },
      ],
      verification: "Open Terminal and run: ffmpeg -version",
    };
  } else {
    instructions = {
      platform: "Linux",
      methods: [
        {
          name: "Ubuntu/Debian",
          command: "sudo apt update && sudo apt install ffmpeg",
        },
        {
          name: "CentOS/RHEL/Fedora",
          command: "sudo dnf install ffmpeg",
        },
        {
          name: "Arch Linux",
          command: "sudo pacman -S ffmpeg",
        },
      ],
      verification: "Open terminal and run: ffmpeg -version",
    };
  }

  res.json({
    message: "FFmpeg Installation Instructions",
    current_platform: platform,
    ...instructions,
    troubleshooting: [
      "Make sure to restart your terminal/command prompt after installation",
      "Verify FFmpeg is in your PATH by running: ffmpeg -version",
      'If you get "command not found", check your PATH environment variable',
    ],
  });
});

// Start MJPEG stream using mjpeg-server
async function startMjpegStream(res, device) {
  try {
    // Stop any existing stream
    stopCameraStream();

    // Create FFmpeg command based on platform
    let ffmpegCommand;
    const cameraName = typeof device === "string" ? device : device.name;

    if (process.platform === "win32") {
      // Windows - use DirectShow with fallback options
      ffmpegCommand = [
        "-f",
        "dshow",
        "-i",
        `video="${cameraName}"`,
        "-f",
        "mjpeg",
        "-vf",
        "scale=640:480",
        "-r",
        "15",
        "-q:v",
        "8",
        "-bufsize",
        "1M",
        "pipe:1",
      ];
    } else if (process.platform === "darwin") {
      // macOS - use AVFoundation
      const cameraIndex = device?.index || "0";
      ffmpegCommand = [
        "-f",
        "avfoundation",
        "-i",
        cameraIndex,
        "-f",
        "mjpeg",
        "-vf",
        "scale=640:480",
        "-r",
        "15",
        "-q:v",
        "8",
        "pipe:1",
      ];
    } else {
      // Linux - use Video4Linux
      const cameraDevice = device || "/dev/video0";
      ffmpegCommand = [
        "-f",
        "v4l2",
        "-i",
        cameraDevice,
        "-f",
        "mjpeg",
        "-vf",
        "scale=640:480",
        "-r",
        "15",
        "-q:v",
        "8",
        "pipe:1",
      ];
    }

    console.log(
      "Starting FFmpeg with command:",
      "ffmpeg",
      ffmpegCommand.join(" ")
    );

    // Start FFmpeg process
    cameraProcess = spawn("ffmpeg", ffmpegCommand);

    // Handle FFmpeg errors
    cameraProcess.stderr.on("data", (data) => {
      console.error(`FFmpeg stderr: ${data}`);
    });

    cameraProcess.on("close", (code) => {
      console.log(`FFmpeg process exited with code ${code}`);
      isStreaming = false;
    });

    cameraProcess.on("error", (error) => {
      console.error("FFmpeg error:", error);
      isStreaming = false;
    });

    // Set response headers for MJPEG stream
    res.writeHead(200, {
      "Content-Type": "multipart/x-mixed-replace; boundary=frame",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      Pragma: "no-cache",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });

    // Handle FFmpeg stdout data and format as MJPEG
    cameraProcess.stdout.on("data", (chunk) => {
      if (!res.destroyed) {
        try {
          res.write("--frame\r\n");
          res.write("Content-Type: image/jpeg\r\n");
          res.write(`Content-Length: ${chunk.length}\r\n\r\n`);
          res.write(chunk);
          res.write("\r\n");
        } catch (error) {
          console.error("Stream write error:", error);
          stopCameraStream();
        }
      }
    });

    // Handle client disconnect
    res.on("close", () => {
      console.log("Client disconnected from camera stream");
      stopCameraStream();
    });

    // Handle response finish
    res.on("finish", () => {
      console.log("Response finished, stopping camera stream");
      stopCameraStream();
    });

    isStreaming = true;
    console.log("MJPEG stream started successfully");
  } catch (error) {
    console.error("Failed to start MJPEG stream:", error);
    throw error;
  }
}

// Stop camera streaming
function stopCameraStream() {
  if (cameraProcess) {
    cameraProcess.kill("SIGTERM");
    cameraProcess = null;
  }
  isStreaming = false;
}

// Capture a snapshot using FFmpeg
async function captureSnapshot(outputPath) {
  return new Promise(async (resolve, reject) => {
    try {
      // Get available camera devices
      const devices = await detectCameraDevices();
      if (devices.length === 0) {
        reject(new Error("No camera devices found"));
        return;
      }

      let ffmpegCommand;
      const device = devices[0];
      const cameraName = typeof device === "string" ? device : device.name;

      if (process.platform === "win32") {
        ffmpegCommand = [
          "-f",
          "dshow",
          "-i",
          `video="${cameraName}"`,
          "-vframes",
          "1",
          "-vf",
          "scale=640:480",
          "-y",
          outputPath,
        ];
      } else if (process.platform === "darwin") {
        const cameraIndex = device?.index || "0";
        ffmpegCommand = [
          "-f",
          "avfoundation",
          "-i",
          cameraIndex,
          "-vframes",
          "1",
          "-vf",
          "scale=640:480",
          "-y",
          outputPath,
        ];
      } else {
        const cameraDevice = device || "/dev/video0";
        ffmpegCommand = [
          "-f",
          "v4l2",
          "-i",
          cameraDevice,
          "-vframes",
          "1",
          "-vf",
          "scale=640:480",
          "-y",
          outputPath,
        ];
      }

      console.log(
        "Capturing snapshot with command:",
        "ffmpeg",
        ffmpegCommand.join(" ")
      );
      const ffmpeg = spawn("ffmpeg", ffmpegCommand);

      ffmpeg.stderr.on("data", (data) => {
        console.log(`FFmpeg snapshot stderr: ${data}`);
      });

      ffmpeg.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg snapshot failed with code ${code}`));
        }
      });

      ffmpeg.on("error", (error) => {
        reject(error);
      });
    } catch (error) {
      reject(error);
    }
  });
}

// Check if FFmpeg is available
function checkFFmpegAvailability() {
  return new Promise((resolve) => {
    exec("ffmpeg -version", { timeout: 5000 }, (error) => {
      if (error) {
        console.log("FFmpeg not available");
        resolve(false);
      } else {
        console.log("FFmpeg is available");
        resolve(true);
      }
    });
  });
}

// Detect camera devices
function detectCameraDevices() {
  return new Promise((resolve, reject) => {
    if (process.platform === "win32") {
      // Windows - list DirectShow devices with timeout
      const ffmpegCommand = [
        "ffmpeg",
        "-list_devices",
        "true",
        "-f",
        "dshow",
        "-i",
        "dummy",
      ];
      const child = exec(
        ffmpegCommand.join(" "),
        { timeout: 10000 },
        (error, stdout, stderr) => {
          const devices = [];
          if (stderr) {
            // Parse stderr for device list (FFmpeg outputs device list to stderr)
            const lines = stderr.split("\n");
            let currentDevice = null;

            for (const line of lines) {
              // Look for lines that contain [dshow @] and (video) to identify video devices
              if (line.includes("[dshow @") && line.includes("(video)")) {
                const match = line.match(/"([^"]+)"/);
                if (match && match[1] !== "dummy") {
                  currentDevice = {
                    name: match[1],
                    alternativeName: null,
                  };
                  console.log(`Found Windows camera device: ${match[1]}`);
                }
              }
              // Look for alternative name on the next line
              else if (
                currentDevice &&
                line.includes("Alternative name") &&
                line.includes("@device_")
              ) {
                const altMatch = line.match(/"([^"]+)"/);
                if (altMatch) {
                  currentDevice.alternativeName = altMatch[1];
                  console.log(`  Alternative name: ${altMatch[1]}`);
                }
                devices.push(currentDevice);
                currentDevice = null;
              }
              // If we found a device but no alternative name on next line, still add it
              else if (
                currentDevice &&
                !line.includes("Alternative name") &&
                line.trim() !== ""
              ) {
                devices.push(currentDevice);
                currentDevice = null;
              }
            }

            // Add any remaining device that didn't have an alternative name
            if (currentDevice) {
              devices.push(currentDevice);
            }
          }

          console.log(
            `Detected ${devices.length} Windows camera devices:`,
            devices
          );
          resolve(devices);
        }
      );

      // Handle timeout
      child.on("error", (error) => {
        if (error.code === "ENOENT") {
          console.error("FFmpeg not found during device detection");
        } else {
          console.error("Device detection error:", error);
        }
        resolve([]);
      });
    } else if (process.platform === "darwin") {
      // macOS - list AVFoundation devices with timeout
      const ffmpegCommand = [
        "ffmpeg",
        "-f",
        "avfoundation",
        "-list_devices",
        "true",
        "-i",
        '""',
      ];
      const child = exec(
        ffmpegCommand.join(" "),
        { timeout: 10000 },
        (error, stdout, stderr) => {
          const devices = [];
          if (stderr) {
            const lines = stderr.split("\n");
            for (const line of lines) {
              if (line.includes("[AVFoundation") && line.includes("] [")) {
                const match = line.match(/\[(\d+)\] (.+)/);
                if (match) {
                  devices.push({
                    index: match[1],
                    name: match[2].trim(),
                  });
                }
              }
            }
          }

          console.log(
            `Detected ${devices.length} macOS camera devices:`,
            devices
          );
          resolve(devices);
        }
      );

      child.on("error", (error) => {
        console.error("macOS device detection error:", error);
        resolve([]);
      });
    } else {
      // Linux - list v4l2 devices with timeout
      exec(
        "ls /dev/video* 2>/dev/null",
        { timeout: 5000 },
        (error, stdout, stderr) => {
          if (error) {
            console.log("No video devices found on Linux");
            resolve([]);
          } else {
            const devices = stdout
              .trim()
              .split("\n")
              .filter((device) => device && device.includes("/dev/video"));
            console.log(
              `Detected ${devices.length} Linux camera devices:`,
              devices
            );
            resolve(devices);
          }
        }
      );
    }
  });
}

// Cleanup on exit
process.on("exit", stopCameraStream);
process.on("SIGINT", stopCameraStream);
process.on("SIGTERM", stopCameraStream);

module.exports = router;
