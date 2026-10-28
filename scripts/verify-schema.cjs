const mysql = require("mysql2/promise");
const fs = require("fs");

async function check() {
  const envContent = fs.readFileSync(".env", "utf8");
  const match = envContent.match(/^DATABASE_URL\s*=\s*["']?([^"'\r\n]+)/m);
  if (!match) {
    console.error("NO_DATABASE_URL");
    process.exit(1);
  }
  const url = match[1].trim();
  const conn = await mysql.createConnection(url);
  try {
    const [tables] = await conn.query("SHOW TABLES");
    console.log("TOTAL_TABLES:", tables.length);
    console.log("TABLE_LIST:", tables.map((r) => Object.values(r)[0]).sort());

    const [gatewaysCols] = await conn.query("SHOW COLUMNS FROM gateways");
    console.log("GATEWAYS_COLUMNS:", gatewaysCols.map((c) => `${c.Field} (${c.Type}, Extra=${c.Extra})`));

    const [indexes] = await conn.query("SHOW INDEX FROM gateways");
    console.log("GATEWAYS_INDEXES:", indexes.map((i) => `${i.Key_name} on ${i.Column_name} (unique=${i.Non_unique === 0})`));
  } finally {
    await conn.end();
  }
}

check().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
