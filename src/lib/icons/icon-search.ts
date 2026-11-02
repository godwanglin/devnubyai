/**
 * Keyword search for the icon picker. Lucide icon names alone miss most words
 * an admin types ("usage", "quota"), so names are matched together with
 * Lucide's own tags (public/icons/lucide-tags.json, from lucide-static of the
 * same version as lucide-react) and a few pricing-page / Indonesian aliases.
 */
type IconTags = Record<string, string[]>;

/** Extra words → icons, for terms Lucide's tags don't cover. */
const ALIASES: Record<string, string[]> = {
  usage: ["gauge", "activity", "chart-no-axes-column", "chart-pie", "battery-medium", "percent", "trending-up"],
  quota: ["gauge", "chart-pie", "battery-medium", "database", "hourglass", "percent"],
  limit: ["gauge", "shield", "timer", "hourglass", "ban", "octagon-alert"],
  unlimited: ["infinity", "zap", "rocket"],
  request: ["send", "message-square", "messages-square", "arrow-up-right", "repeat"],
  rate: ["timer", "gauge", "clock", "activity"],
  model: ["bot", "brain", "cpu", "sparkles", "brain-circuit"],
  ai: ["bot", "brain", "sparkles", "wand-sparkles", "brain-circuit", "cpu"],
  priority: ["zap", "flame", "star", "crown", "rocket", "arrow-up"],
  support: ["life-buoy", "headset", "messages-square", "hand-helping"],
  storage: ["database", "hard-drive", "folder", "cloud", "archive"],
  premium: ["crown", "gem", "star", "sparkles", "badge-check"],
  // Indonesian
  pemakaian: ["gauge", "activity", "chart-pie", "battery-medium", "percent"],
  kuota: ["gauge", "chart-pie", "battery-medium", "database", "hourglass"],
  batas: ["gauge", "shield", "timer", "hourglass", "ban"],
  cepat: ["zap", "rocket", "gauge", "timer"],
  waktu: ["clock", "timer", "hourglass", "calendar"],
  pesan: ["message-square", "messages-square", "send", "mail"],
  dukungan: ["life-buoy", "headset", "hand-helping"],
  keamanan: ["shield", "shield-check", "lock", "key-round"],
  tanpa: ["infinity"],
};

let tagsPromise: Promise<IconTags> | null = null;

/** Loads Lucide's tags once per page; search still works on names if it fails. */
export function loadIconTags(): Promise<IconTags> {
  tagsPromise ??= fetch("/icons/lucide-tags.json")
    .then((res) => (res.ok ? (res.json() as Promise<IconTags>) : {}))
    .catch(() => {
      tagsPromise = null;
      return {};
    });
  return tagsPromise;
}

/** Icons matching the query: name matches first, then tag / alias matches. */
export function searchIcons(names: readonly string[], query: string, tags: IconTags): readonly string[] {
  const q = query.trim().toLowerCase();
  if (!q) return names;
  const slug = q.replace(/\s+/g, "-");

  const aliasHits = new Set<string>();
  for (const [word, icons] of Object.entries(ALIASES)) {
    if (word.startsWith(q) || q.startsWith(word)) icons.forEach((icon) => aliasHits.add(icon));
  }

  const byName: string[] = [];
  const byKeyword: string[] = [];
  for (const name of names) {
    if (name.includes(slug)) byName.push(name);
    else if (aliasHits.has(name) || tags[name]?.some((tag) => tag.toLowerCase().includes(q))) byKeyword.push(name);
  }
  return [...byName, ...byKeyword];
}
