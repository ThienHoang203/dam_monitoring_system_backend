import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Put,
  Param,
  Query,
  BadRequestException,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SensorService } from './sensor.service';
import { SensorDataDto } from './sensor.dto';
import { SensorGateway } from '../gateway/sensor.gateway';
import { AlarmEvent } from './entities/alarm-event.entity';
import { MessagePattern, Payload } from '@nestjs/microservices';


@Controller('sensor')
export class SensorController {
  constructor(
    private readonly sensorService: SensorService,
    private readonly gateway: SensorGateway,
    private readonly configService: ConfigService,
  ) { }

  /**
   * Rewrite imageUrl trong alarm:
   * 1. Ưu tiên dùng MINIO_PUBLIC_ENDPOINT nếu cấu hình Ngrok riêng cho MinIO.
   * 2. Nếu không, chuyển sang endpoint proxy /sensor/images/... trên Backend.
   */
  private rewriteImageUrl(alarm: AlarmEvent): AlarmEvent {
    if (!alarm || !alarm.imageUrl) return alarm;
    try {
      const publicEndpoint = this.configService.get<string>('MINIO_PUBLIC_ENDPOINT');
      if (publicEndpoint && publicEndpoint.trim() !== '') {
        const cleanBase = publicEndpoint.trim().replace(/\/+$/, '');
        let subPath = alarm.imageUrl;
        if (subPath.includes('/dam-images/')) {
          subPath = `/dam-images/${subPath.split('/dam-images/')[1]}`;
        } else if (subPath.startsWith('http://') || subPath.startsWith('https://')) {
          subPath = new URL(subPath).pathname;
        }
        return { ...alarm, imageUrl: `${cleanBase}${subPath}` };
      }

      let imgPath = alarm.imageUrl;
      if (imgPath.includes('/dam-images/')) {
        const parts = imgPath.split('/dam-images/');
        imgPath = `/sensor/images/${parts[1]}`;
      } else if (imgPath.startsWith('http://') || imgPath.startsWith('https://')) {
        const urlObj = new URL(imgPath);
        let pathName = urlObj.pathname;
        if (pathName.startsWith('/dam-images/')) {
          pathName = pathName.replace('/dam-images/', '/sensor/images/');
        } else if (!pathName.startsWith('/sensor/images/')) {
          pathName = `/sensor/images${pathName}`;
        }
        imgPath = pathName;
      } else if (!imgPath.startsWith('/sensor/images/')) {
        imgPath = `/sensor/images/${imgPath.replace(/^\/+/, '')}`;
      }

      return { ...alarm, imageUrl: imgPath };
    } catch {
      return alarm;
    }
  }

