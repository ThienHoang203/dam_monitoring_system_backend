import { SensorService } from './sensor.service';
import { Severity } from '../common/enums/severity.enum';
import { buildSensorService, priv } from '../../test/helpers/build-sensor-service';
import { MockRepo } from '../../test/helpers/mock-repo';
import {
  makeAlarmEvent,
  makeDam,
  makeSnapshot,
  makeStation,
  makeThresholdConfig,
  makeThresholdSet,
} from '../../test/helpers/factories';

/**
 * Nghiệp vụ lõi của hệ thống giám sát: phát hiện vượt ngưỡng và sinh cảnh báo.
 *
 * Cơ chế cần bảo vệ (evaluateThresholdAlarms):
 *  - Chống nhiễu: một mức phải giữ liên tục 30 giây mới coi là sự cố thật.
 *  - Mỗi (trạm, loại cảm biến) chỉ có TỐI ĐA MỘT cảnh báo mở cho một đợt sự cố;
 *    lên/xuống mức thì cập nhật tại chỗ, về bình thường thì tự đóng.
 */
describe('SensorService', () => {
  let service: SensorService;
  let alarmEventRepo: MockRepo;
  let stationRepo: MockRepo;
  let thresholdConfigRepo: MockRepo;
  let damRepo: MockRepo;

  const STATION = 'STA-001-01';
  const DAM = 'DAM-001';
  const SUSTAIN_MS = 30_000;

  beforeEach(() => {
    // Instance mới mỗi test — SensorService giữ ~15 Map state không bao giờ tự reset.
    ({ service, alarmEventRepo, stationRepo, thresholdConfigRepo, damRepo } =
      buildSensorService());
  });

  describe('evaluateThresholdAlarms — chống nhiễu 30 giây', () => {
    const configs = makeThresholdSet(STATION, DAM);

    /** Gọi thẳng hàm private đang được kiểm. */
    const evaluate = (waterLevel: number) =>
      priv(service).evaluateThresholdAlarms(
        STATION,
        DAM,
        makeSnapshot({ waterLevel, stationId: STATION }),
        configs,
      );

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
      stationRepo.findOne.mockResolvedValue(
        makeStation({ stationId: STATION, dam: makeDam({ damId: DAM }) }),
      );
    });

    afterEach(() => jest.useRealTimers());

    it('lần vượt ngưỡng đầu tiên chỉ khởi động đồng hồ, chưa tạo cảnh báo', async () => {
      await evaluate(45); // > warnHigh 42.5

      expect(alarmEventRepo.save).not.toHaveBeenCalled();
      expect(priv(service).pendingBreach.get(`${STATION}:water_level`)).toEqual({
        severity: Severity.WARNING,
        since: Date.now(),
      });
    });

    it('giữ 29 giây vẫn chưa đủ để tạo cảnh báo', async () => {
      await evaluate(45);
      jest.advanceTimersByTime(SUSTAIN_MS - 1);
      await evaluate(45);

      expect(alarmEventRepo.save).not.toHaveBeenCalled();
    });

    it('giữ đủ 30 giây → tạo đúng một cảnh báo với đầy đủ thông tin', async () => {
      await evaluate(45);
      jest.advanceTimersByTime(SUSTAIN_MS);
      await evaluate(45);

      expect(alarmEventRepo.save).toHaveBeenCalledTimes(1);
      expect(alarmEventRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'WARNING',
          sensorType: 'water_level',
          thresholdVal: 42.5,
          measuredVal: 45,
          stationId: STATION,
          damId: DAM,
          cameraActivated: false,
        }),
      );
    });

    it('cảnh báo được bổ sung tên trạm/đập để hiển thị khi trạm bị xoá sau này', async () => {
      await evaluate(45);
      jest.advanceTimersByTime(SUSTAIN_MS);
      await evaluate(45);

      expect(alarmEventRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          stationName: 'Trạm quan trắc 01',
          damName: 'Đập Thủy điện Test',
        }),
      );
    });

    it('không tra được trạm thì vẫn tạo cảnh báo (không chặn luồng)', async () => {
      stationRepo.findOne.mockResolvedValue(null);

      await evaluate(45);
      jest.advanceTimersByTime(SUSTAIN_MS);
      await evaluate(45);

      expect(alarmEventRepo.save).toHaveBeenCalledTimes(1);
    });

    // Đổi mức phải khởi động lại đồng hồ, nếu không một cú nhảy vọt tức thời
    // sẽ kế thừa thời gian chờ của mức thấp hơn và tạo cảnh báo quá sớm.
    it('đổi mức làm khởi động lại đồng hồ chờ', async () => {
      await evaluate(45); // WARNING, t=0
      jest.advanceTimersByTime(20_000);
      await evaluate(52); // ALERT — đồng hồ reset về t=20s

      jest.advanceTimersByTime(20_000); // đã 40s kể từ đầu nhưng mới 20s ở mức ALERT
      await evaluate(52);
      expect(alarmEventRepo.save).not.toHaveBeenCalled();

      jest.advanceTimersByTime(10_000); // đủ 30s ở mức ALERT
      await evaluate(52);
      expect(alarmEventRepo.save).toHaveBeenCalledTimes(1);
    });

    it('nâng mức thì CẬP NHẬT cảnh báo đang mở, không tạo bản ghi mới', async () => {
      alarmEventRepo.save.mockResolvedValue(makeAlarmEvent({ id: 'alarm-1' }));

      await evaluate(45);
      jest.advanceTimersByTime(SUSTAIN_MS);
      await evaluate(45); // tạo WARNING

      await evaluate(52); // đổi mức → reset đồng hồ
      jest.advanceTimersByTime(SUSTAIN_MS);
      await evaluate(52);

      expect(alarmEventRepo.save).toHaveBeenCalledTimes(1); // vẫn chỉ 1 lần tạo
      expect(alarmEventRepo.update).toHaveBeenCalledWith(
        'alarm-1',
        expect.objectContaining({ severity: 'ALERT', measuredVal: 52, thresholdVal: 50 }),
      );
    });

    it('ghi rõ chiều chuyển mức trong ghi chú', async () => {
      alarmEventRepo.save.mockResolvedValue(makeAlarmEvent({ id: 'alarm-1' }));

      await evaluate(45);
      jest.advanceTimersByTime(SUSTAIN_MS);
      await evaluate(45);
      await evaluate(52);
      jest.advanceTimersByTime(SUSTAIN_MS);
      await evaluate(52);

      expect(alarmEventRepo.update.mock.calls[0][1].notes).toContain('WARNING -> ALERT');
    });

    it('mức không đổi thì không ghi DB lặp lại', async () => {
      alarmEventRepo.save.mockResolvedValue(makeAlarmEvent({ id: 'alarm-1' }));

      await evaluate(45);
      jest.advanceTimersByTime(SUSTAIN_MS);
      await evaluate(45); // tạo

      for (let i = 0; i < 5; i++) {
        jest.advanceTimersByTime(10_000);
        await evaluate(45);
      }

      expect(alarmEventRepo.save).toHaveBeenCalledTimes(1);
      expect(alarmEventRepo.update).not.toHaveBeenCalled();
    });

    it('giá trị về bình thường đủ 30 giây → tự đóng cảnh báo', async () => {
      alarmEventRepo.save.mockResolvedValue(makeAlarmEvent({ id: 'alarm-1' }));

      await evaluate(45);
      jest.advanceTimersByTime(SUSTAIN_MS);
      await evaluate(45); // mở cảnh báo

      await evaluate(10); // về NORMAL → reset đồng hồ
      jest.advanceTimersByTime(SUSTAIN_MS);
      alarmEventRepo.findOne.mockResolvedValue(
        makeAlarmEvent({ id: 'alarm-1', resolvedAt: new Date() }),
      );
      await evaluate(10);

      expect(alarmEventRepo.update).toHaveBeenCalledWith('alarm-1', {
        resolvedAt: expect.any(Date),
      });
      expect(priv(service).openThresholdAlarm.has(`${STATION}:water_level`)).toBe(false);
    });

    it('cảnh báo vừa đóng được đẩy vào hàng đợi để broadcast', async () => {
      alarmEventRepo.save.mockResolvedValue(makeAlarmEvent({ id: 'alarm-1' }));

      await evaluate(45);
      jest.advanceTimersByTime(SUSTAIN_MS);
      await evaluate(45);
      service.drainPendingAlarms(); // bỏ qua sự kiện mở

      await evaluate(10);
      jest.advanceTimersByTime(SUSTAIN_MS);
      const resolved = makeAlarmEvent({ id: 'alarm-1', resolvedAt: new Date() });
      alarmEventRepo.findOne.mockResolvedValue(resolved);
      await evaluate(10);

      expect(service.drainPendingAlarms()).toContain(resolved);
    });

    it('bình thường mà chưa có cảnh báo nào mở → không làm gì', async () => {
      await evaluate(10);
      jest.advanceTimersByTime(SUSTAIN_MS);
      await evaluate(10);

      expect(alarmEventRepo.save).not.toHaveBeenCalled();
      expect(alarmEventRepo.update).not.toHaveBeenCalled();
    });

    it('mỗi trạm có đồng hồ chờ độc lập', async () => {
      const other = 'STA-001-02';
      const evalOther = (wl: number) =>
        priv(service).evaluateThresholdAlarms(
          other,
          DAM,
          makeSnapshot({ waterLevel: wl, stationId: other }),
          makeThresholdSet(other, DAM),
        );

      await evaluate(45);
      jest.advanceTimersByTime(20_000);
      await evalOther(45); // trạm 2 mới bắt đầu đếm

      jest.advanceTimersByTime(10_000);
      await evaluate(45); // trạm 1 đủ 30s
      await evalOther(45); // trạm 2 mới 10s

      expect(alarmEventRepo.save).toHaveBeenCalledTimes(1);
      expect(alarmEventRepo.save.mock.calls[0][0].stationId).toBe(STATION);
    });

    describe('phạm vi loại cảm biến', () => {
      // Backend chỉ tự sinh cảnh báo cho water_level và humidity.
      // Cảnh báo rung do Jetson TX2 quyết định và gửi lên qua topic anomaly.
      it('KHÔNG tự sinh cảnh báo cho rung động dù vượt ngưỡng', async () => {
        const snapshot = makeSnapshot({ amp: 30, waterLevel: 10, moisture: 10 });
        await priv(service).evaluateThresholdAlarms(STATION, DAM, snapshot, configs);
        jest.advanceTimersByTime(SUSTAIN_MS);
        await priv(service).evaluateThresholdAlarms(STATION, DAM, snapshot, configs);

        expect(alarmEventRepo.save).not.toHaveBeenCalled();
      });

      it('trạm chưa cấu hình ngưỡng loại đó → bỏ qua, không cảnh báo', async () => {
        const onlyVibration = [makeThresholdConfig({ sensorType: 'vibration' })];
        await priv(service).evaluateThresholdAlarms(
          STATION,
          DAM,
          makeSnapshot({ waterLevel: 999 }),
          onlyVibration,
        );
        jest.advanceTimersByTime(SUSTAIN_MS);
        await priv(service).evaluateThresholdAlarms(
          STATION,
          DAM,
          makeSnapshot({ waterLevel: 999 }),
          onlyVibration,
        );

        expect(alarmEventRepo.save).not.toHaveBeenCalled();
        expect(priv(service).pendingBreach.size).toBe(0);
      });

      it.each([null, undefined, NaN])(
        'giá trị đo không hợp lệ (%p) → bỏ qua',
        async (value) => {
          await priv(service).evaluateThresholdAlarms(
            STATION,
            DAM,
            makeSnapshot({ waterLevel: value as any }),
            configs,
          );
          expect(priv(service).pendingBreach.has(`${STATION}:water_level`)).toBe(false);
        },
      );

      it('cảnh báo độ ẩm dùng đơn vị % trong ghi chú', async () => {
        const snapshot = makeSnapshot({ waterLevel: 10, moisture: 80 });
        await priv(service).evaluateThresholdAlarms(STATION, DAM, snapshot, configs);
        jest.advanceTimersByTime(SUSTAIN_MS);
        await priv(service).evaluateThresholdAlarms(STATION, DAM, snapshot, configs);

        const saved = alarmEventRepo.save.mock.calls[0][0];
        expect(saved.sensorType).toBe('humidity');
        expect(saved.notes).toContain('%');
      });
    });

    describe('mức nguy cấp', () => {
      it.each([
        [45, 'WARNING', 42.5],
        [52, 'ALERT', 50],
        [60, 'CRITICAL', 55],
      ])('mực nước %pm → %s (ngưỡng %p)', async (value, severity, threshold) => {
        await evaluate(value as number);
        jest.advanceTimersByTime(SUSTAIN_MS);
        await evaluate(value as number);

        expect(alarmEventRepo.save).toHaveBeenCalledWith(
          expect.objectContaining({ severity, thresholdVal: threshold }),
        );
      });
    });

    // ⚠️ ThresholdConfig.sustainedSeconds sửa được qua API nhưng KHÔNG được dùng ở đây —
    // code luôn dùng hằng số THRESHOLD_ALARM_SUSTAIN_MS = 30s. Khoá hành vi hiện tại lại.
    it('bỏ qua sustainedSeconds của cấu hình, luôn dùng hằng số 30 giây', async () => {
      const fastConfigs = makeThresholdSet(STATION, DAM).map((c) =>
        Object.assign(c, { sustainedSeconds: 1 }),
      );
      const evalFast = (wl: number) =>
        priv(service).evaluateThresholdAlarms(
          STATION,
          DAM,
          makeSnapshot({ waterLevel: wl }),
          fastConfigs,
        );

      await evalFast(45);
      jest.advanceTimersByTime(2000); // quá 1 giây theo cấu hình
      await evalFast(45);
      expect(alarmEventRepo.save).not.toHaveBeenCalled();

      jest.advanceTimersByTime(SUSTAIN_MS);
      await evalFast(45);
      expect(alarmEventRepo.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('parseTelemetryPayload — dung sai payload từ thiết bị', () => {
    const parse = (raw: any) => priv(service).parseTelemetryPayload(raw);

    it.each<[any, any, string]>([
      [null, {}, 'null'],
      [undefined, {}, 'undefined'],
      [42, { value: 42 }, 'số thuần'],
      [0, { value: 0 }, 'số 0'],
      [-1.5, { value: -1.5 }, 'số âm'],
    ])('%p → %p (%s)', (input, expected) => {
      expect(parse(input)).toEqual(expected);
    });

    it('chuỗi JSON được parse thành object', () => {
      expect(parse('{"amp":1.2,"freq":50}')).toEqual({ amp: 1.2, freq: 50 });
    });

    // ⚠️ PHÁT HIỆN: chuỗi số hợp lệ được JSON.parse nuốt trước, trả về SỐ TRẦN
    // chứ không phải { value }. Nhánh parseFloat chỉ chạy với chuỗi không phải JSON.
    // Hệ quả: ingestSingleTelemetry đọc payload.value/.amp/.waterLevel trên một số trần
    // đều ra undefined → freshTypes rỗng → SỐ ĐO BỊ LOẠI BỎ ÂM THẦM.
    //
    // PHẠM VI THỰC TẾ (đã kiểm chứng ở test/realtime/mqtt.rt-spec.ts): qua đường MQTT,
    // bộ giải mã của Nest đã chuyển payload số trần thành kiểu number trước khi tới đây,
    // nên đường đó AN TOÀN. Lỗi chỉ kích hoạt khi hàm này nhận vào một chuỗi — tức là
    // payload được bọc nháy JSON ("42"), hoặc khi gọi trực tiếp từ mã khác.
    it('chuỗi số hợp lệ trả về số trần, KHÔNG bọc thành { value } (nguồn mất dữ liệu)', () => {
      expect(parse('12.5')).toBe(12.5);
      expect(parse('  12.5  ')).toBe(12.5);
      // Đối chiếu: cùng giá trị nhưng gửi dạng số thì được bọc đúng.
      expect(parse(12.5)).toEqual({ value: 12.5 });
    });

    it('hệ quả: telemetry truyền vào dạng chuỗi số bị bỏ qua, không ghi số đo nào', async () => {
      const { service: s, bufferService } = buildSensorService();

      await s.ingestSingleTelemetry('GTW-ST01-TX2A', 'NOD-GW01-ESP01', 'water_level', '12.5');

      expect(bufferService.push).not.toHaveBeenCalled();
    });

    it('cùng dữ liệu nhưng gửi dạng JSON object thì được ghi nhận', async () => {
      const { service: s, bufferService } = buildSensorService();

      await s.ingestSingleTelemetry(
        'GTW-ST01-TX2A',
        'NOD-GW01-ESP01',
        'water_level',
        '{"value":12.5}',
      );

      expect(bufferService.push).toHaveBeenCalled();
    });

    it('nhánh parseFloat chỉ dùng được cho chuỗi không phải JSON hợp lệ', () => {
      // '12.5abc' không parse được thành JSON → rơi xuống parseFloat.
      expect(parse('12.5abc')).toEqual({ value: 12.5 });
    });

    it('chuỗi rác được giữ nguyên trong { raw } thay vì ném lỗi', () => {
      expect(parse('not-json-at-all')).toEqual({ raw: 'not-json-at-all' });
    });

    it('mảng JSON được giữ nguyên', () => {
      expect(parse('[1,2,3]')).toEqual([1, 2, 3]);
    });

    it('object được trả về nguyên vẹn, không sao chép', () => {
      const obj = { amp: 1 };
      expect(parse(obj)).toBe(obj);
    });
  });

  describe('hàng đợi sự kiện chờ broadcast', () => {
    // Controller drain 3 hàng đợi này sau mỗi lần ingest để đẩy qua WebSocket.
    it.each([
      ['drainPendingAlarms', 'pendingAlarms'],
      ['drainStatusChanges', 'pendingStatusChanges'],
      ['drainDamMetricChanges', 'pendingDamMetricChanges'],
    ])('%s trả dữ liệu rồi làm rỗng hàng đợi', (method, field) => {
      priv(service)[field] = [{ marker: 1 }];

      expect((service as any)[method]()).toEqual([{ marker: 1 }]);
      expect((service as any)[method]()).toEqual([]);
    });

    it('hàng đợi rỗng trả mảng rỗng, không phải null', () => {
      expect(service.drainPendingAlarms()).toEqual([]);
      expect(service.drainStatusChanges()).toEqual([]);
      expect(service.drainDamMetricChanges()).toEqual([]);
    });
  });

  describe('lịch sử trong bộ nhớ', () => {
    const push = (waterLevel: number) =>
      priv(service).pushHistory(makeSnapshot({ waterLevel, stationId: STATION }));

    it('giữ tối đa 60 điểm, đẩy điểm cũ nhất ra', () => {
      for (let i = 0; i < 61; i++) push(i);

      const history = service.getHistory();
      expect(history.waterLevel).toHaveLength(60);
      expect(history.waterLevel[0]).toBe(1); // điểm 0 đã bị đẩy ra
    });

    it('mọi mảng trong lịch sử được cắt đồng bộ', () => {
      for (let i = 0; i < 100; i++) push(i);

      const h = service.getHistory();
      const lengths = [h.timestamps, h.freq, h.amp, h.waterLevel, h.moisture, h.percent].map(
        (a) => a.length,
      );
      expect(new Set(lengths).size).toBe(1);
    });

    it('lịch sử được tách riêng theo từng trạm', () => {
      push(10);
      priv(service).pushHistory(makeSnapshot({ waterLevel: 99, stationId: 'STA-001-02' }));

      expect(service.getHistory(STATION).waterLevel).toEqual([10]);
      expect(service.getHistory('STA-001-02').waterLevel).toEqual([99]);
    });
  });

  describe('calcWaterLevelChange — độ chênh mực nước', () => {
    const calc = () => priv(service).calcWaterLevelChange(STATION);
    const push = (waterLevel: number) =>
      priv(service).pushHistory(makeSnapshot({ waterLevel, stationId: STATION }));

    it('chưa đủ 2 điểm đo → null (không đủ cơ sở kết luận)', () => {
      expect(calc()).toBeNull();
      push(10);
      expect(calc()).toBeNull();
    });

    it('trả độ chênh thực đo, làm tròn 2 chữ số', () => {
      push(10);
      push(12.345);
      expect(calc()).toBe(2.35);
    });

    it('mực nước giảm cho giá trị âm', () => {
      push(20);
      push(15);
      expect(calc()).toBe(-5);
    });

    it('trạm chưa có lịch sử → null', () => {
      expect(priv(service).calcWaterLevelChange('STA-999-99')).toBeNull();
    });
  });

  describe('ensureThresholdConfigs', () => {
    it('tạo đủ bộ 3 ngưỡng khi trạm chưa có gì', async () => {
      thresholdConfigRepo.findOne.mockResolvedValue(null);

      await service.ensureThresholdConfigs(STATION, DAM);

      expect(thresholdConfigRepo.save).toHaveBeenCalledTimes(3);
      const types = thresholdConfigRepo.save.mock.calls.map((c) => c[0].sensorType);
      expect(types).toEqual(['vibration', 'water_level', 'humidity']);
    });

    it('idempotent — loại đã có thì không tạo lại', async () => {
      thresholdConfigRepo.findOne.mockResolvedValue(makeThresholdConfig());

      await service.ensureThresholdConfigs(STATION, DAM);

      expect(thresholdConfigRepo.save).not.toHaveBeenCalled();
    });

    it('ngưỡng mực nước mặc định khớp mốc BĐ1/BĐ2/BĐ3', async () => {
      thresholdConfigRepo.findOne.mockResolvedValue(null);

      await service.ensureThresholdConfigs(STATION, DAM);

      const water = thresholdConfigRepo.save.mock.calls
        .map((c) => c[0])
        .find((c) => c.sensorType === 'water_level');
      expect(water).toMatchObject({
        warnHigh: 42.5,
        alertHigh: 50.0,
        criticalHigh: 55.0,
        tankHeight: 50.0,
      });
    });

    it('không có mã trạm thì không làm gì', async () => {
      await service.ensureThresholdConfigs('', DAM);
      expect(thresholdConfigRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('getDamManagers — dữ liệu cá nhân', () => {
    it('không trả về passwordHash', async () => {
      const { service: s, userRepo } = buildSensorService();
      userRepo.find.mockResolvedValue([]);

      await s.getDamManagers(DAM);

      const options = userRepo.find.mock.calls[0]?.[0];
      expect(JSON.stringify(options ?? {})).not.toContain('passwordHash');
    });
  });
});
