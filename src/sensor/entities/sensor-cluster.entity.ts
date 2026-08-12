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
import { Station } from '../../dam/entities/station.entity';
import { SensorDevice } from './sensor-device.entity';

@Entity('sensor_clusters')
export class SensorCluster {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  description: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  espMacAddress: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  firmwareVersion: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  installLocation: string;

  @Column({ type: 'varchar', length: 16, default: 'offline' })
  status: string; // 'online' | 'offline' | 'error'

  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt: Date;

  @Column({ type: 'integer' })
  stationId: number;

  @ManyToOne(() => Station, (station) => station.sensorClusters, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'stationId' })
  station: Station;

  @OneToMany(() => SensorDevice, (device) => device.cluster, {
    cascade: true,
    eager: true,
  })
  devices: SensorDevice[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
