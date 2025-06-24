require("dotenv").config();
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const session = require("express-session");
const path = require("path");
const authRoutes = require("./routes/auth");
const otpRoutes = require("./routes/otpRoutes");
const googleAuthRoutes = require("./routes/googleAuthRoutes");
const { verifyToken } = require("./admin");
const {
  authenticateAndVerifyEmail,
  authenticateAndVerifyAll,
} = require("./middleware/auth");
const OTPService = require("./services/otpService");
const GoogleAuthenticatorService = require("./services/googleAuthService");

const app = express();
const otpService = new OTPService();
const googleAuthService = new GoogleAuthenticatorService();

const port = process.env.PORT || 4000;

// Create server using your preferred method
const server = app.listen(port, "0.0.0.0", () => {
  console.log(`Server listening on port ${port}`);
  console.log(`TurtleBot backend server running on port ${port}`);
  console.log(`Access the control interface at http://0.0.0.0:${port}`);
});

// Initialize Socket.IO with the new server
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Middleware
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: "turtlebot-secret-key",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
  })
);

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/otp", otpRoutes);
app.use("/api/google-auth", googleAuthRoutes);

// User authentication
const users = {
  admin: { password: "admin123" },
};

// TurtleBot Controller Class (Modified for Windows compatibility)
class TurtleBotController {
  constructor() {
    this.rosNode = null;
    this.cmdVelPublisher = null;
    this.batterySubscriber = null;
    this.odomSubscriber = null;
    this.laserSubscriber = null;
    this.isConnected = false;
    this.currentTwist = {
      linear: { x: 0, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: 0 },
    };
    this.batteryData = null;
    this.odomData = null;
    this.laserData = null;
    this.isMoving = false;
    this.rosMode = false; // Flag to indicate if ROS is available

    // Add continuous publishing support
    this.publishInterval = null;
    this.publishRate = 10; // 10Hz like the Python script

    this.initializeROS();
  }

