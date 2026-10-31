// Builds the design preview (vite.preview.config.ts) once, then keeps serving it on http://localhost:5199/.
// Open that address in any browser, drag the window narrower to check the tablet and mobile layouts, or use the
// "Dark theme" button at the top of the page. Ctrl+C stops it.
//
// Not part of the app: nothing in src/main or src/renderer/src/main.tsx imports anything from here.
const { execSync, spawnSync } = require("node:child_process");

console.log("Building the design preview...");
execSync("npx vite build --config vite.preview.config.ts", {
  stdio: "inherit",
});
console.log("\nServing it. Open http://localhost:5199/ (Ctrl+C to stop)");
spawnSync(process.execPath, ["scripts/preview-server.mjs"], {
  stdio: "inherit",
});
