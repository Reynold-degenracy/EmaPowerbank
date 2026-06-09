export type FeedbackApprovalDecision =
  | { ok: true; rewardAmount: number }
  | { ok: false; reason: "invalidReward" | "cancelled" };

export function getFeedbackApprovalDecision(
  rewardDraft: string | undefined,
  confirmApprove: () => boolean,
): FeedbackApprovalDecision {
  const rewardAmount = Number(rewardDraft || 0);
  if (!Number.isFinite(rewardAmount) || rewardAmount <= 0) {
    return { ok: false, reason: "invalidReward" };
  }
  if (!confirmApprove()) {
    return { ok: false, reason: "cancelled" };
  }
  return { ok: true, rewardAmount };
}