  async initializeROS() {
    try {
      // Force set environment variables for rosnodejs
      process.env.ROS_MASTER_URI =
        process.env.ROS_MASTER_URI || "http://localhost:11311";
      process.env.ROS_HOSTNAME = process.env.ROS_HOSTNAME || "localhost";

      // Enhanced ROS environment debugging
      console.log("=== ROS Environment Debug ===");
      console.log("- ROS_MASTER_URI:", process.env.ROS_MASTER_URI || "not set");
      console.log("- ROS_HOSTNAME:", process.env.ROS_HOSTNAME || "not set");
      console.log("- ROS_IP:", process.env.ROS_IP || "not set");
      console.log(
        "- CMAKE_PREFIX_PATH:",
        process.env.CMAKE_PREFIX_PATH ? "set" : "not set"
      );
      console.log(
        "- ROS_PACKAGE_PATH:",
        process.env.ROS_PACKAGE_PATH ? "set" : "not set"
      );

      // Get system network info
      const os = require("os");
      const networkInterfaces = os.networkInterfaces();
      console.log("- Available network interfaces:");
      Object.keys(networkInterfaces).forEach((name) => {
        networkInterfaces[name].forEach((net) => {
          if (!net.internal && net.family === "IPv4") {
            console.log(`  ${name}: ${net.address}`);
          }
        });
      });

      // Pre-test ROS master connectivity using shell command
      console.log("🔍 Testing ROS master connectivity via shell command...");
      const { exec } = require("child_process");
      const testCommand = new Promise((resolve, reject) => {
        const env = {
          ...process.env,
          ROS_MASTER_URI: process.env.ROS_MASTER_URI,
          ROS_HOSTNAME: process.env.ROS_HOSTNAME,
          ROS_IP: process.env.ROS_IP,
        };

        exec("timeout 10s rosnode list", { env }, (error, stdout, stderr) => {
          if (error) {
            reject(
              new Error(
                `ROS master connectivity test failed: ${error.message}\nStderr: ${stderr}`
              )
            );
          } else {
            console.log("✅ ROS master connectivity test passed");
            console.log("Available ROS nodes:", stdout.trim().split("\n"));
            resolve(stdout);
          }
        });
      });

      try {
        await testCommand;
      } catch (testError) {
        console.error(
          "❌ ROS master connectivity test failed:",
          testError.message
        );
        throw new Error(
          "ROS master is not accessible from Node.js environment"
        );
      }

      // Test rostopic list as well
      console.log("🔍 Testing rostopic connectivity...");
      const testTopics = new Promise((resolve, reject) => {
        const env = {
          ...process.env,
          ROS_MASTER_URI: process.env.ROS_MASTER_URI,
          ROS_HOSTNAME: process.env.ROS_HOSTNAME,
          ROS_IP: process.env.ROS_IP,
        };

        exec("timeout 10s rostopic list", { env }, (error, stdout, stderr) => {
          if (error) {
            reject(
              new Error(
                `rostopic test failed: ${error.message}\nStderr: ${stderr}`
              )
            );
          } else {
            console.log("✅ rostopic connectivity test passed");
            console.log(
              "Available topics:",
              stdout.trim().split("\n").slice(0, 5).join(", "),
              "..."
            );
            resolve(stdout);
          }
        });
      });

      try {
        await testTopics;
      } catch (topicError) {
        console.error(
          "❌ rostopic connectivity test failed:",
          topicError.message
        );
        throw new Error("rostopic is not accessible from Node.js environment");
      }

      // Load rosnodejs
      let rosnodejs;
      try {
        rosnodejs = require("rosnodejs");
        console.log("✅ rosnodejs loaded via require");
      } catch (requireError) {
        console.warn(
          "rosnodejs not found via require, trying dynamic import..."
        );
        try {
          rosnodejs = await import("rosnodejs");
          if (rosnodejs.default) {
            rosnodejs = rosnodejs.default;
          }
          console.log("✅ rosnodejs loaded via dynamic import");
        } catch (importError) {
          console.error("❌ Failed to load rosnodejs:", importError.message);
          throw new Error("rosnodejs module not available");
        }
      }

      // Check if ROS environment is available
      if (
        !process.env.ROS_MASTER_URI &&
        !process.env.CMAKE_PREFIX_PATH &&
        !process.env.ROS_PACKAGE_PATH
      ) {
        console.warn(
          "ROS environment not detected. Running in simulation mode."
        );
        this.initializeSimulationMode();
        return;
      }

      console.log("ROS environment detected and verified:");
      console.log("- ROS_MASTER_URI:", process.env.ROS_MASTER_URI || "not set");

      // Validate rosnodejs functionality
      if (typeof rosnodejs.initNode !== "function") {
        throw new Error(
          "rosnodejs.initNode is not a function. Check rosnodejs installation."
        );
      }

      // Try alternative initialization methods
      console.log("Initializing ROS node with verified connectivity...");

      // Method 1: Try with explicit rosMasterUri parameter
      try {
        console.log(
          "Attempting rosnodejs initialization method 1: explicit rosMasterUri..."
        );
        this.rosNode = await rosnodejs.initNode("/turtlebot_web_controller", {
          rosMasterUri: process.env.ROS_MASTER_URI,
          onTheFly: true,
          anonymous: false,
          timeout: 15000,
        });
        console.log("✅ Method 1 successful!");
      } catch (method1Error) {
        console.warn("❌ Method 1 failed:", method1Error.message);

        // Method 2: Try with no options
        try {
          console.log(
            "Attempting rosnodejs initialization method 2: minimal options..."
          );
          this.rosNode = await rosnodejs.initNode("/turtlebot_web_controller");
          console.log("✅ Method 2 successful!");
        } catch (method2Error) {
          console.warn("❌ Method 2 failed:", method2Error.message);

          // Method 3: Try with different timeout and anonymous
          try {
            console.log(
              "Attempting rosnodejs initialization method 3: anonymous node..."
            );
            this.rosNode = await rosnodejs.initNode(
              "/turtlebot_web_controller",
              {
                anonymous: true,
                timeout: 20000,
              }
            );
            console.log("✅ Method 3 successful!");
          } catch (method3Error) {
            console.error("❌ All initialization methods failed");
            throw method3Error;
          }
        }
      }

      console.log("✅ ROS node initialized successfully");

      // Wait for node registration (shorter wait since connectivity is verified)
      console.log("Waiting for node registration...");
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Get node handle
      const nh = rosnodejs.nh;
      console.log("✅ Node handle obtained");

      // ...rest of your existing initialization code...
      // Try different cmd_vel topics for TurtleBot1
      const cmdVelTopics = [
        "/cmd_vel_mux/input/navi",
        "/cmd_vel_mux/input/teleop",
        "/mobile_base/commands/velocity",
        "/cmd_vel",
      ];

      let publisherCreated = false;
      for (const topic of cmdVelTopics) {
        try {
          this.cmdVelPublisher = nh.advertise(topic, "geometry_msgs/Twist", {
            queueSize: 1,
            latching: false,
          });
          console.log(
            `✅ Command velocity publisher created on topic: ${topic}`
          );
          publisherCreated = true;
          break;
        } catch (error) {
          console.warn(
            `❌ Failed to create publisher on ${topic}:`,
            error.message
          );
        }
      }

      if (!publisherCreated) {
        throw new Error(
          "Failed to create command velocity publisher on any topic"
        );
      }

      // Set connection status
      this.isConnected = true;
      this.rosMode = true;
      console.log(
        "🎉 TurtleBot controller initialized successfully in ROS mode"
      );

      // Test the connection by publishing a zero twist
      setTimeout(() => {
        try {
          this.publishTwist(0, 0, 0, 0, 0, 0);
          console.log("✅ Test message published to cmd_vel topic");
        } catch (testError) {
          console.error(
            "❌ Failed to publish test message:",
            testError.message
          );
        }
      }, 2000);
    } catch (error) {
      console.error("❌ ROS initialization failed:", error);
      console.log("Error details:", {
        message: error.message,
        code: error.code,
        errno: error.errno,
        stack: error.stack?.split("\n").slice(0, 5).join("\n"),
        rosnodejsAvailable:
          typeof require !== "undefined"
            ? (() => {
                try {
                  require("rosnodejs");
                  return true;
                } catch (e) {
                  return false;
                }
              })()
            : false,
      });

      console.log("🔄 Falling back to simulation mode...");
      this.initializeSimulationMode();
    }
  }

  startSimulation() {
    // Update battery data every 30 seconds
    setInterval(() => {
      if (this.batteryData && !this.rosMode) {
        this.batteryData.percentage = Math.max(
          0.1,
          this.batteryData.percentage - 0.001
        );
        this.batteryData.timestamp = Date.now();
        io.emit("battery_update", this.batteryData);
      }
    }, 30000);

    // Update odometry data when moving
    setInterval(() => {
      if (this.isMoving && !this.rosMode) {
        this.odomData.position.x += this.currentTwist.linear.x * 0.1;
        this.odomData.position.y += this.currentTwist.linear.y * 0.1;
        this.odomData.linear_velocity = this.currentTwist.linear;
        this.odomData.angular_velocity = this.currentTwist.angular;
        this.odomData.timestamp = Date.now();
        io.emit("odom_update", this.odomData);
      }
    }, 100);

    // Simulate laser data
    setInterval(() => {
      if (!this.rosMode) {
        const ranges = [];
        for (let i = 0; i < 360; i++) {
          ranges.push(Math.random() * 5 + 0.5); // Random distances between 0.5-5.5m
        }

        this.laserData = {
          ranges: ranges,
          angle_min: -Math.PI,
          angle_max: Math.PI,
          angle_increment: Math.PI / 180,
          time_increment: 0,
          scan_time: 0.1,
          range_min: 0.1,
          range_max: 6.0,
          timestamp: Date.now(),
        };

        io.emit("laser_update", this.laserData);
      }
    }, 200);
  }

