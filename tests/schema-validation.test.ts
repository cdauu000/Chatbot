import { describe, it, expect } from 'vitest';
import { RawDatasetSchema, RawRoomSchema } from '../src/domain/raw-schema.js';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import {
  ConfirmedTrueFieldSchema,
  ConfirmedFalseFieldSchema,
  UnknownFieldSchema,
  createConfirmedTrue,
  createConfirmedFalse,
  createUnknown,
} from '../src/domain/evidence.js';
import { z } from 'zod';

describe('Zod Runtime Schema Validation', () => {
  const raw = loadRawDataset();

  it('xác thực thành công RawDatasetSchema trên dataset canonical thật', () => {
    const result = RawDatasetSchema.safeParse(raw);
    expect(result.success).toBe(true);
  });

  it('bắt lỗi khi cấu trúc phòng bị thiếu trường bắt buộc', () => {
    const invalidRoom = {
      co_so_ma: 'jacayl-ha-dong',
      // ma_phong bị thiếu!
      ten_phong: 'Test Room',
    };
    const result = RawRoomSchema.safeParse(invalidRoom);
    expect(result.success).toBe(false);
  });

  it('xác thực schema ConfirmedTrueFieldSchema cho trường có bằng chứng', () => {
    const schema = ConfirmedTrueFieldSchema(z.number());
    const field = createConfirmedTrue(2, 'WEBSITE_EXPLICIT', 'Tầng 2 trên website');
    const result = schema.safeParse(field);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('CONFIRMED_TRUE');
      expect(result.data.value).toBe(2);
    }
  });

  it('xác thực schema ConfirmedFalseFieldSchema cho trường xác nhận không tồn tại', () => {
    const field = createConfirmedFalse('Không có bồn tắm', 'PHYSICAL_AUDIT');
    const result = ConfirmedFalseFieldSchema.safeParse(field);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('CONFIRMED_FALSE');
      expect(result.data.reason).toBe('Không có bồn tắm');
    }
  });

  it('xác thực schema UnknownFieldSchema cho trường thiếu dữ liệu', () => {
    const field = createUnknown('Chưa ghi nhận số tầng trên website', 'DISCLAIM_UNKNOWN_TO_USER');
    const result = UnknownFieldSchema.safeParse(field);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('UNKNOWN');
      expect(result.data.fallback_action).toBe('DISCLAIM_UNKNOWN_TO_USER');
    }
  });
});
