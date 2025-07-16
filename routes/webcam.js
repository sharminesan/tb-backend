const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');

// Camera state
let cameraProcess = null;
let isStreaming = false;

// Check if camera is available
router.get('/status', async (req, res) => {
  try {
    // First check if FFmpeg is available
    const ffmpegAvailable = await checkFFmpegAvailability();
    if (!ffmpegAvailable) {
      return res.json({
        available: false,
        status: 'ffmpeg_missing',
        resolution: 'N/A',
        fps: 'N/A',
        message: 'FFmpeg is not installed or not accessible. Please install FFmpeg to use camera features.',
        installation_help: {
          windows: 'Install using: choco install ffmpeg OR download from https://ffmpeg.org/download.html',
          macos: 'Install using: brew install ffmpeg',
          linux: 'Install using: sudo apt install ffmpeg'
        }
      });
    }

    // Check for available cameras and get device list
    const devices = await detectCameraDevices();
    const available = devices.length > 0;

    res.json({
      available: available,
      status: available ? 'ready' : 'no_devices',
      resolution: '640x480',
      fps: 30,
      ffmpeg_available: true,
      platform: process.platform,
      detected_devices: devices,
      device_count: devices.length,
      message: available 
        ? `Found ${devices.length} camera device(s). Ready for streaming.`
        : 'FFmpeg is available but no camera devices detected.',
      active_device: available ? devices[0] : null
    });
  } catch (error) {
    res.json({
      available: false,
      error: error.message,
      message: 'Camera status check failed'
    });
  }
});

// Camera stream using FFmpeg (for real camera integration)
router.get('/stream', async (req, res) => {
  try {
    console.log('Camera stream requested');
    
    // Check if FFmpeg is available
    const ffmpegAvailable = await checkFFmpegAvailability();
    if (!ffmpegAvailable) {
      return res.status(503).json({ 
        error: 'FFmpeg not available',
        message: 'FFmpeg is required for camera streaming. Please install FFmpeg and try again.',
        installation_help: {
          windows: 'choco install ffmpeg OR download from https://ffmpeg.org/download.html',
          macos: 'brew install ffmpeg',
          linux: 'sudo apt install ffmpeg'
        }
      });
    }
    
    // Set headers for MJPEG stream
    res.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Pragma': 'no-cache',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });

    // Start camera streaming with FFmpeg
    startCameraStream(res);

  } catch (error) {
    console.error('Camera stream error:', error);
    res.status(500).json({ error: 'Failed to start camera stream' });
  }
});

// Take snapshot using FFmpeg
router.post('/snapshot', async (req, res) => {
  try {
    console.log('Snapshot requested');
    
    // Check if FFmpeg is available
    const ffmpegAvailable = await checkFFmpegAvailability();
    if (!ffmpegAvailable) {
      return res.status(503).json({ 
        error: 'FFmpeg not available',
        message: 'FFmpeg is required for camera snapshots. Please install FFmpeg and try again.',
        installation_help: {
          windows: 'choco install ffmpeg OR download from https://ffmpeg.org/download.html',
          macos: 'brew install ffmpeg',
          linux: 'sudo apt install ffmpeg'
        }
      });
    }
    
    const snapshotPath = path.join(__dirname, '../temp', `snapshot-${Date.now()}.jpg`);
    
    // Ensure temp directory exists
    const tempDir = path.dirname(snapshotPath);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Capture snapshot using FFmpeg
    await captureSnapshot(snapshotPath);
    
    // Send the captured image
    res.set({
      'Content-Type': 'image/jpeg',
      'Content-Disposition': 'attachment; filename="snapshot.jpg"'
    });
    
    const imageBuffer = fs.readFileSync(snapshotPath);
    res.send(imageBuffer);
    
    // Clean up temporary file
    fs.unlinkSync(snapshotPath);
    
  } catch (error) {
    console.error('Snapshot error:', error);
    res.status(500).json({ error: 'Failed to capture snapshot', details: error.message });
  }
});

