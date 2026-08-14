import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Node } from './node.entity';

@Entity('sensors')
export class Sensor {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id: string; // SNR-VIB-ESP01-I2C1

  @Column({ type: 'varchar', length: 16 })
  sensorType: string; // VIB | TLT | WTL | MST | US

  @Column({ type: 'varchar', length: 200, nullable: true })
  model: string; // e.g. 'MPU6050', 'HC-SR04', 'Capacitive v1.2'

  @Column({ type: 'varchar', length: 16, nullable: true })
  unit: string; // mm/s, cm, %

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: string; // 'active' | 'inactive' | 'faulty'

  @Column({ type: 'float', nullable: true })
  calibrationOffset: number;

  @Column({ type: 'varchar', length: 64 })
  nodeId: string;

  @ManyToOne(() => Node, (node) => node.sensors, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'nodeId' })
  node: Node;

  @CreateDateColumn()
  createdAt: Date;
}
