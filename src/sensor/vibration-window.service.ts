import { Injectable } from '@nestjs/common';

export interface ThresholdResult {
  breach: boolean;
  severity: 'NORMAL' | 'WARNING' | 'ALERT' | 'CRITICAL';
  durationMs: number;
}

@Injectable()
export class VibrationWindowService {
  // Quản lý thời điểm vượt ngưỡng của từng cảm biến
  private exceedanceStarts = new Map<string, Date>();

  evaluate(
    sensorId: string,
    ppv: number,
    timestamp: Date,
    thresholdConfig: {
      alertHigh: number;
      criticalHigh: number;
      warnHigh: number;
      sustainedSeconds: number;
    },
  ): ThresholdResult {
    const alertThreshold = thresholdConfig.alertHigh;
    const criticalThreshold = thresholdConfig.criticalHigh;
    const warnThreshold = thresholdConfig.warnHigh;
    const sustainedSeconds = thresholdConfig.sustainedSeconds || 3;

    // 1. Kiểm tra mức nguy cấp (CRITICAL) - Kích hoạt ngay lập tức
    if (ppv >= criticalThreshold) {
      this.exceedanceStarts.delete(sensorId); // Xóa thời gian trượt vì đã rơi vào nguy cấp lập tức
      return { breach: true, severity: 'CRITICAL', durationMs: 0 };
    }

    // 2. Kiểm tra mức báo động (ALERT) - Cần duy trì liên tục
    if (ppv >= alertThreshold) {
      if (!this.exceedanceStarts.has(sensorId)) {
        this.exceedanceStarts.set(sensorId, timestamp);
      }
      
      const startTime = this.exceedanceStarts.get(sensorId)!;
      const durationMs = timestamp.getTime() - startTime.getTime();
      
      if (durationMs >= sustainedSeconds * 1000) {
        return { breach: true, severity: 'ALERT', durationMs };
      }
      
      return { breach: false, severity: 'WARNING', durationMs }; // Rung động cao nhưng chưa đủ lâu
    } 
    
    // 3. Kiểm tra mức theo dõi (WARNING)
    if (ppv >= warnThreshold) {
      this.exceedanceStarts.delete(sensorId); // Reset thời điểm báo động
      return { breach: false, severity: 'WARNING', durationMs: 0 };
    }

    // 4. Bình thường (NORMAL)
    this.exceedanceStarts.delete(sensorId); // Reset hoàn toàn
    return { breach: false, severity: 'NORMAL', durationMs: 0 };
  }
}