// FFmpeg installation help endpoint
router.get('/install-help', (req, res) => {
  const platform = process.platform;
  let instructions = {};

  if (platform === 'win32') {
    instructions = {
      platform: 'Windows',
      methods: [
        {
          name: 'Chocolatey (Recommended)',
          command: 'choco install ffmpeg',
          prerequisite: 'Install Chocolatey first: https://chocolatey.org/install'
        },
        {
          name: 'Scoop',
          command: 'scoop install ffmpeg',
          prerequisite: 'Install Scoop first: https://scoop.sh/'
        },
        {
          name: 'Direct Download',
          steps: [
            '1. Go to https://ffmpeg.org/download.html',
            '2. Click on "Windows" and download a build',
            '3. Extract the zip file',
            '4. Add the bin folder to your PATH environment variable',
            '5. Restart your terminal/IDE'
          ]
        }
      ],
      verification: 'Open a new command prompt and run: ffmpeg -version'
    };
  } else if (platform === 'darwin') {
    instructions = {
      platform: 'macOS',
      methods: [
        {
          name: 'Homebrew (Recommended)',
          command: 'brew install ffmpeg',
          prerequisite: 'Install Homebrew first: https://brew.sh/'
        },
        {
          name: 'MacPorts',
          command: 'sudo port install ffmpeg',
          prerequisite: 'Install MacPorts first: https://www.macports.org/'
        }
      ],
      verification: 'Open Terminal and run: ffmpeg -version'
    };
  } else {
    instructions = {
      platform: 'Linux',
      methods: [
        {
          name: 'Ubuntu/Debian',
          command: 'sudo apt update && sudo apt install ffmpeg'
        },
        {
          name: 'CentOS/RHEL/Fedora',
          command: 'sudo dnf install ffmpeg'
        },
        {
          name: 'Arch Linux',
          command: 'sudo pacman -S ffmpeg'
        }
      ],
      verification: 'Open terminal and run: ffmpeg -version'
    };
  }

  res.json({
    message: 'FFmpeg Installation Instructions',
    current_platform: platform,
    ...instructions,
    troubleshooting: [
      'Make sure to restart your terminal/command prompt after installation',
      'Verify FFmpeg is in your PATH by running: ffmpeg -version',
      'If you get "command not found", check your PATH environment variable'
    ]
  });
});

// Test FFmpeg endpoint
router.get('/test-ffmpeg', async (req, res) => {
  try {
    const ffmpegAvailable = await checkFFmpegAvailability();
    
    if (ffmpegAvailable) {
      // Get FFmpeg version info
      exec('ffmpeg -version', (error, stdout, stderr) => {
        if (error) {
          res.json({
            ffmpeg_available: false,
            error: error.message,
            message: 'FFmpeg test failed'
          });
        } else {
          const versionLine = stdout.split('\n')[0];
          res.json({
            ffmpeg_available: true,
            version: versionLine,
            message: 'FFmpeg is working correctly!',
            full_output: stdout.substring(0, 500) + '...' // Truncate for readability
          });
        }
      });
    } else {
      res.json({
        ffmpeg_available: false,
        message: 'FFmpeg is not installed or not accessible',
        help_endpoint: '/api/webcam/install-help'
      });
    }
  } catch (error) {
    res.status(500).json({
      error: error.message,
      message: 'Failed to test FFmpeg'
    });
  }
});

// Get available camera devices
router.get('/devices', async (req, res) => {
  try {
    const ffmpegAvailable = await checkFFmpegAvailability();
    if (!ffmpegAvailable) {
      return res.status(503).json({
        error: 'FFmpeg not available',
        message: 'FFmpeg is required to detect camera devices'
      });
    }

    const devices = await detectCameraDevices();
    res.json({
      platform: process.platform,
      devices: devices,
      count: devices.length,
      message: devices.length > 0 ? 'Camera devices found' : 'No camera devices detected'
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
      message: 'Failed to detect camera devices'
    });
  }
});

// Function to check FFmpeg availability
function checkFFmpegAvailability() {
  return new Promise((resolve) => {
    exec('ffmpeg -version', (error, stdout, stderr) => {
      if (error) {
        console.log('FFmpeg not found or not accessible');
        resolve(false);
      } else {
        console.log('FFmpeg is available');
        resolve(true);
      }
    });
  });
}

