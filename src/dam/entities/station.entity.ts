import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { Dam } from './dam.entity';
import { Gateway } from '../../gateway/entities/gateway.entity';

@Entity('stations')
export class Station {
  @PrimaryGeneratedColumn()
  id: number;

  // Station code used in child device IDs (e.g. 'ST01' → GTW-ST01-TX2A, NOD-ST01-ESP01)
  @Column({ type: 'varchar', length: 16, nullable: true })
  stationCode: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  location: string;

  @Column({ type: 'double precision', nullable: true })
  latitude: number;

  @Column({ type: 'double precision', nullable: true })
  longitude: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  river: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  km: string;

  @Column({ type: 'varchar', length: 16, default: 'safe' })
  status: string;

  @Column({ type: 'float', default: 0 })
  waterLevel: number;

  @Column({ type: 'float', default: 0 })
  change: number;

  @Column({ type: 'float', default: 0 })
  pressure: number;

  @Column({ type: 'float', default: 0 })
  flow: number;

  @Column({ type: 'float', default: 0 })
  humidity: number;

  @Column({ type: 'float', default: 0 })
  bd1: number;

  @Column({ type: 'float', default: 0 })
  bd2: number;

  @Column({ type: 'float', default: 0 })
  bd3: number;

  @Column({ type: 'varchar', length: 64 })
  damId: string;

  @ManyToOne(() => Dam, dam => dam.stations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'damId' })
  dam: Dam;

  @OneToMany(() => Gateway, gateway => gateway.station, { cascade: true })
  gateways: Gateway[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
