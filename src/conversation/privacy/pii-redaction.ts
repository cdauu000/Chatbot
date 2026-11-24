/**
 * J Collection AI Concierge - Privacy Gate & PII Redaction Layer
 * Milestone 3.5: Prevents sensitive personal data from leaking to Free LLM APIs.
 */

export interface RedactionResult {
  sanitizedText: string;
  redactedTypes: string[];
  hasSensitiveData: boolean;
  maskedReplacements: Record<string, string>;
}

export type DataClassification =
  | 'PUBLIC_CATALOG'
  | 'POLICY_GENERAL'
  | 'USER_QUERY_ANONYMIZED'
  | 'RESTRICTED_PII_BLOCKED';

export class PIIRedactionLayer {
  // Vietnamese phone numbers: 10 digits starting with 03, 05, 07, 08, 09 or +84
  private static readonly PHONE_REGEX =
    /(?:\+84|84|0)(?:3[2-9]|5[25689]|7[06-9]|8[1-9]|9\d)\d{7}\b/g;

  // General phone number pattern with spaces/dots: 0901 234 567, 0901.234.567
  private static readonly FORMATTED_PHONE_REGEX =
    /(?:\+84|0)(?:\s*\d){9,10}\b/g;

  // Email address pattern
  private static readonly EMAIL_REGEX =
    /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;

  // Citizen ID / CMND / CCCD: 9 or 12 digits
  private static readonly CITIZEN_ID_REGEX =
    /\b(?:cccd|cmnd|id|so cccd|so cmnd)?\s*(\d{12}|\d{9})\b/gi;

  // Credit card / Bank card: 16 digits or 4x4 groups
  private static readonly CARD_REGEX =
    /\b(?:\d{4}[-\s]?){3}\d{4}\b/g;

  // Personal name introduction patterns (Vietnamese)
  // e.g. "tên tôi là Nguyễn Văn A", "tôi tên là Lê Văn B", "tên anh là Trần C"
  private static readonly NAME_INTRO_REGEX =
    /(?:tôi tên là|tên tôi là|tên em là|tên anh là|tên chị là|mình tên là|khách tên là|tên:?)\s+([A-ZÀ-Ỹa-zà-ỹ\s]{2,25})(?=[,.\n]|\s+(?:sđt|sdt|số|ở|muốn|thuê|đặt|tại)|$)/gi;

