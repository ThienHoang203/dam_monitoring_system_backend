import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
  AfterLoad,
} from 'typeorm';
import { Gateway } from '../../gateway/entities/gateway.entity';
import { Sensor } from './sensor.entity';
import { Camera } from '../../camera/entities/camera.entity';

@Entity('nodes')
export class Node {
  // Khóa chính kỹ thuật — chỉ dùng nội bộ cho JOIN/khóa ngoại, không lộ ra API/MQTT.
  @PrimaryGeneratedColumn()
  id: number;

  // Mã node: NOD-[GW_SEQ]-ESP[SEQ] (vd NOD-GW01-ESP01) — CHỦ Ý lệch khỏi bảng A.3.2 gốc
  // (vốn dùng STATION_CODE). Node gắn theo GATEWAY (GW_SEQ = khoá chính gateway.id, bất biến),
  // không nhắc gì đến trạm/đập, để mã không "nói dối" khi gateway cha đổi trạm — xem
  // NodeService.nextNodeId().
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  nodeId: string;

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

  // Vibration threshold for this node (used by Jetson config sync) — maps to alert_high
  @Column({ type: 'float', default: 15.0 })
  vibrationThreshold: number;

  // Full vibration threshold config synced to Jetson TX2 via GET/config & MQTT config/gateway/:id/update
  @Column({ type: 'float', default: 2.5 })
  warnHigh: number;

  @Column({ type: 'float', default: 25.0 })
  criticalHigh: number;

  @Column({ type: 'int', default: 4 })
  alertMinCount: number;

  @Column({ type: 'float', default: 6.0 })
  alertMinDurationSec: number;

  @Column({ type: 'float', default: 3.0 })
  episodeResetGapSec: number;

  // Khóa ngoại trỏ vào Gateway.id (khóa chính kỹ thuật).
  @Column({ type: 'int' })
  gatewayRefId: number;

  @ManyToOne(() => Gateway, (gw) => gw.nodes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gatewayRefId' })
  gateway: Gateway;

  // Node → Camera mapping (which camera to trigger when this node detects anomaly)
  @Column({ type: 'int', nullable: true })
  mappedCameraRefId: number | null;

  @ManyToOne(() => Camera, { nullable: true, onDelete: 'SET NULL', eager: true })
  @JoinColumn({ name: 'mappedCameraRefId' })
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

  /** Trường ảo — mã gateway cha; chỉ có giá trị khi quan hệ `gateway` được load. */
  gatewayId?: string;

  /** Trường ảo — mã camera được gán; `mappedCamera` khai báo eager nên luôn có giá trị. */
  mappedCameraId?: string | null;

  @AfterLoad()
  hydrateParentCodes() {
    this.gatewayId = this.gateway?.gatewayId;
    this.mappedCameraId = this.mappedCamera?.cameraId ?? null;
  }
}
