#!/bin/bash

# GStreamer Installation Script for Raspberry Pi
# This script installs GStreamer and necessary plugins for webcam streaming

echo "🎥 Installing GStreamer for TurtleBot Webcam Streaming..."

# Update package list
sudo apt update

# Install GStreamer core and plugins
echo "Installing GStreamer core packages..."
sudo apt install -y \
    gstreamer1.0-tools \
    gstreamer1.0-plugins-base \
    gstreamer1.0-plugins-good \
    gstreamer1.0-plugins-bad \
    gstreamer1.0-plugins-ugly \
    gstreamer1.0-libav

# Install additional packages for USB camera support
echo "Installing USB camera support packages..."
sudo apt install -y \
    v4l-utils \
    uvcdynctrl \
    guvcview

# Install development packages (optional, for building custom plugins)
echo "Installing development packages..."
sudo apt install -y \
    libgstreamer1.0-dev \
    libgstreamer-plugins-base1.0-dev

# Check if webcam is detected
echo ""
echo "🔍 Checking for connected USB cameras..."
lsusb | grep -i camera
lsusb | grep -i webcam
lsusb | grep -i video

# List video devices
echo ""
echo "📹 Available video devices:"
ls -la /dev/video*

# Test basic GStreamer functionality
echo ""
echo "🧪 Testing GStreamer installation..."
gst-inspect-1.0 v4l2src > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "✅ GStreamer v4l2src plugin is working"
else
    echo "❌ GStreamer v4l2src plugin is not working"
fi

# Show webcam capabilities
echo ""
echo "📊 Webcam capabilities (if /dev/video0 exists):"
if [ -e /dev/video0 ]; then
    v4l2-ctl --device=/dev/video0 --list-formats-ext
else
    echo "No webcam found at /dev/video0"
fi

# Create a test script
echo ""
echo "📝 Creating test script..."
cat > test-webcam.sh << 'EOF'
#!/bin/bash
# Test webcam streaming with GStreamer

echo "Testing webcam stream..."
echo "This will stream for 10 seconds, then stop"
echo "You can test the stream by opening: http://localhost:8080 in a browser"

# Simple test stream
gst-launch-1.0 \
    v4l2src device=/dev/video0 \
    ! video/x-raw,width=640,height=480,framerate=30/1 \
    ! videoconvert \
    ! jpegenc quality=80 \
    ! multipartmux \
    ! tcpserversink host=0.0.0.0 port=8080 &

GSTREAMER_PID=$!
echo "GStreamer started with PID: $GSTREAMER_PID"
echo "Stream should be available at: http://localhost:8080"
echo "Press Enter to stop the stream..."
read

kill $GSTREAMER_PID
echo "Stream stopped"
EOF

chmod +x test-webcam.sh

echo ""
echo "✅ GStreamer installation complete!"
echo ""
echo "📋 Next steps:"
echo "1. Connect your USB webcam to the Raspberry Pi"
echo "2. Run './test-webcam.sh' to test the webcam"
echo "3. Install Node.js dependencies: npm install"
echo "4. Start your TurtleBot backend: npm start"
echo "5. Access webcam viewer at: http://your-pi-ip:4000/webcam"
echo ""
echo "🔧 Troubleshooting:"
echo "- Check webcam permissions: sudo usermod -a -G video $USER"
echo "- List cameras: v4l2-ctl --list-devices"
echo "- Test camera: gst-launch-1.0 v4l2src device=/dev/video0 ! autovideosink"
echo ""
