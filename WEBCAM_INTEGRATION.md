# Webcam Integration Documentation

## Overview
The webcam module provides camera streaming and snapshot functionality for the TurtleBot backend server using FFmpeg.

## Prerequisites
- **FFmpeg** must be installed on your system
- A compatible camera connected to your system

### Installing FFmpeg

#### Windows
```bash
# Using Chocolatey
choco install ffmpeg

# Using Scoop
scoop install ffmpeg

# Or download from https://ffmpeg.org/download.html
```

#### macOS
```bash
# Using Homebrew
brew install ffmpeg
```

#### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install ffmpeg
```

## API Endpoints

### 1. Camera Status Check
**GET** `/api/webcam/status`

Returns camera availability and configuration:
```json
{
  "available": true,
  "status": "ready",
  "resolution": "640x480",
  "fps": 30,
  "message": "Camera is available for streaming"
}
```

### 2. Live Camera Stream
**GET** `/api/webcam/stream`

Returns an MJPEG stream that can be displayed in web browsers or video players.

**Usage in HTML:**
```html
<img src="http://localhost:4000/api/webcam/stream" alt="Camera Stream" />
```

### 3. Capture Snapshot
**POST** `/api/webcam/snapshot`

Captures a single frame and returns it as a JPEG image.

**Response:** Binary JPEG image data

## Camera Configuration

The module automatically detects the platform and uses appropriate camera interfaces:

- **Windows**: DirectShow (`dshow`) with default camera name "USB Camera"
- **macOS**: AVFoundation with camera index 0
- **Linux**: Video4Linux (`v4l2`) with `/dev/video0`

### Customizing Camera Settings

To use a different camera, modify the camera input in `/routes/webcam.js`:

#### Windows
Change the camera name in the DirectShow input:
```javascript
'-i', 'video="Your Camera Name"'
```

#### macOS
Change the camera index:
```javascript
'-i', '1' // Use camera index 1 instead of 0
```

#### Linux
Change the video device:
```javascript
'-i', '/dev/video1' // Use video1 instead of video0
```

## Troubleshooting

### Common Issues

1. **Camera not detected**
   - Ensure camera is connected and not in use by another application
   - Check camera permissions on macOS/Windows
   - Verify video device exists on Linux: `ls /dev/video*`

2. **FFmpeg not found**
   - Install FFmpeg using the instructions above
   - Ensure FFmpeg is in your system PATH

3. **Stream not working**
   - Check browser console for errors
   - Verify camera isn't being used by another application
   - Try different camera resolution or frame rate

4. **Snapshot fails**
   - Ensure temp directory has write permissions
   - Check available disk space
   - Verify camera is working with status endpoint

### Camera Name Detection (Windows)

To find your camera name on Windows:
```powershell
ffmpeg -list_devices true -f dshow -i dummy
```

This will list all available DirectShow devices.

## Performance Notes

- Default resolution: 640x480 at 30 FPS
- JPEG quality set to 5 (good balance of quality/performance)
- Streams are automatically cleaned up when clients disconnect
- Multiple clients can view the same stream simultaneously

## Security Considerations

- Camera endpoints currently have no authentication requirements
- Consider adding authentication for production deployments
- Monitor bandwidth usage for streaming endpoints
- Temporary snapshot files are automatically cleaned up

## Integration with Frontend

The webcam stream can be easily integrated into web frontends:

```javascript
// Simple image element
<img src="/api/webcam/stream" />

// Or with error handling
const streamImg = document.getElementById('camera-stream');
streamImg.onerror = () => {
  console.log('Camera stream unavailable');
  streamImg.src = '/path/to/fallback-image.png';
};
```

For snapshot capture:
```javascript
async function captureSnapshot() {
  try {
    const response = await fetch('/api/webcam/snapshot', {
      method: 'POST'
    });
    
    if (response.ok) {
      const blob = await response.blob();
      const imageUrl = URL.createObjectURL(blob);
      // Use imageUrl to display or download the snapshot
    }
  } catch (error) {
    console.error('Snapshot failed:', error);
  }
}
```
