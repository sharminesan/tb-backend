const { spawn, exec } = require("child_process");

console.log("Windows Camera Test Script");
console.log("==========================\n");

// Test 1: Check FFmpeg availability
console.log("1. Testing FFmpeg availability...");
exec("ffmpeg -version", (error, stdout, stderr) => {
  if (error) {
    console.log("❌ FFmpeg not found or not accessible");
    console.log("   Please install FFmpeg: https://ffmpeg.org/download.html");
    return;
  }

  console.log("✅ FFmpeg is available");
  console.log("   Version info:", stdout.split("\n")[0]);

  // Test 2: List DirectShow devices
  console.log("\n2. Listing DirectShow devices...");
  exec(
    "ffmpeg -list_devices true -f dshow -i dummy",
    (error, stdout, stderr) => {
      if (stderr) {
        const lines = stderr.split("\n");
        let foundDevices = false;

        for (const line of lines) {
          if (line.includes("[dshow @") && line.includes("(video)")) {
            const match = line.match(/"([^"]+)"/);
            if (match && match[1] !== "dummy") {
              console.log(`✅ Found video device: ${match[1]}`);
              foundDevices = true;

              // Test 3: Try to access this device
              testDeviceAccess(match[1]);
            }
          }
        }

        if (!foundDevices) {
          console.log("❌ No video devices found");
          console.log("   Please check:");
          console.log("   - Camera is connected and working");
          console.log("   - Camera is not being used by another application");
          console.log("   - Windows Privacy Settings allow camera access");
        }
      }
    }
  );
});

function testDeviceAccess(deviceName) {
  console.log(`\n3. Testing device access: ${deviceName}`);

  // Test with friendly name
  console.log(
    `   Testing: ffmpeg -f dshow -i video="${deviceName}" -vframes 1 -f null -`
  );

  const ffmpeg = spawn("ffmpeg", [
    "-f",
    "dshow",
    "-i",
    `video="${deviceName}"`,
    "-vframes",
    "1",
    "-f",
    "null",
    "-",
  ]);

  let hasError = false;

  ffmpeg.stderr.on("data", (data) => {
    const stderrStr = data.toString();
    if (
      stderrStr.includes("Could not find video device") ||
      stderrStr.includes("Error opening input") ||
      stderrStr.includes("I/O error")
    ) {
      console.log(`   ❌ Failed: ${stderrStr.trim()}`);
      hasError = true;

      // Try alternative approaches
      console.log("\n4. Trying alternative approaches...");

      // Try with video=0
      console.log(
        "   Testing: ffmpeg -f dshow -i video=0 -vframes 1 -f null -"
      );
      const ffmpeg2 = spawn("ffmpeg", [
        "-f",
        "dshow",
        "-i",
        "video=0",
        "-vframes",
        "1",
        "-f",
        "null",
        "-",
      ]);

      ffmpeg2.stderr.on("data", (data) => {
        const stderrStr2 = data.toString();
        if (
          stderrStr2.includes("Could not find video device") ||
          stderrStr2.includes("Error opening input") ||
          stderrStr2.includes("I/O error")
        ) {
          console.log(`   ❌ video=0 also failed: ${stderrStr2.trim()}`);
          console.log("\n🔧 Troubleshooting suggestions:");
          console.log(
            "   1. Close any applications using the camera (Zoom, Teams, etc.)"
          );
          console.log(
            "   2. Check Windows Settings > Privacy & Security > Camera"
          );
          console.log("   3. Try running this script as Administrator");
          console.log("   4. Check Device Manager for camera driver issues");
          console.log(
            "   5. If using USB camera, try unplugging and reconnecting"
          );
        } else {
          console.log("   ✅ video=0 works!");
        }
      });

      ffmpeg2.on("close", (code) => {
        if (code === 0) {
          console.log("   ✅ video=0 test completed successfully");
        }
      });
    }
  });

  ffmpeg.on("close", (code) => {
    if (code === 0 && !hasError) {
      console.log("   ✅ Device access test completed successfully");
      console.log("\n🎉 Your camera should work with the webcam streaming!");
    }
  });

  ffmpeg.on("error", (error) => {
    console.log(`   ❌ FFmpeg error: ${error.message}`);
  });
}
