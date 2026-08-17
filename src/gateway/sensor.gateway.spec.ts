import { SensorGateway } from './sensor.gateway';
import { makeSnapshot } from '../../test/helpers/factories';

/**
 * Kênh WebSocket đẩy dữ liệu realtime lên dashboard.
 * Điểm cần bảo vệ: cơ chế tiết lưu 50ms (tối đa 20 khung/giây) để dữ liệu mượt
 * mà không làm ngập client khi nhiều node cùng gửi.
 */
describe('SensorGateway', () => {
  let server: { emit: jest.Mock };
  let sensorService: any;
  let gateway: SensorGateway;

  beforeEach(() => {
    server = { emit: jest.fn() };
    sensorService = {
      getLatest: jest.fn().mockReturnValue(makeSnapshot()),
      getHistory: jest.fn().mockReturnValue({ timestamps: [], waterLevel: [] }),
    };
    gateway = new SensorGateway(sensorService);
    gateway.server = server as any;
  });

  describe('handleConnection — nạp dữ liệu ban đầu', () => {
    it('client mới nhận ngay snapshot và lịch sử', () => {
      const client = { emit: jest.fn() };

      gateway.handleConnection(client as any);

      expect(client.emit).toHaveBeenCalledWith('update', expect.any(Object));
      expect(client.emit).toHaveBeenCalledWith('history', expect.any(Object));
    });

    it('chưa có dữ liệu nào thì chỉ gửi lịch sử', () => {
      sensorService.getLatest.mockReturnValue(null);
      const client = { emit: jest.fn() };

      gateway.handleConnection(client as any);

      expect(client.emit).toHaveBeenCalledTimes(1);
      expect(client.emit).toHaveBeenCalledWith('history', expect.any(Object));
    });

    it('gửi riêng cho client vừa kết nối, không phát cho tất cả', () => {
      const client = { emit: jest.fn() };
      gateway.handleConnection(client as any);
      expect(server.emit).not.toHaveBeenCalled();
    });
  });

  describe('broadcastUpdate — tiết lưu 50ms', () => {
    beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z')));
    afterEach(() => jest.useRealTimers());

    it('lần phát đầu tiên đi ngay', () => {
      gateway.broadcastUpdate(makeSnapshot({ clusterId: 'C1' }));
      expect(server.emit).toHaveBeenCalledTimes(1);
    });

    it('phát lại sau 40ms bị chặn', () => {
      gateway.broadcastUpdate(makeSnapshot({ clusterId: 'C1' }));
      jest.advanceTimersByTime(40);
      gateway.broadcastUpdate(makeSnapshot({ clusterId: 'C1' }));

      expect(server.emit).toHaveBeenCalledTimes(1);
    });

    it('qua mốc 50ms thì được phát tiếp', () => {
      gateway.broadcastUpdate(makeSnapshot({ clusterId: 'C1' }));
      jest.advanceTimersByTime(50);
      gateway.broadcastUpdate(makeSnapshot({ clusterId: 'C1' }));

      expect(server.emit).toHaveBeenCalledTimes(2);
    });

    // Tiết lưu tính riêng theo từng cụm — nếu dùng chung một mốc thời gian,
    // cụm gửi nhanh sẽ chặn mất dữ liệu của cụm khác.
    it('mỗi cụm cảm biến có bộ đếm tiết lưu riêng', () => {
      gateway.broadcastUpdate(makeSnapshot({ clusterId: 'C1' }));
      gateway.broadcastUpdate(makeSnapshot({ clusterId: 'C2' }));

      expect(server.emit).toHaveBeenCalledTimes(2);
    });

    it('không có clusterId thì khoá theo trạm', () => {
      gateway.broadcastUpdate(makeSnapshot({ clusterId: undefined, stationId: 'STA-001-01' }));
      gateway.broadcastUpdate(makeSnapshot({ clusterId: undefined, stationId: 'STA-001-02' }));

      expect(server.emit).toHaveBeenCalledTimes(2);
    });

    it('không có cả hai thì dùng khoá mặc định chung', () => {
      gateway.broadcastUpdate(makeSnapshot({ clusterId: undefined, stationId: undefined }));
      gateway.broadcastUpdate(makeSnapshot({ clusterId: undefined, stationId: undefined }));

      expect(server.emit).toHaveBeenCalledTimes(1);
    });
  });

  describe('các sự kiện phát cho toàn bộ client', () => {
    // Tên sự kiện là hợp đồng với frontend — đổi tên ở đây là breaking change.
    it('cảnh báo mới', () => {
      const alarm = { id: 'a1', severity: 'ALERT' };
      gateway.broadcastAlarm(alarm);
      expect(server.emit).toHaveBeenCalledWith('alarm', alarm);
    });

    it('cảnh báo đã xử lý', () => {
      const resolvedAt = new Date('2026-01-01T00:00:00Z');
      gateway.broadcastAlarmResolved('a1', resolvedAt);
      expect(server.emit).toHaveBeenCalledWith('alarm_resolved', { id: 'a1', resolvedAt });
    });

    it('trạng thái rung realtime', () => {
      gateway.broadcastVibrationStatus({ severity: 'WARNING' });
      expect(server.emit).toHaveBeenCalledWith('vibration_status', { severity: 'WARNING' });
    });

    it('trạng thái an toàn của trạm đổi mức', () => {
      const change = { level: 'station', stationId: 'STA-001-01', damId: 'DAM-001' } as any;
      gateway.broadcastStationStatus(change);
      expect(server.emit).toHaveBeenCalledWith('station_status_changed', change);
    });

    it('chỉ số mực nước cấp đập thay đổi', () => {
      const change = { damId: 'DAM-001', waterLevel: 30, fillPct: 60 } as any;
      gateway.broadcastDamMetrics(change);
      expect(server.emit).toHaveBeenCalledWith('dam_metrics_changed', change);
    });
  });
});
