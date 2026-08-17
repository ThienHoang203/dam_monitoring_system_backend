import { ForbiddenException } from '@nestjs/common';
import { GatewayController } from './gateway.controller';
import { makeAdmin, makeDam, makeGateway, makeOperator, makeStation } from '../../test/helpers/factories';

describe('GatewayController — phân quyền theo đập', () => {
  let gatewayService: any;
  let controller: GatewayController;

  const damA = makeDam({ damId: 'DAM-001' });
  const damB = makeDam({ damId: 'DAM-002' });
  const stationOfA = makeStation({ stationId: 'STA-001-01', dam: damA });
  const stationOfB = makeStation({ stationId: 'STA-002-01', dam: damB });

  beforeEach(() => {
    gatewayService = {
      findAll: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue(makeGateway({ station: stationOfA })),
      resolveStation: jest.fn().mockResolvedValue(stationOfA),
      create: jest.fn().mockResolvedValue(makeGateway()),
      update: jest.fn().mockResolvedValue({ gateway: makeGateway() }),
      delete: jest.fn().mockResolvedValue({ ok: true }),
      getGatewayConfig: jest.fn().mockResolvedValue({ nodes: {}, cameras: {} }),
      validateGatewayApiKey: jest.fn(),
    };
    controller = new GatewayController(gatewayService);
  });

  describe('GET /api/gateways', () => {
    it('OPERATOR bị ép về đập của mình dù query hỏi đập khác', async () => {
      await controller.findAll(undefined, 'DAM-002', makeOperator('DAM-001'));
      expect(gatewayService.findAll).toHaveBeenCalledWith(undefined, 'DAM-001');
    });

    it('ADMIN dùng đúng damId trong query', async () => {
      await controller.findAll(undefined, 'DAM-002', makeAdmin());
      expect(gatewayService.findAll).toHaveBeenCalledWith(undefined, 'DAM-002');
    });

    it('OPERATOR chưa gán đập thì không bị lọc', async () => {
      await controller.findAll(undefined, 'DAM-002', makeOperator(null as any));
      expect(gatewayService.findAll).toHaveBeenCalledWith(undefined, 'DAM-002');
    });
  });

  describe('GET /api/gateways/:id', () => {
    // ⚠️ LỖ HỔNG: findAll/create/update/delete đều kiểm assignedDamId, riêng findById
    // thì KHÔNG. OPERATOR biết mã gateway là đọc được cấu hình gateway của đập khác.
    // Test khẳng định hành vi hiện tại — khi vá xong, test này sẽ đỏ và cần đảo lại.
    it('LỖ HỔNG: OPERATOR đọc được gateway của đập khác', async () => {
      gatewayService.findById.mockResolvedValue(makeGateway({ station: stationOfB }));

      await expect(
        controller.findById('GTW-ST02-TX2A'),
      ).resolves.toHaveProperty('gateway');
    });
  });

  describe('POST /api/gateways', () => {
    it('OPERATOR tạo gateway cho trạm thuộc đập khác → Forbidden', async () => {
      gatewayService.resolveStation.mockResolvedValue(stationOfB);

      await expect(
        controller.create({ stationId: 'STA-002-01' } as any, makeOperator('DAM-001')),
      ).rejects.toThrow('Bạn không có quyền tạo Gateway cho đập khác');
      expect(gatewayService.create).not.toHaveBeenCalled();
    });

    it('OPERATOR tạo gateway trong đập của mình → cho phép', async () => {
      await expect(
        controller.create({ stationId: 'STA-001-01' } as any, makeOperator('DAM-001')),
      ).resolves.toBeDefined();
    });

    it('ADMIN tạo được ở mọi đập, không cần tra trạm để kiểm quyền', async () => {
      await controller.create({ stationId: 'STA-002-01' } as any, makeAdmin());
      expect(gatewayService.resolveStation).not.toHaveBeenCalled();
    });
  });

  describe('PUT /api/gateways/:id', () => {
    it('OPERATOR sửa gateway của đập khác → Forbidden', async () => {
      gatewayService.findById.mockResolvedValue(makeGateway({ station: stationOfB }));

      await expect(
        controller.update('GTW-ST02-TX2A', {} as any, makeOperator('DAM-001')),
      ).rejects.toThrow(ForbiddenException);
    });

    // Chặn cả đường "lách": gateway đang thuộc đập của mình nhưng bị chuyển sang đập khác.
    it('OPERATOR chuyển gateway sang đập khác → Forbidden', async () => {
      gatewayService.findById.mockResolvedValue(makeGateway({ station: stationOfA }));
      gatewayService.resolveStation.mockResolvedValue(stationOfB);

      await expect(
        controller.update('GTW-ST01-TX2A', { stationId: 'STA-002-01' } as any, makeOperator('DAM-001')),
      ).rejects.toThrow('Bạn không thể chuyển Gateway sang đập khác');
    });

    it('OPERATOR sửa gateway trong đập của mình → cho phép', async () => {
      await expect(
        controller.update('GTW-ST01-TX2A', { name: 'Tên mới' } as any, makeOperator('DAM-001')),
      ).resolves.toBeDefined();
    });
  });

  describe('DELETE /api/gateways/:id', () => {
    it('OPERATOR xoá gateway của đập khác → Forbidden', async () => {
      gatewayService.findById.mockResolvedValue(makeGateway({ station: stationOfB }));

      await expect(
        controller.delete('GTW-ST02-TX2A', makeOperator('DAM-001')),
      ).rejects.toThrow(ForbiddenException);
      expect(gatewayService.delete).not.toHaveBeenCalled();
    });

    it('ADMIN xoá được gateway ở mọi đập', async () => {
      gatewayService.findById.mockResolvedValue(makeGateway({ station: stationOfB }));

      await expect(controller.delete('GTW-ST02-TX2A', makeAdmin())).resolves.toEqual({ ok: true });
    });
  });
});
