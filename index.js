const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const session = require("express-session");
const path = require("path");

const app = express();
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const port = 3000;

// Middleware
app.use(cors());
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

    this.initializeROS();
  }

  async initializeROS() {
    try {
      // Try to import rosnodejs using require instead of dynamic import
      let rosnodejs;
      try {
        rosnodejs = require("rosnodejs");
      } catch (requireError) {
        console.warn(
          "rosnodejs not found via require, trying dynamic import..."
        );
        rosnodejs = await import("rosnodejs");
        // Handle ES module default export
        if (rosnodejs.default) {
          rosnodejs = rosnodejs.default;
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

      console.log("ROS environment detected:");
      console.log("- ROS_MASTER_URI:", process.env.ROS_MASTER_URI || "not set");
      console.log(
        "- CMAKE_PREFIX_PATH:",
        process.env.CMAKE_PREFIX_PATH ? "set" : "not set"
      );
      console.log(
        "- ROS_PACKAGE_PATH:",
        process.env.ROS_PACKAGE_PATH ? "set" : "not set"
      );

      // Initialize ROS node with proper error handling
      if (typeof rosnodejs.initNode !== "function") {
        throw new Error(
          "rosnodejs.initNode is not a function. Check rosnodejs installation."
        );
      }

      this.rosNode = await rosnodejs.initNode("/turtlebot_web_controller", {
        onTheFly: true,
        anonymous: false,
      });

      console.log("ROS node initialized successfully");

      // Get node handle
      const nh = rosnodejs.nh;

      // Create command velocity publisher for TurtleBot1
      this.cmdVelPublisher = nh.advertise(
        "/cmd_vel_mux/input/navi",
        "geometry_msgs/Twist",
        {
          queueSize: 1,
          latching: false,
        }
      );
      console.log(
        "Command velocity publisher created on topic: /cmd_vel_mux/input/navi"
      );

      // Alternative topic for TurtleBot1 if the above doesn't work
      // this.cmdVelPublisher = nh.advertise('/mobile_base/commands/velocity', 'geometry_msgs/Twist');

      // Subscribe to battery status (adjust topic name for TurtleBot1)
      try {
        // Try different battery topics and message types for TurtleBot1
        const batteryTopics = [
          {
            topic: "/laptop_charge",
            msgType: "smart_battery_msgs/SmartBatteryStatus",
          },
          { topic: "/battery_state", msgType: "sensor_msgs/BatteryState" },
          { topic: "/diagnostics", msgType: "diagnostic_msgs/DiagnosticArray" },
          { topic: "/power_state", msgType: "kobuki_msgs/PowerSystemEvent" },
        ];

        let batterySubscribed = false;
        for (const battery of batteryTopics) {
          try {
            this.batterySubscriber = nh.subscribe(
              battery.topic,
              battery.msgType,
              (msg) => this.batteryCallback(msg, battery.msgType),
              {
                queueSize: 1,
              }
            );
            console.log(
              `Battery subscriber created on topic: ${battery.topic} with type: ${battery.msgType}`
            );
            batterySubscribed = true;
            break;
          } catch (subError) {
            console.warn(
              `Could not subscribe to ${battery.topic}:`,
              subError.message
            );
          }
        }

        if (!batterySubscribed) {
          console.warn(
            "No battery topics available. Battery monitoring disabled."
          );
        }
      } catch (batteryError) {
        console.warn(
          "Could not subscribe to any battery topic:",
          batteryError.message
        );
      }

      // Subscribe to odometry
      try {
        this.odomSubscriber = nh.subscribe(
          "/odom",
          "nav_msgs/Odometry",
          (msg) => this.odomCallback(msg),
          {
            queueSize: 1,
          }
        );
        console.log("Odometry subscriber created");
      } catch (odomError) {
        console.warn(
          "Could not subscribe to odometry topic:",
          odomError.message
        );
      }

      // Subscribe to laser scan
      try {
        this.laserSubscriber = nh.subscribe(
          "/scan",
          "sensor_msgs/LaserScan",
          (msg) => this.laserCallback(msg),
          {
            queueSize: 1,
          }
        );
        console.log("Laser scan subscriber created");
      } catch (laserError) {
        console.warn("Could not subscribe to laser topic:", laserError.message);
      }

      this.isConnected = true;
      this.rosMode = true;
      console.log("TurtleBot controller initialized successfully in ROS mode");

      // Test the connection by publishing a zero twist
      setTimeout(() => {
        this.publishTwist(0, 0, 0, 0, 0, 0);
        console.log("Test message published to cmd_vel topic");
      }, 1000);
    } catch (error) {
      console.error("ROS initialization failed:", error);
      console.log("Error details:", {
        message: error.message,
        stack: error.stack,
        rosnodejsAvailable: typeof require("rosnodejs") !== "undefined",
      });
      console.log("Falling back to simulation mode...");
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

    if (this.rosMode && this.cmdVelPublisher) {
      try {
        // Publish to actual ROS topic
        this.cmdVelPublisher.publish(twist);
        console.log(
          `ROS command published: linear=[${twist.linear.x.toFixed(
            2
          )}, ${twist.linear.y.toFixed(2)}, ${twist.linear.z.toFixed(
            2
          )}], angular=[${twist.angular.x.toFixed(
            2
          )}, ${twist.angular.y.toFixed(2)}, ${twist.angular.z.toFixed(2)}]`
        );
      } catch (publishError) {
        console.error("Failed to publish ROS message:", publishError);
        return false;
      }
    } else {
      // Simulation mode - just log the command
      console.log(
        `Simulation command: linear=[${twist.linear.x.toFixed(
          2
        )}, ${twist.linear.y.toFixed(2)}, ${twist.linear.z.toFixed(
          2
        )}], angular=[${twist.angular.x.toFixed(2)}, ${twist.angular.y.toFixed(
          2
        )}, ${twist.angular.z.toFixed(2)}]`
      );
    }

    this.currentTwist = twist;
    this.isMoving =
      twist.linear.x !== 0 ||
      twist.linear.y !== 0 ||
      twist.linear.z !== 0 ||
      twist.angular.x !== 0 ||
      twist.angular.y !== 0 ||
      twist.angular.z !== 0;

    io.emit("movement_update", {
      twist: this.currentTwist,
      is_moving: this.isMoving,
    });

    return true;
  }

  moveForward(speed = 0.2) {
    return this.publishTwist(speed, 0, 0, 0, 0, 0);
  }

  moveBackward(speed = 0.2) {
    return this.publishTwist(-speed, 0, 0, 0, 0, 0);
  }

  turnLeft(angularSpeed = 0.5) {
    return this.publishTwist(0, 0, 0, 0, 0, angularSpeed);
  }

  turnRight(angularSpeed = 0.5) {
    return this.publishTwist(0, 0, 0, 0, 0, -angularSpeed);
  }

  stop() {
    return this.publishTwist(0, 0, 0, 0, 0, 0);
  }

  customMove(
    linear_x,
    linear_y = 0,
    linear_z = 0,
    angular_x = 0,
    angular_y = 0,
    angular_z = 0
  ) {
    return this.publishTwist(
      parseFloat(linear_x) || 0,
      parseFloat(linear_y) || 0,
      parseFloat(linear_z) || 0,
      parseFloat(angular_x) || 0,
      parseFloat(angular_y) || 0,
      parseFloat(angular_z) || 0
    );
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
}

// Initialize TurtleBot controller
const turtlebot = new TurtleBotController();

// Authentication middleware
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
                <ul>
                    <li>POST /api/login - User authentication</li>
                    <li>POST /api/logout - User logout</li>
                    <li>GET /api/status - Robot status</li>
                    <li>POST /api/move/forward - Move forward</li>
                    <li>POST /api/move/backward - Move backward</li>
                    <li>POST /api/move/left - Turn left</li>
                    <li>POST /api/move/right - Turn right</li>
                    <li>POST /api/move/stop - Stop movement</li>
                    <li>POST /api/emergency_stop - Emergency stop</li>
                    <li>GET /api/sensors/battery - Battery data</li>
                    <li>GET /api/sensors/odometry - Position data</li>
                    <li>GET /api/sensors/laser - Laser scan data</li>
                </ul>
            </div>
        </body>
        </html>
    `);
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;

  if (users[username] && users[username].password === password) {
    req.session.user = username;
    res.json({ success: true, message: "Login successful", user: username });
  } else {
    res.status(401).json({ success: false, message: "Invalid credentials" });
  }
});

app.post("/api/logout", (req, res) => {
  const user = req.session.user;
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, message: "Logout failed" });
    }
    turtlebot.stop();
    res.json({ success: true, message: "Logged out successfully" });
  });
});

app.get("/api/status", requireAuth, (req, res) => {
  res.json(turtlebot.getStatus());
});

// Movement API endpoints
app.post("/api/move/forward", requireAuth, (req, res) => {
  const speed = parseFloat(req.body.speed) || 0.2;
  const success = turtlebot.moveForward(speed);
  res.json({ success, action: "move_forward", speed });
});

app.post("/api/move/backward", requireAuth, (req, res) => {
  const speed = parseFloat(req.body.speed) || 0.2;
  const success = turtlebot.moveBackward(speed);
  res.json({ success, action: "move_backward", speed });
});

app.post("/api/move/left", requireAuth, (req, res) => {
  const angular_speed = parseFloat(req.body.angular_speed) || 0.5;
  const success = turtlebot.turnLeft(angular_speed);
  res.json({ success, action: "turn_left", angular_speed });
});

app.post("/api/move/right", requireAuth, (req, res) => {
  const angular_speed = parseFloat(req.body.angular_speed) || 0.5;
  const success = turtlebot.turnRight(angular_speed);
  res.json({ success, action: "turn_right", angular_speed });
});

app.post("/api/move/stop", requireAuth, (req, res) => {
  const success = turtlebot.stop();
  res.json({ success, action: "stop" });
});

app.post("/api/move/custom", requireAuth, (req, res) => {
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
  });
});

app.post("/api/emergency_stop", (req, res) => {
  const success = turtlebot.emergencyStop();
  res.json({ success, action: "emergency_stop" });
});

app.post("/verify-firebase-token", async (req, res) => {
  try {
    const { idToken, isNewUser } = req.body;

    // Verify the ID token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
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

// Sensor data endpoints
app.get("/api/sensors/battery", requireAuth, (req, res) => {
  if (turtlebot.batteryData) {
    res.json(turtlebot.batteryData);
  } else {
    res.status(503).json({ error: "Battery data not available" });
  }
});

app.get("/api/sensors/odometry", requireAuth, (req, res) => {
  if (turtlebot.odomData) {
    res.json(turtlebot.odomData);
  } else {
    res.status(503).json({ error: "Odometry data not available" });
  }
});

app.get("/api/sensors/laser", requireAuth, (req, res) => {
  if (turtlebot.laserData) {
    res.json(turtlebot.laserData);
  } else {
    res.status(503).json({ error: "Laser data not available" });
  }
});

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("move_command", (data) => {
    const { action, parameters = {} } = data;
    let success = false;
    console.log("MOVING");

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
  turtlebot.stop();
  process.exit(0);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  turtlebot.stop();
});

// Start server
const server = app.listen(4000, "0.0.0.0", () => {
  console.log("Server listening on port 4000");
  console.log(`TurtleBot backend server running on port 4000`);
  console.log(`Access the control interface at http://0.0.0.0:4000`);
  console.log(`Mode: ${turtlebot.rosMode ? "ROS Connected" : "Simulation"}`);
});

module.exports = { app, turtlebot };
