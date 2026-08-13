import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('system_logs')
export class SystemLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 50 })
  action: string; // e.g. LOGIN, REGISTER, UPDATE_DAM, UPDATE_STATION, UPDATE_THRESHOLD

  @Column({ length: 50 })
  category: string; // AUTH, DAM, STATION, THRESHOLD

  @Column({ type: 'text' })
  description: string;

  @Column({ length: 100, nullable: true })
  username: string;

  @Column({ length: 50, nullable: true })
  userRole: string;

  @Column({ length: 50, nullable: true })
  ipAddress: string;

  @Column({ type: 'json', nullable: true })
  metadata: any;

  @CreateDateColumn()
  timestamp: Date;
}
