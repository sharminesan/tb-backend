# TurtleBot Webcam Streaming on Windows

This guide will help you set up webcam streaming for your TurtleBot backend on Windows.

## Prerequisites

- Windows 10 or later
- USB webcam or built-in camera
- Node.js installed
- FFmpeg installed

## Quick Setup

1. **Install FFmpeg (if not already installed):**

   ```bash
   # Using Chocolatey (recommended)
   choco install ffmpeg

   # Or download from https://ffmpeg.org/download.html
   ```

2. **Test your camera setup:**

   ```bash
   node test-windows-camera.js
   ```

3. **Start the server:**

   ```bash
   npm start
   ```

## API Endpoints

### Check Camera Status

```bash
curl http://localhost:4000/api/webcam/status
```

### Start Camera Stream

```bash
curl http://localhost:4000/api/webcam/stream
```

### Take Snapshot

```bash
curl -X POST http://localhost:4000/api/webcam/snapshot
```

### Windows Troubleshooting

```bash
curl http://localhost:4000/api/webcam/windows-troubleshoot
```

## Common Windows Camera Issues

### 1. "Could not find video device" Error

This is the most common issue on Windows. The system has been updated to automatically try multiple approaches:

- **Attempt 1:** Use the friendly device name
- **Attempt 2:** Use the alternative device path (if available)
- **Attempt 3:** Use the default device (video=0)

### 2. Camera Access Denied

**Solution:** Check Windows Privacy Settings

1. Open Windows Settings
2. Go to Privacy & Security > Camera
3. Make sure "Camera access" is turned ON
4. Make sure "Let apps access your camera" is turned ON
5. Check if your app is in the "Choose which apps can access your camera" list

### 3. Camera in Use by Another Application

**Solution:** Close other applications using the camera

Common applications that might be using your camera:

- Zoom, Teams, Skype
- Web browsers (Chrome, Edge, Firefox)
- Camera app
- Other video conferencing apps

### 4. Driver Issues

**Solution:** Update camera drivers

1. Open Device Manager
2. Expand "Imaging devices" or "Cameras"
3. Right-click your camera
4. Select "Update driver"

### 5. USB Camera Not Detected

**Solution:** Check USB connection

1. Unplug and reconnect the USB camera
2. Try a different USB port
3. Check if the camera works in other applications

## Testing Your Setup

### Run the Test Script

```bash
node test-windows-camera.js
```

This script will:

1. Check if FFmpeg is installed
2. List available camera devices
3. Test device access
4. Try alternative approaches if the first fails
5. Provide troubleshooting suggestions

### Manual FFmpeg Testing

You can also test manually in Command Prompt:

```bash
# List devices
ffmpeg -list_devices true -f dshow -i dummy

# Test with friendly name
ffmpeg -f dshow -i video="Your Camera Name" -vframes 1 -f null -

# Test with default device
ffmpeg -f dshow -i video=0 -vframes 1 -f null -
```

## Troubleshooting Steps

### Step 1: Check FFmpeg Installation

```bash
ffmpeg -version
```

If this fails, install FFmpeg:

- **Chocolatey:** `choco install ffmpeg`
- **Manual:** Download from https://ffmpeg.org/download.html

### Step 2: Check Camera Detection

```bash
node test-windows-camera.js
```

### Step 3: Check Windows Privacy Settings

1. Settings > Privacy & Security > Camera
2. Enable camera access
3. Allow app access

### Step 4: Close Other Applications

Make sure no other applications are using the camera.

### Step 5: Run as Administrator

Try running your Node.js application as Administrator.

### Step 6: Check Device Manager

1. Open Device Manager
2. Look for camera under "Imaging devices" or "Cameras"
3. Update drivers if needed

## Advanced Configuration

### Custom FFmpeg Parameters

You can modify the FFmpeg parameters in `routes/webcam.js`:

```javascript
// In startWindowsCameraStream function
ffmpegCommand = [
  "-f",
  "dshow",
  "-i",
  `video="${cameraName}"`,
  "-f",
  "mjpeg",
  "-vf",
  "scale=640:480", // Resolution
  "-r",
  "15", // Frame rate
  "-q:v",
  "8", // Quality
  "-bufsize",
  "1M", // Buffer size
  "pipe:1",
];
```

### Multiple Cameras

If you have multiple cameras, the system will use the first detected device. You can modify the device selection logic in the `detectCameraDevices` function.

## Performance Optimization

### Reduce Resolution

For better performance, try lower resolutions:

```javascript
"-vf", "scale=320:240"; // Instead of 640:480
```

### Reduce Frame Rate

```javascript
"-r", "10"; // Instead of 15
```

### Adjust Quality

```javascript
"-q:v", "10"; // Higher number = lower quality, better performance
```

## Error Messages and Solutions

| Error Message                 | Solution                                       |
| ----------------------------- | ---------------------------------------------- |
| "Could not find video device" | Try closing other apps, check privacy settings |
| "Error opening input"         | Check camera drivers, try different USB port   |
| "I/O error"                   | Camera in use by another application           |
| "FFmpeg not found"            | Install FFmpeg                                 |
| "No camera devices detected"  | Check camera connection and drivers            |

## Support

If you're still having issues:

1. Run the test script: `node test-windows-camera.js`
2. Check the troubleshooting endpoint: `GET /api/webcam/windows-troubleshoot`
3. Check the server logs for detailed error messages
4. Try the manual FFmpeg commands above

## Security Notes

- The webcam API requires authentication
- Camera access is limited to authenticated users
- Consider using HTTPS in production
- Monitor camera usage to prevent abuse
