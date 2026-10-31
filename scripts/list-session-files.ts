import { writeFileSync } from "node:fs";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { db } from "../src/lib/db";
import { getR2Config, getS3Client } from "../src/lib/storage/r2";

// Temporary debug helper: downloads one session file (matched by name fragment) for local parser testing.
async function main() {
  const [chatPublicId, nameFragment, outPath] = process.argv.slice(2);
  const cs = await db.chatSession.findUnique({ where: { publicId: chatPublicId }, select: { id: true } });
  if (!cs) throw new Error("chat not found");
  const files = await db.sessionFile.findMany({
    where: { sessionId: cs.id },
    select: { filename: true, storageKey: true, sizeBytes: true },
  });
  for (const f of files) console.log(f.filename, f.sizeBytes.toString(), f.storageKey);
  const file = files.find((f) => f.filename.includes(nameFragment));
  if (!file || !outPath) return;
  const res = await getS3Client().send(
    new GetObjectCommand({ Bucket: getR2Config().bucketName, Key: file.storageKey })
  );
  const bytes = await res.Body!.transformToByteArray();
  writeFileSync(outPath, bytes);
  console.log("saved", outPath, bytes.length);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
