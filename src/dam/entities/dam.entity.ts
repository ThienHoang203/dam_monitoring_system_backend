import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, OneToMany, Index } from 'typeorm';
import { Station } from './station.entity';

@Entity('dams')
export class Dam {
  // Khóa chính kỹ thuật — chỉ dùng nội bộ cho JOIN/khóa ngoại, không lộ ra API/MQTT.
  @PrimaryGeneratedColumn()
  id: number;

  // Mã đập theo quy tắc đặt tên A.3.2: DAM-[XXX] (vd DAM-001). Đây là định danh công khai.
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  damId: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  location: string;

  @Column({ type: 'double precision', nullable: true })
  latitude: number;

  @Column({ type: 'double precision', nullable: true })
  longitude: number;

  @Column({ type: 'float', default: 0 })
  waterLevel: number;

  @Column({ type: 'float', default: 0 })
  flow: number;

  @Column({ type: 'float', default: 0 })
  fillPct: number;

  @Column({ type: 'varchar', length: 16, default: 'unknown' })
  status: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  statusReason: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  cameraUrl: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Station, station => station.dam, { cascade: true })
  stations: Station[];
}
