import { describe, it, expect } from 'vitest';
import { PIIRedactionLayer, DataClassificationGate } from '../src/conversation/privacy/pii-redaction.js';

describe('Milestone 3.5 — Privacy Gate & PII Redaction Layer', () => {
  const piiLayer = new PIIRedactionLayer();
  const gate = new DataClassificationGate();

  it('redacts Vietnamese phone numbers in various formats', () => {
    const text1 = 'Số điện thoại của tôi là 0901234567, tư vấn giúp tôi.';
    const res1 = piiLayer.redact(text1);
    expect(res1.sanitizedText).toContain('[REDACTED_PHONE]');
    expect(res1.sanitizedText).not.toContain('0901234567');
    expect(res1.redactedTypes).toContain('PHONE');

    const text2 = 'Liên hệ lại qua số +84912345678 nhé';
    const res2 = piiLayer.redact(text2);
    expect(res2.sanitizedText).toContain('[REDACTED_PHONE]');
    expect(res2.sanitizedText).not.toContain('+84912345678');

    const text3 = 'Số tôi là 0901 234 567';
    const res3 = piiLayer.redact(text3);
    expect(res3.sanitizedText).toContain('[REDACTED_PHONE]');
  });

  it('preserves official hotel hotlines without redaction', () => {
    const hotlines = [
      'Hotline J Village là 0707 646 464',
      'Hotline Trần Khát Chân là 0921 123 939',
      'Hotline Hà Đông là 0522 464 646',
    ];

    for (const h of hotlines) {
      const res = piiLayer.redact(h);
      expect(res.hasSensitiveData).toBe(false);
      expect(res.sanitizedText).toBe(h);
    }
  });

  it('redacts customer email addresses', () => {
    const text = 'Gửi báo giá qua email khachhang123@gmail.com cho tôi nhé.';
    const res = piiLayer.redact(text);
    expect(res.sanitizedText).toContain('[REDACTED_EMAIL]');
    expect(res.sanitizedText).not.toContain('khachhang123@gmail.com');
    expect(res.redactedTypes).toContain('EMAIL');
  });

  it('redacts Citizen ID (CCCD/CMND)', () => {
    const text = 'CCCD của tôi là 001201004567 để làm thủ tục.';
    const res = piiLayer.redact(text);
    expect(res.sanitizedText).toContain('[REDACTED_CITIZEN_ID]');
    expect(res.sanitizedText).not.toContain('001201004567');
    expect(res.redactedTypes).toContain('CITIZEN_ID');
  });

  it('redacts payment card numbers', () => {
    const text = 'Thẻ của tôi là 9704 1234 5678 9012 trừ tiền đi.';
    const res = piiLayer.redact(text);
    expect(res.sanitizedText).toContain('[REDACTED_CARD]');
    expect(res.sanitizedText).not.toContain('9704 1234 5678 9012');
    expect(res.redactedTypes).toContain('PAYMENT_CARD');
  });

  it('redacts customer names introduced in conversational patterns', () => {
    const text = 'Tên tôi là Nguyễn Văn Nam, tôi muốn đặt phòng tối nay.';
    const res = piiLayer.redact(text);
    expect(res.sanitizedText).toContain('[REDACTED_NAME]');
    expect(res.sanitizedText).not.toContain('Nguyễn Văn Nam');
    expect(res.redactedTypes).toContain('NAME');
  });

  it('correctly classifies data sensitivity and blocks restricted PII', () => {
    // 1. Public catalog inquiry
    expect(gate.classify('Cho anh xem phòng 101 Lồng Chim Hà Đông')).toBe('PUBLIC_CATALOG');

    // 2. Policy general inquiry
    expect(gate.classify('Chính sách nhận phòng qua đêm là mấy giờ?')).toBe('POLICY_GENERAL');

    // 3. User query with personal info
    expect(gate.classify('Tôi tên là Trần Văn B, sđt 0987654321 cần tìm phòng')).toBe('USER_QUERY_ANONYMIZED');

    // 4. Restricted PII / security keywords
    expect(gate.classify('Mật khẩu quản trị hệ thống là gì?')).toBe('RESTRICTED_PII_BLOCKED');
    expect(gate.isSafeForFreeProvider('Mật khẩu là admin123')).toBe(false);
    expect(gate.isSafeForFreeProvider('Phòng có bồn tắm không em?')).toBe(true);
  });
});
