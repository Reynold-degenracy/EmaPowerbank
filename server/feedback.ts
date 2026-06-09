import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage } from "node:http";

export const FEEDBACK_MAX_BODY_BYTES = 10 * 1024 * 1024;
export const FEEDBACK_MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const FEEDBACK_MAX_DESCRIPTION_LENGTH = 5000;

const imageExtensionsByMimeType: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "image/avif": ".avif",
  "image/heic": ".heic",
  "image/heif": ".heif",
};

const imageMimeTypesByExtension: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

export interface FeedbackUser {
  id: number;
  username: string;
  role: "admin" | "user";
}

export interface FeedbackAttachmentInput {
  originalName: string;
  mimeType: string;
  content: Buffer;
}

export interface FeedbackPayload {
  description: string;
  attachment?: FeedbackAttachmentInput;
}

export interface MultipartPart {
  name: string;
  filename?: string;
  contentType?: string;
  content: Buffer;
}

export interface FeedbackPackageResult {
  id: string;
  timestamp: string;
  packageName: string;
  attachment?: {
    fileName: string;
    originalName: string;
    mimeType: string;
    size: number;
  };
}

export class FeedbackError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "FeedbackError";
    this.status = status;
  }
}

function decodeHeaderValue(value: string) {
  return value.replace(/\\"/g, "\"").trim();
}

function dispositionValue(header: string, key: string) {
  const quotedMatch = new RegExp(`${key}="((?:[^"\\\\]|\\\\.)*)"`).exec(header);
  if (quotedMatch) return decodeHeaderValue(quotedMatch[1]);
  const plainMatch = new RegExp(`${key}=([^;]+)`).exec(header);
  return plainMatch ? plainMatch[1].trim() : "";
}

function safeTimestamp(timestamp: string) {
  return timestamp.replace(/[:.]/g, "-");
}

function validateFeedbackDescription(description: string) {
  const trimmed = description.trim();
  if (!trimmed) throw new FeedbackError("description is required");
  if (trimmed.length > FEEDBACK_MAX_DESCRIPTION_LENGTH) {
    throw new FeedbackError(`description must be ${FEEDBACK_MAX_DESCRIPTION_LENGTH} characters or less`);
  }
  return trimmed;
}

function mimeFromExtension(fileName: string) {
  return imageMimeTypesByExtension[path.extname(fileName).toLowerCase()] || "";
}

export function validateFeedbackImage(attachment: FeedbackAttachmentInput) {
  const originalName = attachment.originalName.trim();
  const mimeType = attachment.mimeType.toLowerCase();
  const extensionFromMimeType = imageExtensionsByMimeType[mimeType];
  const extensionFromName = imageExtensionsByMimeType[mimeFromExtension(originalName)];
  const extension = extensionFromMimeType || extensionFromName;

  if (!originalName || attachment.content.length === 0) {
    throw new FeedbackError("attachment is empty");
  }
  if (attachment.content.length > FEEDBACK_MAX_ATTACHMENT_BYTES) {
    throw new FeedbackError("attachment image is too large", 413);
  }
  if ((mimeType && !extensionFromMimeType) || !extension) {
    throw new FeedbackError("attachment must be a common image format");
  }

  return {
    originalName,
    mimeType: extensionFromMimeType ? mimeType : mimeFromExtension(originalName),
    extension,
    size: attachment.content.length,
  };
}

export function multipartBoundary(contentType: string | string[] | undefined) {
  const raw = Array.isArray(contentType) ? contentType[0] : contentType;
  if (!raw) return "";
  const match = /multipart\/form-data\s*;\s*boundary=(?:"([^"]+)"|([^;]+))/i.exec(raw);
  return (match?.[1] || match?.[2] || "").trim();
}