  batteryCallback(msg, msgType) {
    let batteryData = {};

    switch (msgType) {
      case "smart_battery_msgs/SmartBatteryStatus":
        batteryData = {
          percentage: msg.percentage,
          voltage: msg.voltage,
          current: msg.current,
          charge: msg.charge,
          capacity: msg.capacity,
          design_capacity: msg.design_capacity,
          present: msg.present,
          timestamp: Date.now(),
        };
        break;

      case "sensor_msgs/BatteryState":
        batteryData = {
          percentage: msg.percentage,
          voltage: msg.voltage,
          current: msg.current,
          charge: msg.charge,
          capacity: msg.capacity,
          design_capacity: msg.design_capacity,
          present: msg.present,
          timestamp: Date.now(),
        };
        break;

      case "diagnostic_msgs/DiagnosticArray":
        // Extract battery info from diagnostics
        const batteryStatus = msg.status.find(
          (s) => s.name.includes("battery") || s.name.includes("power")
        );
        if (batteryStatus) {
          const voltage = batteryStatus.values.find((v) => v.key === "Voltage");
          const percentage = batteryStatus.values.find(
            (v) => v.key === "Charge"
          );

          batteryData = {
            percentage: percentage ? parseFloat(percentage.value) / 100 : null,
            voltage: voltage ? parseFloat(voltage.value) : null,
            current: null,
            charge: null,
            capacity: null,
            design_capacity: null,
            present: batteryStatus.level !== 3, // ERROR level
            timestamp: Date.now(),
          };
        }
        break;

      default:
        console.warn("Unknown battery message type:", msgType);
        return;
    }

    this.batteryData = batteryData;
    io.emit("battery_update", this.batteryData);
  }

  odomCallback(msg) {
    this.odomData = {
      position: {
        x: msg.pose.pose.position.x,
        y: msg.pose.pose.position.y,
        z: msg.pose.pose.position.z,
      },
      orientation: {
        x: msg.pose.pose.orientation.x,
        y: msg.pose.pose.orientation.y,
        z: msg.pose.pose.orientation.z,
        w: msg.pose.pose.orientation.w,
      },
      linear_velocity: {
        x: msg.twist.twist.linear.x,
        y: msg.twist.twist.linear.y,
        z: msg.twist.twist.linear.z,
      },
      angular_velocity: {
        x: msg.twist.twist.angular.x,
        y: msg.twist.twist.angular.y,
        z: msg.twist.twist.angular.z,
      },
      timestamp: Date.now(),
    };

    io.emit("odom_update", this.odomData);
  }

  laserCallback(msg) {
    this.laserData = {
      ranges: msg.ranges,
      angle_min: msg.angle_min,
      angle_max: msg.angle_max,
      angle_increment: msg.angle_increment,
      time_increment: msg.time_increment,
      scan_time: msg.scan_time,
      range_min: msg.range_min,
      range_max: msg.range_max,
      timestamp: Date.now(),
    };

    if (Date.now() % 100 < 50) {
      io.emit("laser_update", this.laserData);
    }
  }
  publishTwist(
    linear_x = 0,
    linear_y = 0,
    linear_z = 0,
    angular_x = 0,
    angular_y = 0,
    angular_z = 0
  ) {
    if (!this.isConnected) {
      console.warn("Controller not connected");
      return false;
    }

    const twist = {
      linear: {
        x: parseFloat(linear_x) || 0,
        y: parseFloat(linear_y) || 0,
        z: parseFloat(linear_z) || 0,
      },
      angular: {
        x: parseFloat(angular_x) || 0,
        y: parseFloat(angular_y) || 0,
        z: parseFloat(angular_z) || 0,
      },
    };

    // Update current twist
    this.currentTwist = twist;
    this.isMoving =
      twist.linear.x !== 0 ||
      twist.linear.y !== 0 ||
      twist.linear.z !== 0 ||
      twist.angular.x !== 0 ||
      twist.angular.y !== 0 ||
      twist.angular.z !== 0;

    // Start continuous publishing
    this.startContinuousPublishing();

    io.emit("movement_update", {
      twist: this.currentTwist,
      is_moving: this.isMoving,
    });

    return true;
  }

