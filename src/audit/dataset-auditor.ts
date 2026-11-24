import { RawDataset } from '../domain/raw-schema.js';
import { NormalizedDataset } from '../domain/normalized-schema.js';
import { transformRawDatasetToDomain } from '../domain/transformer.js';
import { loadRawDataset } from '../data-loader/raw-loader.js';

export interface AuditReport {
  timestamp: string;
  facilities: {
    total: number;
    details: Array<{
      ma: string;
      ten: string;
      dia_chi: string;
      dien_thoai: string | null;
      rooms_count: number;
      photos_count: number;
      confirmed_floor_count: number;
      categories: Record<string, number>;
    }>;
  };
  rooms: {
    total: number;
    by_facility: Record<string, number>;
    total_photos: number;
    photos_by_facility: Record<string, number>;
    confirmed_floors: {
      total: number;
      by_facility: Record<string, number>;
      unconfirmed_count: number;
    };
    bathtub_rooms: Array<{
      id: string;
      co_so_ma: string;
      ma_phong: string;
      ten_phong: string;
      hang: string;
      gia_2h: number;
      extra_hour_rate: number;
    }>;
    love_chair_rooms: Array<{
      id: string;
      co_so_ma: string;
      ma_phong: string;
      ten_phong: string;
    }>;
    special_extra_hour_rooms: Array<{
      id: string;
      rate: number;
      source: string;
    }>;
  };
  policies: {
    overnight_hours: string;
    fullday_hours: string;
    overtime_rule: string;
    parking_general_rule: string;
  };
}

export class DatasetAuditor {
  public static runAudit(rawDataset?: RawDataset): AuditReport {
    const raw = rawDataset ?? loadRawDataset();
    const normalized = transformRawDatasetToDomain(raw);

    const facilityDetails = normalized.co_so.map((cs) => {
      const facilityRooms = normalized.phong.filter((p) => p.co_so_ma === cs.ma);
      const photosCount = facilityRooms.reduce((acc, p) => acc + p.anh.length, 0);
      const confirmedFloorCount = facilityRooms.filter((p) => p.tang.status === 'CONFIRMED_TRUE').length;

      const categories: Record<string, number> = {};
      facilityRooms.forEach((p) => {
        categories[p.hang] = (categories[p.hang] || 0) + 1;
      });

      return {
        ma: cs.ma,
        ten: cs.ten,
        dia_chi: cs.dia_chi,
        dien_thoai: cs.dien_thoai,
        rooms_count: facilityRooms.length,
        photos_count: photosCount,
        confirmed_floor_count: confirmedFloorCount,
        categories,
      };
    });

    const photosByFacility: Record<string, number> = {};
    const roomsByFacility: Record<string, number> = {};
    const confirmedFloorsByFacility: Record<string, number> = {};

    facilityDetails.forEach((f) => {
      photosByFacility[f.ma] = f.photos_count;
      roomsByFacility[f.ma] = f.rooms_count;
      confirmedFloorsByFacility[f.ma] = f.confirmed_floor_count;
    });

    const bathtubRooms = normalized.phong
      .filter((p) => p.tien_nghi.bon_tam.status === 'CONFIRMED_TRUE')
      .map((p) => ({
        id: p.id,
        co_so_ma: p.co_so_ma,
        ma_phong: p.ma_phong,
        ten_phong: p.ten_phong,
        hang: p.hang,
        gia_2h: p.gia_goc_dataset.nghi_gio_2h,
        extra_hour_rate: p.gia_goc_dataset.gio_phat_sinh_ap_dung,
      }));

    const loveChairRooms = normalized.phong
      .filter((p) => p.tien_nghi.ghe_tinh_yeu.status === 'CONFIRMED_TRUE')
      .map((p) => ({
        id: p.id,
        co_so_ma: p.co_so_ma,
        ma_phong: p.ma_phong,
        ten_phong: p.ten_phong,
      }));

    const specialExtraHourRooms = normalized.phong
      .filter((p) => p.gia_goc_dataset.gio_phat_sinh_ap_dung !== 100000)
      .map((p) => ({
        id: p.id,
        rate: p.gia_goc_dataset.gio_phat_sinh_ap_dung,
        source: p.gia_goc_dataset.nguon_gio_phat_sinh,
      }));

    const confirmedFloorsTotal = Object.values(confirmedFloorsByFacility).reduce((a, b) => a + b, 0);

    return {
      timestamp: new Date().toISOString(),
      facilities: {
        total: normalized.co_so.length,
        details: facilityDetails,
      },
      rooms: {
        total: normalized.phong.length,
        by_facility: roomsByFacility,
        total_photos: Object.values(photosByFacility).reduce((a, b) => a + b, 0),
        photos_by_facility: photosByFacility,
        confirmed_floors: {
          total: confirmedFloorsTotal,
          by_facility: confirmedFloorsByFacility,
          unconfirmed_count: normalized.phong.length - confirmedFloorsTotal,
        },
        bathtub_rooms: bathtubRooms,
        love_chair_rooms: loveChairRooms,
        special_extra_hour_rooms: specialExtraHourRooms,
      },
      policies: {
        overnight_hours: raw.quy_dinh.gio_luu_tru.qua_dem,
        fullday_hours: raw.quy_dinh.gio_luu_tru.ngay_dem,
        overtime_rule: raw.quy_dinh.phu_thu_gio,
        parking_general_rule: raw.quy_dinh.do_xe,
      },
    };
  }
}
