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
import { Camera } from '../../camera/entities/camera.entity';
import { Node } from '../../node/entities/node.entity';

@Entity('gateways')
export class Gateway {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id: string; // GTW-ST01-TX2A

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  macAddress: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  firmwareVersion: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  description: string;

  @Column({ type: 'varchar', length: 16, default: 'offline' })
  status: string; // 'online' | 'offline' | 'error'

  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt: Date;

  @Column({ type: 'integer' })
  stationId: number;

  @ManyToOne(() => Station, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'stationId' })
  station: Station;

  @OneToMany(() => Camera, (camera) => camera.gateway, { cascade: true })
  cameras: Camera[];

  @OneToMany(() => Node, (node) => node.gateway, { cascade: true })
  nodes: Node[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
