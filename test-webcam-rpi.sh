#!/bin/bash

# Test script for TurtleBot Webcam on Raspberry Pi
echo "🎥 TurtleBot Webcam Test Script"
echo "==============================="

# Check if we're on Raspberry Pi
if [ ! -f /proc/cpuinfo ] || ! grep -q "Raspberry Pi" /proc/cpuinfo; then
    echo "⚠️  This script is designed for Raspberry Pi"
fi

# Check Node.js
echo ""
echo "📦 Checking Node.js..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo "✅ Node.js found: $NODE_VERSION"
else
    echo "❌ Node.js not found. Please install Node.js first."
    exit 1
fi

# Check NPM dependencies
echo ""
echo "📦 Checking NPM dependencies..."
if [ -f "package.json" ]; then
    if [ -d "node_modules" ]; then
        echo "✅ Node modules found"
    else
        echo "⚠️  Installing NPM dependencies..."
        npm install
    fi
else
    echo "❌ package.json not found. Are you in the correct directory?"
    exit 1
fi

# Check GStreamer
echo ""
echo "🎬 Checking GStreamer..."
if command -v gst-launch-1.0 &> /dev/null; then
    GST_VERSION=$(gst-launch-1.0 --version | head -1)
    echo "✅ GStreamer found: $GST_VERSION"
else
    echo "❌ GStreamer not found. Please run setup-webcam-rpi.sh first."
    exit 1
fi

# Check video devices
echo ""
echo "📹 Checking video devices..."
if ls /dev/video* 1> /dev/null 2>&1; then
    echo "✅ Video devices found:"
    for device in /dev/video*; do
        if [[ -c "$device" ]]; then
            echo "   $device"
        fi
    done
    
    # Test primary camera
    if [ -c "/dev/video0" ]; then
        echo ""
        echo "🔍 Testing camera capabilities..."
        v4l2-ctl --device=/dev/video0 --list-formats-ext 2>/dev/null | head -10
        
        echo ""
        echo "🧪 Testing GStreamer with camera (5 second test)..."
        timeout 5s gst-launch-1.0 v4l2src device=/dev/video0 ! videoconvert ! jpegenc ! fakesink 2>/dev/null
        if [ $? -eq 124 ]; then
            echo "✅ Camera test successful"
        else
            echo "⚠️  Camera test failed. Check camera connection."
        fi
    fi
else
    echo "❌ No video devices found. Please connect a USB camera."
    exit 1
fi

# Check permissions
echo ""
echo "🔐 Checking permissions..."
if groups $USER | grep -q video; then
    echo "✅ User is in video group"
else
    echo "⚠️  User not in video group. Run: sudo usermod -a -G video $USER"
fi

# Test server startup (dry run)
echo ""
echo "🚀 Testing server startup (dry run)..."
if node -c index.js 2>/dev/null; then
    echo "✅ Server syntax is valid"
else
    echo "❌ Server syntax errors found"
    exit 1
fi

# Network test
echo ""
echo "🌐 Network information..."
IP_ADDRESS=$(hostname -I | awk '{print $1}')
echo "📍 Raspberry Pi IP: $IP_ADDRESS"
echo "🔗 Webcam stream will be available at: http://$IP_ADDRESS:4000/api/webcam/stream"
echo "🌐 Web interface will be available at: http://$IP_ADDRESS:4000/webcam"

# Port check
echo ""
echo "🔌 Checking if port 4000 is available..."
if ss -tln | grep -q ":4000 "; then
    echo "⚠️  Port 4000 is already in use"
    echo "   Current processes using port 4000:"
    sudo ss -tlnp | grep ":4000 "
else
    echo "✅ Port 4000 is available"
fi

# Final recommendations
echo ""
echo "🎯 Test Results Summary:"
echo "========================"
echo ""

# Create quick start commands
cat << EOF
🚀 Quick Start Commands:
-----------------------

1. Start the server:
   npm start

2. Test webcam status:
   curl http://localhost:4000/api/webcam/status

3. Start webcam (requires authentication):
   curl -X POST http://localhost:4000/api/webcam/start \\
     -H "Content-Type: application/json" \\
     -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \\
     -d '{"device": "/dev/video0", "width": 640, "height": 480}'

4. View stream in browser:
   http://$IP_ADDRESS:4000/webcam

5. Stop webcam:
   curl -X POST http://localhost:4000/api/webcam/stop \\
     -H "Authorization: Bearer YOUR_FIREBASE_TOKEN"

📚 For detailed instructions, see WEBCAM_README_RPI.md
EOF

echo ""
echo "✨ Test complete! Your system appears ready for webcam streaming."
