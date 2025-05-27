const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const session = require('express-session');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const port = 3000;

// Middleware
app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    optionsSuccessStatus: 200
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'turtlebot-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    name: 'turtlebot.sid',
    cookie: { 
        secure: false, // Set to true if using HTTPS
        httpOnly: false, // Change to false to allow frontend access
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'lax'
    }
}));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Enhanced user management
const users = {
    'admin': { 
        password: 'admin123',
        role: 'admin',
        lastLogin: null,
        loginAttempts: 0,
        lockedUntil: null
    }
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
        this.currentTwist = { linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } };
        this.batteryData = null;
        this.odomData = null;
        this.laserData = null;
        this.isMoving = false;
        this.rosMode = false; // Flag to indicate if ROS is available
        
        this.initializeROS();
    }

    async initializeROS() {
        try {
            // Try to import rosnodejs dynamically
            const rosnodejs = await import('rosnodejs');
            
            // Check if ROS environment is available
            if (!process.env.CMAKE_PREFIX_PATH && !process.env.ROS_PACKAGE_PATH) {
                console.warn('ROS environment not detected. Running in simulation mode.');
                this.initializeSimulationMode();
                return;
            }

            // Initialize ROS node
            this.rosNode = await rosnodejs.initNode('/turtlebot_web_controller', {
                onTheFly: true
            });
            
            console.log('ROS node initialized successfully');

            // Create command velocity publisher
            this.cmdVelPublisher = this.rosNode.advertise('/cmd_vel', 'geometry_msgs/Twist');
            console.log('Command velocity publisher created');

            // Subscribe to battery status
            this.batterySubscriber = this.rosNode.subscribe('/laptop_charge', 'smart_battery_msgs/SmartBatteryStatus', 
                (msg) => this.batteryCallback(msg));

            // Subscribe to odometry
            this.odomSubscriber = this.rosNode.subscribe('/odom', 'nav_msgs/Odometry',
                (msg) => this.odomCallback(msg));

            // Subscribe to laser scan
            this.laserSubscriber = this.rosNode.subscribe('/scan', 'sensor_msgs/LaserScan',
                (msg) => this.laserCallback(msg));

            this.isConnected = true;
            this.rosMode = true;
            console.log('TurtleBot controller initialized successfully');

        } catch (error) {
            console.warn('ROS initialization failed:', error.message);
            console.log('Running in simulation mode...');
            this.initializeSimulationMode();
        }
    }

    initializeSimulationMode() {
        this.isConnected = true;
        this.rosMode = false;
        
        // Simulate battery data
        this.batteryData = {
            percentage: 0.75,
            voltage: 12.5,
            current: -0.5,
            charge: 7500,
            capacity: 10000,
            design_capacity: 10000,
            present: true,
            timestamp: Date.now()
        };

        // Simulate odometry data
        this.odomData = {
            position: { x: 0, y: 0, z: 0 },
            orientation: { x: 0, y: 0, z: 0, w: 1 },
            linear_velocity: { x: 0, y: 0, z: 0 },
            angular_velocity: { x: 0, y: 0, z: 0 },
            timestamp: Date.now()
        };

        // Start simulation timers
        this.startSimulation();
        
        console.log('Simulation mode initialized');
    }

    startSimulation() {
        // Update battery data every 30 seconds
        setInterval(() => {
            if (this.batteryData && !this.rosMode) {
                this.batteryData.percentage = Math.max(0.1, this.batteryData.percentage - 0.001);
                this.batteryData.timestamp = Date.now();
                io.emit('battery_update', this.batteryData);
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
                io.emit('odom_update', this.odomData);
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
                    timestamp: Date.now()
                };
                
                io.emit('laser_update', this.laserData);
            }
        }, 200);
    }

    batteryCallback(msg) {
        this.batteryData = {
            percentage: msg.percentage,
            voltage: msg.voltage,
            current: msg.current,
            charge: msg.charge,
            capacity: msg.capacity,
            design_capacity: msg.design_capacity,
            present: msg.present,
            timestamp: Date.now()
        };
        
        io.emit('battery_update', this.batteryData);
    }

    odomCallback(msg) {
        this.odomData = {
            position: {
                x: msg.pose.pose.position.x,
                y: msg.pose.pose.position.y,
                z: msg.pose.pose.position.z
            },
            orientation: {
                x: msg.pose.pose.orientation.x,
                y: msg.pose.pose.orientation.y,
                z: msg.pose.pose.orientation.z,
                w: msg.pose.pose.orientation.w
            },
            linear_velocity: {
                x: msg.twist.twist.linear.x,
                y: msg.twist.twist.linear.y,
                z: msg.twist.twist.linear.z
            },
            angular_velocity: {
                x: msg.twist.twist.angular.x,
                y: msg.twist.twist.angular.y,
                z: msg.twist.twist.angular.z
            },
            timestamp: Date.now()
        };
        
        io.emit('odom_update', this.odomData);
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
            timestamp: Date.now()
        };
        
        if (Date.now() % 100 < 50) {
            io.emit('laser_update', this.laserData);
        }
    }

    publishTwist(linear_x = 0, linear_y = 0, linear_z = 0, angular_x = 0, angular_y = 0, angular_z = 0) {
        if (!this.isConnected) {
            console.warn('Controller not connected');
            return false;
        }

        const twist = {
            linear: { x: linear_x, y: linear_y, z: linear_z },
            angular: { x: angular_x, y: angular_y, z: angular_z }
        };

        if (this.rosMode && this.cmdVelPublisher) {
            // Publish to actual ROS topic
            this.cmdVelPublisher.publish(twist);
        } else {
            // Simulation mode - just log the command
            console.log(`Movement command: linear=[${linear_x.toFixed(2)}, ${linear_y.toFixed(2)}, ${linear_z.toFixed(2)}], angular=[${angular_x.toFixed(2)}, ${angular_y.toFixed(2)}, ${angular_z.toFixed(2)}]`);
        }

        this.currentTwist = twist;
        this.isMoving = (linear_x !== 0 || linear_y !== 0 || linear_z !== 0 || 
                        angular_x !== 0 || angular_y !== 0 || angular_z !== 0);
        
        io.emit('movement_update', {
            twist: this.currentTwist,
            is_moving: this.isMoving
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

    customMove(linear_x, linear_y = 0, linear_z = 0, angular_x = 0, angular_y = 0, angular_z = 0) {
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
            timestamp: Date.now()
        };
    }

    emergencyStop() {
        console.log('EMERGENCY STOP ACTIVATED');
        this.stop();
        return true;
    }
}

// Initialize TurtleBot controller
const turtlebot = new TurtleBotController();

// Rate limiting for login attempts
const loginAttempts = new Map();

function rateLimitLogin(req, res, next) {
    const ip = req.ip;
    const attempts = loginAttempts.get(ip) || { count: 0, resetTime: Date.now() };
    
    if (Date.now() > attempts.resetTime) {
        attempts.count = 0;
        attempts.resetTime = Date.now() + 15 * 60 * 1000; // 15 minutes
    }
    
    if (attempts.count >= 5) {
        return res.status(429).json({ 
            success: false, 
            error: 'Too many login attempts. Try again later.' 
        });
    }
    
    loginAttempts.set(ip, attempts);
    next();
}

// Enhanced authentication middleware
function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({ 
            success: false, 
            error: 'Authentication required',
            redirect: '/login'
        });
    }
    next();
}

