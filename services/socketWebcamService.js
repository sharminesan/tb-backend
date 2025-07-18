const NodeWebcam = require("node-webcam");
const fs = require("fs");
const path = require("path");

class SocketWebcamService {
  constructor(io) {
    this.io = io;
    this.webcam = null;
    this.streamingClients = new Map(); // Map to track streaming clients
    this.isInitialized = false;
    this.streamInterval = null;
    this.frameRate = 30; // Target FPS - Default to 30 FPS for smooth streaming
    this.actualFrameRate = 30; // Actual achieved FPS
    this.lastCaptureTime = 0;
    this.performanceHistory = [];

    // Webcam configuration optimized for Socket.IO streaming
    this.webcamOptions = {
      width: 320, // Reduced resolution for faster capture
      height: 240,
      quality: 60, // Lower quality for faster streaming
      frames: 1,
      delay: 0,
      saveShots: true,
      output: "jpeg",
      device: false,
      callbackReturn: "location",
      verbose: false, // Disable verbose for cleaner logs
    };

    this.initializeWebcam();
    this.setupSocketHandlers();
  }

  initializeWebcam() {
    try {
      console.log("🔧 Initializing Socket.IO webcam service...");
      this.webcam = NodeWebcam.create(this.webcamOptions);
      this.isInitialized = true;
      console.log("✅ Socket.IO webcam service initialized successfully");
    } catch (error) {
      console.error("❌ Failed to initialize Socket.IO webcam:", error);
      this.isInitialized = false;
    }
  }

  setupSocketHandlers() {
    this.io.on("connection", (socket) => {
      console.log(`📱 Client connected to webcam service: ${socket.id}`);

      // Handle webcam stream start
      socket.on("start_webcam_stream", (data) => {
        console.log(`🎥 Starting webcam stream for client: ${socket.id}`);
        this.addStreamingClient(socket);
      });

      // Handle webcam stream stop
      socket.on("stop_webcam_stream", () => {
        console.log(`⏹️ Stopping webcam stream for client: ${socket.id}`);
        this.removeStreamingClient(socket);
      });

      // Handle single capture request
      socket.on("capture_webcam_image", () => {
        console.log(`📸 Single capture requested by client: ${socket.id}`);
        this.captureImageForClient(socket);
      });

      // Handle webcam test
      socket.on("test_webcam", () => {
        console.log(`🧪 Webcam test requested by client: ${socket.id}`);
        this.testWebcamForClient(socket);
      });

      // Handle frame rate change
      socket.on("change_frame_rate", (data) => {
        console.log(
          `🎯 Frame rate change requested by client: ${socket.id} to ${data.fps} FPS`
        );
        this.setFrameRate(data.fps);
        socket.emit("frame_rate_changed", {
          frameRate: this.frameRate,
          message: `Frame rate changed to ${this.frameRate} FPS`,
          timestamp: new Date().toISOString(),
        });
      });

      // Handle disconnect
      socket.on("disconnect", () => {
        console.log(`🔌 Client disconnected from webcam service: ${socket.id}`);
        this.removeStreamingClient(socket);
      });
    });
  }

  addStreamingClient(socket) {
    if (!this.isInitialized) {
      socket.emit("webcam_error", {
        error: "Webcam not initialized",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    this.streamingClients.set(socket.id, {
      socket: socket,
      lastFrame: 0,
      frameCount: 0,
    });

    // Start streaming if this is the first client
    if (this.streamingClients.size === 1) {
      this.startStreaming();
    }

    socket.emit("webcam_stream_started", {
      message: "Webcam stream started",
      frameRate: this.frameRate,
      timestamp: new Date().toISOString(),
    });
  }

  removeStreamingClient(socket) {
    if (this.streamingClients.has(socket.id)) {
      const clientInfo = this.streamingClients.get(socket.id);
      console.log(
        `📊 Client ${socket.id} received ${clientInfo.frameCount} frames`
      );
      this.streamingClients.delete(socket.id);
    }

    // Stop streaming if no clients left
    if (this.streamingClients.size === 0) {
      this.stopStreaming();
    }
  }

  startStreaming() {
    if (this.streamInterval) {
      return; // Already streaming
    }

    console.log(`🎬 Starting webcam streaming at ${this.frameRate} FPS`);

    // Use adaptive timing based on capture performance
    const baseInterval = 1000 / this.frameRate;
    let dynamicInterval = baseInterval;

    const streamLoop = () => {
      const frameStart = Date.now();

      // Only capture if enough time has passed
      if (frameStart - this.lastCaptureTime >= dynamicInterval) {
        this.lastCaptureTime = frameStart;
        this.captureAndBroadcastFrame();
      }

      // Schedule next frame
      this.streamInterval = setTimeout(
        streamLoop,
        Math.max(16, dynamicInterval / 2)
      ); // Min 16ms (60 FPS max)
    };

    streamLoop();
  }

  stopStreaming() {
    if (this.streamInterval) {
      clearTimeout(this.streamInterval);
      this.streamInterval = null;
      console.log("🛑 Webcam streaming stopped");
    }
  }

  captureAndBroadcastFrame() {
    if (!this.isInitialized || this.streamingClients.size === 0) {
      return;
    }

    const startTime = Date.now();
    const timestamp = Date.now();
    const filename = `socketio_frame_${timestamp}`;

    // Use a timeout to prevent hanging captures
    const captureTimeout = setTimeout(() => {
      console.warn("⏰ Frame capture timeout - skipping frame");
    }, 2000);

    this.webcam.capture(filename, (err, filePath) => {
      clearTimeout(captureTimeout);

      if (err) {
        console.error("❌ Socket.IO frame capture error:", err);
        // Don't emit error for every frame failure to avoid spam
        if (Math.random() < 0.1) {
          // Only emit 10% of errors
          this.streamingClients.forEach((client) => {
            client.socket.emit("webcam_error", {
              error: "Frame capture failed",
              details: err.message,
              timestamp: new Date().toISOString(),
            });
          });
        }
        return;
      }

      // Measure capture time
      const captureTime = Date.now() - startTime;

      // Read the file asynchronously
      fs.readFile(filePath, (readErr, imageBuffer) => {
        if (readErr) {
          console.error("❌ Failed to read frame file:", readErr);
          return;
        }

        // Convert to base64 for Socket.IO transmission
        const base64Image = imageBuffer.toString("base64");
        const totalTime = Date.now() - startTime;

        // Broadcast to all streaming clients
        this.streamingClients.forEach((client) => {
          client.socket.emit("webcam_frame", {
            image: base64Image,
            timestamp: timestamp,
            frameNumber: client.frameCount++,
            captureTime: captureTime,
            totalTime: totalTime,
          });
        });

        // Log performance occasionally
        if (Math.random() < 0.05) {
          // 5% of frames
          console.log(
            `📊 Frame processed in ${totalTime}ms (capture: ${captureTime}ms)`
          );
        }

        // Clean up the file asynchronously
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr && unlinkErr.code !== "ENOENT") {
            console.error("❌ Failed to delete frame file:", unlinkErr);
          }
        });
      });
    });
  }

