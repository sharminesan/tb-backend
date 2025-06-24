# TurtleBot Webcam Streaming on Raspberry Pi

This guide will help you set up webcam streaming for your TurtleBot on Raspberry Pi.

## Prerequisites

- Raspberry Pi (3B+ or 4 recommended)
- USB webcam compatible with V4L2 (most USB webcams work)
- Node.js installed on Raspberry Pi
- Internet connection

## Quick Setup

1. **Run the automated setup script:**

```bash
chmod +x setup-webcam-rpi.sh
./setup-webcam-rpi.sh
```

2. **Reboot your Raspberry Pi:**

```bash
sudo reboot
```

3. **Start the server:**

```bash
npm start
```

## Manual Setup

### 1. Install GStreamer

```bash
sudo apt update
sudo apt install -y gstreamer1.0-tools gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly gstreamer1.0-libav
```

### 2. Install V4L2 utilities

```bash
sudo apt install -y v4l-utils
```

### 3. Check camera detection

```bash
# List video devices
ls -la /dev/video*

# Check camera capabilities
v4l2-ctl --device=/dev/video0 --list-formats-ext
```

### 4. Test camera manually

```bash
# Test if camera works with GStreamer
gst-launch-1.0 v4l2src device=/dev/video0 ! videoconvert ! autovideosink

# Test MJPEG output (press Ctrl+C to stop)
gst-launch-1.0 v4l2src device=/dev/video0 ! videoconvert ! jpegenc ! fakesink
```

## API Usage

### Start Webcam Stream

```bash
curl -X POST http://your-pi-ip:4000/api/webcam/start \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -d '{
    "device": "/dev/video0",
    "width": 640,
    "height": 480,
    "framerate": 30
  }'
```

### View Stream

Open in browser: `http://your-pi-ip:4000/api/webcam/stream`

Or use the web interface: `http://your-pi-ip:4000/webcam`

### Stop Stream

```bash
curl -X POST http://your-pi-ip:4000/api/webcam/stop \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN"
```

### Check Status

```bash
curl http://your-pi-ip:4000/api/webcam/status
```

## Supported Camera Formats

The service automatically detects and uses the best available format:

- **Preferred:** Raw video (video/x-raw) - converted to JPEG
- **Fallback:** Native MJPEG (image/jpeg) - direct streaming
- **Resolution:** 640x480 (default), configurable
- **Frame rate:** 30fps (default), configurable

## Troubleshooting

### Camera Not Detected

```bash
# Check if camera is connected
lsusb

# Check video devices
ls -la /dev/video*

# Check camera permissions
groups $USER  # Should include 'video'
```

### Permission Issues

```bash
# Add user to video group
sudo usermod -a -G video $USER

# Reboot required after group change
sudo reboot
```

### GStreamer Issues

```bash
# Test basic GStreamer functionality
gst-launch-1.0 videotestsrc ! autovideosink

# Check GStreamer version
gst-launch-1.0 --version

# List available plugins
gst-inspect-1.0 | grep video
```

### Stream Quality Issues

Try different camera settings:

```bash
# List available formats and resolutions
v4l2-ctl --device=/dev/video0 --list-formats-ext

# Test different resolutions
curl -X POST http://localhost:4000/api/webcam/start \
  -H "Content-Type: application/json" \
  -d '{"width": 320, "height": 240, "framerate": 15}'
```

### Performance Optimization

For better performance on Raspberry Pi:

1. **Lower resolution:** Use 320x240 for better performance
2. **Lower framerate:** Use 15fps instead of 30fps
3. **GPU memory split:** Increase GPU memory

   ```bash
   sudo raspi-config
   # Advanced Options > Memory Split > 128
   ```

4. **Overclock (if needed):**
   ```bash
   sudo raspi-config
   # Advanced Options > Overclock
   ```

## Network Access

To access the webcam from other devices on your network:

1. **Find your Pi's IP address:**

   ```bash
   hostname -I
   ```

2. **Access from another device:**

   - Stream: `http://PI_IP_ADDRESS:4000/api/webcam/stream`
   - Web interface: `http://PI_IP_ADDRESS:4000/webcam`

3. **Firewall (if needed):**
   ```bash
   sudo ufw allow 4000/tcp
   ```

## Integration with Frontend

The webcam service integrates seamlessly with your TurtleBot frontend. The stream URL will be automatically provided to connected clients via Socket.IO events.

### Socket.IO Events

- `webcam_stream_started` - Fired when stream starts
- `webcam_stream_ended` - Fired when stream stops
- `webcam_stream_stopped` - Fired when manually stopped

## Security Notes

- The webcam API requires Firebase authentication + email OTP verification
- Stream endpoint (`/api/webcam/stream`) has CORS enabled for frontend access
- Consider using HTTPS in production environments
- Monitor client connections to prevent resource exhaustion

## Performance Monitoring

Check system resources while streaming:

```bash
# CPU usage
htop

# Memory usage
free -h

# Network usage
iftop

# Temperature (Raspberry Pi)
vcgencmd measure_temp
```

## Advanced Configuration

### Custom GStreamer Pipeline

If you need to modify the GStreamer pipeline, edit the `startStream` method in the `WebcamService` class.

### Multiple Cameras

To support multiple cameras, modify the device parameter:

```json
{
  "device": "/dev/video1",
  "width": 640,
  "height": 480
}
```

### Recording Video

The current implementation streams live video. For recording capabilities, you would need to modify the GStreamer pipeline to include a `filesink` element.

## Support

If you encounter issues:

1. Check the server logs for GStreamer errors
2. Verify camera compatibility with `v4l2-ctl`
3. Test GStreamer manually before using the API
4. Check network connectivity and firewall settings
5. Monitor Raspberry Pi temperature and performance

For additional help, refer to:

- [GStreamer Documentation](https://gstreamer.freedesktop.org/documentation/)
- [V4L2 Documentation](https://www.kernel.org/doc/html/latest/userspace-api/media/v4l/v4l2.html)
- [Raspberry Pi Camera Documentation](https://www.raspberrypi.org/documentation/usage/camera/)
