import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, MoreThan } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Evidence } from './entities/evidence.entity';
import { AlarmEvent } from '../sensor/entities/alarm-event.entity';
import { Gateway } from '../gateway/entities/gateway.entity';
import { Node } from '../node/entities/node.entity';
import * as Minio from 'minio';

const DEFAULT_DAM_ID = 'DAM-001';
const DEFAULT_NODE_ID = 'NOD-GW01-ESP01';

@Injectable()
export class EvidenceService implements OnModuleInit {
  private minioClient!: Minio.Client;

  constructor(
    @InjectRepository(Evidence)
    private readonly evidenceRepo: Repository<Evidence>,
    @InjectRepository(AlarmEvent)
    private readonly alarmEventRepo: Repository<AlarmEvent>,
    @InjectRepository(Gateway)
    private readonly gatewayRepo: Repository<Gateway>,
    @InjectRepository(Node)
    private readonly nodeRepo: Repository<Node>,
    private readonly configService: ConfigService,
  ) { }

  onModuleInit() {
    const rawEndpoint = this.configService.get<string>(
      'MINIO_ENDPOINT',
      'http://127.0.0.1:9000',
    );
    const user = this.configService.get<string>(
      'MINIO_ROOT_USER',
      'minioadmin',
    );
    const pass = this.configService.get<string>(
      'MINIO_ROOT_PASSWORD',
      'minioadmin',
    );

    try {
      const urlObj = new URL(rawEndpoint);
      const port = urlObj.port
        ? parseInt(urlObj.port, 10)
        : urlObj.protocol === 'https:'
          ? 443
          : 80;
      this.minioClient = new Minio.Client({
        endPoint: urlObj.hostname || '127.0.0.1',
        port,
        useSSL: urlObj.protocol === 'https:',
        accessKey: user,
        secretKey: pass,
      });
    } catch {
      this.minioClient = new Minio.Client({
        endPoint: '127.0.0.1',
        port: 9000,
        useSSL: false,
        accessKey: user,
        secretKey: pass,
      });
    }
  }

