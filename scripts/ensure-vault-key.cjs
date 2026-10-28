const fs = require("fs");
const crypto = require("crypto");

const envPath = ".env";
if (!fs.existsSync(envPath)) {
  console.log("No .env found");
  process.exit(0);
}

let envContent = fs.readFileSync(envPath, "utf8");

if (!envContent.includes("GATEWAY_SECRET_KEY")) {
  const secret = crypto.randomBytes(32).toString("hex");
  const addition = `\n# Gateway Vault Secret (AES-256-GCM encryption key)\nGATEWAY_SECRET_KEY=${secret}\n`;
  fs.appendFileSync(envPath, addition, "utf8");
  console.log("GATEWAY_SECRET_KEY generated and appended to .env");
} else {
  console.log("GATEWAY_SECRET_KEY already exists in .env");
}