// Function to check camera availability
function checkCameraAvailability() {
  return new Promise(async (resolve, reject) => {
    try {
      // First check if FFmpeg is available
      const ffmpegAvailable = await checkFFmpegAvailability();
      if (!ffmpegAvailable) {
        resolve(false);
        return;
      }

      // Use device detection to check for cameras
      const devices = await detectCameraDevices();
      resolve(devices.length > 0);
    } catch (error) {
      console.error('Camera availability check failed:', error);
      resolve(false);
    }
  });
}

// Function to detect available camera devices
function detectCameraDevices() {
  return new Promise((resolve, reject) => {
    if (process.platform === 'win32') {
      // Windows - list DirectShow devices
      const ffmpegCommand = ['ffmpeg', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'];
      exec(ffmpegCommand.join(' '), (error, stdout, stderr) => {
        const devices = [];
        if (stderr) {
          // Parse stderr for device list (FFmpeg outputs device list to stderr)
          const lines = stderr.split('\n');
          let inVideoSection = false;
          
          for (const line of lines) {
            if (line.includes('[dshow @') && line.includes('DirectShow video devices')) {
              inVideoSection = true;
              continue;
            }
            if (line.includes('[dshow @') && line.includes('DirectShow audio devices')) {
              inVideoSection = false;
              break;
            }
            if (inVideoSection && line.includes('"')) {
              const match = line.match(/"([^"]+)"/);
              if (match) {
                devices.push(match[1]);
              }
            }
          }
        }
        resolve(devices);
      });
    } else if (process.platform === 'darwin') {
      // macOS - list AVFoundation devices
      const ffmpegCommand = ['ffmpeg', '-f', 'avfoundation', '-list_devices', 'true', '-i', '""'];
      exec(ffmpegCommand.join(' '), (error, stdout, stderr) => {
        const devices = [];
        if (stderr) {
          const lines = stderr.split('\n');
          for (const line of lines) {
            if (line.includes('[AVFoundation') && line.includes('] [')) {
              const match = line.match(/\[(\d+)\] (.+)/);
              if (match) {
                devices.push({
                  index: match[1],
                  name: match[2].trim()
                });
              }
            }
          }
        }
        resolve(devices);
      });
    } else {
      // Linux - list v4l2 devices
      exec('ls /dev/video*', (error, stdout, stderr) => {
        if (error) {
          resolve([]);
        } else {
          const devices = stdout.trim().split('\n').filter(device => device);
          resolve(devices);
        }
      });
    }
  });
}

