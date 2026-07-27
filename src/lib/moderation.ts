/**
 * Shared, non-"use server" constants for fraud-flag moderation. A "use
 * server" file (src/actions/admin-moderation.ts) can only export async
 * functions — Next.js's server-actions transform rejects any other export,
 * so this plain value/type lives here instead and is imported by both the
 * server action and the client form that renders the review buttons.
 */
export const REVIEW_ACTIONS = ["cleared", "confirmed", "escalated"] as const
export type FraudReviewAction = (typeof REVIEW_ACTIONS)[number]
