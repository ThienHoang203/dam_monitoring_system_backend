import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Gateway } from '../../gateway/entities/gateway.entity';

@Entity('cameras')
export class Camera {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id: string; // CAM-CSI-ST01-01 | CAM-IP-ST01-02

  @Column({ type: 'varchar', length: 8 })
  cameraType: string; // 'CSI' | 'IP'

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'text', nullable: true })
  streamUrl: string; // Required when cameraType = 'IP'

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: string; // 'active' | 'inactive' | 'error'

  @Column({ type: 'varchar', length: 32, nullable: true })
  resolution: string; // e.g. '1280x720'

  @Column({ type: 'varchar', length: 64 })
  gatewayId: string;

  @ManyToOne(() => Gateway, (gw) => gw.cameras, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gatewayId' })
  gateway: Gateway;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