  startContinuousPublishing() {
    // Clear existing interval
    if (this.publishInterval) {
      clearInterval(this.publishInterval);
    }

    // Start publishing at the specified rate (like Python script)
    this.publishInterval = setInterval(() => {
      if (this.rosMode && this.cmdVelPublisher) {
        try {
          // Publish current twist continuously
          this.cmdVelPublisher.publish(this.currentTwist);
          console.log(
            `ROS command published: linear=[${this.currentTwist.linear.x.toFixed(
              2
            )}, ${this.currentTwist.linear.y.toFixed(
              2
            )}, ${this.currentTwist.linear.z.toFixed(
              2
            )}], angular=[${this.currentTwist.angular.x.toFixed(
              2
            )}, ${this.currentTwist.angular.y.toFixed(
              2
            )}, ${this.currentTwist.angular.z.toFixed(2)}]`
          );
        } catch (publishError) {
          console.error("Failed to publish ROS message:", publishError);
        }
      } else if (!this.rosMode) {
        // Simulation mode - just log the command
        console.log(
          `Simulation command: linear=[${this.currentTwist.linear.x.toFixed(
            2
          )}, ${this.currentTwist.linear.y.toFixed(
            2
          )}, ${this.currentTwist.linear.z.toFixed(
            2
          )}], angular=[${this.currentTwist.angular.x.toFixed(
            2
          )}, ${this.currentTwist.angular.y.toFixed(
            2
          )}, ${this.currentTwist.angular.z.toFixed(2)}]`
        );
      }

      // Stop publishing if not moving
      if (!this.isMoving) {
        clearInterval(this.publishInterval);
        this.publishInterval = null;
      }
    }, 1000 / this.publishRate); // Convert rate to milliseconds
  }
  moveForward(speed = 0.2) {
    console.log(`Moving forward at speed: ${speed}`);
    return this.publishTwist(speed, 0, 0, 0, 0, 0);
  }

  moveBackward(speed = 0.2) {
    console.log(`Moving backward at speed: ${speed}`);
    return this.publishTwist(-speed, 0, 0, 0, 0, 0);
  }

  turnLeft(angularSpeed = 0.5) {
    console.log(`Turning left at angular speed: ${angularSpeed}`);
    return this.publishTwist(0, 0, 0, 0, 0, angularSpeed);
  }

  turnRight(angularSpeed = 0.5) {
    console.log(`Turning right at angular speed: ${angularSpeed}`);
    return this.publishTwist(0, 0, 0, 0, 0, -angularSpeed);
  }

  stop() {
    console.log("Stopping robot");

    // Stop continuous publishing
    if (this.publishInterval) {
      clearInterval(this.publishInterval);
      this.publishInterval = null;
    }

    // Publish stop command multiple times to ensure it's received
    const stopTwist = {
      linear: { x: 0, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: 0 },
    };

    this.currentTwist = stopTwist;
    this.isMoving = false;

    if (this.rosMode && this.cmdVelPublisher) {
      // Send stop command multiple times to ensure it's received
      for (let i = 0; i < 5; i++) {
        setTimeout(() => {
          try {
            this.cmdVelPublisher.publish(stopTwist);
            console.log("Stop command published");
          } catch (error) {
            console.error("Failed to publish stop command:", error);
          }
        }, i * 10); // 10ms intervals
      }
    }

    io.emit("movement_update", {
      twist: this.currentTwist,
      is_moving: this.isMoving,
    });

    return true;
  }
  customMove(
    linear_x,
    linear_y = 0,
    linear_z = 0,
    angular_x = 0,
    angular_y = 0,
    angular_z = 0
  ) {
    console.log(
      `Custom move: linear=[${linear_x}, ${linear_y}, ${linear_z}], angular=[${angular_x}, ${angular_y}, ${angular_z}]`
    );
    return this.publishTwist(
      parseFloat(linear_x) || 0,
      parseFloat(linear_y) || 0,
      parseFloat(linear_z) || 0,
      parseFloat(angular_x) || 0,
      parseFloat(angular_y) || 0,
      parseFloat(angular_z) || 0
    );
  }