  captureImageForClient(socket) {
    if (!this.isInitialized) {
      socket.emit("webcam_error", {
        error: "Webcam not initialized",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const timestamp = Date.now();
    const filename = `socketio_capture_${timestamp}`;

    this.webcam.capture(filename, (err, filePath) => {
      if (err) {
        console.error("❌ Socket.IO capture error:", err);
        socket.emit("webcam_error", {
          error: "Capture failed",
          details: err.message,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Read the file and send to the requesting client
      fs.readFile(filePath, (readErr, imageBuffer) => {
        if (readErr) {
          console.error("❌ Failed to read capture file:", readErr);
          socket.emit("webcam_error", {
            error: "Failed to read captured image",
            details: readErr.message,
            timestamp: new Date().toISOString(),
          });
          return;
        }

        // Convert to base64 for Socket.IO transmission
        const base64Image = imageBuffer.toString("base64");

        socket.emit("webcam_capture", {
          image: base64Image,
          timestamp: timestamp,
          size: imageBuffer.length,
        });

        // Clean up the file
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr && unlinkErr.code !== "ENOENT") {
            console.error("❌ Failed to delete capture file:", unlinkErr);
          }
        });
      });
    });
  }

  testWebcamForClient(socket) {
    if (!this.isInitialized) {
      socket.emit("webcam_test_result", {
        success: false,
        error: "Webcam not initialized",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const timestamp = Date.now();
    const filename = `socketio_test_${timestamp}`;

    this.webcam.capture(filename, (err, filePath) => {
      if (err) {
        console.error("❌ Socket.IO test error:", err);
        socket.emit("webcam_test_result", {
          success: false,
          error: "Test capture failed",
          details: err.message,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Check file size without reading the entire file
      fs.stat(filePath, (statErr, stats) => {
        if (statErr) {
          console.error("❌ Failed to stat test file:", statErr);
          socket.emit("webcam_test_result", {
            success: false,
            error: "Failed to read test file stats",
            details: statErr.message,
            timestamp: new Date().toISOString(),
          });
          return;
        }

        socket.emit("webcam_test_result", {
          success: true,
          message: "Webcam test passed",
          imageSize: stats.size,
          timestamp: new Date().toISOString(),
        });

        // Clean up the test file
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr && unlinkErr.code !== "ENOENT") {
            console.error("❌ Failed to delete test file:", unlinkErr);
          }
        });
      });
    });
  }

  // Public method to change frame rate
  setFrameRate(fps) {
    this.frameRate = Math.max(1, Math.min(30, fps)); // Clamp between 1-30 FPS
    console.log(`🎯 Frame rate changed to ${this.frameRate} FPS`);

    // Restart streaming with new frame rate if currently streaming
    if (this.streamInterval) {
      this.stopStreaming();
      this.startStreaming();
    }
  }

  // Public method to get service status
  getStatus() {
    return {
      initialized: this.isInitialized,
      streaming: this.streamInterval !== null,
      connectedClients: this.streamingClients.size,
      frameRate: this.frameRate,
      options: this.webcamOptions,
    };
  }
}

module.exports = SocketWebcamService;
