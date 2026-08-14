import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Gateway } from '../../gateway/entities/gateway.entity';
import { Sensor } from './sensor.entity';
import { Camera } from '../../camera/entities/camera.entity';

@Entity('nodes')
export class Node {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id: string; // NOD-ST01-ESP01

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  macAddress: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  firmwareVersion: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  description: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  installLocation: string;

  @Column({ type: 'varchar', length: 16, default: 'offline' })
  status: string; // 'online' | 'offline' | 'error'

  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt: Date;

  // Vibration threshold for this node (used by Jetson config sync)
  @Column({ type: 'float', default: 15.0 })
  vibrationThreshold: number;

  @Column({ type: 'varchar', length: 64 })
  gatewayId: string;

  @ManyToOne(() => Gateway, (gw) => gw.nodes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gatewayId' })
  gateway: Gateway;

  // Node → Camera mapping (which camera to trigger when this node detects anomaly)
  @Column({ type: 'varchar', length: 64, nullable: true })
  mappedCameraId: string | null;

  @ManyToOne(() => Camera, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'mappedCameraId' })
  mappedCamera: Camera;

  @OneToMany(() => Sensor, (sensor) => sensor.node, {
    cascade: true,
    eager: true,
  })
  sensors: Sensor[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