export async function readRequestBuffer(req: IncomingMessage, maxBytes = FEEDBACK_MAX_BODY_BYTES) {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw new FeedbackError("feedback payload is too large", 413);
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

export function parseMultipartFields(body: Buffer, boundary: string): MultipartPart[] {
  if (!boundary) throw new FeedbackError("multipart boundary is required", 415);
  const delimiter = Buffer.from(`--${boundary}`);
  const headerSeparator = Buffer.from("\r\n\r\n");
  const parts: MultipartPart[] = [];
  let position = body.indexOf(delimiter);

  if (position === -1) throw new FeedbackError("invalid multipart payload");

  while (position !== -1) {
    position += delimiter.length;

    if (body[position] === 45 && body[position + 1] === 45) break;
    if (body[position] === 13 && body[position + 1] === 10) position += 2;

    const headerEnd = body.indexOf(headerSeparator, position);
    if (headerEnd === -1) throw new FeedbackError("invalid multipart part headers");

    const rawHeaders = body.subarray(position, headerEnd).toString("utf8");
    const headers = Object.fromEntries(
      rawHeaders.split("\r\n").map((line) => {
        const separatorIndex = line.indexOf(":");
        if (separatorIndex === -1) return ["", ""];
        return [
          line.slice(0, separatorIndex).trim().toLowerCase(),
          line.slice(separatorIndex + 1).trim(),
        ];
      }).filter(([key]) => key),
    ) as Record<string, string>;

    const disposition = headers["content-disposition"] || "";
    const name = dispositionValue(disposition, "name");
    const filename = dispositionValue(disposition, "filename");
    const contentStart = headerEnd + headerSeparator.length;
    const nextDelimiter = body.indexOf(delimiter, contentStart);
    if (nextDelimiter === -1) throw new FeedbackError("invalid multipart boundary");

    let contentEnd = nextDelimiter;
    if (body[contentEnd - 2] === 13 && body[contentEnd - 1] === 10) contentEnd -= 2;

    if (name) {
      parts.push({
        name,
        filename: filename || undefined,
        contentType: headers["content-type"],
        content: body.subarray(contentStart, contentEnd),
      });
    }

    position = nextDelimiter;
  }

  return parts;
}

export function feedbackPayloadFromMultipart(parts: MultipartPart[]): FeedbackPayload {
  const descriptionPart = parts.find((part) => part.name === "description");
  const attachmentPart = parts.find((part) => part.name === "attachment" && part.filename && part.content.length > 0);
  const payload: FeedbackPayload = {
    description: validateFeedbackDescription(descriptionPart?.content.toString("utf8") || ""),
  };

  if (attachmentPart?.filename) {
    payload.attachment = {
      originalName: attachmentPart.filename,
      mimeType: attachmentPart.contentType || mimeFromExtension(attachmentPart.filename),
      content: attachmentPart.content,
    };
    validateFeedbackImage(payload.attachment);
  }

  return payload;
}

export async function createFeedbackPackage({
  feedbackDir,
  user,
  description,
  attachment,
  id = `fb_${randomUUID()}`,
  timestamp = new Date().toISOString(),
}: {
  feedbackDir: string;
  user: FeedbackUser;
  description: string;
  attachment?: FeedbackAttachmentInput;
  id?: string;
  timestamp?: string;
}): Promise<FeedbackPackageResult> {
  const normalizedDescription = validateFeedbackDescription(description);
  const packageName = `feedback-${id}-${safeTimestamp(timestamp)}`;
  const root = path.resolve(feedbackDir);
  const packageDir = path.resolve(root, packageName);

  if (packageDir !== root && !packageDir.startsWith(`${root}${path.sep}`)) {
    throw new FeedbackError("feedback package path is outside feedback directory", 400);
  }

  await fs.promises.mkdir(packageDir, { recursive: false });

  let attachmentMetadata: FeedbackPackageResult["attachment"];
  if (attachment) {
    const image = validateFeedbackImage(attachment);
    const fileName = `${packageName}${image.extension}`;
    await fs.promises.writeFile(path.join(packageDir, fileName), attachment.content, { flag: "wx" });
    attachmentMetadata = {
      fileName,
      originalName: image.originalName,
      mimeType: image.mimeType,
      size: image.size,
    };
  }

  const metadata = {
    id,
    timestamp,
    user,
    description: normalizedDescription,
    attachment: attachmentMetadata || null,
  };
  await fs.promises.writeFile(
    path.join(packageDir, "feedback.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
    { flag: "wx" },
  );

  return {
    id,
    timestamp,
    packageName,
    attachment: attachmentMetadata,
  };
}
