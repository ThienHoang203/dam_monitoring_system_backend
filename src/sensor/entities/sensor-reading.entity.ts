import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('sensor_readings')
export class SensorReading {
  @PrimaryColumn({ type: 'timestamptz' })
  time: Date;

  @PrimaryColumn({ type: 'varchar', length: 64 })
  sensorId: string;

  @PrimaryColumn({ type: 'varchar', length: 32 })
  sensorType: string; // 'vibration_freq' | 'vibration_amp' | 'water_level' | 'moisture'

  @Column({ type: 'double precision' })
  value: number;

  @Column({ type: 'varchar', length: 16, nullable: true })
  unit: string;

  @Column({ type: 'varchar', length: 64 })
  damId: string;
}
