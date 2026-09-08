import { describe, expect, it } from 'vitest';
import {
  buildComplaintAcknowledgementHtml,
  type ComplaintAcknowledgementData,
} from './complaint-acknowledgement.template';

const BASE_DATA: ComplaintAcknowledgementData = {
  complaintId: 'complaint-123',
  customerLegalName: 'شركة الأفق للتأمين',
  issue: 'Delayed response on my claim',
  category: 'unanswered_claim',
  createdAt: new Date('2026-01-15T00:00:00Z'),
  dueAt: new Date('2026-01-29T00:00:00Z'),
  bodyEn: 'Thank you for contacting us.',
  bodyAr: 'شكراً لتواصلكم معنا.',
};

describe('buildComplaintAcknowledgementHtml', () => {
  it('renders an AR-only document with dir="rtl" and no English section', () => {
    const html = buildComplaintAcknowledgementHtml(BASE_DATA, 'AR');
    expect(html).toContain('dir="rtl"');
    expect(html).not.toContain('dir="ltr"');
    expect(html).toContain('شكراً لتواصلكم معنا.');
    expect(html).not.toContain('Thank you for contacting us.');
  });

  it('renders an EN-only document with dir="ltr" and no Arabic section', () => {
    const html = buildComplaintAcknowledgementHtml(BASE_DATA, 'EN');
    expect(html).toContain('dir="ltr"');
    expect(html).not.toContain('dir="rtl"');
    expect(html).toContain('Thank you for contacting us.');
    expect(html).not.toContain('شكراً لتواصلكم معنا.');
  });

  it("DUAL renders both sections, Arabic first (this system's primary language)", () => {
    const html = buildComplaintAcknowledgementHtml(BASE_DATA, 'DUAL');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('شكراً لتواصلكم معنا.');
    expect(html).toContain('Thank you for contacting us.');
    expect(html.indexOf('dir="rtl"')).toBeLessThan(html.indexOf('dir="ltr"'));
  });

  it('translates a known category to its bilingual label, not the raw snake_case value', () => {
    const htmlEn = buildComplaintAcknowledgementHtml(BASE_DATA, 'EN');
    expect(htmlEn).toContain('Unanswered Claim');
    expect(htmlEn).not.toContain('unanswered_claim');

    const htmlAr = buildComplaintAcknowledgementHtml(BASE_DATA, 'AR');
    expect(htmlAr).toContain('مطالبة دون رد');
  });

  it('falls back to the raw category string for an unrecognized value, rather than dropping it', () => {
    const html = buildComplaintAcknowledgementHtml(
      { ...BASE_DATA, category: 'some_future_category' },
      'EN',
    );
    expect(html).toContain('some_future_category');
  });

  it('omits the SLA due-date row entirely when no SLA timer exists', () => {
    const html = buildComplaintAcknowledgementHtml(
      { ...BASE_DATA, dueAt: null },
      'EN',
    );
    expect(html).not.toContain('Expected Response By');
  });

  it('escapes HTML-shaped customer-supplied content instead of injecting it raw', () => {
    const html = buildComplaintAcknowledgementHtml(
      { ...BASE_DATA, issue: '<script>alert(1)</script>' },
      'EN',
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes a single quote too, not just the other 4 HTML-special characters', () => {
    const html = buildComplaintAcknowledgementHtml(
      { ...BASE_DATA, issue: "It's been unresolved for weeks" },
      'EN',
    );
    expect(html).not.toContain("It's been unresolved for weeks");
    expect(html).toContain('It&#39;s been unresolved for weeks');
  });
});
