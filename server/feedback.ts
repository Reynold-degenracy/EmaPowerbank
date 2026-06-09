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

export interface FeedbackAttachmentMetadata {
  fileName: string;
  originalName: string;
  mimeType: string;
  size: number;
}

export type FeedbackReviewStatus = "pending" | "approved" | "rejected";
export type FeedbackReviewFilter = FeedbackReviewStatus | "all";

export interface FeedbackReview {
  status: FeedbackReviewStatus;
  rewardAmount: number;
  reviewedBy: FeedbackUser | null;
  reviewedAt: string | null;
}

export interface FeedbackMetadata {
  id: string;
  timestamp: string;
  packageName: string;
  user: FeedbackUser;
  description: string;
  attachment: FeedbackAttachmentMetadata | null;
  review: FeedbackReview;
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
  attachment?: FeedbackAttachmentMetadata;
  review: FeedbackReview;
}

export class FeedbackError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "FeedbackError";
    this.status = status;
  }
}

const reviewLocks = new Map<string, Promise<void>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function defaultReview(): FeedbackReview {
  return {
    status: "pending",
    rewardAmount: 0,
    reviewedBy: null,
    reviewedAt: null,
  };
}

function normalizeUser(value: unknown): FeedbackUser {
  if (!isRecord(value)) throw new FeedbackError("invalid feedback user");
  const role = value.role === "admin" ? "admin" : "user";
  const id = Number(value.id);
  const username = String(value.username || "").trim();
  if (!Number.isFinite(id) || id <= 0 || !username) {
    throw new FeedbackError("invalid feedback user");
  }
  return { id, username, role };
}

function normalizeAttachment(value: unknown): FeedbackAttachmentMetadata | null {
  if (!isRecord(value)) return null;
  const fileName = String(value.fileName || "").trim();
  const originalName = String(value.originalName || "").trim();
  const mimeType = String(value.mimeType || "").trim();
  const size = Number(value.size);
  if (!fileName || !originalName || !mimeType || !Number.isFinite(size) || size < 0) {
    return null;
  }
  return { fileName, originalName, mimeType, size };
}

function normalizeReview(value: unknown): FeedbackReview {
  if (!isRecord(value)) return defaultReview();
  const status: FeedbackReviewStatus = value.status === "approved" || value.status === "rejected"
    ? value.status
    : "pending";
  const rewardAmount = status === "approved" && Number.isFinite(Number(value.rewardAmount))
    ? Number(value.rewardAmount)
    : 0;
  const reviewedBy = status === "pending" ? null : (() => {
    try {
      return normalizeUser(value.reviewedBy);
    } catch {
      return null;
    }
  })();
  const reviewedAt = status === "pending" ? null : String(value.reviewedAt || "").trim() || null;

  return {
    status,
    rewardAmount,
    reviewedBy,
    reviewedAt,
  };
}

function validateFeedbackId(id: string) {
  const normalized = id.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(normalized)) {
    throw new FeedbackError("invalid feedback id");
  }
  return normalized;
}

function resolvePackageDir(feedbackDir: string, packageName: string) {
  const root = path.resolve(feedbackDir);
  const packageDir = path.resolve(root, packageName);
  if (packageDir !== root && packageDir.startsWith(`${root}${path.sep}`)) return packageDir;
  throw new FeedbackError("feedback package path is outside feedback directory");
}

function feedbackJsonPath(feedbackDir: string, packageName: string) {
  return path.join(resolvePackageDir(feedbackDir, packageName), "feedback.json");
}

