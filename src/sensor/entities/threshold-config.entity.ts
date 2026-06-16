import { Entity, Column, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('threshold_configs')
export class ThresholdConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64 })
  damId: string;

  @Column({ type: 'varchar', length: 32 })
  sensorType: string; // 'vibration' | 'water_level' | 'humidity'

  @Column({ type: 'float' })
  warnLow: number;

  @Column({ type: 'float' })
  warnHigh: number;

  @Column({ type: 'float' })
  alertLow: number;

  @Column({ type: 'float' })
  alertHigh: number;

  @Column({ type: 'float' })
  criticalHigh: number;

  @Column({ type: 'integer', nullable: true })
  sustainedSeconds: number; // dùng cho rung động

  @Column({ type: 'boolean', default: true })
  cameraEnabled: boolean;

  @Column({ type: 'float', default: 50.0 })
  tankHeight: number; // Chiều cao tối đa để tính % mực nước

  @UpdateDateColumn()
  updatedAt: Date;
}
