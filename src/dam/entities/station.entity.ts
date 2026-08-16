import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
  AfterLoad,
} from 'typeorm';
import { Dam } from './dam.entity';
import { Gateway } from '../../gateway/entities/gateway.entity';

@Entity('stations')
export class Station {
  // Khóa chính kỹ thuật — chỉ dùng nội bộ cho JOIN/khóa ngoại, không lộ ra API/MQTT.
  @PrimaryGeneratedColumn()
  id: number;

  // Mã trạm theo quy tắc đặt tên A.3.2: STA-[DAM_CODE]-[XX] (vd STA-001-01). Định danh công khai.
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  stationId: string;

  // Station code dùng trong mã Gateway và Camera (vd 'ST01' → GTW-ST01-TX2A, CAM-CSI-ST01-01).
  // Node KHÔNG dùng trường này — mã Node gắn theo Gateway, xem NodeService.nextNodeId().
  @Column({ type: 'varchar', length: 16, nullable: true })
  stationCode: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  location: string;

  @Column({ type: 'double precision', nullable: true })
  latitude: number;

  @Column({ type: 'double precision', nullable: true })
  longitude: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  river: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  km: string;

  @Column({ type: 'varchar', length: 16, default: 'unknown' })
  status: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  statusReason: string;

  @Column({ type: 'float', default: 0 })
  waterLevel: number;

  @Column({ type: 'float', default: 0 })
  change: number;

  @Column({ type: 'float', default: 0 })
  pressure: number;

  @Column({ type: 'float', default: 0 })
  flow: number;

  @Column({ type: 'float', default: 0 })
  humidity: number;

  // Biên độ rung mới nhất (mm/s) — cập nhật từ cảm biến trong SensorService.ingest()
  @Column({ type: 'float', default: 0 })
  vibration: number;

  /**
   * @deprecated Ngưỡng báo động 1/2/3 — KHÔNG còn được đọc/ghi ở bất kỳ đâu.
   * Ngưỡng cảnh báo thật nằm ở ThresholdConfig (khóa theo damId + sensorType).
   * Giữ cột để không mất dữ liệu lịch sử; đừng dùng lại cho mục đích khác.
   */
  @Column({ type: 'float', default: 0 })
  bd1: number;

  /** @deprecated Xem ghi chú ở bd1. */
  @Column({ type: 'float', default: 0 })
  bd2: number;

  /** @deprecated Xem ghi chú ở bd1. */
  @Column({ type: 'float', default: 0 })
  bd3: number;

  // Khóa ngoại trỏ vào Dam.id (khóa chính kỹ thuật).
  @Column({ type: 'int' })
  damRefId: number;

  @ManyToOne(() => Dam, dam => dam.stations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'damRefId' })
  dam: Dam;

  @OneToMany(() => Gateway, gateway => gateway.station, { cascade: true })
  gateways: Gateway[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /**
   * Trường ảo (KHÔNG phải cột) — mã đập cha, để JSON trả về cho frontend giữ nguyên hình dạng cũ.
   * Chỉ có giá trị khi quan hệ `dam` được load; muốn lọc theo mã đập phải dùng `where: { dam: { damId } }`.
   */
  damId?: string;

  @AfterLoad()
  hydrateParentCodes() {
    this.damId = this.dam?.damId;
  }
}
