import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { SensorCluster } from './sensor-cluster.entity';

@Entity('sensor_devices')
export class SensorDevice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 32 })
  sensorType: string; // 'water_level' | 'humidity' | 'vibration'

  @Column({ type: 'varchar', length: 200, nullable: true })
  model: string; // Model cảm biến VD: 'HC-SR04', 'DHT22', 'SW-420'

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: string; // 'active' | 'inactive' | 'faulty'

  @Column({ type: 'varchar', length: 16, nullable: true })
  unit: string; // Đơn vị đo: 'cm', '%', 'mm/s'

  @Column({ type: 'float', nullable: true })
  calibrationOffset: number; // Giá trị hiệu chỉnh

  @Column({ type: 'varchar', length: 64 })
  clusterId: string;

  @ManyToOne(() => SensorCluster, (cluster) => cluster.devices, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'clusterId' })
  cluster: SensorCluster;

  @CreateDateColumn()
  createdAt: Date;
}
