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
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SensorService } from './sensor.service';
import { SensorDataDto } from './sensor.dto';
import { SensorGateway } from '../gateway/sensor.gateway';
import { AlarmEvent } from './entities/alarm-event.entity';

@Controller('sensor')
export class SensorController {
  constructor(
    private readonly sensorService: SensorService,
    private readonly gateway: SensorGateway,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Rewrite imageUrl trong alarm để luôn dùng MINIO_ENDPOINT hiện tại.
   * Khi đổi mạng WiFi (IP thay đổi), chỉ cần sửa MINIO_ENDPOINT trong .env.
   */
  private rewriteImageUrl(alarm: AlarmEvent): AlarmEvent {
    if (!alarm.imageUrl) return alarm;
    try {
      const currentEndpoint = this.configService.get<string>('MINIO_ENDPOINT', 'http://localhost:9000');
      const oldUrl = new URL(alarm.imageUrl);
      const newBase = new URL(currentEndpoint);
      oldUrl.protocol = newBase.protocol;
      oldUrl.host = newBase.host;
      return { ...alarm, imageUrl: oldUrl.toString() };
    } catch {
      return alarm;
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
      this.gateway.broadcastAlarm(alarm);
    }

    return { ok: true };
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
}
