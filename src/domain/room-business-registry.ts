/**
 * J Collection AI Concierge - Room Business Registry
 * Owner-Confirmed Operational & Commercial Status Registry.
 *
 * Ground Truth Invariants:
 * 1. j_collection_dataset.json is never modified.
 * 2. Room 401 Ha Dong exists physically, but is registered as NOT_FOR_SALE.
 * 3. NOT_FOR_SALE is strictly distinct from INVALID_ROOM, SOLD_OUT, or OCCUPIED.
 */

import { RoomCommercialStatus } from './types.js';

export interface RoomOperationalRecord {
  key: string; // e.g. "jacayl-ha-dong::401"
  facility_id: string; // "jacayl-ha-dong"
  room_code: string; // "401"
  status: RoomCommercialStatus;
  reason: string;
  display_explanation: string;
}

export const ROOM_BUSINESS_REGISTRY: Record<string, RoomOperationalRecord> = {
  'jacayl-ha-dong::401': {
    key: 'jacayl-ha-dong::401',
    facility_id: 'jacayl-ha-dong',
    room_code: '401',
    status: 'NOT_FOR_SALE',
    reason: 'Chủ dự án xác nhận phòng 401 Hà Đông tồn tại thực tế nhưng không sử dụng để kinh doanh.',
    display_explanation:
      'Dạ phòng 401 tại cơ sở Jacayl Hà Đông tồn tại thực tế nhưng hiện không sử dụng để kinh doanh (không nằm trong danh mục phòng bán của khách sạn) ạ. Tại Hà Đông, anh/chị có thể tham khảo các phòng khác như 402 — Whisky, 403 — Led Neon, 404 — Lolipop, 405 — 1st Time hoặc các căn phòng tuyệt đẹp khác trong danh mục của cơ sở nhé ạ!',
  },
};

export function getRoomCommercialStatus(facilityId: string, roomCode: string): RoomCommercialStatus {
  const cleanCode = roomCode.replace(/^([a-z0-9_-]+::)?/, '').split('-')[0];
  const exactKey = `${facilityId}::${cleanCode}`;
  const record = ROOM_BUSINESS_REGISTRY[exactKey] ?? ROOM_BUSINESS_REGISTRY[`${facilityId}::${roomCode}`];
  return record ? record.status : 'COMMERCIAL';
}

export function isRoomNotForSale(facilityId: string, roomCode: string): boolean {
  return getRoomCommercialStatus(facilityId, roomCode) === 'NOT_FOR_SALE';
}

export function getRoomOperationalRecord(facilityId: string, roomCode: string): RoomOperationalRecord | null {
  const cleanCode = roomCode.replace(/^([a-z0-9_-]+::)?/, '').split('-')[0];
  const exactKey = `${facilityId}::${cleanCode}`;
  return ROOM_BUSINESS_REGISTRY[exactKey] ?? ROOM_BUSINESS_REGISTRY[`${facilityId}::${roomCode}`] ?? null;
}
