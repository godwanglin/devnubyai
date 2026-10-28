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
    const [info] = await conn.query(
      "SELECT VERSION() as ver, DATABASE() as db, @@character_set_database as cs, @@collation_database as col"
    );
    console.log("SERVER_INFO:", JSON.stringify(info[0]));
    const [tables] = await conn.query("SHOW TABLES");
    console.log("TABLES_COUNT:", tables.length);
    if (tables.length > 0) {
      console.log("TABLES:", tables.map((r) => Object.values(r)[0]));
    }
  } finally {
    await conn.end();
  }
}

check().catch((err) => {
  console.error("CHECK_FAILED:", err.message);
  process.exit(1);
});
