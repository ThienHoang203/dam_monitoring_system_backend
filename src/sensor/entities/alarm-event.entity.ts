import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

@Entity('alarm_events')
export class AlarmEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64, nullable: true, unique: true })
  eventId?: string;

  @Column({ type: 'varchar', length: 64 })
  damId: string;

  @Column({ type: 'varchar', length: 64 })
  sensorId: string;

  @Column({ type: 'varchar', length: 32 })
  sensorType: string;

  @Column({ type: 'varchar', length: 16 })
  severity: string; // 'WARNING' | 'ALERT' | 'CRITICAL'

  @Column({ type: 'float' })
  thresholdVal: number;

  @Column({ type: 'float' })
  measuredVal: number;

  @Column({ type: 'integer', nullable: true })
  durationS: number; // số giây vượt ngưỡng liên tiếp

  @CreateDateColumn({ type: 'timestamptz' })
  triggeredAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date;

  @Column({ type: 'boolean', default: false })
  cameraActivated: boolean;

  @Column({ type: 'text', nullable: true })
  imageUrl: string; // URL MinIO

  @Column({ type: 'integer', nullable: true })
  stationId: number;

  @Column({ type: 'varchar', length: 200, nullable: true })
  stationName: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  damName: string;

  @Column({ type: 'varchar', length: 250, nullable: true })
  location: string;

  @Column({ type: 'boolean', nullable: true })
  crackDetected: boolean;

  @Column({ type: 'float', nullable: true })
  crackConfidence: number;

  @Column({ type: 'text', nullable: true })
  notes: string;
}