  /**
   * Endpoint Proxy ảnh từ MinIO nội bộ cho trình duyệt ở mọi thiết bị (LAN, Mobile, Ngrok)
   * GET /sensor/images/*
   */
  @Get('images/*')
  async getProxyImage(@Req() req: any, @Res() res: any) {
    try {
      const reqUrl = req.url || '';
      const imageSubPath = reqUrl.replace(/^\/sensor\/images\//, '').split('?')[0];

      if (!imageSubPath) {
        return res.status(400).send('Bad Request: Missing image path');
      }

      const minioEndpoint =
        this.configService.get<string>('MINIO_INTERNAL_ENDPOINT') ||
        this.configService.get<string>('MINIO_ENDPOINT', 'http://127.0.0.1:9000');
      const bucket = this.configService.get<string>('MINIO_BUCKET', 'dam-images');

      const cleanMinioBase = minioEndpoint.replace(/\/+$/, '');
      const cleanSubPath = imageSubPath.startsWith(`${bucket}/`)
        ? imageSubPath
        : `${bucket}/${imageSubPath.replace(/^\/+/, '')}`;

      const targetUrl = `${cleanMinioBase}/${cleanSubPath}`;

      const fetchRes = await fetch(targetUrl);
      if (!fetchRes.ok) {
        return res.status(fetchRes.status).send('Image not found in storage');
      }

      const contentType = fetchRes.headers.get('content-type') || 'image/jpeg';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache 24h

      const arrayBuffer = await fetchRes.arrayBuffer();
      return res.send(Buffer.from(arrayBuffer));
    } catch (error: any) {
      console.error('[ProxyImage] Lỗi khi lấy ảnh từ MinIO:', error.message);
      return res.status(500).send('Internal Server Error');
    }
  }

  @Post('all')
  @HttpCode(200)
  async ingest(@Body() dto: SensorDataDto) {
    if (
      dto.freq == null ||
      dto.amp == null ||
      dto.waterLevel == null ||
      dto.moisture == null
    ) {
      throw new BadRequestException('Missing required sensor fields');
    }

    const { snapshot, alarms } = await this.sensorService.ingest(dto);
    this.gateway.broadcastUpdate(snapshot);

    // Broadcast từng alarm event mới qua WebSocket
    for (const alarm of alarms) {
      this.gateway.broadcastAlarm(this.rewriteImageUrl(alarm));
    }

    return { ok: true };
  }

  @MessagePattern('dam/sensor/all')
  async ingestMqtt(@Payload() dto: SensorDataDto) {
    if (
      dto.freq == null ||
      dto.amp == null ||
      dto.waterLevel == null ||
      dto.moisture == null
    ) {
      console.warn('[MQTT] Nhận payload lỗi hoặc thiếu trường dữ liệu cảm biến.');
      return { ok: false, error: 'Missing required sensor fields' };
    }

    try {
      const { snapshot, alarms } = await this.sensorService.ingest(dto);
      this.gateway.broadcastUpdate(snapshot);

      // Broadcast từng alarm event mới qua WebSocket
      for (const alarm of alarms) {
        this.gateway.broadcastAlarm(this.rewriteImageUrl(alarm));
      }
      return { ok: true };
    } catch (error: any) {
      console.error('[MQTT] Lỗi ingest data:', error.message);
      return { ok: false, error: error.message };
    }
  }


  @Get('latest')
  getLatest() {
    return {
      data: this.sensorService.getLatest(),
      history: this.sensorService.getHistory(),
    };
  }

  // Lấy lịch sử dữ liệu thực tế từ TimescaleDB cho một loại cảm biến cụ thể
  @Get('history/long-term')
  async getLongTermHistory(
    @Query('type') type: string,
    @Query('limit') limit?: string,
  ) {
    if (!type) {
      throw new BadRequestException('Query parameter "type" is required');
    }
    const maxLimit = limit ? parseInt(limit, 10) : 100;
    const data = await this.sensorService.getLongTermHistory(type, maxLimit);
    return { data };
  }

  // Quản lý ngưỡng: Lấy toàn bộ cấu hình ngưỡng của một đập
  @Get('thresholds')
  async getThresholdConfigs(@Query('damId') damId: string) {
    const targetDamId = damId || 'dam_1';
    const configs = await this.sensorService.getThresholdConfigs(targetDamId);
    return { configs };
  }

  // Quản lý ngưỡng: Cập nhật cấu hình ngưỡng
  @Put('thresholds/:id')
  async updateThresholdConfig(
    @Param('id') id: string,
    @Body() body: any,
  ) {
    const updated = await this.sensorService.updateThresholdConfig(id, body);
    return { ok: true, data: updated };
  }

  // ── Alarm Events ─────────────────────────────────────────────────
  // Lấy danh sách sự kiện cảnh báo
  @Get('alarms')
  async getAlarmEvents(
    @Query('damId') damId: string,
    @Query('limit') limit?: string,
    @Query('severity') severity?: string,
    @Query('resolved') resolved?: string,
  ) {
    const targetDamId = damId || 'dam_1';
    const maxLimit = limit ? parseInt(limit, 10) : 50;
    const resolvedFlag = resolved === 'true' ? true : resolved === 'false' ? false : undefined;

    const alarms = await this.sensorService.getAlarmEvents(
      targetDamId,
      maxLimit,
      severity || undefined,
      resolvedFlag,
    );
    return { alarms: alarms.map(a => this.rewriteImageUrl(a)) };
  }

  // Đánh dấu sự kiện cảnh báo đã xử lý
  @Put('alarms/:id/resolve')
  async resolveAlarmEvent(@Param('id') id: string) {
    const resolved = await this.sensorService.resolveAlarmEvent(id);
    return { ok: true, data: this.rewriteImageUrl(resolved) };
  }

  // Nhận kết quả từ Camera AI và cập nhật báo động
  @Put('alarms/:id/ai-result')
  async updateAiResult(
    @Param('id') id: string,
    @Body() body: { crackDetected: boolean; crackConfidence: number; imageUrl: string }
  ) {
    console.log(`[AI-Result] Nhận kết quả AI cho alarm ${id}:`, JSON.stringify(body));
    const updated = await this.sensorService.updateAlarmEventAiResult(id, body);
    console.log(`[AI-Result] Đã cập nhật DB, imageUrl = ${updated.imageUrl}`);
    const rewritten = this.rewriteImageUrl(updated);
    this.gateway.broadcastAlarm(rewritten);
    return { ok: true, data: rewritten };
  }

  // Gửi Email thông báo khẩn cấp từ Admin
  @Post('send-email-alert')
  async sendEmailAlert(
    @Body() body: { toEmail: string | string[]; subject?: string; message: string; alarmId?: string }
  ) {
    if (!body.message) {
      throw new BadRequestException('Nội dung thông báo (message) không được để trống');
    }
    const result = await this.sensorService.sendEmailAlert(body);
    return result;
  }
}

