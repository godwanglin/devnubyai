const fs = require("node:fs");
const path = require("node:path");

const sourceDir = path.join(__dirname, "..", "node_modules", "@lobehub", "icons-static-svg", "icons");
const targetDir = path.join(__dirname, "..", "public", "brand-logos");

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

// Map each brand logo_key to its best available colored or monochrome SVG from lobehub icons
const mapping = {
  openai: "openai.svg",
  claude: "claude-color.svg",
  gemini: "gemini-color.svg",
  deepseek: "deepseek-color.svg",
  grok: "grok.svg",
  meta: "meta-color.svg",
  mistral: "mistral-color.svg",
  qwen: "qwen-color.svg",
  kimi: "kimi-color.svg",
  zhipu: "zhipu-color.svg",
  minimax: "minimax-color.svg",
  cohere: "cohere-color.svg",
  perplexity: "perplexity-color.svg",
};

for (const [logoKey, filename] of Object.entries(mapping)) {
  const src = path.join(sourceDir, filename);
  const dest = path.join(targetDir, `${logoKey}.svg`);
  if (!fs.existsSync(src)) {
    console.error(`Missing source icon: ${src}`);
    process.exit(1);
  }
  fs.copyFileSync(src, dest);
  console.log(`Copied ${filename} -> public/brand-logos/${logoKey}.svg`);
}

// Devnuby brand logo custom SVG
const devnubySvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none">
  <defs>
    <linearGradient id="devnuby_grad" x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
      <stop stop-color="#3B82F6"/>
      <stop offset="1" stop-color="#8B5CF6"/>
    </linearGradient>
  </defs>
  <rect width="48" height="48" rx="12" fill="url(#devnuby_grad)"/>
  <path d="M14 16H22C27.5228 16 32 20.4772 32 26C32 31.5228 27.5228 36 22 36H14V16Z" stroke="#FFFFFF" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="23" cy="26" r="3.5" fill="#FFFFFF"/>
</svg>
`;

fs.writeFileSync(path.join(targetDir, "devnuby.svg"), devnubySvg, "utf8");
console.log("Written custom brand logo -> public/brand-logos/devnuby.svg");
