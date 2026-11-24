import { DatasetAuditor } from './dataset-auditor.js';

function run() {
  const audit = DatasetAuditor.runAudit();
  console.log('='.repeat(70));
  console.log('J COLLECTION AI CONCIERGE — AUTOMATED DATASET AUDIT REPORT');
  console.log('Timestamp:', audit.timestamp);
  console.log('='.repeat(70));

  console.log('\n1. FACILITIES SUMMARY:');
  console.log(`- Total facilities: ${audit.facilities.total}`);
  audit.facilities.details.forEach((f) => {
    console.log(
      `  * [${f.ma}] ${f.ten} | Địa chỉ: ${f.dia_chi} | Hotline: ${f.dien_thoai ?? 'N/A'}`
    );
    console.log(
      `    Phòng: ${f.rooms_count} | Ảnh phòng: ${f.photos_count} | Tầng xác nhận: ${f.confirmed_floor_count}`
    );
    console.log(`    Hạng phòng:`, JSON.stringify(f.categories));
  });

  console.log('\n2. ROOMS & INVARIANTS:');
  console.log(`- Total rooms: ${audit.rooms.total} (Chain invariant: 66)`);
  console.log(`- Total room photos: ${audit.rooms.total_photos} (Chain invariant: 228)`);
  console.log(
    `- Confirmed floors: ${audit.rooms.confirmed_floors.total} (44 unconfirmed/unknown)`
  );
  console.log(`- Bathtub rooms: ${audit.rooms.bathtub_rooms.length} (Chain invariant: 5)`);
  audit.rooms.bathtub_rooms.forEach((r) => {
    console.log(
      `    * ${r.id} (${r.hang}) - Giá 2h: ${r.gia_2h.toLocaleString('vi-VN')}đ, Giờ thêm: ${r.extra_hour_rate.toLocaleString('vi-VN')}đ/h`
    );
  });
  console.log(`- Love chair rooms: ${audit.rooms.love_chair_rooms.length} (Chain invariant: 4)`);
  audit.rooms.love_chair_rooms.forEach((r) => {
    console.log(`    * ${r.id}`);
  });
  console.log(`- Special extra hour surcharge rooms: ${audit.rooms.special_extra_hour_rooms.length}`);
  audit.rooms.special_extra_hour_rooms.forEach((r) => {
    console.log(`    * ${r.id}: ${r.rate.toLocaleString('vi-VN')}đ/h (${r.source})`);
  });

  console.log('\n3. GENERAL POLICIES IN DATASET:');
  console.log(`- Qua đêm: "${audit.policies.overnight_hours}"`);
  console.log(`- Ngày đêm: "${audit.policies.fullday_hours}"`);
  console.log(`- Phụ thu giờ: "${audit.policies.overtime_rule}"`);
  console.log(`- Đỗ xe: "${audit.policies.parking_general_rule}"`);
  console.log('='.repeat(70));
}

run();
