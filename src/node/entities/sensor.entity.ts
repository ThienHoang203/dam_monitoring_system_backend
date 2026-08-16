import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  AfterLoad,
} from 'typeorm';
import { Node } from './node.entity';

@Entity('sensors')
export class Sensor {
  // Khóa chính kỹ thuật — chỉ dùng nội bộ cho JOIN/khóa ngoại, không lộ ra API/MQTT.
  @PrimaryGeneratedColumn()
  id: number;

  // Mã cảm biến theo quy tắc A.3.2: SNR-[SENSOR_TYPE]-[NODE_SEQ]-[PORT] (vd SNR-VIB-ESP01-I2C1).
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  sensorId: string;

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

  // Khóa ngoại trỏ vào Node.id (khóa chính kỹ thuật).
  @Column({ type: 'int' })
  nodeRefId: number;

  @ManyToOne(() => Node, (node) => node.sensors, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'nodeRefId' })
  node: Node;

  @CreateDateColumn()
  createdAt: Date;

  /** Trường ảo — mã node cha; chỉ có giá trị khi quan hệ `node` được load. */
  nodeId?: string;

  @AfterLoad()
  hydrateParentCodes() {
    this.nodeId = this.node?.nodeId;
  }
}
