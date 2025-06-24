# TurtleBot Webcam Streaming

This module adds webcam streaming functionality to your TurtleBot backend using GStreamer.

## Features

- 📹 USB webcam streaming via GStreamer
- 🌐 HTTP MJPEG stream accessible via web browser
- 🔒 Authentication required (Firebase + OTP)
- 📱 Real-time Socket.IO events
- 🎛️ Configurable resolution and framerate
- 👥 Multiple client support

## Prerequisites

### Hardware

- Raspberry Pi with USB port
- USB webcam (UVC compatible recommended)
- Active internet connection

### Software

- Ubuntu/Raspbian OS
- GStreamer 1.0+
- Node.js 14+
- USB camera drivers (usually included)

## Installation

### 1. Install GStreamer (on Raspberry Pi)

```bash
# Make the setup script executable
chmod +x setup-gstreamer.sh

# Run the installation script
./setup-gstreamer.sh
```

### 2. Install Node.js Dependencies

```bash
npm install
```

### 3. Connect USB Webcam

```bash
# Check if webcam is detected
lsusb | grep -i camera

# List video devices
ls -la /dev/video*

# Check webcam capabilities
v4l2-ctl --device=/dev/video0 --list-formats-ext
```

## Usage

### 1. Start the Backend Server

```bash
npm start
```

### 2. Access Webcam Interface

Open your web browser and navigate to:

```
http://your-raspberry-pi-ip:4000/webcam
```

### 3. API Endpoints

#### Start Webcam Stream

```bash
curl -X POST http://localhost:4000/api/webcam/start \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -d '{
    "device": "/dev/video0",
    "width": 640,
    "height": 480,
    "framerate": 30
  }'
```

#### Stop Webcam Stream

```bash
curl -X POST http://localhost:4000/api/webcam/stop \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN"
```

#### Check Stream Status

```bash
curl http://localhost:4000/api/webcam/status
```

#### Access Video Stream

```
http://localhost:4000/api/webcam/stream
```

### 4. Socket.IO Events

```javascript
// Connect to Socket.IO
const socket = io("http://your-pi-ip:4000");

// Start webcam
socket.emit("webcam_start", {
  device: "/dev/video0",
  width: 640,
  height: 480,
  framerate: 30,
});

// Stop webcam
socket.emit("webcam_stop");

// Get status
socket.emit("webcam_status");

// Listen for events
socket.on("webcam_stream_started", (data) => {
  console.log("Stream started:", data);
});

socket.on("webcam_stream_stopped", (data) => {
  console.log("Stream stopped:", data);
});

socket.on("webcam_status_update", (status) => {
  console.log("Webcam status:", status);
});
```

## Configuration

### Default Settings

- **Device**: `/dev/video0`
- **Resolution**: 640x480
- **Framerate**: 30 FPS
- **Port**: 4000 (backend), 8081 (stream)
- **Format**: MJPEG

### Environment Variables

Add to your `.env` file:

```env
WEBCAM_DEVICE=/dev/video0
WEBCAM_WIDTH=640
WEBCAM_HEIGHT=480
WEBCAM_FRAMERATE=30
WEBCAM_QUALITY=80
```

## Troubleshooting

### Common Issues

#### 1. Webcam Not Detected

```bash
# Check USB connections
lsusb

# Check video devices
ls -la /dev/video*

# Test with guvcview
guvcview
```

#### 2. Permission Denied

```bash
# Add user to video group
sudo usermod -a -G video $USER

# Log out and log back in, or:
newgrp video
```

#### 3. GStreamer Pipeline Errors

```bash
# Test basic pipeline
gst-launch-1.0 v4l2src device=/dev/video0 ! autovideosink

# Test MJPEG encoding
gst-launch-1.0 v4l2src device=/dev/video0 ! jpegenc ! fakesink
```

#### 4. Low Performance

- Reduce resolution: Use 320x240 instead of 640x480
- Lower framerate: Use 15 FPS instead of 30 FPS
- Adjust quality: Lower JPEG quality (60-80)
- Check CPU usage: `htop`

### Advanced Configuration

#### Custom GStreamer Pipeline

```javascript
// In webcamService.js, modify the gstreamerCommand array:
const customPipeline = [
  "v4l2src",
  `device=${this.webcamDevice}`,
  "!",
  "video/x-raw,width=320,height=240,framerate=15/1",
  "!",
  "videoscale",
  "!",
  "videoconvert",
  "!",
  "jpegenc",
  "quality=60",
  "!",
  "multipartmux",
  "!",
  `tcpserversink host=0.0.0.0 port=${this.streamPort}`,
];
```

#### Multiple Cameras

```javascript
// Support for multiple cameras
const camera1 = new WebcamService("/dev/video0", 8080);
const camera2 = new WebcamService("/dev/video1", 8081);
```

## Integration with Frontend

### HTML Video Element

```html
<img
  id="webcamStream"
  src="http://your-pi-ip:4000/api/webcam/stream"
  alt="TurtleBot Camera Feed"
/>
```

### React Component

```jsx
import React, { useState, useEffect } from "react";

function WebcamStream() {
  const [streaming, setStreaming] = useState(false);

  const startStream = async () => {
    const response = await fetch("/api/webcam/start", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${firebaseToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ width: 640, height: 480 }),
    });

    if (response.ok) {
      setStreaming(true);
    }
  };

  return (
    <div>
      {streaming && <img src="/api/webcam/stream" alt="Webcam Feed" />}
      <button onClick={startStream}>Start Camera</button>
    </div>
  );
}
```

## Performance Tips

1. **Optimize Resolution**: Use the lowest resolution that meets your needs
2. **Adjust Framerate**: 15-20 FPS is often sufficient for robot control
3. **JPEG Quality**: 70-80% provides good quality with reasonable bandwidth
4. **Network**: Use wired connection for better stability
5. **CPU**: Monitor CPU usage and adjust settings accordingly

## Security Considerations

- Authentication is required for all webcam control endpoints
- Firebase tokens are validated for each request
- OTP verification adds an extra security layer
- Stream access can be restricted by IP if needed

## Testing

### Manual Testing

```bash
# Test webcam directly
./test-webcam.sh

# Test with curl
curl -X POST http://localhost:4000/api/webcam/start \
  -H "Authorization: Bearer $FIREBASE_TOKEN" \
  -d '{"device":"/dev/video0"}'
```

### Browser Testing

1. Open `http://localhost:4000/webcam`
2. Authenticate with Firebase
3. Click "Start Stream"
4. Verify video appears

## License

This webcam streaming module is part of the TurtleBot backend project and follows the same license terms.
