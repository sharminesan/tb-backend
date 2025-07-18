const fs = require("fs");
const path = require("path");

class OpenCVWebcamService {
  constructor(io) {
    this.io = io;
    this.cap = null;
    this.streamingClients = new Map();
    this.isInitialized = false;
    this.isStreaming = false;
    this.frameRate = 30;
    this.streamInterval = null;
    this.currentFrame = null;
    this.frameBuffer = null;

    this.initializeCamera();
    this.setupSocketHandlers();
  }

  async initializeCamera() {
    try {
      console.log("🔧 Initializing OpenCV webcam...");

      // Try to open the default camera (index 0)
      this.cap = new cv.VideoCapture(0);

      // Set camera properties for better performance
      this.cap.set(cv.CAP_PROP_FRAME_WIDTH, 640);
      this.cap.set(cv.CAP_PROP_FRAME_HEIGHT, 480);
      this.cap.set(cv.CAP_PROP_FPS, this.frameRate);
      this.cap.set(cv.CAP_PROP_BUFFERSIZE, 1); // Reduce buffer size for lower latency

      // Test if camera is working
      const frame = this.cap.read();
      if (frame.empty) {
        throw new Error("Cannot read from camera");
      }

      this.isInitialized = true;
      console.log("✅ OpenCV webcam initialized successfully");
      console.log(`📹 Camera resolution: ${frame.cols}x${frame.rows}`);
    } catch (error) {
      console.error("❌ Failed to initialize OpenCV webcam:", error);
      this.isInitialized = false;
    }
  }

  setupSocketHandlers() {
    this.io.on("connection", (socket) => {
      console.log(`📱 OpenCV webcam client connected: ${socket.id}`);

      // Handle stream start
      socket.on("start_opencv_stream", (data) => {
        console.log(`🎥 Starting OpenCV stream for: ${socket.id}`);
        this.addStreamingClient(socket, data);
      });

      // Handle stream stop
      socket.on("stop_opencv_stream", () => {
        console.log(`⏹️ Stopping OpenCV stream for: ${socket.id}`);
        this.removeStreamingClient(socket);
      });

      // Handle frame rate change
      socket.on("set_opencv_fps", (data) => {
        console.log(`🎯 OpenCV FPS change requested: ${data.fps} FPS`);
        this.setFrameRate(data.fps);
      });

      // Handle single frame capture
      socket.on("capture_opencv_frame", () => {
        console.log(`📸 OpenCV frame capture requested by: ${socket.id}`);
        this.captureFrameForClient(socket);
      });

      // Handle disconnect
      socket.on("disconnect", () => {
        console.log(`🔌 OpenCV webcam client disconnected: ${socket.id}`);
        this.removeStreamingClient(socket);
      });
    });
  }

