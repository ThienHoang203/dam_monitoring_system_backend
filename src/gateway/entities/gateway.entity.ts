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
import { Station } from '../../dam/entities/station.entity';
import { Camera } from '../../camera/entities/camera.entity';
import { Node } from '../../node/entities/node.entity';

@Entity('gateways')
export class Gateway {
  // Khóa chính kỹ thuật — chỉ dùng nội bộ cho JOIN/khóa ngoại, không lộ ra API/MQTT.
  @PrimaryGeneratedColumn()
  id: number;

  // Mã gateway theo quy tắc A.3.2: GTW-[STATION_CODE]-[SEQ_ID] (vd GTW-ST01-TX2A).
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  gatewayId: string;

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

  // Khóa ngoại trỏ vào Station.id (khóa chính kỹ thuật).
  @Column({ type: 'int' })
  stationRefId: number;

  @ManyToOne(() => Station, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'stationRefId' })
  station: Station;

  @OneToMany(() => Camera, (camera) => camera.gateway, { cascade: true })
  cameras: Camera[];

  @OneToMany(() => Node, (node) => node.gateway, { cascade: true })
  nodes: Node[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /** Trường ảo — mã trạm cha; chỉ có giá trị khi quan hệ `station` được load. */
  stationId?: string;

  @AfterLoad()
  hydrateParentCodes() {
    this.stationId = this.station?.stationId;
  }
}
