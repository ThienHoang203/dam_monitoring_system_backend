import { BadRequestException } from '@nestjs/common';
import { SensorController } from './sensor.controller';
import { createConfigService } from '../../test/helpers/exec-context';
import { makeMqttContext } from '../../test/helpers/mqtt-ctx';
import {
  makeAdmin,
  makeAlarmEvent,
  makeOperator,
  makeSensorDataDto,
  makeSnapshot,
} from '../../test/helpers/factories';

describe('SensorController', () => {
  let sensorService: any;
  let gateway: any;
  let controller: SensorController;

  const build = (config: Record<string, any> = {}) => {
    sensorService = {
      ingest: jest.fn().mockResolvedValue({ snapshot: makeSnapshot(), alarms: [] }),
      ingestSingleTelemetry: jest
        .fn()
        .mockResolvedValue({ snapshot: makeSnapshot(), alarms: [] }),
      handleVibrationStatus: jest.fn().mockResolvedValue({ severity: 'NORMAL' }),
      handleAnomalyEvent: jest.fn().mockResolvedValue(makeAlarmEvent()),
      getAlarmEvents: jest.fn().mockResolvedValue([]),
      getLongTermHistory: jest.fn().mockResolvedValue([]),
      getHistoryKpi: jest.fn().mockResolvedValue({}),
      drainStatusChanges: jest.fn().mockReturnValue([]),
      drainDamMetricChanges: jest.fn().mockReturnValue([]),
      drainPendingAlarms: jest.fn().mockReturnValue([]),
    };
    gateway = {
      broadcastUpdate: jest.fn(),
      broadcastAlarm: jest.fn(),
      broadcastVibrationStatus: jest.fn(),
      broadcastStationStatus: jest.fn(),
      broadcastDamMetrics: jest.fn(),
    };
    return new SensorController(sensorService, gateway, createConfigService(config));
  };

  beforeEach(() => {
    controller = build();
  });

  describe('rewriteImageUrl — quy đổi URL ảnh MinIO', () => {
    const rewrite = (imageUrl: any, config: Record<string, any> = {}) =>
      (build(config) as any).rewriteImageUrl(makeAlarmEvent({ imageUrl })).imageUrl;

    it('không có ảnh thì trả nguyên cảnh báo, không sao chép', () => {
      const alarm = makeAlarmEvent({ imageUrl: null });
      expect((controller as any).rewriteImageUrl(alarm)).toBe(alarm);
    });

    describe('khi có MINIO_PUBLIC_ENDPOINT (trình duyệt gọi thẳng MinIO)', () => {
      const config = { MINIO_PUBLIC_ENDPOINT: 'https://cdn.example.test/' };

      it('URL nội bộ được đổi sang endpoint công khai', () => {
        expect(rewrite('http://minio:9000/dam-images/evidence/a.jpg', config)).toBe(
          'https://cdn.example.test/dam-images/evidence/a.jpg',
        );
      });

      it('dấu gạch chéo thừa ở cuối endpoint được cắt bỏ', () => {
        expect(rewrite('http://minio:9000/dam-images/a.jpg', config)).not.toContain('//dam-images');
      });

      it('URL tuyệt đối khác giữ nguyên đường dẫn', () => {
        expect(rewrite('http://other-host/some/path.jpg', config)).toBe(
          'https://cdn.example.test/some/path.jpg',
        );
      });
    });

    describe('khi KHÔNG có MINIO_PUBLIC_ENDPOINT (ảnh đi qua proxy backend)', () => {
      it('URL chứa bucket được đổi sang đường dẫn proxy', () => {
        expect(rewrite('http://minio:9000/dam-images/evidence/a.jpg')).toBe(
          '/sensor/images/evidence/a.jpg',
        );
      });

      it('đường dẫn trần được thêm tiền tố proxy', () => {
        expect(rewrite('evidence/a.jpg')).toBe('/sensor/images/evidence/a.jpg');
      });

      it('dấu gạch chéo thừa ở đầu bị cắt', () => {
        expect(rewrite('///evidence/a.jpg')).toBe('/sensor/images/evidence/a.jpg');
      });

      it('đường dẫn đã đúng dạng proxy thì giữ nguyên', () => {
        expect(rewrite('/sensor/images/evidence/a.jpg')).toBe('/sensor/images/evidence/a.jpg');
      });
    });

    it('URL hỏng không làm vỡ luồng — trả lại cảnh báo gốc', () => {
      expect(() => rewrite('http://')).not.toThrow();
    });
  });

  describe('getProxyImage — chặn path traversal', () => {
    const res = () => {
      const r: any = {
        status: jest.fn(() => r),
        send: jest.fn(() => r),
        setHeader: jest.fn(),
      };
      return r;
    };

    // Proxy ảnh là endpoint @Public: bất kỳ ai cũng gọi được. Nếu đường dẫn không
    // được lọc, kẻ tấn công đọc được object tuỳ ý ngoài phạm vi bucket.
    it.each([
      ['/sensor/images/../../etc/passwd', 'dấu .. dạng thô'],
      ['/sensor/images/..%2F..%2Fetc%2Fpasswd', 'dấu .. đã mã hoá URL'],
      ['/sensor/images/a%5Cb.jpg', 'dấu gạch chéo ngược Windows'],
      ['/sensor/images/%2Fetc/passwd', 'đường dẫn tuyệt đối'],
    ])('từ chối %s (%s)', async (url) => {
      const r = res();
      await controller.getProxyImage({ url }, r);

      expect(r.status).toHaveBeenCalledWith(400);
      expect(r.send).toHaveBeenCalledWith('Invalid image path');
    });

    it('thiếu đường dẫn → 400', async () => {
      const r = res();
      await controller.getProxyImage({ url: '/sensor/images/' }, r);
      expect(r.status).toHaveBeenCalledWith(400);
    });

    it('chuỗi mã hoá hỏng không làm vỡ server → 400', async () => {
      const r = res();
      await controller.getProxyImage({ url: '/sensor/images/%E0%A4%A' }, r);

      expect(r.status).toHaveBeenCalledWith(400);
      expect(r.send).toHaveBeenCalledWith('Invalid image path');
    });

    describe('đường dẫn hợp lệ', () => {
      const fetchMock = jest.fn();

      beforeEach(() => {
        global.fetch = fetchMock as any;
        fetchMock.mockResolvedValue({
          ok: true,
          status: 200,
          headers: { get: () => 'image/png' },
          arrayBuffer: async () => new ArrayBuffer(4),
        });
      });

      it('gọi đúng địa chỉ MinIO nội bộ', async () => {
        controller = build({
          MINIO_INTERNAL_ENDPOINT: 'http://minio:9000',
          MINIO_BUCKET: 'dam-images',
        });

        await controller.getProxyImage({ url: '/sensor/images/evidence/a.jpg' }, res());

        expect(fetchMock).toHaveBeenCalledWith('http://minio:9000/dam-images/evidence/a.jpg');
      });

      it('đặt Content-Type theo upstream và cho phép cache 24 giờ', async () => {
        const r = res();
        await controller.getProxyImage({ url: '/sensor/images/a.jpg' }, r);

        expect(r.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
        expect(r.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=86400');
      });

      it('ảnh không tồn tại trên MinIO → chuyển tiếp đúng mã lỗi', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 404 });
        const r = res();

        await controller.getProxyImage({ url: '/sensor/images/missing.jpg' }, r);

        expect(r.status).toHaveBeenCalledWith(404);
      });

      it('MinIO chết → 500, không rò rỉ chi tiết lỗi', async () => {
        fetchMock.mockRejectedValue(new Error('ECONNREFUSED 10.0.0.5:9000'));
        const r = res();

        await controller.getProxyImage({ url: '/sensor/images/a.jpg' }, r);

        expect(r.status).toHaveBeenCalledWith(500);
        expect(r.send).toHaveBeenCalledWith('Internal Server Error');
      });
    });
  });

  describe('ingest qua HTTP', () => {
    it.each(['freq', 'amp', 'waterLevel', 'moisture'])(
      'thiếu trường bắt buộc "%s" → BadRequest',
      async (field) => {
        const dto = makeSensorDataDto({ [field]: null } as any);
        await expect(controller.ingest(dto)).rejects.toThrow(BadRequestException);
      },
    );

    it('ingest thành công thì phát sóng bản cập nhật', async () => {
      await controller.ingest(makeSensorDataDto());
      expect(gateway.broadcastUpdate).toHaveBeenCalled();
    });

    // Ba hàng đợi sự kiện chỉ được xả khi có ingest — không có luồng dữ liệu vào
    // thì các thay đổi trạng thái đã xếp hàng sẽ không bao giờ tới client.
    it('xả đủ cả ba hàng đợi sự kiện', async () => {
      sensorService.drainStatusChanges.mockReturnValue([{ level: 'station' }]);
      sensorService.drainDamMetricChanges.mockReturnValue([{ damId: 'DAM-001' }]);
      sensorService.drainPendingAlarms.mockReturnValue([makeAlarmEvent()]);

      await controller.ingest(makeSensorDataDto());

      expect(gateway.broadcastStationStatus).toHaveBeenCalled();
      expect(gateway.broadcastDamMetrics).toHaveBeenCalled();
      expect(gateway.broadcastAlarm).toHaveBeenCalled();
    });
  });

  describe('thu hẹp phạm vi đập ở endpoint đọc', () => {
    it('OPERATOR bị ép về đập của mình dù query hỏi đập khác', async () => {
      await controller.getAlarmEvents(makeOperator('DAM-002'), 'DAM-001');
      expect(sensorService.getAlarmEvents).toHaveBeenCalledWith('DAM-002', 50, undefined, undefined);
    });

    it('ADMIN dùng đúng damId trong query', async () => {
      await controller.getAlarmEvents(makeAdmin(), 'DAM-001');
      expect(sensorService.getAlarmEvents.mock.calls[0][0]).toBe('DAM-001');
    });

    it('damId="all" → bỏ lọc, trả dữ liệu toàn hệ thống', async () => {
      await controller.getAlarmEvents(makeAdmin(), 'all');
      expect(sensorService.getAlarmEvents.mock.calls[0][0]).toBeUndefined();
    });

    it('khách vãng lai xem được cảnh báo mọi đập', async () => {
      await controller.getAlarmEvents(null, undefined);
      expect(sensorService.getAlarmEvents.mock.calls[0][0]).toBeUndefined();
    });

    // ⚠️ OPERATOR chưa được gán đập bị đẩy về DAM-001 cứng trong code, tức là
    // vô tình thấy dữ liệu của một đập cụ thể thay vì bị từ chối.
    it('OPERATOR chưa gán đập bị đẩy về DAM-001 cứng', async () => {
      await controller.getAlarmEvents(makeOperator(null as any), undefined);
      expect(sensorService.getAlarmEvents.mock.calls[0][0]).toBe('DAM-001');
    });

    it.each([
      ['true', true],
      ['false', false],
      ['maybe', undefined],
      [undefined, undefined],
    ])('tham số resolved="%s" → %p', async (input, expected) => {
      await controller.getAlarmEvents(makeAdmin(), 'all', undefined, undefined, input as any);
      expect(sensorService.getAlarmEvents.mock.calls[0][3]).toBe(expected);
    });

    it('cùng quy tắc thu hẹp áp cho lịch sử dài hạn', async () => {
      await controller.getLongTermHistory(makeOperator('DAM-002'), undefined, 'DAM-001');
      expect(sensorService.getLongTermHistory.mock.calls[0][0].damId).toBe('DAM-002');
    });

    it('cùng quy tắc thu hẹp áp cho chỉ số KPI', async () => {
      await controller.getHistoryKpi(makeOperator('DAM-002'), 'DAM-001');
      expect(sensorService.getHistoryKpi.mock.calls[0][0].damId).toBe('DAM-002');
    });
  });

  describe('bộ xử lý MQTT', () => {
    it('tách đúng gateway/node/loại cảm biến từ topic', async () => {
      await controller.ingestTelemetryPerSensorMqtt(
        { value: 30 },
        makeMqttContext('telemetry/gateway/GTW-ST01-TX2A/node/NOD-GW01-ESP01/water_level'),
      );

      expect(sensorService.ingestSingleTelemetry).toHaveBeenCalledWith(
        'GTW-ST01-TX2A',
        'NOD-GW01-ESP01',
        'water_level',
        { value: 30 },
      );
    });

    it('topic cấp node dùng loại "all"', async () => {
      await controller.ingestTelemetryNodeMqtt(
        {},
        makeMqttContext('telemetry/gateway/GTW-ST01-TX2A/node/NOD-GW01-ESP01'),
      );

      expect(sensorService.ingestSingleTelemetry.mock.calls[0][2]).toBe('all');
    });

    it('topic thiếu đoạn không làm vỡ handler', async () => {
      await expect(
        controller.ingestTelemetryPerSensorMqtt({}, makeMqttContext('telemetry/gateway')),
      ).resolves.toEqual({ ok: true });

      expect(sensorService.ingestSingleTelemetry).toHaveBeenCalledWith('', '', '', {});
    });

    it('topic trạng thái rung gọi đúng service và phát sóng', async () => {
      await controller.ingestVibrationStatusMqtt(
        { severity: 'CRITICAL' },
        makeMqttContext('status/gateway/GTW-ST01-TX2A/node/NOD-GW01-ESP01/vibration'),
      );

      expect(sensorService.handleVibrationStatus).toHaveBeenCalledWith(
        'GTW-ST01-TX2A',
        'NOD-GW01-ESP01',
        { severity: 'CRITICAL' },
      );
      expect(gateway.broadcastVibrationStatus).toHaveBeenCalled();
    });

    it('sự kiện bất thường từ Jetson được phát sóng như cảnh báo', async () => {
      await controller.ingestAnomalyMqtt({ event_id: 'E1', crack_detected: true });

      expect(sensorService.handleAnomalyEvent).toHaveBeenCalled();
      expect(gateway.broadcastAlarm).toHaveBeenCalled();
    });

    it('payload MQTT thiếu trường → trả lỗi thay vì ném (MQTT không có ai bắt)', async () => {
      const result = await controller.ingestMqtt({ freq: 1 } as any);
      expect(result).toEqual({ ok: false, error: 'Missing required sensor fields' });
    });

    // ⚠️ Mọi handler MQTT đều nuốt lỗi và trả { ok: false }. Ưu điểm: microservice
    // không chết vì một gói tin hỏng. Nhược điểm: telemetry mất âm thầm, không có
    // cảnh báo vận hành nào. Khoá hành vi này lại để nó là lựa chọn có ý thức.
    it('lỗi từ service bị nuốt, không làm chết microservice', async () => {
      sensorService.ingestSingleTelemetry.mockRejectedValue(new Error('DB down'));

      await expect(
        controller.ingestTelemetryPerSensorMqtt(
          {},
          makeMqttContext('telemetry/gateway/G/node/N/water_level'),
        ),
      ).resolves.toEqual({ ok: false, error: 'DB down' });
    });
  });
});
