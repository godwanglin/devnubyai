"use client";

import React from "react";
import { Terminal } from "lucide-react";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { useI18n } from "@/providers/i18n-provider";
import type { ToolActivity } from "@/types";

/**
 * Admin tool debug inspect of one tool call (tool debug mode): command-like tools as a
 * terminal (command, output, exit code), every other tool as typed fields, never raw JSON.
 */

const isRunningTool = (tool: ToolActivity) => tool.state === "running" || tool.state === "streaming";

/** Large outputs (fetched pages, file contents) are cut so the chat stays responsive. */
const DEBUG_JSON_MAX_CHARS = 20_000;

function formatDebugJson(value: unknown, more: (count: number) => string): string {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > DEBUG_JSON_MAX_CHARS
    ? `${text.slice(0, DEBUG_JSON_MAX_CHARS)}\n${more(text.length - DEBUG_JSON_MAX_CHARS)}`
    : text;
}

/** Wraps text in a Markdown code fence longer than any backtick run inside it. */
function fenced(text: string, language: string): string {
  const longestRun = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longestRun + 1);
  return `${fence}${language}\n${text}\n${fence}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function fileNamesOf(data: Record<string, unknown>): string[] {
  return Array.isArray(data.generatedFiles)
    ? (data.generatedFiles as unknown[])
        .map((f) => String(asRecord(f).displayName || asRecord(f).filename || ""))
        .filter(Boolean)
    : [];
}

/** Window header / code / output / footer of a command-like tool call, styled as a terminal. */
function TerminalDebugView({
  tool,
  shell,
  subtitle,
  code,
  codeLanguage,
  stdout,
  stderr,
  exitCode,
  durationMs,
  timedOut,
  footer,
  footerRight,
}: {
  tool: ToolActivity;
  shell: string;
  subtitle?: string;
  code: string;
  codeLanguage: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number | null;
  timedOut: boolean;
  footer?: string[];
  footerRight?: string;
}) {
  const errorText = stderr || tool.error || "";
  const hasOutput = Boolean(stdout || errorText);
  const failed = tool.state === "error" || timedOut || (exitCode !== null && exitCode !== 0);
  const footerItems = (footer ?? []).filter(Boolean);
  const { t } = useI18n();

  return (
    <div className="max-w-[620px] overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--panel-elevated)]">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-1.5 font-mono text-[11px] text-[var(--muted)]">
        <Terminal className="h-3 w-3 shrink-0" />
        <span className="shrink-0">{shell}</span>
        {subtitle ? <span className="truncate font-sans">· {subtitle}</span> : null}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {isRunningTool(tool) ? <span>{t("toolDebug.running")}</span> : null}
          {timedOut ? <span className="text-amber-400">{t("toolDebug.timeout")}</span> : null}
          {exitCode !== null ? (
            <span className={failed ? "text-red-400/90" : "text-emerald-400"}>{t("toolDebug.exit", { code: exitCode })}</span>
          ) : null}
          {durationMs !== null ? <span>{(durationMs / 1000).toFixed(1)}s</span> : null}
        </span>
      </div>

      {code ? (
        <MarkdownRenderer
          content={fenced(code, codeLanguage)}
          className="px-1 [&_.group]:!my-1 [&_pre]:!max-h-[260px] [&_pre]:!overflow-y-auto"
        />
      ) : null}

      {hasOutput ? (
        <div className="border-t border-[var(--border)] px-3 py-2">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{t("toolDebug.output")}</div>
          <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed">
            {stdout ? <span className="text-[var(--ink)]">{stdout}</span> : null}
            {stdout && errorText ? "\n" : null}
            {errorText ? <span className="text-red-400/90">{errorText}</span> : null}
          </pre>
        </div>
      ) : null}

      {footerItems.length > 0 || footerRight ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--border)] px-3 py-1.5 font-mono text-[11px] text-[var(--muted)]">
          {footerItems.map((item) => (
            <span key={item} className="truncate">
              {item}
            </span>
          ))}
          {footerRight ? <span className="ml-auto shrink-0">{footerRight}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** `exec_command`: the bash command, then its output. */
function ExecCommandDebugView({ tool }: { tool: ToolActivity }) {
  const { t } = useI18n();
  const input = asRecord(tool.input);
  const outer = asRecord(tool.output);
  const data = asRecord(outer.data ?? outer);
  const files = fileNamesOf(data);
  const workspace = asRecord(data.workspace);
  const usedMb = typeof workspace.usedBytes === "number" ? workspace.usedBytes / 1048576 : null;
  const quotaMb = typeof workspace.quotaBytes === "number" ? workspace.quotaBytes / 1048576 : null;

  return (
    <TerminalDebugView
      tool={tool}
      shell="bash"
      subtitle={asText(input.description).trim() || undefined}
      code={asText(input.command)}
      codeLanguage="bash"
      stdout={asText(data.stdout)}
      stderr={asText(data.stderr)}
      exitCode={typeof data.exitCode === "number" ? data.exitCode : null}
      durationMs={typeof data.durationMs === "number" ? data.durationMs : null}
      timedOut={data.timedOut === true}
      footer={files.length > 0 ? [t("toolDebug.files", { list: files.join(", ") })] : undefined}
      footerRight={usedMb !== null && quotaMb !== null ? t("toolDebug.disk", { used: usedMb.toFixed(1), quota: quotaMb.toFixed(0) }) : undefined}
    />
  );
}

/** `run_skill_script`: the inline script (or helper command line), then its output. */
function SkillScriptDebugView({ tool }: { tool: ToolActivity }) {
  const { t } = useI18n();
  const input = asRecord(tool.input);
  const outer = asRecord(tool.output);
  const data = asRecord(outer.data ?? outer);
  const code = asText(input.code);
  const script = asText(input.script) || asText(data.script);
  const runtime =
    asText(data.runtime) ||
    asText(input.runtime) ||
    (/\.(?:c|m)?js$/i.test(script) || /\brequire\s*\(/.test(code) ? "node" : "python");
  const args = Array.isArray(input.args) ? (input.args as unknown[]).map(String) : [];
  const skill = asText(input.skill);
  const commandLine = code
    ? code
    : [runtime === "node" ? "node" : "python3", script ? `scripts/${script}` : "", ...args].filter(Boolean).join(" ");
  const inputFiles = Object.keys(asRecord(input.inputFiles));
  const files = fileNamesOf(data);
  const jsonOutputs = Object.keys(asRecord(data.jsonOutputs));

  return (
    <TerminalDebugView
      tool={tool}
      shell={runtime === "node" ? "node" : "python"}
      subtitle={[skill && t("toolDebug.skill", { name: skill }), script && !code ? script : ""].filter(Boolean).join(" · ") || undefined}
      code={commandLine}
      codeLanguage={code ? (runtime === "node" ? "javascript" : "python") : "bash"}
      stdout={asText(data.stdout)}
      stderr={asText(data.stderr)}
      exitCode={typeof data.exitCode === "number" ? data.exitCode : null}
      durationMs={typeof data.durationMs === "number" ? data.durationMs : null}
      timedOut={data.timedOut === true}
      footer={[
        inputFiles.length > 0 ? t("toolDebug.inputFiles", { list: inputFiles.join(", ") }) : "",
        files.length > 0 ? t("toolDebug.files", { list: files.join(", ") }) : "",
        jsonOutputs.length > 0 ? t("toolDebug.json", { list: jsonOutputs.join(", ") }) : "",
      ]}
    />
  );
}

/** Fields whose string value is source code / document text, with the fence language to show it in. */
const CODE_FIELD_LANGUAGE: Record<string, string> = {
  code: "",
  command: "bash",
  content: "",
  html: "html",
  markdown: "markdown",
  css: "css",
  sql: "sql",
  old_string: "",
  new_string: "",
};

function languageForFile(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    py: "python", js: "javascript", cjs: "javascript", mjs: "javascript", ts: "typescript", tsx: "tsx",
    jsx: "jsx", html: "html", htm: "html", css: "css", json: "json", md: "markdown", sh: "bash",
    sql: "sql", yml: "yaml", yaml: "yaml", xml: "xml", csv: "csv", svg: "xml",
  };
  return map[ext] ?? "";
}

/** One field of a tool's input or output, shown by type instead of as one JSON blob. */
function DebugField({
  name,
  value,
  fileHint,
  languageHint,
}: {
  name: string;
  value: unknown;
  fileHint: string;
  languageHint: string;
}) {
  const { t } = useI18n();
  const more = (count: number) => t("toolDebug.moreChars", { count });
  const label = (
    <div className="mb-0.5 font-mono text-[11px] text-[var(--muted)]">{name}</div>
  );

  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") {
    return (
      <div className="flex items-baseline gap-2 font-mono text-[11.5px]">
        <span className="text-[var(--muted)] shrink-0">{name}</span>
        <span className={typeof value === "boolean" ? (value ? "text-emerald-400" : "text-red-400/90") : "text-[var(--ink)]"}>
          {String(value)}
        </span>
      </div>
    );
  }

  if (typeof value === "string") {
    const isCode = name in CODE_FIELD_LANGUAGE;
    if (!isCode && !value.includes("\n") && value.length <= 160) {
      return (
        <div className="flex items-baseline gap-2 font-mono text-[11.5px] min-w-0">
          <span className="text-[var(--muted)] shrink-0">{name}</span>
          <span className="text-[var(--ink)] break-all">{value}</span>
        </div>
      );
    }
    const language = CODE_FIELD_LANGUAGE[name] || (name === "code" ? languageHint : "") || languageForFile(fileHint);
    const text = value.length > DEBUG_JSON_MAX_CHARS
      ? `${value.slice(0, DEBUG_JSON_MAX_CHARS)}\n${more(value.length - DEBUG_JSON_MAX_CHARS)}`
      : value;
    return (
      <div>
        {label}
        {isCode ? (
          <MarkdownRenderer
            content={fenced(text, language)}
            className="[&_.group]:!my-0 [&_pre]:!max-h-[260px] [&_pre]:!overflow-y-auto"
          />
        ) : (
          <pre className="max-h-[240px] overflow-auto whitespace-pre-wrap break-words rounded-[8px] border border-[var(--border)] bg-[var(--panel-elevated)] px-2.5 py-1.5 font-mono text-[11.5px] leading-relaxed text-[var(--ink)]">
            {text}
          </pre>
        )}
      </div>
    );
  }

  return (
    <div>
      {label}
      <MarkdownRenderer
        content={fenced(formatDebugJson(value, more), "json")}
        className="[&_.group]:!my-0 [&_pre]:!max-h-[240px] [&_pre]:!overflow-y-auto"
      />
    </div>
  );
}

function DebugFieldGroup({
  title,
  value,
  fileHint,
  languageHint,
}: {
  title: string;
  value: unknown;
  fileHint: string;
  languageHint: string;
}) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? asRecord(value) : null;
  const entries = record ? Object.entries(record) : [];
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{title}</div>
      {record ? (
        entries.length > 0 ? (
          entries.map(([key, v]) => (
            <DebugField key={key} name={key} value={v} fileHint={fileHint} languageHint={languageHint} />
          ))
        ) : (
          <div className="font-mono text-[11.5px] text-[var(--muted)]">—</div>
        )
      ) : (
        <DebugField name="value" value={value} fileHint={fileHint} languageHint={languageHint} />
      )}
    </div>
  );
}

/** Admin tool debug inspect of one tool call: terminal for commands, typed fields for the rest. */
export function ToolDebugDetails({ tool }: { tool: ToolActivity }) {
  const { t } = useI18n();
  if (tool.name === "exec_command") return <ExecCommandDebugView tool={tool} />;
  if (tool.name === "run_skill_script") return <SkillScriptDebugView tool={tool} />;

  const input = asRecord(tool.input);
  const outer = asRecord(tool.output);
  // `{ success, data }` envelopes: the data is what matters
  const output = tool.output !== undefined && "data" in outer && Object.keys(outer).length <= 3 ? outer.data : tool.output;
  const fileHint = asText(input.filename) || asText(input.path) || asText(asRecord(output).filename);
  const languageHint = asText(input.language);

  return (
    <div className="max-w-[620px] space-y-3 rounded-[10px] border border-[var(--border)] bg-[var(--panel)] p-3">
      <div className="font-mono text-[11px] text-[var(--muted)]/80 select-all">
        {tool.name} · {tool.id} · {tool.state}
      </div>
      {tool.error ? (
        <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap break-words rounded-[8px] border border-red-400/20 bg-red-400/5 px-2.5 py-1.5 font-mono text-[11.5px] leading-relaxed text-red-400/90">
          {tool.error}
        </pre>
      ) : null}
      <DebugFieldGroup title={t("toolDebug.input")} value={tool.input ?? null} fileHint={fileHint} languageHint={languageHint} />
      {tool.output !== undefined ? (
        <DebugFieldGroup title={t("toolDebug.output")} value={output} fileHint={fileHint} languageHint={languageHint} />
      ) : null}
    </div>
  );
}