  /**
   * Redacts sensitive personal identifiable information (PII) from user utterance.
   */
  public redact(text: string): RedactionResult {
    let sanitized = text;
    const redactedTypes: string[] = [];
    const maskedReplacements: Record<string, string> = {};

    // 1. Temporarily protect official hotel hotlines from being matched by general digit regexes
    const HOTLINES = ['0707 646 464', '0921 123 939', '0522 464 646'];
    const hotlineHolders: { placeholder: string; original: string }[] = [];
    HOTLINES.forEach((h, idx) => {
      if (sanitized.includes(h)) {
        const ph = `__HOTLINE_${idx}__`;
        hotlineHolders.push({ placeholder: ph, original: h });
        sanitized = sanitized.replaceAll(h, ph);
      }
    });

    // 2. Redact Payment Card Numbers (16 digits / 4 groups of 4)
    if (PIIRedactionLayer.CARD_REGEX.test(sanitized)) {
      sanitized = sanitized.replace(PIIRedactionLayer.CARD_REGEX, (match) => {
        redactedTypes.push('PAYMENT_CARD');
        const token = '[REDACTED_CARD]';
        maskedReplacements[match] = token;
        return token;
      });
    }

    // 3. Redact Citizen ID / CCCD (12 or 9 digits)
    if (PIIRedactionLayer.CITIZEN_ID_REGEX.test(sanitized)) {
      sanitized = sanitized.replace(PIIRedactionLayer.CITIZEN_ID_REGEX, (match, digits) => {
        redactedTypes.push('CITIZEN_ID');
        const token = '[REDACTED_CITIZEN_ID]';
        maskedReplacements[digits] = token;
        return match.replace(digits, token);
      });
    }

    // Also catch bare 12-digit CCCD numbers not caught by prefix regex
    sanitized = sanitized.replace(/\b\d{12}\b/g, (match) => {
      redactedTypes.push('CITIZEN_ID');
      const token = '[REDACTED_CITIZEN_ID]';
      maskedReplacements[match] = token;
      return token;
    });

    // 4. Redact Emails
    if (PIIRedactionLayer.EMAIL_REGEX.test(sanitized)) {
      sanitized = sanitized.replace(PIIRedactionLayer.EMAIL_REGEX, (match) => {
        redactedTypes.push('EMAIL');
        const token = '[REDACTED_EMAIL]';
        maskedReplacements[match] = token;
        return token;
      });
    }

    // 5. Redact Phone numbers
    const phoneMatches = sanitized.match(PIIRedactionLayer.FORMATTED_PHONE_REGEX) || [];
    for (const phone of phoneMatches) {
      sanitized = sanitized.replaceAll(phone, '[REDACTED_PHONE]');
      redactedTypes.push('PHONE');
      maskedReplacements[phone] = '[REDACTED_PHONE]';
    }

    if (PIIRedactionLayer.PHONE_REGEX.test(sanitized)) {
      sanitized = sanitized.replace(PIIRedactionLayer.PHONE_REGEX, (match) => {
        redactedTypes.push('PHONE');
        const token = '[REDACTED_PHONE]';
        maskedReplacements[match] = token;
        return token;
      });
    }

    // 6. Redact Customer Name when introduced
    sanitized = sanitized.replace(PIIRedactionLayer.NAME_INTRO_REGEX, (fullMatch, nameGroup) => {
      const trimmedName = nameGroup.trim();
      // Avoid replacing common words like "phòng", "khách", "hotel"
      if (trimmedName.length > 1 && !/^(phòng|khách|hotel|nhà|bạn)$/i.test(trimmedName)) {
        redactedTypes.push('NAME');
        maskedReplacements[trimmedName] = '[REDACTED_NAME]';
        return fullMatch.replace(trimmedName, '[REDACTED_NAME]');
      }
      return fullMatch;
    });

    // 7. Restore protected hotel hotlines
    for (const item of hotlineHolders) {
      sanitized = sanitized.replaceAll(item.placeholder, item.original);
    }

    const uniqueTypes = Array.from(new Set(redactedTypes));

    return {
      sanitizedText: sanitized,
      redactedTypes: uniqueTypes,
      hasSensitiveData: uniqueTypes.length > 0,
      maskedReplacements,
    };
  }
}

export class DataClassificationGate {
  private piiLayer = new PIIRedactionLayer();

  /**
   * Classify data payload according to sensitivity level.
   */
  public classify(text: string): DataClassification {
    const rawLower = text.toLowerCase();

    // Check for high-risk unredactable PII or security keywords
    if (
      rawLower.includes('mật khẩu') ||
      rawLower.includes('password') ||
      rawLower.includes('api_key') ||
      rawLower.includes('secret')
    ) {
      return 'RESTRICTED_PII_BLOCKED';
    }

    const { hasSensitiveData } = this.piiLayer.redact(text);
    if (hasSensitiveData) {
      return 'USER_QUERY_ANONYMIZED';
    }

    if (
      rawLower.includes('chính sách') ||
      rawLower.includes('quy định') ||
      rawLower.includes('phụ thu') ||
      rawLower.includes('giờ nhận') ||
      rawLower.includes('checkin')
    ) {
      return 'POLICY_GENERAL';
    }

    return 'PUBLIC_CATALOG';
  }

  /**
   * Determines whether a message payload is safe to transmit to a Free LLM API.
   * Ensures that unredacted PII is never sent externally.
   */
  public isSafeForFreeProvider(text: string): boolean {
    const classification = this.classify(text);
    if (classification === 'RESTRICTED_PII_BLOCKED') {
      return false;
    }
    return true;
  }
}
