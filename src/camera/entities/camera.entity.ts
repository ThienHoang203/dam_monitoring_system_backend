import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  AfterLoad,
} from 'typeorm';
import { Gateway } from '../../gateway/entities/gateway.entity';

@Entity('cameras')
export class Camera {
  // Khóa chính kỹ thuật — chỉ dùng nội bộ cho JOIN/khóa ngoại, không lộ ra API/MQTT.
  @PrimaryGeneratedColumn()
  id: number;

  // Mã camera theo quy tắc A.3.2: CAM-[CAM_TYPE]-[STATION_CODE]-[SEQ_ID] (vd CAM-CSI-ST01-01).
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  cameraId: string;

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

  // Khóa ngoại trỏ vào Gateway.id (khóa chính kỹ thuật).
  @Column({ type: 'int' })
  gatewayRefId: number;

  @ManyToOne(() => Gateway, (gw) => gw.cameras, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gatewayRefId' })
  gateway: Gateway;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /** Trường ảo — mã gateway cha; chỉ có giá trị khi quan hệ `gateway` được load. */
  gatewayId?: string;

  @AfterLoad()
  hydrateParentCodes() {
    this.gatewayId = this.gateway?.gatewayId;
  }
}