// Start camera streaming with FFmpeg
async function startCameraStream(res) {
  try {
    // Get available camera devices
    const devices = await detectCameraDevices();
    if (devices.length === 0) {
      console.error('No camera devices found');
      if (!res.destroyed) {
        res.status(503).json({
          error: 'No cameras found',
          message: 'No camera devices detected on this system'
        });
      }
      return;
    }

    // FFmpeg command for camera streaming
    let ffmpegCommand;
    
    if (process.platform === 'win32') {
      // Windows - use DirectShow with first available device
      const cameraName = devices[0];
      console.log(`Using Windows camera: ${cameraName}`);
      ffmpegCommand = [
        '-f', 'dshow',
        '-i', `video="${cameraName}"`,
        '-f', 'mjpeg',
        '-vf', 'scale=640:480',
        '-r', '30',
        '-q:v', '5',
        'pipe:1'
      ];
    } else if (process.platform === 'darwin') {
      // macOS - use AVFoundation with first available device
      const cameraIndex = devices[0]?.index || '0';
      console.log(`Using macOS camera index: ${cameraIndex}`);
      ffmpegCommand = [
        '-f', 'avfoundation',
        '-i', cameraIndex,
        '-f', 'mjpeg',
        '-vf', 'scale=640:480',
        '-r', '30',
        '-q:v', '5',
        'pipe:1'
      ];
    } else {
      // Linux - use Video4Linux with first available device
      const cameraDevice = devices[0] || '/dev/video0';
      console.log(`Using Linux camera device: ${cameraDevice}`);
      ffmpegCommand = [
        '-f', 'v4l2',
        '-i', cameraDevice,
        '-f', 'mjpeg',
        '-vf', 'scale=640:480',
        '-r', '30',
        '-q:v', '5',
        'pipe:1'
      ];
    }

    // Start FFmpeg process
    console.log('Starting FFmpeg with command:', 'ffmpeg', ffmpegCommand.join(' '));
    cameraProcess = spawn('ffmpeg', ffmpegCommand);
    
    cameraProcess.stdout.on('data', (chunk) => {
      if (!res.destroyed) {
        try {
          res.write('--frame\r\n');
          res.write('Content-Type: image/jpeg\r\n');
          res.write(`Content-Length: ${chunk.length}\r\n\r\n`);
          res.write(chunk);
          res.write('\r\n');
        } catch (error) {
          console.error('Stream write error:', error);
          stopCameraStream();
        }
      }
    });

    cameraProcess.stderr.on('data', (data) => {
      console.error(`FFmpeg stderr: ${data}`);
    });

    cameraProcess.on('close', (code) => {
      console.log(`FFmpeg process exited with code ${code}`);
      isStreaming = false;
      if (!res.destroyed) {
        res.end();
      }
    });

    cameraProcess.on('error', (error) => {
      console.error('FFmpeg error:', error);
      isStreaming = false;
      if (!res.destroyed) {
        if (error.code === 'ENOENT') {
          res.status(503).json({
            error: 'FFmpeg not found',
            message: 'FFmpeg is not installed or not accessible in PATH',
            solution: 'Please install FFmpeg and ensure it is in your system PATH'
          });
        } else {
          res.status(500).json({
            error: 'Camera stream failed',
            message: error.message,
            code: error.code,
            available_devices: devices
          });
        }
      }
    });

    // Handle client disconnect
    res.on('close', () => {
      console.log('Client disconnected from camera stream');
      stopCameraStream();
    });

    isStreaming = true;
  } catch (error) {
    console.error('Failed to start camera stream:', error);
    if (!res.destroyed) {
      res.status(500).json({
        error: 'Stream initialization failed',
        message: error.message
      });
    }
  }
}

// Stop camera streaming
function stopCameraStream() {
  if (cameraProcess) {
    cameraProcess.kill('SIGTERM');
    cameraProcess = null;
  }
  isStreaming = false;
}

// Capture a snapshot using FFmpeg
async function captureSnapshot(outputPath) {
  return new Promise(async (resolve, reject) => {
    try {
      // Get available camera devices
      const devices = await detectCameraDevices();
      if (devices.length === 0) {
        reject(new Error('No camera devices found'));
        return;
      }

      let ffmpegCommand;
      
      if (process.platform === 'win32') {
        const cameraName = devices[0];
        console.log(`Using Windows camera for snapshot: ${cameraName}`);
        ffmpegCommand = [
          '-f', 'dshow',
          '-i', `video="${cameraName}"`,
          '-vframes', '1',
          '-vf', 'scale=640:480',
          '-y',
          outputPath
        ];
      } else if (process.platform === 'darwin') {
        const cameraIndex = devices[0]?.index || '0';
        console.log(`Using macOS camera for snapshot: ${cameraIndex}`);
        ffmpegCommand = [
          '-f', 'avfoundation',
          '-i', cameraIndex,
          '-vframes', '1',
          '-vf', 'scale=640:480',
          '-y',
          outputPath
        ];
      } else {
        const cameraDevice = devices[0] || '/dev/video0';
        console.log(`Using Linux camera for snapshot: ${cameraDevice}`);
        ffmpegCommand = [
          '-f', 'v4l2',
          '-i', cameraDevice,
          '-vframes', '1',
          '-vf', 'scale=640:480',
          '-y',
          outputPath
        ];
      }

      console.log('Capturing snapshot with command:', 'ffmpeg', ffmpegCommand.join(' '));
      const ffmpeg = spawn('ffmpeg', ffmpegCommand);
      
      ffmpeg.stderr.on('data', (data) => {
        console.log(`FFmpeg snapshot stderr: ${data}`);
      });
      
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg snapshot failed with code ${code}`));
        }
      });

      ffmpeg.on('error', (error) => {
        reject(error);
      });
    } catch (error) {
      reject(error);
    }
  });
}

// Cleanup on exit
process.on('exit', stopCameraStream);
process.on('SIGINT', stopCameraStream);
process.on('SIGTERM', stopCameraStream);

module.exports = router;
