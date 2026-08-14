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
import { MessagePattern, Payload, Ctx, MqttContext } from '@nestjs/microservices';


import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';

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

  /**
   * Topic: telemetry/gateway/{gateway_id}/node/{node_id}/{sensor_type}
   * Ví dụ:
   *   - telemetry/gateway/GTW-ST01-TX2A/node/NOD-ST01-ESP01/vibration
   *   - telemetry/gateway/GTW-ST01-TX2A/node/NOD-ST01-ESP01/water_level
   *   - telemetry/gateway/GTW-ST01-TX2A/node/NOD-ST01-ESP01/moisture
   */
  @MessagePattern('telemetry/gateway/+/node/+/+')
  async ingestTelemetryPerSensorMqtt(
    @Payload() payload: any,
    @Ctx() context: MqttContext,
  ) {
    try {
      const topic = context.getTopic();
      const parts = topic.split('/');
      const gatewayId = parts[2] || '';
      const nodeId = parts[4] || '';
      const sensorType = parts[5] || '';

      console.log(
        `[MQTT Telemetry] Nhận [${sensorType}] từ Gateway: ${gatewayId}, Node: ${nodeId}`,
        payload,
      );

      const { snapshot, alarms } = await this.sensorService.ingestSingleTelemetry(
        gatewayId,
        nodeId,
        sensorType,
        payload,
      );

      this.gateway.broadcastUpdate(snapshot);

      for (const alarm of alarms) {
        this.gateway.broadcastAlarm(this.rewriteImageUrl(alarm));
      }

      return { ok: true };
    } catch (error: any) {
      console.error('[MQTT Telemetry] Lỗi xử lý dữ liệu telemetry:', error.message);
      return { ok: false, error: error.message };
    }
  }

  /**
   * Topic: telemetry/gateway/{gateway_id}/node/{node_id} (Full node payload)
   */
  @MessagePattern('telemetry/gateway/+/node/+')
  async ingestTelemetryNodeMqtt(
    @Payload() payload: any,
    @Ctx() context: MqttContext,
  ) {
    try {
      const topic = context.getTopic();
      const parts = topic.split('/');
      const gatewayId = parts[2] || '';
      const nodeId = parts[4] || '';

      console.log(
        `[MQTT Telemetry Node] Nhận dữ liệu từ Gateway: ${gatewayId}, Node: ${nodeId}`,
        payload,
      );

      const { snapshot, alarms } = await this.sensorService.ingestSingleTelemetry(
        gatewayId,
        nodeId,
        'all',
        payload,
      );

      this.gateway.broadcastUpdate(snapshot);

      for (const alarm of alarms) {
        this.gateway.broadcastAlarm(this.rewriteImageUrl(alarm));
      }

      return { ok: true };
    } catch (error: any) {
      console.error('[MQTT Telemetry Node] Lỗi xử lý dữ liệu:', error.message);
      return { ok: false, error: error.message };
    }
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

  /**
   * Topic: status/gateway/{gateway_id}/node/{node_id}/vibration
   * Trạng thái ngưỡng độ rung đã xử lý — gửi cả khi breach=false (NORMAL/WARNING),
   * dùng cho dashboard vẽ biểu đồ ngưỡng realtime qua WebSocket.
   */
  @MessagePattern('status/gateway/+/node/+/vibration')
  async ingestVibrationStatusMqtt(
    @Payload() payload: any,
    @Ctx() context: MqttContext,
  ) {
    try {
      const topic = context.getTopic();
      const parts = topic.split('/');
      const gatewayId = parts[2] || '';
      const nodeId = parts[4] || '';

      const status = await this.sensorService.handleVibrationStatus(
        gatewayId,
        nodeId,
        payload,
      );
      this.gateway.broadcastVibrationStatus(status);
      return { ok: true };
    } catch (error: any) {
      console.error('[MQTT Vibration Status] Lỗi xử lý trạng thái ngưỡng độ rung:', error.message);
      return { ok: false, error: error.message };
    }
  }

  @MessagePattern('events/gateway/+/anomaly')
  async ingestAnomalyMqtt(@Payload() payload: any) {
    try {
      const alarm = await this.sensorService.handleAnomalyEvent(payload);
      this.gateway.broadcastAlarm(this.rewriteImageUrl(alarm));
      return { ok: true };
    } catch (error: any) {
      console.error('[MQTT Anomaly] Lỗi xử lý sự kiện anomaly:', error.message);
      return { ok: false, error: error.message };
    }
  }


  @Get('latest')
  getLatest(
    @Query('stationId') stationId?: string,
    @Query('clusterId') clusterId?: string,
  ) {
    const stId = stationId ? parseInt(stationId, 10) : undefined;
    return {
      data: this.sensorService.getLatest(stId, clusterId),
      history: this.sensorService.getHistory(stId),
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
  // Lấy danh sách sự kiện cảnh báo (ADMIN thấy tất cả đập, OPERATOR chỉ thấy đập quản lý)
  @Get('alarms')
  @UseGuards(OptionalJwtAuthGuard)
  async getAlarmEvents(
    @CurrentUser() user: User | null,
    @Query('damId') damId?: string,
    @Query('limit') limit?: string,
    @Query('severity') severity?: string,
    @Query('resolved') resolved?: string,
  ) {
    let targetDamId = damId;

    // Nếu là OPERATOR: Bắt buộc chỉ lấy cảnh báo của đập được phân công
    if (user && user.role === 'OPERATOR') {
      targetDamId = user.assignedDamId || damId || 'dam_1';
    }

    // Nếu damId === 'all' hoặc không truyền damId (hoặc là ADMIN chọn xem tất cả đập)
    if (damId === 'all' || (!damId && (!user || user.role === 'ADMIN'))) {
      targetDamId = undefined;
    }

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
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'OPERATOR')
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