  addStreamingClient(socket, options = {}) {
    if (!this.isInitialized) {
      socket.emit("opencv_error", {
        error: "OpenCV webcam not initialized",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const clientOptions = {
      quality: options.quality || 80,
      width: options.width || 640,
      height: options.height || 480,
      ...options,
    };

    this.streamingClients.set(socket.id, {
      socket: socket,
      frameCount: 0,
      startTime: Date.now(),
      options: clientOptions,
    });

    socket.emit("opencv_stream_started", {
      message: "OpenCV stream started",
      frameRate: this.frameRate,
      resolution: `${clientOptions.width}x${clientOptions.height}`,
      timestamp: new Date().toISOString(),
    });

    // Start streaming if this is the first client
    if (this.streamingClients.size === 1) {
      this.startStreaming();
    }
  }

  removeStreamingClient(socket) {
    if (this.streamingClients.has(socket.id)) {
      const client = this.streamingClients.get(socket.id);
      const duration = Date.now() - client.startTime;
      console.log(
        `📊 Client ${socket.id} streamed ${client.frameCount} frames in ${duration}ms`
      );
      this.streamingClients.delete(socket.id);
    }

    // Stop streaming if no clients left
    if (this.streamingClients.size === 0) {
      this.stopStreaming();
    }
  }

  startStreaming() {
    if (this.isStreaming || !this.isInitialized) {
      return;
    }

    this.isStreaming = true;
    console.log(`🎬 Starting OpenCV streaming at ${this.frameRate} FPS`);

    const streamLoop = () => {
      if (!this.isStreaming || this.streamingClients.size === 0) {
        return;
      }

      const startTime = Date.now();

      try {
        // Read frame from camera
        const frame = this.cap.read();

        if (frame.empty) {
          console.error("❌ Empty frame received from camera");
          this.scheduleNextFrame();
          return;
        }

        // Process and send frame to all clients
        this.processAndBroadcastFrame(frame, startTime);
      } catch (error) {
        console.error("❌ Error in OpenCV streaming loop:", error);
      }

      this.scheduleNextFrame();
    };

    // Start the streaming loop
    streamLoop();
  }

  scheduleNextFrame() {
    const interval = 1000 / this.frameRate;
    this.streamInterval = setTimeout(() => {
      if (this.isStreaming) {
        this.startStreaming();
      }
    }, interval);
  }

  processAndBroadcastFrame(frame, startTime) {
    const processStart = Date.now();

    // Resize frame if needed and encode to JPEG
    const resizedFrame = frame.resize(640, 480);

    // Encode frame to JPEG buffer
    const jpegBuffer = cv.imencode(".jpg", resizedFrame, [
      cv.IMWRITE_JPEG_QUALITY,
      80,
    ]);

    // Convert to base64
    const base64Image = jpegBuffer.toString("base64");

    const processTime = Date.now() - processStart;
    const totalTime = Date.now() - startTime;

    // Broadcast to all clients
    this.streamingClients.forEach((client) => {
      try {
        client.socket.emit("opencv_frame", {
          image: base64Image,
          timestamp: Date.now(),
          frameNumber: client.frameCount++,
          captureTime: processTime,
          totalTime: totalTime,
          resolution: `${resizedFrame.cols}x${resizedFrame.rows}`,
          quality: 80,
        });
      } catch (error) {
        console.error("❌ Error sending frame to client:", error);
      }
    });

    // Log performance occasionally
    if (Math.random() < 0.02) {
      // 2% of frames
      console.log(
        `📊 OpenCV frame processed in ${totalTime}ms (encode: ${processTime}ms)`
      );
    }
  }

  stopStreaming() {
    if (!this.isStreaming) {
      return;
    }

    this.isStreaming = false;

    if (this.streamInterval) {
      clearTimeout(this.streamInterval);
      this.streamInterval = null;
    }

    console.log("🛑 OpenCV streaming stopped");
  }

  captureFrameForClient(socket) {
    if (!this.isInitialized) {
      socket.emit("opencv_error", {
        error: "OpenCV webcam not initialized",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    try {
      const startTime = Date.now();
      const frame = this.cap.read();

      if (frame.empty) {
        socket.emit("opencv_error", {
          error: "Failed to capture frame - empty frame",
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Resize and encode
      const resizedFrame = frame.resize(640, 480);
      const jpegBuffer = cv.imencode(".jpg", resizedFrame, [
        cv.IMWRITE_JPEG_QUALITY,
        90,
      ]);

      const base64Image = jpegBuffer.toString("base64");
      const captureTime = Date.now() - startTime;

      socket.emit("opencv_capture", {
        image: base64Image,
        timestamp: Date.now(),
        captureTime: captureTime,
        size: jpegBuffer.length,
        resolution: `${resizedFrame.cols}x${resizedFrame.rows}`,
      });

      console.log(`📸 OpenCV frame captured in ${captureTime}ms`);
    } catch (error) {
      console.error("❌ Error capturing OpenCV frame:", error);
      socket.emit("opencv_error", {
        error: "Failed to capture frame",
        details: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  setFrameRate(fps) {
    const newFPS = Math.max(1, Math.min(60, fps));
    if (newFPS !== this.frameRate) {
      this.frameRate = newFPS;
      console.log(`🎯 OpenCV frame rate changed to ${this.frameRate} FPS`);

      // Update camera FPS if possible
      if (this.cap && this.isInitialized) {
        try {
          this.cap.set(cv.CAP_PROP_FPS, this.frameRate);
        } catch (error) {
          console.warn("⚠️ Could not set camera FPS:", error.message);
        }
      }

      // Notify all clients
      this.streamingClients.forEach((client) => {
        client.socket.emit("opencv_fps_changed", {
          frameRate: this.frameRate,
          timestamp: new Date().toISOString(),
        });
      });
    }
  }

  getStatus() {
    return {
      initialized: this.isInitialized,
      streaming: this.isStreaming,
      connectedClients: this.streamingClients.size,
      frameRate: this.frameRate,
      cameraOpen: this.cap ? !this.cap.isOpened() : false,
    };
  }

  // Cleanup method
  cleanup() {
    console.log("🧹 Cleaning up OpenCV webcam service...");

    this.stopStreaming();

    if (this.cap) {
      try {
        this.cap.release();
        console.log("✅ Camera released");
      } catch (error) {
        console.error("❌ Error releasing camera:", error);
      }
    }

    this.streamingClients.clear();
    this.isInitialized = false;
  }
}

module.exports = OpenCVWebcamService;
