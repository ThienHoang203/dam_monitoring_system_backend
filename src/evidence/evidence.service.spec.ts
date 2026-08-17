import { EvidenceService } from './evidence.service';
import { createMockRepo, createMockQueryBuilder, MockRepo } from '../../test/helpers/mock-repo';
import { createConfigService } from '../../test/helpers/exec-context';
import { makeAlarmEvent, makeDam, makeGateway, makeNode, makeStation } from '../../test/helpers/factories';
import { minioClientMock, MinioClientCtorMock, resetMinioMock } from '../../test/mocks/minio.mock';

/**
 * Ảnh bằng chứng do Jetson TX2 chụp khi phát hiện vết nứt, tải lên MinIO
 * rồi ghép vào AlarmEvent tương ứng theo eventId.
 */
describe('EvidenceService', () => {
  let evidenceRepo: MockRepo;
  let alarmEventRepo: MockRepo;
  let gatewayRepo: MockRepo;
  let nodeRepo: MockRepo;
  let service: EvidenceService;

  const file = {
    originalname: 'crack.jpg',
    mimetype: 'image/jpeg',
    buffer: Buffer.from('fake-image-bytes'),
  };

  const build = (config: Record<string, any> = {}) => {
    evidenceRepo = createMockRepo();
    alarmEventRepo = createMockRepo();
    gatewayRepo = createMockRepo();
    nodeRepo = createMockRepo();
    const s = new EvidenceService(
      evidenceRepo as any,
      alarmEventRepo as any,
      gatewayRepo as any,
      nodeRepo as any,
      createConfigService({
        MINIO_ENDPOINT: 'http://minio:9000',
        MINIO_BUCKET: 'dam-images',
        ...config,
      }),
    );
    s.onModuleInit();
    return s;
  };

  beforeEach(() => {
    resetMinioMock();
    service = build();
  });

  describe('onModuleInit — cấu hình client MinIO', () => {
    it('HTTPS không ghi cổng → dùng 443 và bật SSL', () => {
      build({ MINIO_ENDPOINT: 'https://minio.example.test' });
      expect(MinioClientCtorMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ endPoint: 'minio.example.test', port: 443, useSSL: true }),
      );
    });

    it('HTTP không ghi cổng → dùng 80', () => {
      build({ MINIO_ENDPOINT: 'http://minio.example.test' });
      expect(MinioClientCtorMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ port: 80, useSSL: false }),
      );
    });

    it('cổng khai tường minh được tôn trọng', () => {
      build({ MINIO_ENDPOINT: 'http://minio:9000' });
      expect(MinioClientCtorMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ endPoint: 'minio', port: 9000 }),
      );
    });

    // Cấu hình sai không được làm sập cả ứng dụng lúc khởi động.
    it('endpoint hỏng → quay về mặc định 127.0.0.1:9000', () => {
      expect(() => build({ MINIO_ENDPOINT: 'không-phải-url' })).not.toThrow();
      expect(MinioClientCtorMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ endPoint: '127.0.0.1', port: 9000 }),
      );
    });
  });

  describe('uploadEvidence — tạo bucket', () => {
    it('bucket chưa có thì tạo và mở quyền đọc công khai', async () => {
      minioClientMock.bucketExists.mockResolvedValue(false);

      await service.uploadEvidence(file, 'GTW-ST01-TX2A', 0.93, '2026-01-01T00:00:00.000Z');

      expect(minioClientMock.makeBucket).toHaveBeenCalledWith('dam-images');
      const policy = JSON.parse(minioClientMock.setBucketPolicy.mock.calls[0][1]);
      expect(policy.Statement[0].Action).toContain('s3:GetObject');
    });

    it('bucket đã có thì không tạo lại', async () => {
      minioClientMock.bucketExists.mockResolvedValue(true);

      await service.uploadEvidence(file, 'GTW-ST01-TX2A', 0.9, '2026-01-01T00:00:00.000Z');

      expect(minioClientMock.makeBucket).not.toHaveBeenCalled();
    });
  });

  describe('uploadEvidence — khoá đối tượng', () => {
    it('gồm gateway, thời điểm và tên file gốc', async () => {
      await service.uploadEvidence(file, 'GTW-ST01-TX2A', 0.9, '2026-01-01T10:30:00.000Z');

      const [, objectKey] = minioClientMock.putObject.mock.calls[0];
      expect(objectKey).toBe('evidence/GTW-ST01-TX2A/2026-01-01T10-30-00-000Z_crack.jpg');
    });

    // Dấu ':' và '.' không hợp lệ trong tên đối tượng trên một số hệ thống lưu trữ.
    it('làm sạch ký tự ":" và "." trong dấu thời gian', async () => {
      await service.uploadEvidence(file, 'G1', 0.9, '2026-01-01T10:30:00.000Z');

      const [, objectKey] = minioClientMock.putObject.mock.calls[0];
      expect(objectKey).not.toMatch(/[:.]\d/);
    });

    it('thiếu tên file gốc → dùng image.jpg', async () => {
      await service.uploadEvidence(
        { ...file, originalname: '' },
        'G1',
        0.9,
        '2026-01-01T00:00:00.000Z',
      );

      expect(minioClientMock.putObject.mock.calls[0][1]).toContain('_image.jpg');
    });

    it('thiếu mimetype → mặc định image/jpeg', async () => {
      await service.uploadEvidence(
        { ...file, mimetype: undefined },
        'G1',
        0.9,
        '2026-01-01T00:00:00.000Z',
      );

      expect(minioClientMock.putObject.mock.calls[0][4]).toEqual({ 'Content-Type': 'image/jpeg' });
    });
  });

  describe('uploadEvidence — ghép ảnh vào cảnh báo', () => {
    it('tìm thấy cảnh báo cùng eventId thì gắn ảnh và độ tin cậy', async () => {
      const alarm = makeAlarmEvent({ eventId: 'EVT-1', imageUrl: null });
      alarmEventRepo.findOne.mockResolvedValue(alarm);

      const { updatedAlarm } = await service.uploadEvidence(
        file,
        'GTW-ST01-TX2A',
        0.93,
        '2026-01-01T00:00:00.000Z',
        'EVT-1',
      );

      expect(updatedAlarm).toBeTruthy();
      expect(alarm.imageUrl).toContain('evidence/GTW-ST01-TX2A/');
      expect(alarm.crackConfidence).toBe(0.93);
      expect(alarm.crackDetected).toBe(true);
    });

    it('độ tin cậy bằng 0 → không đánh dấu là có vết nứt', async () => {
      const alarm = makeAlarmEvent({ eventId: 'EVT-1' });
      alarmEventRepo.findOne.mockResolvedValue(alarm);

      await service.uploadEvidence(file, 'G1', 0, '2026-01-01T00:00:00.000Z', 'EVT-1');

      expect(alarm.crackDetected).toBe(false);
    });

    // Ảnh có thể tới TRƯỚC gói tin anomaly qua MQTT — vẫn phải lưu để ghép sau.
    it('chưa có cảnh báo tương ứng thì vẫn lưu ảnh, không ném lỗi', async () => {
      alarmEventRepo.findOne.mockResolvedValue(null);

      const { evidence, updatedAlarm } = await service.uploadEvidence(
        file,
        'G1',
        0.9,
        '2026-01-01T00:00:00.000Z',
        'EVT-UNKNOWN',
      );

      expect(evidence).toBeTruthy();
      expect(updatedAlarm).toBeNull();
    });

    it('không truyền eventId thì không tra cứu cảnh báo', async () => {
      await service.uploadEvidence(file, 'G1', 0.9, '2026-01-01T00:00:00.000Z');
      expect(alarmEventRepo.findOne).not.toHaveBeenCalled();
    });

    it('lỗi khi ghép cảnh báo không làm hỏng việc lưu ảnh', async () => {
      alarmEventRepo.findOne.mockRejectedValue(new Error('DB down'));

      await expect(
        service.uploadEvidence(file, 'G1', 0.9, '2026-01-01T00:00:00.000Z', 'EVT-1'),
      ).resolves.toMatchObject({ updatedAlarm: null });
    });
  });

  describe('uploadEvidence — truy vết đập và node', () => {
    it('suy ra mã đập theo chuỗi gateway → trạm → đập', async () => {
      gatewayRepo.findOne.mockResolvedValue(
        makeGateway({
          station: makeStation({ dam: makeDam({ damId: 'DAM-003' }) }),
          nodes: [],
        }),
      );

      await service.uploadEvidence(file, 'GTW-ST03-TX2A', 0.9, '2026-01-01T00:00:00.000Z');

      expect(gatewayRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { gatewayId: 'GTW-ST03-TX2A' } }),
      );
    });

    it('không truyền nodeId thì lấy node đầu tiên của gateway', async () => {
      gatewayRepo.findOne.mockResolvedValue(
        makeGateway({
          station: makeStation({ dam: makeDam() }),
          nodes: [makeNode({ nodeId: 'NOD-GW01-ESP07', vibrationThreshold: 18 })],
        }),
      );

      await expect(
        service.uploadEvidence(file, 'GTW-ST01-TX2A', 0.9, '2026-01-01T00:00:00.000Z'),
      ).resolves.toBeTruthy();
    });

    it('lỗi tra cứu gateway không làm hỏng luồng tải ảnh', async () => {
      gatewayRepo.findOne.mockRejectedValue(new Error('DB down'));

      await expect(
        service.uploadEvidence(file, 'G1', 0.9, '2026-01-01T00:00:00.000Z'),
      ).resolves.toBeTruthy();
    });
  });

  // ⚠️ PHÁT HIỆN: lỗi tải lên MinIO chỉ được ghi console.error, bản ghi vẫn vào DB
  // với imageUrl trỏ tới đối tượng không tồn tại — frontend sẽ hiện ảnh vỡ.
  describe('xử lý khi MinIO sự cố', () => {
    it('putObject thất bại nhưng bản ghi vẫn được lưu (sinh imageUrl mồ côi)', async () => {
      minioClientMock.putObject.mockRejectedValue(new Error('MinIO down'));

      const { evidence } = await service.uploadEvidence(
        file,
        'G1',
        0.9,
        '2026-01-01T00:00:00.000Z',
      );

      expect(evidence).toBeTruthy();
      expect(evidenceRepo.save).toHaveBeenCalled();
    });

    it('lỗi kiểm tra bucket cũng bị nuốt', async () => {
      minioClientMock.bucketExists.mockRejectedValue(new Error('MinIO down'));

      await expect(
        service.uploadEvidence(file, 'G1', 0.9, '2026-01-01T00:00:00.000Z'),
      ).resolves.toBeTruthy();
    });
  });

  describe('findAll', () => {
    it('giới hạn mặc định 50 bản ghi, mới nhất trước', async () => {
      const qb = createMockQueryBuilder();
      evidenceRepo.createQueryBuilder.mockReturnValue(qb);

      await service.findAll();

      expect(qb.take).toHaveBeenCalledWith(50);
      expect(qb.orderBy).toHaveBeenCalledWith('e.createdAt', 'DESC');
    });

    it('lọc theo gateway khi được yêu cầu', async () => {
      const qb = createMockQueryBuilder();
      evidenceRepo.createQueryBuilder.mockReturnValue(qb);

      await service.findAll('GTW-ST01-TX2A');

      expect(qb.andWhere).toHaveBeenCalledWith('e.gatewayId = :gatewayId', {
        gatewayId: 'GTW-ST01-TX2A',
      });
    });
  });
});
