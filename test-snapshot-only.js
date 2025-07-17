const { spawn } = require("child_process");

console.log("Testing Windows Camera Snapshot Only");
console.log("====================================\n");

// Test snapshot with video=0 (which worked in our earlier tests)
console.log("Testing snapshot with video=0...");

const ffmpeg = spawn("ffmpeg", [
  "-f",
  "dshow",
  "-i",
  "video=0",
  "-vframes",
  "1",
  "-vf",
  "scale=640:480",
  "-y",
  "test-snapshot-direct.jpg",
]);

ffmpeg.stderr.on("data", (data) => {
  console.log(`FFmpeg stderr: ${data}`);
});

ffmpeg.on("close", (code) => {
  if (code === 0) {
    console.log("✅ Snapshot test successful!");
    console.log("   File saved as: test-snapshot-direct.jpg");
  } else {
    console.log(`❌ Snapshot test failed with code ${code}`);
  }
});

ffmpeg.on("error", (error) => {
  console.log(`❌ FFmpeg error: ${error.message}`);
});
