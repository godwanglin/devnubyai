import { Prisma } from "@/generated/client";
import { db } from "../db";
import type { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from "./types";

/**
 * Lets the model look up the user's own earlier chats (Settings → Memory →
 * "Pencarian dan rujukan chat"). Only ever offered when that toggle is on, and
 * every query is scoped to the caller's own chats, locked ones excluded.
 */
export interface SearchPastChatsParams {
  query?: string;
  limit?: number;
}

interface ChatHit {
  chatId: string;
  title: string;
  updatedAt: string;
  matches: Array<{ role: string; snippet: string }>;
}

export interface SearchPastChatsData {
  query: string;
  chats: ChatHit[];
  total: number;
}

const MAX_QUERY_CHARS = 200;
const MAX_CHATS = 8;
const MAX_MATCHES_PER_CHAT = 3;

interface SearchRow {
  chatId: string;
  title: string;
  updatedAt: Date;
  role: string;
  snippet: string;
  rank: number;
}

export const searchPastChatsTool: ToolDefinition<SearchPastChatsParams, SearchPastChatsData> = {
  name: "search_past_chats",
  description:
    "Searches the user's own earlier chats for something they mentioned before. Use when the user refers to a previous conversation ('like we discussed last week', 'the plan we made', 'what did I say about ...') and the current chat does not contain it. Returns short snippets with the chat title and date. Never reveals chats of other users.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "What to look for, in the user's own words, e.g. 'deploy production redis'. A few keywords work better than a full sentence.",
        required: true,
      },
      limit: {
        type: "number",
        description: `How many chats to return (default 5, max ${MAX_CHATS}).`,
        default: 5,
      },
    },
    required: ["query"],
  },
  execute: async (
    params: SearchPastChatsParams,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult<SearchPastChatsData>> => {
    const startTime = Date.now();
    const query = String(params?.query ?? "").trim().slice(0, MAX_QUERY_CHARS);
    if (query.length < 2) {
      return {
        success: false,
        error: { code: "INVALID_PARAM", message: "Parameter 'query' must be at least 2 characters." },
        metadata: { durationMs: Date.now() - startTime },
      };
    }
    if (context.userInternalId === undefined) {
      return {
        success: false,
        error: { code: "INVALID_PARAM", message: "Chat search needs the signed-in user." },
        metadata: { durationMs: Date.now() - startTime },
      };
    }

    const limit = Math.min(Math.max(Number(params?.limit) || 5, 1), MAX_CHATS);
    // One extra chat of headroom so a chat that only matched inside the current one still fills the limit
    const fetchChats = limit + 1;

    try {
      const rows = await db.$queryRaw<SearchRow[]>(Prisma.sql`
        WITH matching AS (
          SELECT m.session_id,
                 m.role,
                 m.created_at,
                 ts_rank(to_tsvector('simple', m.content), plainto_tsquery('simple', ${query})) AS rank,
                 ts_headline(
                   'simple',
                   m.content,
                   plainto_tsquery('simple', ${query}),
                   'MaxWords=30, MinWords=8, MaxFragments=1'
                 ) AS snippet
          FROM chat_messages m
          JOIN chat_sessions s ON s.id = m.session_id
          WHERE s.user_id = ${context.userInternalId}
            AND s.is_locked = false
            AND m.status IN ('completed', 'aborted')
            AND to_tsvector('simple', m.content) @@ plainto_tsquery('simple', ${query})
        ),
        top_chats AS (
          SELECT session_id, MAX(rank) AS best
          FROM matching
          GROUP BY session_id
          ORDER BY best DESC
          LIMIT ${fetchChats}
        )
        SELECT s.public_id AS "chatId",
               s.title AS title,
               s.last_message_at AS "updatedAt",
               m.role AS role,
               m.snippet AS snippet,
               m.rank AS rank
        FROM top_chats t
        JOIN matching m ON m.session_id = t.session_id
        JOIN chat_sessions s ON s.id = t.session_id
        ORDER BY t.best DESC, m.rank DESC
      `);

      const chats: ChatHit[] = [];
      for (const row of rows) {
        if (row.chatId === context.sessionId) continue; // the current chat is already in context
        let chat = chats.find((c) => c.chatId === row.chatId);
        if (!chat) {
          if (chats.length >= limit) continue;
          chat = { chatId: row.chatId, title: row.title, updatedAt: row.updatedAt.toISOString(), matches: [] };
          chats.push(chat);
        }
        if (chat.matches.length < MAX_MATCHES_PER_CHAT) {
          chat.matches.push({ role: row.role, snippet: row.snippet });
        }
      }

      return {
        success: true,
        data: { query, chats, total: chats.length },
        metadata: { durationMs: Date.now() - startTime, provider: "chat-history" },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return {
        success: false,
        error: { code: "EXECUTION_ERROR", message: `Chat search failed: ${message}` },
        metadata: { durationMs: Date.now() - startTime },
      };
    }
  },
};
