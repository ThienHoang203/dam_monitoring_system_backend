import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

// Lịch sử thay đổi trạng thái an toàn tổng hợp của Station/Dam — ghi lại mỗi khi
// SensorService.recomputeStationStatus/recomputeDamStatus tính ra một mức severity mới.
@Entity('station_status_history')
export class StationStatusHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 16 })
  level: string; // 'station' | 'dam'

  // Mã trạm (STA-001-01) — phi chuẩn hóa, KHÔNG đặt khóa ngoại (bản ghi lịch sử).
  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true })
  stationId: string | null;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  damId: string;

  @Column({ type: 'varchar', length: 16 })
  previousStatus: string;

  @Column({ type: 'varchar', length: 16 })
  newStatus: string;

  @Column({ type: 'integer' })
  severity: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason: string;

  @CreateDateColumn({ type: 'timestamptz' })
  changedAt: Date;
}
