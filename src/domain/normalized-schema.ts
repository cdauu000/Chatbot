import { z } from 'zod';
import { CoSoMa, RawRoomCategory } from './types.js';
import { EvidenceField } from './evidence.js';

/**
 * J Collection AI Concierge - Normalized Domain Schema
 * Type-safe, validated schema with evidence tracking and zero data loss.
 */

export interface NormalizedRoomPrice {
  nghi_gio_2h: number;
  qua_dem: number;
  ngay_dem: number;
  gio_phat_sinh_ap_dung: number;
  nguon_gio_phat_sinh: string;
}

export interface NormalizedRoomImage {
  nhan: string;
  url: string;
  alt: string | null;
  index: number;
}

export interface NormalizedRoomAmenities {
  bon_tam: EvidenceField<boolean>;
  ghe_tinh_yeu: EvidenceField<boolean>;
  thang_may: EvidenceField<boolean>;
  bep_nau: EvidenceField<boolean>;
  thu_cung_cho_phep: EvidenceField<boolean>;
  cho_phep_hut_thuoc: EvidenceField<boolean>;
}

export interface NormalizedRoom {
  id: string; // Composite key: "<co_so_ma>::<ma_phong>"
  co_so_ma: CoSoMa;
  co_so_ten: string;
  ma_phong: string;
  ten_phong: string;
  hang: RawRoomCategory;
  link_phong: string | null;
  meta_description: string | null;
  cau_gioi_thieu_ngan: string | null;
  dong_vi_tri_nguyen_van: string | null;
  tieu_de_nguyen_van: string | null;
  gia_goc_dataset: NormalizedRoomPrice;
  gia_hien_thi_nguyen_van: string | null;
  tang: EvidenceField<number>;
  tien_nghi: NormalizedRoomAmenities;
  anh: NormalizedRoomImage[];
  noi_dung_nguyen_van: string[];
  nhom_nhu_cau: string[];
  ghi_chu_trich_xuat: string[];
}

export interface NormalizedFacilityPolicies {
  thu_cung: EvidenceField<boolean>;
  hut_thuoc: EvidenceField<boolean>;
  bep_nau: EvidenceField<boolean>;
  do_xe_chi_tiet_phi: EvidenceField<string>;
}

export interface NormalizedFacility {
  ma: CoSoMa;
  ten: string;
  dia_chi: string;
  gioi_thieu: string | null;
  so_hang_so_phong: string | null;
  dien_thoai: string | null;
  website: string | null;
  zalo: string | null;
  link: string | null;
  anh_dai_dien: string | null;
  gia_tu_theo_hang: Record<string, number>;
  do_xe: EvidenceField<string>;
  gio_luu_tru: {
    nghi_gio: string;
    qua_dem: string; // Exactly "Từ 22h đến 12h hôm sau"
    ngay_dem: string; // Exactly "Từ 14h đến 12h hôm sau"
  };
  phu_thu_gio_quy_dinh: string; // Exactly "Quá giờ sau 10 phút thì tính thêm 1 giờ."
  chinh_sach_chua_xac_nhan: NormalizedFacilityPolicies;
}

export interface NormalizedDataset {
  co_so: NormalizedFacility[];
  phong: NormalizedRoom[];
  ghi_chu_website: string[];
  quy_dinh_goc: {
    nguon: string;
    phu_thu_gio: string;
    gio_phat_sinh_mac_dinh: {
      gia_tri: number;
      ghi_chu: string;
    };
    do_xe: string;
    giay_to: string;
    huy_phong: string;
    quy_dinh_khac: string;
  };
}
