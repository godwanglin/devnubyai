/**
 * Device and browser parser from User-Agent string.
 */
export function parseDeviceUa(ua: string | null): { device: string; browser: string } {
  if (!ua) return { device: "Perangkat Lain", browser: "Browser" };

  let device = "Desktop";
  if (/Android/i.test(ua)) device = "Android";
  else if (/iPhone/i.test(ua)) device = "iPhone";
  else if (/iPad/i.test(ua)) device = "iPad";
  else if (/Macintosh|Mac OS/i.test(ua)) device = "macOS";
  else if (/Windows/i.test(ua)) device = "Windows";
  else if (/Linux/i.test(ua)) device = "Linux";

  let browser = "Browser";
  if (/WindowsPowerShell|curl/i.test(ua)) browser = "CLI / Script";
  else if (/Edg/i.test(ua)) browser = "Edge";
  else if (/Chrome/i.test(ua)) browser = "Chrome";
  else if (/Safari/i.test(ua)) browser = "Safari";
  else if (/Firefox/i.test(ua)) browser = "Firefox";

  return { device, browser };
}
