#!/bin/bash

# Setup script for TurtleBot Webcam on Raspberry Pi
echo "Setting up TurtleBot Webcam Service on Raspberry Pi..."

# Update package list
echo "Updating package list..."
sudo apt update

# Install GStreamer and required plugins
echo "Installing GStreamer and plugins..."
sudo apt install -y \
    gstreamer1.0-tools \
    gstreamer1.0-plugins-base \
    gstreamer1.0-plugins-good \
    gstreamer1.0-plugins-bad \
    gstreamer1.0-plugins-ugly \
    gstreamer1.0-libav \
    gstreamer1.0-alsa \
    gstreamer1.0-pulseaudio

# Install v4l-utils for camera configuration
echo "Installing v4l-utils..."
sudo apt install -y v4l-utils

# Install additional development tools if needed
echo "Installing additional tools..."
sudo apt install -y \
    build-essential \
    pkg-config \
    libgstreamer1.0-dev \
    libgstreamer-plugins-base1.0-dev

# Check if camera is detected
echo "Checking for connected cameras..."
if ls /dev/video* 1> /dev/null 2>&1; then
    echo "Found video devices:"
    ls -la /dev/video*
    
    echo ""
    echo "Camera capabilities:"
    for device in /dev/video*; do
        if [[ -c "$device" ]]; then
            echo "Device: $device"
            v4l2-ctl --device="$device" --list-formats-ext 2>/dev/null | head -20
            echo "---"
        fi
    done
else
    echo "⚠️  No video devices found. Please connect your USB camera."
fi

# Test GStreamer installation
echo ""
echo "Testing GStreamer installation..."
if command -v gst-launch-1.0 &> /dev/null; then
    echo "✅ GStreamer is installed"
    gst-launch-1.0 --version
    
    # Test if camera works with GStreamer
    if ls /dev/video0 1> /dev/null 2>&1; then
        echo ""
        echo "Testing camera with GStreamer (this will run for 5 seconds)..."
        timeout 5s gst-launch-1.0 v4l2src device=/dev/video0 ! videoconvert ! jpegenc ! fakesink 2>/dev/null
        if [ $? -eq 124 ]; then
            echo "✅ Camera test successful (timed out as expected)"
        else
            echo "⚠️  Camera test had issues. Check camera connection and permissions."
        fi
    fi
else
    echo "❌ GStreamer installation failed"
    exit 1
fi

# Set up camera permissions
echo ""
echo "Setting up camera permissions..."
sudo usermod -a -G video $USER
echo "✅ Added user to video group"

# Create systemd service file for auto-starting webcam service
echo ""
echo "Would you like to create a systemd service for auto-starting the webcam? (y/n)"
read -r create_service

if [[ "$create_service" =~ ^[Yy]$ ]]; then
    cat > /tmp/turtlebot-webcam.service << EOF
[Unit]
Description=TurtleBot Webcam Service
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

    sudo mv /tmp/turtlebot-webcam.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable turtlebot-webcam.service
    
    echo "✅ Systemd service created and enabled"
    echo "You can start it with: sudo systemctl start turtlebot-webcam.service"
fi

# Install Node.js dependencies if package.json exists
if [ -f "package.json" ]; then
    echo ""
    echo "Installing Node.js dependencies..."
    npm install
    echo "✅ Node.js dependencies installed"
fi

echo ""
echo "🎉 Setup complete!"
echo ""
echo "Next steps:"
echo "1. Reboot your Raspberry Pi: sudo reboot"
echo "2. After reboot, check camera: ls -la /dev/video*"
echo "3. Start your Node.js server: npm start"
echo "4. Test webcam stream: curl http://localhost:4000/api/webcam/status"
echo ""
echo "Troubleshooting:"
echo "- If camera not detected: lsusb (check if USB camera is listed)"
echo "- Check camera formats: v4l2-ctl --device=/dev/video0 --list-formats-ext"
echo "- Test camera manually: gst-launch-1.0 v4l2src device=/dev/video0 ! videoconvert ! autovideosink"
echo ""
echo "📚 Documentation: Check WEBCAM_README.md for detailed instructions"
