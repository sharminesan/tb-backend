const NodeWebcam = require("node-webcam");
const fs = require("fs");
const path = require("path");

class FastWebcamService {
  constructor(io) {
    this.io = io;
    this.webcam = null;
    this.streamingClients = new Map();
    this.isInitialized = false;
    this.streamInterval = null;
    this.frameRate = 10; // Start with lower FPS for stability
    this.isCapturing = false;
    this.frameQueue = [];
    this.maxQueueSize = 3;

    // Use a single file for all captures to reduce file system overhead
    this.captureFile = path.join(
      __dirname,
      "..",
      "temp",
      "fast_webcam_capture.jpg"
    );

    this.webcamOptions = {
      width: 320,
      height: 240,
      quality: 50,
      frames: 1,
      delay: 0,
      saveShots: true,
      output: "jpeg",
      device: false,
      callbackReturn: "location",
      verbose: false,
    };

    this.ensureTempDir();
    this.initializeWebcam();
    this.setupSocketHandlers();
  }

  ensureTempDir() {
    const tempDir = path.join(__dirname, "..", "temp");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  }

  initializeWebcam() {
    try {
      console.log("🔧 Initializing Fast Webcam Service...");
      this.webcam = NodeWebcam.create(this.webcamOptions);
      this.isInitialized = true;
      console.log("✅ Fast Webcam Service initialized successfully");
    } catch (error) {
      console.error("❌ Failed to initialize Fast Webcam:", error);
      this.isInitialized = false;
    }
  }

  setupSocketHandlers() {
    this.io.on("connection", (socket) => {
      console.log(`📱 Fast Webcam client connected: ${socket.id}`);

      socket.on("start_fast_webcam", () => {
        console.log(`🎥 Starting fast webcam for: ${socket.id}`);
        this.addClient(socket);
      });

      socket.on("stop_fast_webcam", () => {
        console.log(`⏹️ Stopping fast webcam for: ${socket.id}`);
        this.removeClient(socket);
      });

      socket.on("disconnect", () => {
        console.log(`🔌 Fast webcam client disconnected: ${socket.id}`);
        this.removeClient(socket);
      });
    });
  }

  addClient(socket) {
    if (!this.isInitialized) {
      socket.emit("fast_webcam_error", { error: "Webcam not initialized" });
      return;
    }

    this.streamingClients.set(socket.id, {
      socket: socket,
      frameCount: 0,
      connected: Date.now(),
    });

    socket.emit("fast_webcam_started", {
      message: "Fast webcam started",
      frameRate: this.frameRate,
    });

    // Start streaming if this is the first client
    if (this.streamingClients.size === 1) {
      this.startStreaming();
    }
  }

  removeClient(socket) {
    this.streamingClients.delete(socket.id);

    // Stop streaming if no clients
    if (this.streamingClients.size === 0) {
      this.stopStreaming();
    }
  }

  startStreaming() {
    if (this.streamInterval) return;

    console.log(`🎬 Starting fast webcam streaming at ${this.frameRate} FPS`);

    const captureLoop = () => {
      if (this.streamingClients.size === 0) {
        return;
      }

      if (!this.isCapturing) {
        this.captureFrame();
      }

      // Schedule next capture
      this.streamInterval = setTimeout(captureLoop, 1000 / this.frameRate);
    };

    captureLoop();
  }

  stopStreaming() {
    if (this.streamInterval) {
      clearTimeout(this.streamInterval);
      this.streamInterval = null;
      console.log("🛑 Fast webcam streaming stopped");
    }
  }

  captureFrame() {
    if (this.isCapturing) return;

    this.isCapturing = true;
    const startTime = Date.now();

    // Use a fixed filename to avoid file system overhead
    this.webcam.capture("fast_capture", (err, filePath) => {
      this.isCapturing = false;

      if (err) {
        console.error("❌ Fast capture error:", err);
        return;
      }

      const captureTime = Date.now() - startTime;

      // Read and broadcast immediately
      fs.readFile(filePath, (readErr, imageBuffer) => {
        if (readErr) {
          console.error("❌ Failed to read fast capture:", readErr);
          return;
        }

        const base64Image = imageBuffer.toString("base64");
        const timestamp = Date.now();
        const totalTime = timestamp - startTime;

        // Broadcast to all clients
        this.streamingClients.forEach((client) => {
          client.socket.emit("fast_webcam_frame", {
            image: base64Image,
            timestamp: timestamp,
            frameNumber: client.frameCount++,
            captureTime: captureTime,
            totalTime: totalTime,
          });
        });

        // Log performance occasionally
        if (Math.random() < 0.1) {
          console.log(
            `⚡ Fast frame: ${totalTime}ms (capture: ${captureTime}ms)`
          );
        }

        // Clean up
        fs.unlink(filePath, () => {});
      });
    });
  }

  // Increase frame rate gradually
  increaseFrameRate() {
    if (this.frameRate < 15) {
      this.frameRate += 1;
      console.log(`⬆️ Frame rate increased to ${this.frameRate} FPS`);
      this.restartStreaming();
    }
  }

  // Decrease frame rate if performance is poor
  decreaseFrameRate() {
    if (this.frameRate > 1) {
      this.frameRate -= 1;
      console.log(`⬇️ Frame rate decreased to ${this.frameRate} FPS`);
      this.restartStreaming();
    }
  }

  restartStreaming() {
    if (this.streamInterval) {
      this.stopStreaming();
      setTimeout(() => this.startStreaming(), 100);
    }
  }
}

module.exports = FastWebcamService;
