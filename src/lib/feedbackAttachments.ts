export const FEEDBACK_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const FEEDBACK_MAX_ATTACHMENTS = 10;
export const FEEDBACK_IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp,image/bmp,image/avif,image/heic,image/heif";

const FEEDBACK_IMAGE_NAME_PATTERN = /\.(png|jpe?g|gif|webp|bmp|avif|hei[cf])$/i;
const FEEDBACK_IMAGE_TYPES = new Set(FEEDBACK_IMAGE_ACCEPT.split(","));

export type FeedbackAttachmentSelectionError = "tooMany" | "invalidType" | "tooLarge";

export type FeedbackAttachmentSelectionResult =
  | { ok: true; attachments: File[] }
  | { ok: false; attachments: File[]; reason: FeedbackAttachmentSelectionError };

export interface FeedbackAttachmentPreview {
  file: File;
  key: string;
  url: string;
}

export function isAcceptedFeedbackImage(file: File) {
  return FEEDBACK_IMAGE_TYPES.has(file.type) || (!file.type && FEEDBACK_IMAGE_NAME_PATTERN.test(file.name));
}

export function feedbackAttachmentKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}:${file.type}`;
}

export function hasFeedbackDragFiles(types: Iterable<string> | ArrayLike<string> | null | undefined) {
  if (!types) return false;
  const maybeDomStringList = types as { contains?: (value: string) => boolean };
  if (typeof maybeDomStringList.contains === "function") return maybeDomStringList.contains("Files");
  return Array.from(types).includes("Files");
}

export function createFeedbackAttachmentPreviews(
  attachments: File[],
  createObjectUrl = (file: File) => URL.createObjectURL(file),
): FeedbackAttachmentPreview[] {
  return attachments.map((file) => ({
    file,
    key: feedbackAttachmentKey(file),
    url: createObjectUrl(file),
  }));
}

export function revokeFeedbackAttachmentPreviews(
  previews: Array<Pick<FeedbackAttachmentPreview, "url">>,
  revokeObjectUrl = (url: string) => URL.revokeObjectURL(url),
) {
  for (const preview of previews) revokeObjectUrl(preview.url);
}

export function mergeFeedbackAttachmentSelection(
  current: File[],
  selected: File[],
): FeedbackAttachmentSelectionResult {
  if (selected.length === 0) return { ok: true, attachments: current };

  if (selected.some((file) => !isAcceptedFeedbackImage(file))) {
    return { ok: false, attachments: current, reason: "invalidType" };
  }
  if (selected.some((file) => file.size > FEEDBACK_ATTACHMENT_MAX_BYTES)) {
    return { ok: false, attachments: current, reason: "tooLarge" };
  }

  const seen = new Set(current.map(feedbackAttachmentKey));
  const attachments = [...current];
  for (const file of selected) {
    const key = feedbackAttachmentKey(file);
    if (seen.has(key)) continue;
    seen.add(key);
    attachments.push(file);
  }

  if (attachments.length > FEEDBACK_MAX_ATTACHMENTS) {
    return { ok: false, attachments: current, reason: "tooMany" };
  }

  return { ok: true, attachments };
}
