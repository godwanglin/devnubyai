/**
 * Manual check for fetch_url's YouTube path: npx tsx --env-file=.env scripts/test-fetch-youtube.ts [url]
 * Uses a throwaway session id, so the saved copy lands in .devnuby/fetch-cache/test-fetch-youtube/.
 */
import { fetchUrlTool } from "../src/lib/tools/fetch-url";
import { sanitizeToolOutputForStorage } from "../src/lib/tools/compact-source";

const urls = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["https://youtu.be/jNQXAC9IVRw", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s"];

async function main() {
  for (const url of urls) {
    for (const round of ["first", "repeat"]) {
      const started = Date.now();
      const result = await fetchUrlTool.execute(
        { url, maxChars: 2_000 },
        { userId: "test", sessionId: "test-fetch-youtube" }
      );
      const video = result.data?.video;
      console.log(`\n=== ${round} ${url} (${Date.now() - started}ms, ${result.metadata?.provider}) ===`);
      if (!result.success) {
        console.log("FAILED", result.error);
        continue;
      }
      if (!video) {
        console.log("no video data; page title:", result.data?.title);
        continue;
      }
      console.log({
        title: video.title,
        channel: video.channel,
        uploadDate: video.uploadDate,
        duration: video.duration,
        views: video.viewCount,
        chapters: video.chapters.length,
        descriptionChars: video.description.length,
        savedFile: video.savedFile,
        fromSavedFile: video.fromSavedFile,
        transcript: video.transcript && {
          language: video.transcript.language,
          source: video.transcript.source,
          totalChars: video.transcript.totalChars,
          nextStartAt: video.transcript.nextStartAt,
        },
      });
      console.log(video.transcript?.text.split("\n").slice(0, 4).join("\n"));
      console.log("client sees:", JSON.stringify(sanitizeToolOutputForStorage("fetch_url", result.data)));

      if (round === "repeat" && video.transcript?.nextStartAt) {
        const next = await fetchUrlTool.execute(
          { url, maxChars: 2_000, startAt: video.transcript.nextStartAt },
          { userId: "test", sessionId: "test-fetch-youtube" }
        );
        console.log(`--- continuation from ${video.transcript.nextStartAt}s:`);
        console.log(next.data?.video?.transcript?.text.split("\n").slice(0, 2).join("\n"));
      }
    }
  }
  process.exit(0);
}

void main();
