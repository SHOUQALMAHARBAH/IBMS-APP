import { describe, expect, it } from 'vitest';
import {
  deriveFeedbackView,
  feedbackAuditSnapshot,
  isFeedbackContext,
  type FeedbackRow,
} from './feedback.config';

describe('isFeedbackContext (Process 45)', () => {
  it('accepts the three documented touchpoints, rejects anything else', () => {
    expect(isFeedbackContext('post_issuance')).toBe(true);
    expect(isFeedbackContext('post_claim')).toBe(true);
    expect(isFeedbackContext('post_renewal')).toBe(true);
    expect(isFeedbackContext('post_complaint')).toBe(false);
    expect(isFeedbackContext('')).toBe(false);
  });
});

describe('deriveFeedbackView (Process 45)', () => {
  const row: FeedbackRow = {
    id: 'fb-1',
    customerId: 'cust-1',
    context: 'post_claim',
    score: 4,
    comments: 'The adjuster was responsive throughout.',
    submittedAt: new Date('2026-09-04T09:00:00.000Z'),
  };

  it('renders the row with an ISO timestamp, score and comments intact', () => {
    expect(deriveFeedbackView(row)).toEqual({
      id: 'fb-1',
      customerId: 'cust-1',
      context: 'post_claim',
      score: 4,
      comments: 'The adjuster was responsive throughout.',
      submittedAt: '2026-09-04T09:00:00.000Z',
    });
  });

  it('carries a null score / comments through unchanged', () => {
    const v = deriveFeedbackView({ ...row, score: null, comments: null });
    expect(v.score).toBeNull();
    expect(v.comments).toBeNull();
  });
});

describe('feedbackAuditSnapshot (Process 45)', () => {
  it('carries ids + context + score + submittedAt, and NEVER comments', () => {
    const snap = feedbackAuditSnapshot({
      feedbackId: 'fb-1',
      customerId: 'cust-1',
      context: 'post_issuance',
      score: 5,
      submittedAt: new Date('2026-09-04T09:00:00.000Z'),
    });
    expect(snap).toEqual({
      feedbackId: 'fb-1',
      customerId: 'cust-1',
      context: 'post_issuance',
      score: 5,
      submittedAt: '2026-09-04T09:00:00.000Z',
    });
    expect(Object.keys(snap)).not.toContain('comments');
  });
});
