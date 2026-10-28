import "dotenv/config";
import { db } from "../src/lib/db";

// EXPLAIN the hot queries from .plans/01-database-schema.md §5 and check each
// one can use its planned index. On near-empty tables the optimizer may pick a
// scan anyway, so "possible_keys" counts as a match too.

interface ExplainRow {
  table: string | null;
  type: string | null;
  possible_keys: string | null;
  key: string | null;
  rows: number | bigint | null;
  Extra: string | null;
}

interface Check {
  id: string;
  sql: string;
  expect: Array<{ table: string; index: string }>;
}

const CHECKS: Check[] = [
  {
    id: "Q1 resolve routing candidates",
    sql: `SELECT r.priority, um.model_key, g.id
          FROM catalog_models cm
          JOIN catalog_model_routes r ON r.catalog_model_id = cm.id AND r.is_enabled = 1
          JOIN upstream_models um ON um.id = r.upstream_model_id AND um.is_available = 1
          JOIN gateways g ON g.id = um.gateway_id AND g.is_enabled = 1
          WHERE cm.public_id = 'openai/gpt-6-luna'
          ORDER BY r.priority`,
    expect: [
      { table: "cm", index: "uq_catalog_models_public_id" },
      { table: "r", index: "idx_routes_resolve" },
      { table: "um", index: "PRIMARY" },
      { table: "g", index: "PRIMARY" },
    ],
  },
  {
    id: "Q2 composer model list",
    sql: `SELECT id, public_id FROM catalog_models WHERE status = 'active' ORDER BY sort_order`,
    expect: [{ table: "catalog_models", index: "idx_catalog_models_listing" }],
  },
  {
    id: "Q3 sidebar sessions",
    sql: `SELECT id, public_id, title FROM chat_sessions
          WHERE user_id = 1
          ORDER BY is_pinned DESC, last_message_at DESC, id DESC LIMIT 30`,
    expect: [{ table: "chat_sessions", index: "idx_chat_sessions_sidebar" }],
  },
  {
    id: "Q4 open /c/{public_id}",
    sql: `SELECT id FROM chat_sessions WHERE public_id = '01934b5c-6e8a-7b3c-9d0e-1a2b3c4d5e6f'`,
    expect: [{ table: "chat_sessions", index: "uq_chat_sessions_public_id" }],
  },
  {
    id: "Q5 message history cursor",
    sql: `SELECT id, role FROM chat_messages WHERE session_id = 1 AND id < 1000 ORDER BY id DESC LIMIT 50`,
    expect: [{ table: "chat_messages", index: "idx_chat_messages_session" }],
  },
  {
    id: "Q6 sync upsert lookup",
    sql: `SELECT id FROM upstream_models WHERE gateway_id = 1 AND model_key = 'gpt-4o'`,
    expect: [{ table: "upstream_models", index: "uq_upstream_models_gateway_key" }],
  },
  {
    id: "Q7 admin upstream list per gateway",
    sql: `SELECT id, model_key FROM upstream_models
          WHERE gateway_id = 1 AND is_available = 1 ORDER BY model_key`,
    expect: [{ table: "upstream_models", index: "idx_upstream_models_gateway_avail" }],
  },
  {
    id: "Q8 model_key search across gateways",
    sql: `SELECT id, gateway_id FROM upstream_models WHERE model_key = 'gpt-4o'`,
    expect: [{ table: "upstream_models", index: "idx_upstream_models_key" }],
  },
  {
    id: "Q9 quota this period",
    sql: `SELECT request_count FROM user_usage_periods WHERE user_id = 1 AND period_start = '2026-10-01'`,
    expect: [{ table: "user_usage_periods", index: "PRIMARY" }],
  },
  {
    id: "Q10 gateway error rate 24h",
    sql: `SELECT outcome, COUNT(*) FROM routing_attempts
          WHERE gateway_id = 1 AND created_at >= NOW() - INTERVAL 24 HOUR GROUP BY outcome`,
    expect: [{ table: "routing_attempts", index: "idx_attempts_gateway" }],
  },
  {
    id: "Q11 session file by name",
    sql: `SELECT id, storage_key FROM session_files WHERE session_id = 1 AND filename = 'photo.png'`,
    expect: [{ table: "session_files", index: "uq_session_files_name" }],
  },
  {
    id: "Q12 auth cookie validation",
    sql: `SELECT s.user_id, u.role FROM auth_sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = UNHEX(SHA2('x', 256)) AND s.expires_at > NOW()`,
    expect: [
      { table: "s", index: "uq_auth_sessions_token" },
      { table: "u", index: "PRIMARY" },
    ],
  },
  {
    id: "Q13a purge routing_attempts",
    sql: `DELETE FROM routing_attempts WHERE created_at < NOW() - INTERVAL 90 DAY LIMIT 1000`,
    expect: [{ table: "routing_attempts", index: "idx_attempts_created" }],
  },
  {
    id: "Q13b purge expired auth_sessions",
    sql: `DELETE FROM auth_sessions WHERE expires_at < NOW() LIMIT 1000`,
    expect: [{ table: "auth_sessions", index: "idx_auth_sessions_expires" }],
  },
];

function hasIndex(list: string | null, index: string) {
  return (list ?? "").split(",").includes(index);
}

async function main() {
  let failed = 0;

  for (const check of CHECKS) {
    const rows = await db.$queryRawUnsafe<ExplainRow[]>(`EXPLAIN ${check.sql}`);
    const notes: string[] = [];
    let ok = true;

    for (const { table, index } of check.expect) {
      const row = rows.find((r) => r.table === table);
      if (!row) {
        // Const-table elimination on empty tables drops the row entirely
        notes.push(`${table}: optimized away (${rows[0]?.Extra ?? "no row"})`);
        continue;
      }
      if (row.key === index) {
        notes.push(`${table}: key=${index}`);
      } else if (hasIndex(row.possible_keys, index)) {
        notes.push(`${table}: possible=${index} (chose ${row.key ?? row.type} on small table)`);
      } else {
        ok = false;
        notes.push(`${table}: MISSING ${index} (key=${row.key}, possible=${row.possible_keys})`);
      }
    }

    if (!ok) failed++;
    console.log(`${ok ? "OK  " : "FAIL"} ${check.id}\n     ${notes.join("\n     ")}`);
  }

  console.log(failed === 0 ? "\nALL_INDEX_CHECKS: OK" : `\nALL_INDEX_CHECKS: ${failed} FAILED`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("EXPLAIN_FAILED:", err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
