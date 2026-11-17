import { createHash } from "crypto";
import { GridFSBucket, ObjectId } from "mongodb";
import { Readable } from "stream";
import { getDb } from "@/lib/mongodb";
import { runBoatCommand, shellQuote } from "@/lib/boat";

/**
 * Campaign attachments (the same files on every email). Stored in MongoDB GridFS; copied to the
 * cloud computer once and reused, then attached through the mail client's own file picker.
 */
export const CLOUD_ATTACHMENT_MAX_TOTAL = 18 * 1024 * 1024; // under Gmail/Outlook web limits
export const CLOUD_ATTACHMENT_MAX_FILES = 10;

export type CloudAttachment = {
  id: string;
  name: string;
  size: number;
  type: string;
  sha1: string;
};

async function bucket() {
  const db = await getDb();
  return new GridFSBucket(db, { bucketName: "cloud_attachments" });
}

/** Keep names safe for paths and still recognisable in the email. */
export function safeAttachmentName(name: string) {
  const cleaned = String(name || "file")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned || "file";
}

export async function storeCloudAttachment(input: {
  projectId: ObjectId;
  campaignId: string;
  name: string;
  type: string;
  data: Buffer;
}): Promise<CloudAttachment> {
  const fs = await bucket();
  const name = safeAttachmentName(input.name);
  const sha1 = createHash("sha1").update(input.data).digest("hex");
  const id = await new Promise<ObjectId>((resolve, reject) => {
    const upload = fs.openUploadStream(name, {
      metadata: { projectId: input.projectId, campaignId: input.campaignId, type: input.type, sha1 },
    });
    Readable.from(input.data)
      .pipe(upload)
      .on("error", reject)
      .on("finish", () => resolve(upload.id as ObjectId));
  });
  return { id: id.toHexString(), name, size: input.data.length, type: input.type || "application/octet-stream", sha1 };
}

export async function deleteCloudAttachment(id: string) {
  const fs = await bucket();
  await fs.delete(new ObjectId(id)).catch(() => undefined);
}

async function readAttachment(id: string) {
  const fs = await bucket();
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    fs.openDownloadStream(new ObjectId(id))
      .on("data", (chunk: Buffer) => chunks.push(chunk))
      .on("error", reject)
      .on("end", () => resolve());
  });
  return Buffer.concat(chunks);
}

/**
 * Make sure every attachment is on the VM (copied once, verified by size). Returns absolute
 * paths for the sender script. Large files are written in chunks to stay under request limits.
 */
export async function ensureAttachmentsOnVm(sandboxId: string, attachments: CloudAttachment[]) {
  const out: { path: string; name: string }[] = [];
  for (const attachment of attachments) {
    // Content hash as the folder keeps the original file name for the recipient.
    const dir = `"$HOME/nexuses-sender/attachments/${attachment.sha1}"`;
    const file = `${dir}/${shellQuote(attachment.name)}`;
    const check = await runBoatCommand(sandboxId, `stat -c %s ${file} 2>/dev/null || echo missing`, 15);
    if (Number(check.stdout.trim()) !== attachment.size) {
      const data = await readAttachment(attachment.id);
      const tmp = `${dir}/.part`;
      await runBoatCommand(sandboxId, `mkdir -p ${dir} && rm -f ${tmp}`, 15);
      const chunk = 450 * 1024;
      for (let offset = 0; offset < data.length; offset += chunk) {
        const b64 = data.subarray(offset, offset + chunk).toString("base64").replace(/(.{1,76})/g, "$1\n");
        const write = await runBoatCommand(
          sandboxId,
          [`base64 -d >> ${tmp} <<'NXS_FILE_EOF'`, b64.trimEnd(), `NXS_FILE_EOF`, `echo ok`].join("\n"),
          40,
        );
        if (!/ok/.test(write.stdout)) throw new Error(`Couldn't copy ${attachment.name} to the computer`);
      }
      const finalize = await runBoatCommand(sandboxId, `mv ${tmp} ${file} && stat -c %s ${file}`, 15);
      if (Number(finalize.stdout.trim()) !== attachment.size) {
        throw new Error(`${attachment.name} didn't copy completely; try again`);
      }
    }
    const resolved = await runBoatCommand(sandboxId, `readlink -f ${file}`, 15);
    out.push({ path: resolved.stdout.trim(), name: attachment.name });
  }
  return out;
}