// Redirect root to login if not authenticated (replace existing app.get('/'))
app.get('/', (req, res) => {
    if (req.session.user) {
        res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>TurtleBot Control Server</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 40px; }
                .status { background: #f0f0f0; padding: 20px; border-radius: 10px; margin: 20px 0; }
                .api-list { background: #e8f4f8; padding: 20px; border-radius: 10px; }
                .user-info { background: #d4edda; padding: 15px; border-radius: 10px; margin-bottom: 20px; }
                .logout-btn { background: #dc3545; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; }
            </style>
        </head>
        <body>
            <div class="user-info">
                <h3>Welcome, ${req.session.user}!</h3>
                <p>Role: ${req.session.role || 'admin'}</p>
                <a href="#" class="logout-btn" onclick="logout()">Logout</a>
            </div>
            
            <h1>TurtleBot Control Server</h1>
            <div class="status">
                <h2>Server Status</h2>
                <p>✅ Server is running on port ${port}</p>
                <p>🤖 Robot Mode: ${turtlebot.rosMode ? 'ROS Connected' : 'Simulation'}</p>
                <p>🔗 Connection Status: ${turtlebot.isConnected ? 'Connected' : 'Disconnected'}</p>
            </div>
            
            <div class="api-list">
                <h2>Available API Endpoints</h2>
                <ul>
                    <li>POST /api/login - User authentication</li>
                    <li>POST /api/logout - User logout</li>
                    <li>GET /api/auth/status - Check authentication status</li>
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
            
            <script>                async function logout() {
                    try {
                        const response = await fetch('/api/logout', { 
                            method: 'POST',
                            credentials: 'include'
                        });
                        const result = await response.json();
                        if (result.success) {
                            window.location.href = '/login';
                        }
                    } catch (error) {
                        console.error('Logout failed:', error);
                    }
                }
            </script>
        </body>
        </html>
    `);
    } else {
        res.redirect('/login');
    }
});

// Enhanced login route (replace existing /api/login)
app.post('/api/login', rateLimitLogin, (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ 
            success: false, 
            error: 'Username and password required' 
        });
    }
    
    const user = users[username];
    
    // Check if user exists and account is not locked
    if (!user) {
        const ip = req.ip;
        const attempts = loginAttempts.get(ip) || { count: 0, resetTime: Date.now() };
        attempts.count += 1;
        loginAttempts.set(ip, attempts);
        
        return res.status(401).json({ 
            success: false, 
            error: 'Invalid credentials' 
        });
    }
    
    // Check if account is locked
    if (user.lockedUntil && Date.now() < user.lockedUntil) {
        return res.status(423).json({ 
            success: false, 
            error: 'Account temporarily locked due to multiple failed attempts' 
        });
    }
    
    // Verify password
    if (user.password !== password) {
        user.loginAttempts = (user.loginAttempts || 0) + 1;
        
        if (user.loginAttempts >= 5) {
            user.lockedUntil = Date.now() + 15 * 60 * 1000; // Lock for 15 minutes
        }
        
        const ip = req.ip;
        const attempts = loginAttempts.get(ip) || { count: 0, resetTime: Date.now() };
        attempts.count += 1;
        loginAttempts.set(ip, attempts);
        
        return res.status(401).json({ 
            success: false, 
            error: 'Invalid credentials' 
        });
    }
      // Successful login
    user.loginAttempts = 0;
    user.lockedUntil = null;
    user.lastLogin = new Date().toISOString();
    
    req.session.user = username;
    req.session.role = user.role;
    
    console.log("LOGGED IN - Session ID:", req.sessionID);
    console.log("LOGGED IN - Session user:", req.session.user);
    console.log("LOGGED IN - Session data:", req.session);
    
    res.json({ 
        success: true, 
        message: 'Login successful', 
        user: {
            username: username,
            role: user.role,
            lastLogin: user.lastLogin
        }
    });
});

// Enhanced logout route (replace existing /api/logout)
app.post('/api/logout', (req, res) => {
    const user = req.session.user;
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ 
                success: false, 
                error: 'Logout failed' 
            });
        }
        
        // Stop robot movement on logout
        if (turtlebot) {
            turtlebot.stop();
        }
        
        res.json({ 
            success: true, 
            message: 'Logged out successfully' 
        });
    });
});

// Check authentication status
app.get('/api/auth/status', (req, res) => {
    console.log('Auth status check - Origin:', req.get('Origin'));
    console.log('Auth status check - Cookie:', req.get('Cookie'));
    console.log('Auth status check - Session ID:', req.sessionID);
    console.log('Auth status check - Session user:', req.session.user);
    
    if (req.session.user) {
        const user = users[req.session.user];
        console.log("AUTHENTICATED - User:", req.session.user);
        res.json({ 
            authenticated: true, 
            user: {
                username: req.session.user,
                role: req.session.role,
                lastLogin: user.lastLogin
            }
        });
    } else {
        console.log("NOT AUTHENTICATED - New session created");
        res.json({ authenticated: false });
    }
});

// Serve login page
app.get('/login', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>TurtleBot Login</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 0; padding: 0; background: #f5f5f5; }
                .login-container { max-width: 400px; margin: 100px auto; padding: 20px; background: white; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                .form-group { margin-bottom: 15px; }
                label { display: block; margin-bottom: 5px; font-weight: bold; }
                input { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; box-sizing: border-box; }
                button { width: 100%; padding: 10px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 16px; }
                button:hover { background: #0056b3; }
                .error { color: red; margin-top: 10px; }
                .header { text-align: center; margin-bottom: 30px; }
            </style>
        </head>
        <body>
            <div class="login-container">
                <div class="header">
                    <h2>🤖 TurtleBot Control</h2>
                    <p>Please login to continue</p>
                </div>
                <form id="loginForm">
                    <div class="form-group">
                        <label for="username">Username:</label>
                        <input type="text" id="username" name="username" required>
                    </div>
                    <div class="form-group">
                        <label for="password">Password:</label>
                        <input type="password" id="password" name="password" required>
                    </div>
                    <button type="submit">Login</button>
                    <div id="error" class="error"></div>
                </form>
            </div>
            
            <script>
                document.getElementById('loginForm').addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const formData = new FormData(e.target);
                    const data = Object.fromEntries(formData);
                      try {
                        const response = await fetch('/api/login', {
                            method: 'POST',
                            credentials: 'include', // Important: Include cookies
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(data)
                        });
                        
                        const result = await response.json();
                        
                        if (result.success) {
                            window.location.href = '/';
                        } else {
                            document.getElementById('error').textContent = result.error;
                        }
                    } catch (error) {
                        document.getElementById('error').textContent = 'Login failed. Please try again.';
                    }
                });
            </script>
        </body>
        </html>
    `);
});

// Test endpoint for debugging sessions
app.get('/test', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Session Test</title>
        </head>
        <body>
            <h1>Session Test Page</h1>
            <div id="status"></div>
            <button onclick="login()">Test Login</button>
            <button onclick="checkAuth()">Check Auth</button>
            <button onclick="logout()">Test Logout</button>
            
            <script>
                async function login() {
                    try {
                        const response = await fetch('/api/login', {
                            method: 'POST',
                            credentials: 'include',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ username: 'admin', password: 'admin123' })
                        });
                        const result = await response.json();
                        document.getElementById('status').innerHTML = 'Login: ' + JSON.stringify(result);
                    } catch (error) {
                        document.getElementById('status').innerHTML = 'Login Error: ' + error.message;
                    }
                }
                
                async function checkAuth() {
                    try {
                        const response = await fetch('/api/auth/status', {
                            method: 'GET',
                            credentials: 'include'
                        });
                        const result = await response.json();
                        document.getElementById('status').innerHTML = 'Auth Status: ' + JSON.stringify(result);
                    } catch (error) {
                        document.getElementById('status').innerHTML = 'Auth Error: ' + error.message;
                    }
                }
                
                async function logout() {
                    try {
                        const response = await fetch('/api/logout', {
                            method: 'POST',
                            credentials: 'include'
                        });
                        const result = await response.json();
                        document.getElementById('status').innerHTML = 'Logout: ' + JSON.stringify(result);
                    } catch (error) {
                        document.getElementById('status').innerHTML = 'Logout Error: ' + error.message;
                    }
                }
            </script>
        </body>
        </html>
    `);
});

app.get('/api/status', requireAuth, (req, res) => {
    res.json(turtlebot.getStatus());
});

// Movement API endpoints
app.post('/api/move/forward', requireAuth, (req, res) => {
    const speed = parseFloat(req.body.speed) || 0.2;
    const success = turtlebot.moveForward(speed);
    res.json({ success, action: 'move_forward', speed });
});

app.post('/api/move/backward', requireAuth, (req, res) => {
    const speed = parseFloat(req.body.speed) || 0.2;
    const success = turtlebot.moveBackward(speed);
    res.json({ success, action: 'move_backward', speed });
});

app.post('/api/move/left', requireAuth, (req, res) => {
    const angular_speed = parseFloat(req.body.angular_speed) || 0.5;
    const success = turtlebot.turnLeft(angular_speed);
    res.json({ success, action: 'turn_left', angular_speed });
});

app.post('/api/move/right', requireAuth, (req, res) => {
    const angular_speed = parseFloat(req.body.angular_speed) || 0.5;
    const success = turtlebot.turnRight(angular_speed);
    res.json({ success, action: 'turn_right', angular_speed });
});

app.post('/api/move/stop', requireAuth, (req, res) => {
    const success = turtlebot.stop();
    res.json({ success, action: 'stop' });
});

app.post('/api/move/custom', requireAuth, (req, res) => {
    const { linear_x, linear_y, linear_z, angular_x, angular_y, angular_z } = req.body;
    const success = turtlebot.customMove(linear_x, linear_y, linear_z, angular_x, angular_y, angular_z);
    res.json({ 
        success, 
        action: 'custom_move',
        parameters: { linear_x, linear_y, linear_z, angular_x, angular_y, angular_z }
    });
});

app.post('/api/emergency_stop', (req, res) => {
    const success = turtlebot.emergencyStop();
    res.json({ success, action: 'emergency_stop' });
});

// Sensor data endpoints
app.get('/api/sensors/battery', requireAuth, (req, res) => {
    if (turtlebot.batteryData) {
        res.json(turtlebot.batteryData);
    } else {
        res.status(503).json({ error: 'Battery data not available' });
    }
});

app.get('/api/sensors/odometry', requireAuth, (req, res) => {
    if (turtlebot.odomData) {
        res.json(turtlebot.odomData);
    } else {
        res.status(503).json({ error: 'Odometry data not available' });
    }
});

app.get('/api/sensors/laser', requireAuth, (req, res) => {
    if (turtlebot.laserData) {
        res.json(turtlebot.laserData);
    } else {
        res.status(503).json({ error: 'Laser data not available' });
    }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('move_command', (data) => {
        const { action, parameters = {} } = data;
        let success = false;
        console.log("MOVING");

        switch (action) {
            case 'forward':
                success = turtlebot.moveForward(parameters.speed || 0.2);
                break;
            case 'backward':
                success = turtlebot.moveBackward(parameters.speed || 0.2);
                break;
            case 'left':
                success = turtlebot.turnLeft(parameters.angular_speed || 0.5);
                break;
            case 'right':
                success = turtlebot.turnRight(parameters.angular_speed || 0.5);
                break;
            case 'stop':
                success = turtlebot.stop();
                break;
            case 'custom':
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
                socket.emit('error', { message: 'Unknown action' });
                return;
        }

        socket.emit('move_response', { success, action, parameters });
    });

    socket.on('emergency_stop', () => {
        const success = turtlebot.emergencyStop();
        io.emit('emergency_stop_activated', { success });
    });

    socket.emit('status_update', turtlebot.getStatus());

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// Error handling
process.on('SIGINT', () => {
    console.log('Shutting down gracefully...');
    turtlebot.stop();
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    turtlebot.stop();
});

// Start server
server.listen(port, () => {
    console.log(`TurtleBot backend server running on port ${port}`);
    console.log(`Access the control interface at http://localhost:${port}`);
    console.log(`Mode: ${turtlebot.rosMode ? 'ROS Connected' : 'Simulation'}`);
});

module.exports = { app, turtlebot };