export function normalizeFeedbackMetadata(value: unknown, fallbackPackageName = ""): FeedbackMetadata {
  if (!isRecord(value)) throw new FeedbackError("invalid feedback metadata");
  const id = String(value.id || "").trim();
  const timestamp = String(value.timestamp || "").trim();
  const packageName = String(value.packageName || fallbackPackageName || "").trim();
  const description = String(value.description || "").trim();
  if (!id || !timestamp || !packageName || !description) {
    throw new FeedbackError("invalid feedback metadata");
  }
  return {
    id,
    timestamp,
    packageName,
    user: normalizeUser(value.user),
    description,
    attachment: normalizeAttachment(value.attachment),
    review: normalizeReview(value.review),
  };
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

async function writeFeedbackMetadata(feedbackDir: string, metadata: FeedbackMetadata) {
  const filePath = feedbackJsonPath(feedbackDir, metadata.packageName);
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  await fs.promises.writeFile(tempPath, `${JSON.stringify(metadata, null, 2)}\n`, { flag: "wx" });
  await fs.promises.rename(tempPath, filePath);
}

async function withFeedbackReviewLock<T>(id: string, action: () => Promise<T>) {
  const previous = reviewLocks.get(id) || Promise.resolve();
  let release!: () => void;
  const current = previous.catch(() => undefined).then(() => new Promise<void>((resolve) => {
    release = resolve;
  }));
  reviewLocks.set(id, current);
  await previous.catch(() => undefined);

  try {
    return await action();
  } finally {
    release();
    if (reviewLocks.get(id) === current) {
      reviewLocks.delete(id);
    }
  }
}

export async function listFeedbackPackages(feedbackDir: string, status: FeedbackReviewFilter = "pending") {
  const root = path.resolve(feedbackDir);
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const feedbacks: FeedbackMetadata[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("feedback-")) continue;
    try {
      const raw = await fs.promises.readFile(path.join(root, entry.name, "feedback.json"), "utf8");
      const feedback = normalizeFeedbackMetadata(JSON.parse(raw), entry.name);
      if (status === "all" || feedback.review.status === status) {
        feedbacks.push(feedback);
      }
    } catch {
      // Invalid feedback package metadata is ignored in list responses.
    }
  }

  return feedbacks.sort((left, right) => {
    const dateDiff = Date.parse(right.timestamp) - Date.parse(left.timestamp);
    return dateDiff || right.id.localeCompare(left.id);
  });
}

export async function readFeedbackPackage(feedbackDir: string, id: string) {
  const normalizedId = validateFeedbackId(id);
  const feedbacks = await listFeedbackPackages(feedbackDir, "all");
  const feedback = feedbacks.find((item) => item.id === normalizedId);
  if (!feedback) throw new FeedbackError("Feedback not found", 404);
  return feedback;
}

export function resolveFeedbackAttachmentPath(feedbackDir: string, feedback: FeedbackMetadata) {
  if (!feedback.attachment?.fileName) throw new FeedbackError("Feedback attachment not found", 404);
  const packageDir = resolvePackageDir(feedbackDir, feedback.packageName);
  const filePath = path.resolve(packageDir, feedback.attachment.fileName);
  if (filePath !== packageDir && filePath.startsWith(`${packageDir}${path.sep}`)) return filePath;
  throw new FeedbackError("Feedback attachment path is outside feedback directory");
}

export async function approveFeedbackPackage({
  feedbackDir,
  id,
  reviewer,
  rewardAmount,
  creditUser,
  reviewedAt = new Date().toISOString(),
}: {
  feedbackDir: string;
  id: string;
  reviewer: FeedbackUser;
  rewardAmount: number;
  creditUser: (userId: number, amount: number) => Promise<void> | void;
  reviewedAt?: string;
}) {
  const normalizedId = validateFeedbackId(id);
  const amount = Number(rewardAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new FeedbackError("rewardAmount must be greater than 0");
  }

  return withFeedbackReviewLock(normalizedId, async () => {
    const feedback = await readFeedbackPackage(feedbackDir, normalizedId);
    if (feedback.review.status !== "pending") {
      throw new FeedbackError("Feedback already reviewed", 409);
    }
    await creditUser(feedback.user.id, amount);
    const updated: FeedbackMetadata = {
      ...feedback,
      review: {
        status: "approved",
        rewardAmount: amount,
        reviewedBy: reviewer,
        reviewedAt,
      },
    };
    await writeFeedbackMetadata(feedbackDir, updated);
    return updated;
  });
}

export async function rejectFeedbackPackage({
  feedbackDir,
  id,
  reviewer,
  reviewedAt = new Date().toISOString(),
}: {
  feedbackDir: string;
  id: string;
  reviewer: FeedbackUser;
  reviewedAt?: string;
}) {
  const normalizedId = validateFeedbackId(id);
  return withFeedbackReviewLock(normalizedId, async () => {
    const feedback = await readFeedbackPackage(feedbackDir, normalizedId);
    if (feedback.review.status !== "pending") {
      throw new FeedbackError("Feedback already reviewed", 409);
    }
    const updated: FeedbackMetadata = {
      ...feedback,
      review: {
        status: "rejected",
        rewardAmount: 0,
        reviewedBy: reviewer,
        reviewedAt,
      },
    };
    await writeFeedbackMetadata(feedbackDir, updated);
    return updated;
  });
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
    packageName,
    user,
    description: normalizedDescription,
    attachment: attachmentMetadata || null,
    review: defaultReview(),
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
    review: metadata.review,
  };
}
