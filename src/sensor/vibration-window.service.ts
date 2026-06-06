import { Injectable } from '@nestjs/common';

export interface ThresholdResult {
  breach: boolean;
  severity: 'NORMAL' | 'WARNING' | 'ALERT' | 'CRITICAL';
  durationMs: number;
}

@Injectable()
export class VibrationWindowService {
  private alertWindowMap = new Map<string, Date[]>();

  evaluate(
    sensorId: string,
    ppv: number,
    timestamp: Date | string, // Chấp nhận cả chuỗi từ Postman gửi lên
    thresholdConfig: {
      warnHigh: number;
      alertHigh: number;
      criticalHigh: number;
      alertMinCount: number;
    },
  ): ThresholdResult {
    const { warnHigh, alertHigh, criticalHigh, alertMinCount = 4 } = thresholdConfig;
    const WINDOW_SIZE_MS = 10000; // Định nghĩa cửa sổ trượt 10 giây

    // Đảm bảo timestamp luôn là đối tượng Date chuẩn (Fix lỗi nhận chuỗi từ Postman)
    const currentTimestamp = timestamp instanceof Date ? timestamp : new Date(timestamp);

    // 1. KIỂM TRA MỨC NGUY CẤP (CRITICAL) - Đạt ngưỡng nguy hiểm là kích hoạt lập tức
    if (ppv >= criticalHigh) {
      return { breach: true, severity: 'CRITICAL', durationMs: 0 };
    }

    // Khởi tạo cửa sổ lưu trữ cho cảm biến nếu chưa có
    if (!this.alertWindowMap.has(sensorId)) {
      this.alertWindowMap.set(sensorId, []);
    }
    let breachTimestamps = this.alertWindowMap.get(sensorId)!;

    // Tiến hành "Trượt" cửa sổ: Loại bỏ phần tử quá 10 giây so với gói tin hiện tại
    const cutoffTime = currentTimestamp.getTime() - WINDOW_SIZE_MS;
    breachTimestamps = breachTimestamps.filter(t => t.getTime() >= cutoffTime);
    this.alertWindowMap.set(sensorId, breachTimestamps);

    // 2. KIỂM TRA MỨC BÁO ĐỘNG (ALERT)
    // CHỈ VÀO ĐÂY KHI bản thân dữ liệu hiện tại thực sự lớn hơn hoặc bằng ngưỡng Alert
    if (ppv >= alertHigh) {
      // Ghi nhận mốc thời gian lỗi mới vào mảng
      breachTimestamps.push(currentTimestamp);
      this.alertWindowMap.set(sensorId, breachTimestamps);

      // Tính toán độ dài thời gian từ điểm lỗi đầu tiên đến hiện tại trong cửa sổ
      const durationMs = currentTimestamp.getTime() - breachTimestamps[0].getTime();

      // Kiểm tra mật độ lỗi trong cửa sổ 10s
      if (breachTimestamps.length >= alertMinCount) {
        return { breach: true, severity: 'ALERT', durationMs };
      }

      // Biên độ vượt ngưỡng ALERT nhưng tần suất xuất hiện chưa đủ dày đặc trong 10s
      return { breach: false, severity: 'WARNING', durationMs };
    }

    // 3. KIỂM TRA MỨC THEO DÕI (WARNING)
    // Áp dụng cho các gói tin nằm trong khoảng từ [warnHigh -> alertHigh)
    if (ppv >= warnHigh) {
      return { breach: false, severity: 'WARNING', durationMs: 0 };
    }

    // 4. TRẠNG THÁI BÌNH THƯỜNG (NORMAL)
    // Gói tin có biên độ thấp (như 0.25 hay 0.61) sẽ luôn rơi thẳng xuống đây
    return { breach: false, severity: 'NORMAL', durationMs: 0 };
  }
}