  // Enhanced square movement similar to Python script
  async moveSquare(sideLength = 2.0, linearSpeed = 0.2, angularSpeed = 0.5) {
    if (!this.isConnected) {
      console.warn("Controller not connected");
      return false;
    }

    console.log(
      `Starting square movement: side=${sideLength}m, linear=${linearSpeed}m/s, angular=${angularSpeed}rad/s`
    );

    const moveTime = sideLength / linearSpeed; // Time to move forward
    const turnTime = Math.PI / 2 / angularSpeed; // Time to turn 90 degrees

    for (let side = 0; side < 4; side++) {
      console.log(`Square side ${side + 1}/4`);

      // Move forward
      console.log("Moving forward...");
      this.publishTwist(linearSpeed, 0, 0, 0, 0, 0);
      await new Promise((resolve) => setTimeout(resolve, moveTime * 1000));

      // Stop
      console.log("Stopping...");
      this.stop();
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Turn right (90 degrees)
      console.log("Turning right...");
      this.publishTwist(0, 0, 0, 0, 0, -angularSpeed);
      await new Promise((resolve) => setTimeout(resolve, turnTime * 1000));

      // Stop turning
      console.log("Stop turning...");
      this.stop();
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log("Square movement completed");
    return true;
  }

  // Cleanup method
  cleanup() {
    if (this.publishInterval) {
      clearInterval(this.publishInterval);
      this.publishInterval = null;
    }
    this.stop();
  }

  getStatus() {
    return {
      is_connected: this.isConnected,
      is_moving: this.isMoving,
      ros_mode: this.rosMode,
      current_twist: this.currentTwist,
      battery_available: this.batteryData !== null,
      odometry_available: this.odomData !== null,
      laser_available: this.laserData !== null,
      timestamp: Date.now(),
    };
  }

  emergencyStop() {
    console.log("EMERGENCY STOP ACTIVATED");
    this.stop();
    return true;
  }

  initializeSimulationMode() {
    this.isConnected = true;
    this.rosMode = false;

    // Initialize simulation data
    this.batteryData = {
      percentage: 0.85,
      voltage: 12.3,
      current: -2.1,
      charge: 8500,
      capacity: 10000,
      design_capacity: 10000,
      present: true,
      timestamp: Date.now(),
    };

    this.odomData = {
      position: { x: 0, y: 0, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
      linear_velocity: { x: 0, y: 0, z: 0 },
      angular_velocity: { x: 0, y: 0, z: 0 },
      timestamp: Date.now(),
    };

    console.log("TurtleBot controller initialized in simulation mode");
    this.startSimulation();
  }
  // Enhanced geometric movement methods with continuous publishing
  async moveInCircle(radius = 1.0, duration = 10000, clockwise = true) {
    if (!this.isConnected) {
      console.warn("Controller not connected");
      return false;
    }

    const circumference = 2 * Math.PI * radius;
    const linearSpeed = circumference / (duration / 1000); // m/s
    const angularSpeed = (2 * Math.PI) / (duration / 1000); // rad/s

    console.log(
      `Starting circle movement: radius=${radius}m, duration=${duration}ms, clockwise=${clockwise}`
    );
    console.log(
      `Calculated speeds: linear=${linearSpeed.toFixed(
        2
      )}m/s, angular=${angularSpeed.toFixed(2)}rad/s`
    );

    // Emit movement start event
    io.emit("pattern_movement_start", {
      pattern: "circle",
      radius,
      duration,
      clockwise,
    });

    // Start circular movement
    this.publishTwist(
      linearSpeed,
      0,
      0,
      0,
      0,
      clockwise ? -angularSpeed : angularSpeed
    );

    // Stop after duration
    setTimeout(() => {
      this.stop();
      io.emit("pattern_movement_complete", { pattern: "circle" });
    }, duration);

    return true;
  }

  async moveInTriangle(sideLength = 1.0, pauseDuration = 500) {
    if (!this.isConnected) {
      console.warn("Controller not connected");
      return false;
    }

    console.log(
      `Starting triangle movement: side=${sideLength}m, pause=${pauseDuration}ms`
    );

    io.emit("pattern_movement_start", {
      pattern: "triangle",
      sideLength,
      pauseDuration,
    });

    const speed = 0.2; // m/s
    const moveDuration = (sideLength / speed) * 1000; // ms
    const turnAngle = 120; // degrees
    const angularSpeed = (turnAngle * Math.PI) / 180; // rad/s for 1 second turn

    // Move forward for one side
    this.publishTwist(speed, 0, 0, 0, 0, 0);

    setTimeout(() => {
      // Stop and turn
      this.stop();
      setTimeout(() => {
        this.publishTwist(0, 0, 0, 0, 0, angularSpeed);
        setTimeout(() => {
          // Move forward for second side
          this.publishTwist(speed, 0, 0, 0, 0, 0);
          setTimeout(() => {
            // Stop and turn
            this.stop();
            setTimeout(() => {
              this.publishTwist(0, 0, 0, 0, 0, angularSpeed);
              setTimeout(() => {
                // Move forward for third side
                this.publishTwist(speed, 0, 0, 0, 0, 0);
                setTimeout(() => {
                  // Stop and final turn
                  this.stop();
                  setTimeout(() => {
                    this.publishTwist(0, 0, 0, 0, 0, angularSpeed);
                    setTimeout(() => {
                      this.stop();
                      io.emit("pattern_movement_complete", {
                        pattern: "triangle",
                      });
                    }, 1000);
                  }, pauseDuration);
                }, moveDuration);
              }, 1000);
            }, pauseDuration);
          }, moveDuration);
        }, 1000);
      }, pauseDuration);
    }, moveDuration);

    return true;
  }

  async moveInLove(size = 1.0, duration = 20000) {
    if (!this.isConnected) {
      console.warn("Controller not connected");
      return false;
    }

    console.log(
      `Starting love (heart) movement: size=${size}, duration=${duration}ms`
    );

    io.emit("pattern_movement_start", {
      pattern: "love",
      size,
      duration,
    });

    // Heart shape using parametric equations with smooth curves
    const steps = 100;
    const stepDuration = duration / steps;
    let step = 0;

    const heartInterval = setInterval(() => {
      if (step >= steps) {
        this.stop();
        io.emit("pattern_movement_complete", { pattern: "love" });
        clearInterval(heartInterval);
        return;
      }

      // Parametric heart equations
      const t = (step / steps) * 2 * Math.PI;
      const scale = size * 0.1;

      // Heart curve with varying speeds for dramatic effect
      const speedMultiplier = 1 + 0.5 * Math.sin(t * 3); // Varies between 0.5 and 1.5
      const linearSpeed = scale * speedMultiplier * Math.cos(t);
      const angularSpeed =
        scale * speedMultiplier * (Math.sin(t) + Math.sin(3 * t) * 0.3);

      this.publishTwist(linearSpeed, 0, 0, 0, 0, angularSpeed);
      step++;
    }, stepDuration);

    return true;
  }

  async moveInDiamond(sideLength = 1.0, pauseDuration = 300) {
    if (!this.isConnected) {
      console.warn("Controller not connected");
      return false;
    }

    console.log(
      `Starting diamond movement: side=${sideLength}m, pause=${pauseDuration}ms`
    );

    io.emit("pattern_movement_start", {
      pattern: "diamond",
      sideLength,
      pauseDuration,
    });

    const speed = 0.25; // m/s
    const moveDuration = (sideLength / speed) * 1000; // ms
    const turnAngle = 90; // degrees for diamond (square rotated 45°)
    const angularSpeed = (turnAngle * Math.PI) / 180; // rad/s for 1 second turn

    let currentSide = 0;
    const totalSides = 4;

    const executeSide = () => {
      if (currentSide >= totalSides) {
        this.stop();
        io.emit("pattern_movement_complete", { pattern: "diamond" });
        return;
      }

      // Add slight speed variation for more interesting movement
      const speedVariation = 1 + Math.sin(currentSide) * 0.2;
      const currentSpeed = speed * speedVariation;

      // Move forward
      this.publishTwist(currentSpeed, 0, 0, 0, 0, 0);

      setTimeout(() => {
        // Stop
        this.stop();

        setTimeout(() => {
          // Turn
          const turnDirection = currentSide % 2 === 0 ? 1 : -1; // Alternate turn directions
          this.publishTwist(0, 0, 0, 0, 0, angularSpeed * turnDirection);

          setTimeout(() => {
            this.stop();
            currentSide++;

            setTimeout(() => {
              executeSide();
            }, pauseDuration / 2);
          }, 800);
        }, pauseDuration);
      }, moveDuration);
    };

    executeSide();
    return true;
  }
  // Enhanced stop   that also stops pattern movements
  stopPattern() {
    this.stop();
    io.emit("pattern_movement_stopped", { timestamp: Date.now() });
    return true;
  }
}

// Initialize TurtleBot controller
const turtlebot = new TurtleBotController();

// Firebase Authentication middleware
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

// Legacy authentication middleware (for backward compatibility)
function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
}

// Routes
app.get("/", (req, res) => {
  res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>TurtleBot Control Server</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 40px; }
                .status { background: #f0f0f0; padding: 20px; border-radius: 10px; margin: 20px 0; }
                .api-list { background: #e8f4f8; padding: 20px; border-radius: 10px; }
                .pattern-section { background: #f8e8f8; padding: 15px; border-radius: 8px; margin: 10px 0; }
            </style>
        </head>
        <body>
            <h1>TurtleBot Control Server</h1>
            <div class="status">
                <h2>Server Status</h2>
                <p>✅ Server is running on port ${port}</p>
                <p>🤖 Robot Mode: ${
                  turtlebot.rosMode ? "ROS Connected" : "Simulation"
                }</p>
                <p>🔗 Connection Status: ${
                  turtlebot.isConnected ? "Connected" : "Disconnected"
                }</p>
            </div>
              <div class="api-list">
                <h2>Available API Endpoints</h2>
                  <h3>🔐 Authentication & Security</h3>
                <ul>
                    <li>POST /api/auth/login - User authentication (legacy)</li>
                    <li>POST /api/auth/logout - User logout</li>
                    <li>POST /api/otp/send - Send OTP to email for verification</li>
                    <li>POST /api/otp/verify - Verify OTP code</li>
                    <li>POST /api/otp/resend - Resend OTP code</li>
                    <li>GET /api/otp/status - Check OTP verification status</li>
                    <li>POST /api/google-auth/setup - Setup Google Authenticator (2FA)</li>
                    <li>POST /api/google-auth/verify-setup - Complete 2FA setup</li>
                    <li>POST /api/google-auth/verify - Verify 2FA code for login</li>
                    <li>GET /api/google-auth/status - Check 2FA status</li>
                    <li>POST /api/google-auth/disable - Disable 2FA</li>
                    <li>GET /api/google-auth/backup-codes - Get backup codes</li>
                    <li>POST /api/verify-firebase-token - Verify Firebase authentication token</li>
                    <li>GET /api/status - Robot status</li>
                </ul>

                <h3>🔄 Basic Movement (Requires Firebase Auth + Email OTP)</h3>
                <ul>
                    <li>POST /api/move/forward - Move forward</li>
                    <li>POST /api/move/backward - Move backward</li>
                    <li>POST /api/move/left - Turn left</li>
                    <li>POST /api/move/right - Turn right</li>
                    <li>POST /api/move/stop - Stop movement</li>
                    <li>POST /api/move/custom - Custom movement</li>
                    <li>POST /api/emergency_stop - Emergency stop (no auth required)</li>
                </ul>

                <div class="pattern-section">
                    <h3>🎨 Geometric Pattern Movement (Requires Firebase Auth + Email OTP)</h3>
                    <ul>
                        <li>POST /api/move/circle - Move in circular pattern
                            <br><small>Parameters: radius, duration, clockwise</small></li>
                        <li>POST /api/move/triangle - Move in triangular pattern
                            <br><small>Parameters: sideLength, pauseDuration</small></li>
                        <li>POST /api/move/love - Move in heart/love pattern
                            <br><small>Parameters: size, duration</small></li>
                        <li>POST /api/move/diamond - Move in diamond pattern
                            <br><small>Parameters: sideLength, pauseDuration</small></li>
                        <li>POST /api/move/square - Move in square pattern
                            <br><small>Parameters: sideLength, linearSpeed, angularSpeed</small></li>
                        <li>POST /api/move/stop_pattern - Stop any pattern movement</li>
                    </ul>
                </div>

                <h3>📊 Sensors (Requires Firebase Auth + Email OTP)</h3>
                <ul>
                    <li>GET /api/sensors/battery - Battery data</li>
                    <li>GET /api/sensors/odometry - Position data</li>
                    <li>GET /api/sensors/laser - Laser scan data</li>
                </ul>                <div style="background: #ffe8e8; padding: 15px; border-radius: 8px; margin: 15px 0;">
                    <h3>🔒 Enhanced Security Authentication Flow</h3>
                    <ol>
                        <li><strong>Firebase Authentication:</strong> Authenticate with Firebase and get ID token</li>
                        <li><strong>Email OTP:</strong> Send OTP to your email using /api/otp/send and verify with /api/otp/verify</li>
                        <li><strong>Google Authenticator (Optional):</strong> 
                            <ul style="margin: 5px 0;">
                                <li>Setup: /api/google-auth/setup (generates QR code)</li>
                                <li>Enable: /api/google-auth/verify-setup (verify first code)</li>
                                <li>Login: /api/google-auth/verify (for each session)</li>
                            </ul>
                        </li>
                        <li><strong>Use APIs:</strong> Include Firebase Bearer token in headers for all API calls</li>
                    </ol>
                    <p><strong>Header Format:</strong> <code>Authorization: Bearer &lt;firebase-id-token&gt;</code></p>
                    <p><strong>Security Levels:</strong></p>
                    <ul>
                        <li>🔑 <strong>Basic:</strong> Firebase Auth + Email OTP</li>
                        <li>🛡️ <strong>Enhanced:</strong> Firebase Auth + Email OTP + Google Authenticator</li>
                    </ul>
                </div>
            </div>
        </body>
        </html>
    `);
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  console.log(`Login attempt for user: ${username} ${password}`);

  if (users[username] && users[username].password === password) {
    req.session.user = username;
    res.json({ success: true, message: "Login successful", user: username });
  } else {
    res.status(401).json({ success: false, message: "Invalid credentials" });
  }
});

app.post("/api/logout", async (req, res) => {
  let userEmail = "unknown";

  try {
    // Try to get user email from Firebase token if provided
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const idToken = authHeader.split("Bearer ")[1];
      const decodedToken = await verifyToken(idToken);
      userEmail = decodedToken.email || decodedToken.uid;
    }
  } catch (error) {
    console.warn(
      "Could not decode Firebase token during logout:",
      error.message
    );
  }
  // Also check legacy session user
  const sessionUser = req.session.user;

  console.log(`User ${userEmail} (session: ${sessionUser}) is logging out`);
  req.session.destroy(async (err) => {
    if (err) {
      console.error("Session destruction failed:", err);
      return res.status(500).json({
        success: false,
        message: "Logout failed",
        user: userEmail,
      });
    } // Reset email verification status if we have a valid email
    if (userEmail && userEmail !== "unknown") {
      try {
        await otpService.resetEmailVerification(userEmail);
        await googleAuthService.resetTwoFactorVerification(userEmail);
      } catch (error) {
        console.error(
          "Error resetting verification status during logout:",
          error
        );
      }
    }

    // Stop the robot on logout
    turtlebot.stop();

    res.json({
      success: true,
      message: "Logged out successfully",
      user: userEmail,
    });
  });
});

app.get("/api/status", requireAuth, (req, res) => {
  res.json(turtlebot.getStatus());
});

// Movement API endpoints (require email verification via OTP)
app.post("/api/move/forward", authenticateAndVerifyEmail, (req, res) => {
  const speed = parseFloat(req.body.speed) || 0.2;
  const success = turtlebot.moveForward(speed);
  res.json({ success, action: "move_forward", speed, user: req.user.email });
});

app.post("/api/move/backward", authenticateAndVerifyEmail, (req, res) => {
  const speed = parseFloat(req.body.speed) || 0.2;
  const success = turtlebot.moveBackward(speed);
  res.json({ success, action: "move_backward", speed, user: req.user.email });
});

app.post("/api/move/left", authenticateAndVerifyEmail, (req, res) => {
  const angular_speed = parseFloat(req.body.angular_speed) || 0.5;
  const success = turtlebot.turnLeft(angular_speed);
  res.json({
    success,
    action: "turn_left",
    angular_speed,
    user: req.user.email,
  });
});

app.post("/api/move/right", authenticateAndVerifyEmail, (req, res) => {
  const angular_speed = parseFloat(req.body.angular_speed) || 0.5;
  const success = turtlebot.turnRight(angular_speed);
  res.json({
    success,
    action: "turn_right",
    angular_speed,
    user: req.user.email,
  });
});

app.post("/api/move/stop", authenticateAndVerifyEmail, (req, res) => {
  const success = turtlebot.stop();
  res.json({ success, action: "stop", user: req.user.email });
});

app.post("/api/move/custom", authenticateAndVerifyEmail, (req, res) => {
  const { linear_x, linear_y, linear_z, angular_x, angular_y, angular_z } =
    req.body;
  const success = turtlebot.customMove(
    linear_x,
    linear_y,
    linear_z,
    angular_x,
    angular_y,
    angular_z
  );
  res.json({
    success,
    action: "custom_move",
    parameters: {
      linear_x,
      linear_y,
      linear_z,
      angular_x,
      angular_y,
      angular_z,
    },
    user: req.user.email,
  });
});

app.post("/api/emergency_stop", (req, res) => {
  const success = turtlebot.emergencyStop();
  res.json({ success, action: "emergency_stop" });
});

// Geometric movement patterns (require OTP email verification)
app.post("/api/move/circle", authenticateAndVerifyEmail, (req, res) => {
  const radius = parseFloat(req.body.radius) || 1.0;
  const duration = parseInt(req.body.duration) || 10000;
  const clockwise = req.body.clockwise !== false; // default true

  const success = turtlebot.moveInCircle(radius, duration, clockwise);
  res.json({
    success,
    action: "move_circle",
    parameters: { radius, duration, clockwise },
    user: req.user.email,
  });
});

app.post("/api/move/triangle", authenticateAndVerifyEmail, (req, res) => {
  const sideLength = parseFloat(req.body.sideLength) || 1.0;
  const pauseDuration = parseInt(req.body.pauseDuration) || 500;

  const success = turtlebot.moveInTriangle(sideLength, pauseDuration);
  res.json({
    success,
    action: "move_triangle",
    parameters: { sideLength, pauseDuration },
    user: req.user.email,
  });
});

app.post("/api/move/love", authenticateAndVerifyEmail, (req, res) => {
  const size = parseFloat(req.body.size) || 1.0;
  const duration = parseInt(req.body.duration) || 20000;

  const success = turtlebot.moveInLove(size, duration);
  res.json({
    success,
    action: "move_love",
    parameters: { size, duration },
    user: req.user.email,
  });
});

app.post("/api/move/diamond", authenticateAndVerifyEmail, (req, res) => {
  const sideLength = parseFloat(req.body.sideLength) || 1.0;
  const pauseDuration = parseInt(req.body.pauseDuration) || 300;

  const success = turtlebot.moveInDiamond(sideLength, pauseDuration);
  res.json({
    success,
    action: "move_diamond",
    parameters: { sideLength, pauseDuration },
    user: req.user.email,
  });
});

// Add square movement endpoint (require email verification via OTP)
app.post("/api/move/square", authenticateAndVerifyEmail, (req, res) => {
  const sideLength = parseFloat(req.body.sideLength) || 2.0;
  const linearSpeed = parseFloat(req.body.linearSpeed) || 0.2;
  const angularSpeed = parseFloat(req.body.angularSpeed) || 0.5;

  const success = turtlebot.moveSquare(sideLength, linearSpeed, angularSpeed);
  res.json({
    success,
    action: "move_square",
    parameters: { sideLength, linearSpeed, angularSpeed },
    user: req.user.email,
  });
});

app.post("/api/verify-firebase-token", async (req, res) => {
  try {
    const { idToken, isNewUser } = req.body;

    // Verify the ID token
    const decodedToken = await verifyToken(idToken);
    const uid = decodedToken.uid;
    const email = decodedToken.email;

    if (isNewUser) {
      console.log("New user registered:", { uid, email });
      // Here you can save user data to your database
    } else {
      console.log("User authenticated:", { uid, email });
    }

    res.json({
      success: true,
      uid: uid,
      email: email,
      isNewUser: isNewUser || false,
    });
  } catch (error) {
    console.error("Token verification error:", error);
    res.status(401).json({ error: "Invalid token" });
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// Sensor data endpoints (require OTP email verification)
app.get("/api/sensors/battery", authenticateAndVerifyEmail, (req, res) => {
  if (turtlebot.batteryData) {
    res.json({ ...turtlebot.batteryData, user: req.user.email });
  } else {
    res
      .status(503)
      .json({ error: "Battery data not available", user: req.user.email });
  }
});

app.get("/api/sensors/odometry", authenticateAndVerifyEmail, (req, res) => {
  if (turtlebot.odomData) {
    res.json({ ...turtlebot.odomData, user: req.user.email });
  } else {
    res
      .status(503)
      .json({ error: "Odometry data not available", user: req.user.email });
  }
});

app.get("/api/sensors/laser", authenticateAndVerifyEmail, (req, res) => {
  if (turtlebot.laserData) {
    res.json({ ...turtlebot.laserData, user: req.user.email });
  } else {
    res
      .status(503)
      .json({ error: "Laser data not available", user: req.user.email });
  }
});

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
  socket.on("move_command", (data) => {
    const { action, parameters = {} } = data;
    let success = false;
    console.log(`ACTION: ${action}`);

    switch (action) {
      case "forward":
        success = turtlebot.moveForward(parameters.speed || 0.2);
        break;
      case "backward":
        success = turtlebot.moveBackward(parameters.speed || 0.2);
        break;
      case "left":
        success = turtlebot.turnLeft(parameters.angular_speed || 0.5);
        break;
      case "right":
        success = turtlebot.turnRight(parameters.angular_speed || 0.5);
        break;
      case "stop":
        success = turtlebot.stop();
        break;
      case "custom":
        success = turtlebot.customMove(
          parameters.linear_x,
          parameters.linear_y,
          parameters.linear_z,
          parameters.angular_x,
          parameters.angular_y,
          parameters.angular_z
        );
        break;
      // New pattern movements
      case "circle":
        success = turtlebot.moveInCircle(
          parameters.radius || 1.0,
          parameters.duration || 10000,
          parameters.clockwise !== false
        );
        break;
      case "triangle":
        success = turtlebot.moveInTriangle(
          parameters.sideLength || 1.0,
          parameters.pauseDuration || 500
        );
        break;
      case "love":
        success = turtlebot.moveInLove(
          parameters.size || 1.0,
          parameters.duration || 20000
        );
        break;
      case "diamond":
        success = turtlebot.moveInDiamond(
          parameters.sideLength || 1.0,
          parameters.pauseDuration || 300
        );
        break;
      case "square":
        success = turtlebot.moveSquare(
          parameters.sideLength || 2.0,
          parameters.linearSpeed || 0.2,
          parameters.angularSpeed || 0.5
        );
        break;
      case "stop_pattern":
        success = turtlebot.stopPattern();
        break;
      default:
        socket.emit("error", { message: "Unknown action" });
        return;
    }

    socket.emit("move_response", { success, action, parameters });
  });

  socket.on("emergency_stop", () => {
    const success = turtlebot.emergencyStop();
    io.emit("emergency_stop_activated", { success });
  });

  socket.emit("status_update", turtlebot.getStatus());

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// Error handling
process.on("SIGINT", () => {
  console.log("Shutting down gracefully...");
  turtlebot.cleanup();
  process.exit(0);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  turtlebot.cleanup();
});

module.exports = { app, turtlebot };
