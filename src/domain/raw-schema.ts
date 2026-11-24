import { z } from 'zod';

/**
 * J Collection AI Concierge - Raw Dataset Schema
 * Strictly mirrors j_collection_dataset.json without data loss or early conversions.
 */

export const RawGioLuuTruSchema = z.object({
  nghi_gio: z.string(),
  qua_dem: z.string(),
  ngay_dem: z.string(),
});

export const RawGioPhatSinhMacDinhSchema = z.object({
  gia_tri: z.number(),
  ghi_chu: z.string(),
});

export const RawQuyDinhSchema = z.object({
  nguon: z.string(),
  gio_luu_tru: RawGioLuuTruSchema,
  phu_thu_gio: z.string(),
  gio_phat_sinh_mac_dinh: RawGioPhatSinhMacDinhSchema,
  do_xe: z.string(),
  giay_to: z.string(),
  huy_phong: z.string(),
  quy_dinh_khac: z.string(),
});

export const RawCoSoSchema = z.object({
  ma: z.string(),
  ten: z.string(),
  dia_chi: z.string(),
  gioi_thieu: z.string().optional(),
  so_hang_so_phong: z.string().optional(),
  dien_thoai: z.string().optional(),
  website: z.string().optional(),
  zalo: z.string().optional(),
  link: z.string().optional(),
  gia_tu_theo_hang: z.record(z.string(), z.number()).optional(),
  anh_dai_dien: z.string().optional(),
});

export const RawRoomImageSchema = z.object({
  nhan: z.string(),
  url: z.string(),
  alt: z.string().nullable().optional(),
});

export const RawRoomPriceSchema = z.object({
  nghi_gio_2h: z.number(),
  qua_dem: z.number(),
  ngay_dem: z.number(),
  gio_phat_sinh_ap_dung: z.number().optional(),
  nguon_gio_phat_sinh: z.string().optional(),
});

export const RawRoomSchema = z.object({
  co_so_ma: z.string(),
  co_so_ten: z.string(),
  link_phong: z.string().optional(),
  ma_phong: z.string(),
  meta_description: z.string().optional(),
  dong_vi_tri_nguyen_van: z.string().optional(),
  tieu_de_nguyen_van: z.string().nullable().optional(),
  cau_gioi_thieu_ngan: z.string().nullable().optional(),
  gia: RawRoomPriceSchema,
  gia_hien_thi_nguyen_van: z.string().optional(),
  noi_dung_nguyen_van: z.array(z.string()).optional(),
  anh: z.array(RawRoomImageSchema),
  ghi_chu_trich_xuat: z.array(z.string()).optional(),
  ten_phong: z.string(),
  hang: z.string(),
  tang_theo_website: z.number().nullable().optional(),
  nhom_nhu_cau_theo_website: z.array(z.string()).optional(),
  tien_nghi_nguyen_van: z.array(z.string()).nullable().optional(),
});

export const RawDatasetSchema = z.object({
  nguon: z.string(),
  ghi_chu_website: z.array(z.string()),
  quy_dinh: RawQuyDinhSchema,
  co_so: z.array(RawCoSoSchema),
  phong: z.array(RawRoomSchema),
  nhom_nhu_cau_theo_website: z.record(z.string(), z.any()).optional(),
});

export type RawDataset = z.infer<typeof RawDatasetSchema>;
export type RawCoSo = z.infer<typeof RawCoSoSchema>;
export type RawRoom = z.infer<typeof RawRoomSchema>;
export type RawRoomImage = z.infer<typeof RawRoomImageSchema>;
export type RawRoomPrice = z.infer<typeof RawRoomPriceSchema>;
export type RawQuyDinh = z.infer<typeof RawQuyDinhSchema>;