  /**
   * Upload evidence image to MinIO with S3 authentication and save metadata to DB.
   * Also updates or creates AlarmEvent linked by eventId so Frontend shows the capture.
   */
  async uploadEvidence(
    file: { originalname: string; mimetype?: string; buffer: Buffer },
    gatewayId: string,
    confidence: number,
    timestamp: string,
    eventId?: string,
    nodeId?: string,
    thresholdVal?: number,
    measuredVal?: number,
  ): Promise<{ evidence: Evidence; updatedAlarm: AlarmEvent | null }> {
    const minioEndpoint = this.configService.get<string>(
      'MINIO_ENDPOINT',
      'http://127.0.0.1:9000',
    );
    const bucket = this.configService.get<string>(
      'MINIO_BUCKET',
      'dam-images',
    );

    const safeTimestamp = (timestamp || new Date().toISOString()).replace(
      /[:.]/g,
      '-',
    );
    const objectKey = `evidence/${gatewayId}/${safeTimestamp}_${file.originalname || 'image.jpg'}`;

    try {
      // Ensure bucket exists
      const bucketExists = await this.minioClient
        .bucketExists(bucket)
        .catch(() => false);
      if (!bucketExists) {
        await this.minioClient.makeBucket(bucket).catch(() => { });
        await this.minioClient
          .setBucketPolicy(
            bucket,
            JSON.stringify({
              Version: '2012-10-17',
              Statement: [
                {
                  Effect: 'Allow',
                  Principal: { AWS: ['*'] },
                  Action: ['s3:GetObject'],
                  Resource: [`arn:aws:s3:::${bucket}/*`],
                },
              ],
            }),
          )
          .catch(() => { });
      }

      await this.minioClient.putObject(
        bucket,
        objectKey,
        file.buffer,
        file.buffer.length,
        { 'Content-Type': file.mimetype || 'image/jpeg' },
      );
      console.log(
        `[Evidence] Upload ảnh lên MinIO thành công: ${bucket}/${objectKey}`,
      );
    } catch (err: any) {
      console.error(
        '[Evidence] Lỗi upload ảnh MinIO bằng S3 Client:',
        err.message,
      );
    }

    const imageUrl = `${minioEndpoint}/${bucket}/${objectKey}`;

    // Save metadata to DB
    const evidence = await this.evidenceRepo.save(
      this.evidenceRepo.create({
        gatewayId,
        imageUrl,
        eventId: eventId || null,
        confidence: confidence || null,
        capturedAt: timestamp ? new Date(timestamp) : new Date(),
      }),
    );

    // Resolve dynamic damId, sensorId, and threshold from gateway hierarchy
    let targetDamId = DEFAULT_DAM_ID;
    let targetSensorId = nodeId || DEFAULT_NODE_ID;
    let targetThreshold = thresholdVal ?? 15.0;

    if (gatewayId) {
      try {
        const gw = await this.gatewayRepo.findOne({
          where: { gatewayId },
          relations: { station: { dam: true }, nodes: true },
        });
        if (gw?.station?.damId) {
          targetDamId = gw.station.damId;
        }
        if (!nodeId && gw?.nodes && gw.nodes.length > 0) {
          targetSensorId = gw.nodes[0].nodeId;
          if (gw.nodes[0].vibrationThreshold != null) {
            targetThreshold = gw.nodes[0].vibrationThreshold;
          }
        }
      } catch (err: any) {
        console.warn('[Evidence] Tra cứu gateway metadata lỗi:', err.message);
      }
    }

    if (nodeId && targetDamId === DEFAULT_DAM_ID) {
      try {
        const node = await this.nodeRepo.findOne({
          where: { nodeId },
          relations: { gateway: { station: { dam: true } } },
        });
        if (node?.gateway?.station?.damId) {
          targetDamId = node.gateway.station.damId;
        }
      } catch {
        // ignore
      }
    }

    // Link uploaded evidence image to the corresponding AlarmEvent
    let updatedAlarm: AlarmEvent | null = null;
    try {
      let alarm: AlarmEvent | null = null;
      // 1. Tìm chính xác AlarmEvent theo eventId của sự cố
      if (eventId) {
        alarm = await this.alarmEventRepo.findOne({ where: { eventId } });
      }

      if (alarm) {
        // Ghép thành công imageUrl vào AlarmEvent hiện có
        alarm.imageUrl = imageUrl;
        if (confidence) alarm.crackConfidence = confidence;
        alarm.crackDetected = (confidence || 0) > 0;
        if (eventId && !alarm.eventId) alarm.eventId = eventId;
        updatedAlarm = await this.alarmEventRepo.save(alarm);
        console.log(
          `[Evidence] Đã ghép thành công imageUrl vào Alarm ${alarm.id} (eventId: ${eventId || 'N/A'}, MeasuredVal: ${alarm.measuredVal} ${alarm.sensorType}): ${imageUrl}`,
        );
      } else {
        console.log(
          `[Evidence] Chưa tìm thấy AlarmEvent cho eventId ${eventId || 'N/A'}. File ảnh đã lưu an toàn vào Evidence DB để ghép khớp khi MQTT anomaly đến.`,
        );
      }
    } catch (err: any) {
      console.warn('[Evidence] Không thể gán imageUrl vào Alarm:', err.message);
    }

    return { evidence, updatedAlarm };
  }

  async findAll(gatewayId?: string, limit = 50): Promise<Evidence[]> {
    const qb = this.evidenceRepo
      .createQueryBuilder('e')
      .orderBy('e.createdAt', 'DESC')
      .take(limit);

    if (gatewayId) {
      qb.andWhere('e.gatewayId = :gatewayId', { gatewayId });
    }

    return qb.getMany();
  }

  async findById(id: string): Promise<Evidence | null> {
    return this.evidenceRepo.findOne({ where: { id } });
  }
}
