# TurtleBot Backend with Firebase Authentication

This backend server provides API endpoints for controlling a TurtleBot robot with Firebase-based authentication and role-based access control.

## Features

- ✅ Firebase Authentication integration
- ✅ Role-based access control (admin, user, moderator)
- ✅ TurtleBot movement control (forward, backward, left, right, stop)
- ✅ Geometric pattern movements (circle, triangle, heart/love, diamond)
- ✅ Real-time communication via Socket.IO
- ✅ Sensor data endpoints (battery, odometry, laser)
- ✅ ROS integration with simulation fallback

## Setup Instructions

### 1. Firebase Project Setup

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project or select existing one
3. Enable Authentication in the Firebase console
4. Set up sign-in methods (Email/Password, Google, etc.)

### 2. Firebase Service Account Key

1. In Firebase Console, go to Project Settings → Service Accounts
2. Click "Generate new private key"
3. Download the JSON file
4. Replace `serviceAccountKey.json` with your downloaded file
5. **Important**: This file is already in `.gitignore` - never commit it to version control

### 3. Environment Variables

Update the `.env` file with your configuration:

```env
# Firebase Admin SDK
FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccountKey.json

# Server Config
PORT=4000
FRONTEND_URL=http://localhost:5173
```

### 4. Installation

```bash
cd tb-backend
npm install
```

### 5. Running the Server

```bash
# Development mode
npm run dev

# Production mode
npm start
```

## API Endpoints

### Authentication Routes (`/api/auth`)

| Method | Endpoint                | Description                               | Auth Required | Admin Only |
| ------ | ----------------------- | ----------------------------------------- | ------------- | ---------- |
| POST   | `/api/auth/assign-role` | Assign role to user (public registration) | No            | No         |
| POST   | `/api/auth/update-role` | Update user role                          | Yes           | Yes        |
| GET    | `/api/auth/user/:uid`   | Get user info with roles                  | Yes           | No\*       |
| GET    | `/api/auth/users`       | Get all users                             | Yes           | Yes        |

\*Users can only access their own info unless they're admin

### Robot Control Routes (Firebase Auth Required)

| Method | Endpoint             | Description     | Parameters                                                                |
| ------ | -------------------- | --------------- | ------------------------------------------------------------------------- |
| POST   | `/api/move/forward`  | Move forward    | `speed` (optional)                                                        |
| POST   | `/api/move/backward` | Move backward   | `speed` (optional)                                                        |
| POST   | `/api/move/left`     | Turn left       | `angular_speed` (optional)                                                |
| POST   | `/api/move/right`    | Turn right      | `angular_speed` (optional)                                                |
| POST   | `/api/move/stop`     | Stop movement   | None                                                                      |
| POST   | `/api/move/custom`   | Custom movement | `linear_x`, `linear_y`, `linear_z`, `angular_x`, `angular_y`, `angular_z` |

### Pattern Movement Routes (Legacy Auth Required)

| Method | Endpoint                 | Description           | Parameters                        |
| ------ | ------------------------ | --------------------- | --------------------------------- |
| POST   | `/api/move/circle`       | Move in circle        | `radius`, `duration`, `clockwise` |
| POST   | `/api/move/triangle`     | Move in triangle      | `sideLength`, `pauseDuration`     |
| POST   | `/api/move/love`         | Move in heart pattern | `size`, `duration`                |
| POST   | `/api/move/diamond`      | Move in diamond       | `sideLength`, `pauseDuration`     |
| POST   | `/api/move/stop_pattern` | Stop pattern movement | None                              |

### Sensor Routes (Legacy Auth Required)

| Method | Endpoint                | Description         |
| ------ | ----------------------- | ------------------- |
| GET    | `/api/sensors/battery`  | Get battery data    |
| GET    | `/api/sensors/odometry` | Get position data   |
| GET    | `/api/sensors/laser`    | Get laser scan data |

### Other Routes

| Method | Endpoint                     | Description              |
| ------ | ---------------------------- | ------------------------ |
| POST   | `/api/login`                 | Legacy session login     |
| POST   | `/api/logout`                | Legacy session logout    |
| GET    | `/api/status`                | Robot status             |
| POST   | `/api/verify-firebase-token` | Verify Firebase token    |
| POST   | `/api/emergency_stop`        | Emergency stop (no auth) |
| GET    | `/health`                    | Health check             |

## Authentication Methods

### Firebase Authentication (Recommended)

Include Firebase ID token in Authorization header:

```
Authorization: Bearer <firebase-id-token>
```

### Legacy Session Authentication

Login via `/api/login` with username/password:

```json
{
  "username": "admin",
  "password": "admin123"
}
```

## Role-Based Access Control

### Roles

- **admin**: Full access to all endpoints including user management
- **moderator**: Extended access (implementation specific)
- **user**: Basic access to robot control

### Role Assignment

- New users automatically get "user" role
- Admin can update roles via `/api/auth/update-role`
- Public registration only allows "user" role for security

## Socket.IO Events

### Client → Server

- `move_command`: Send movement commands
- `emergency_stop`: Trigger emergency stop

### Server → Client

- `move_response`: Movement command response
- `status_update`: Robot status updates
- `battery_update`: Battery data updates
- `odom_update`: Odometry updates
- `laser_update`: Laser scan updates
- `pattern_movement_start`: Pattern movement started
- `pattern_movement_complete`: Pattern movement completed
- `pattern_movement_stopped`: Pattern movement stopped
- `emergency_stop_activated`: Emergency stop activated

## Example Usage

### Firebase Authentication

```javascript
// Get Firebase ID token
const user = firebase.auth().currentUser;
const idToken = await user.getIdToken();

// Make authenticated request
const response = await fetch("/api/move/forward", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${idToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ speed: 0.3 }),
});
```

### Socket.IO

```javascript
const socket = io();

// Send movement command
socket.emit("move_command", {
  action: "forward",
  parameters: { speed: 0.2 },
});

// Listen for responses
socket.on("move_response", (data) => {
  console.log("Movement result:", data);
});
```

## Security Notes

- Firebase service account key should never be committed to version control
- Firebase ID tokens are automatically validated on each request
- Emergency stop endpoint is intentionally unauthenticated for safety
- Pattern movements currently use legacy auth (to be updated)
- Sensor endpoints currently use legacy auth (to be updated)

## Development

### File Structure

```
tb-backend/
├── admin.js              # Firebase Admin SDK setup
├── index.js              # Main server file
├── routes/
│   └── auth.js           # Authentication routes
├── .env                  # Environment variables
├── serviceAccountKey.json # Firebase service account (not in git)
├── package.json
└── README.md
```

### Adding New Endpoints

1. Create route handlers in appropriate files
2. Add Firebase authentication middleware if needed
3. Update this README with new endpoint documentation

## Troubleshooting

### Common Issues

1. **Firebase service account errors**: Ensure `serviceAccountKey.json` is properly configured
2. **CORS issues**: Check `FRONTEND_URL` in `.env` matches your frontend URL
3. **Token verification fails**: Ensure Firebase ID token is fresh and valid
4. **ROS connection issues**: Server falls back to simulation mode automatically

### Logs

The server provides detailed logging for:

- Firebase authentication attempts
- Robot movement commands
- ROS connection status
- Error conditions

Check console output for debugging information.
