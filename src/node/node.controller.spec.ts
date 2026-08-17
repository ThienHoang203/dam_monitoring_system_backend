import { ForbiddenException } from '@nestjs/common';
import { NodeController } from './node.controller';
import { makeAdmin, makeDam, makeGateway, makeNode, makeOperator, makeStation } from '../../test/helpers/factories';

/**
 * NodeController có 7 chỗ kiểm tra assignedDamId viết tay. Mỗi chỗ là một cơ hội
 * rò rỉ độc lập, nên mỗi chỗ cần một cặp test cho phép/từ chối.
 */
describe('NodeController — phân quyền theo đập', () => {
  let nodeService: any;
  let controller: NodeController;

  const nodeOfDamA = makeNode({
    nodeId: 'NOD-GW01-ESP01',
    gateway: makeGateway({ station: makeStation({ dam: makeDam({ damId: 'DAM-001' }) }) }),
  });
  const nodeOfDamB = makeNode({
    nodeId: 'NOD-GW02-ESP01',
    gateway: makeGateway({ station: makeStation({ dam: makeDam({ damId: 'DAM-002' }) }) }),
  });

  beforeEach(() => {
    nodeService = {
      findAll: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue(nodeOfDamA),
      create: jest.fn().mockResolvedValue({ node: nodeOfDamA }),
      update: jest.fn().mockResolvedValue({ node: nodeOfDamA }),
      delete: jest.fn().mockResolvedValue({ ok: true }),
      mapCamera: jest.fn().mockResolvedValue(nodeOfDamA),
      findSensorsByNode: jest.fn().mockResolvedValue([]),
      addSensor: jest.fn().mockResolvedValue({}),
      updateSensor: jest.fn().mockResolvedValue({}),
      removeSensor: jest.fn().mockResolvedValue({ ok: true }),
    };
    controller = new NodeController(nodeService);
  });

  // Trường ảo damId nằm sâu ở node.gateway.station.damId — @AfterLoad chỉ điền khi
  // toàn bộ chuỗi quan hệ đã được load.
  const denied = (fn: () => Promise<unknown>) => expect(fn()).rejects.toThrow(ForbiddenException);

  describe('GET /api/nodes', () => {
    it('OPERATOR bị ép về đập của mình dù query hỏi đập khác', async () => {
      await controller.findAll(undefined, undefined, 'DAM-002', makeOperator('DAM-001'));
      expect(nodeService.findAll).toHaveBeenCalledWith(undefined, undefined, 'DAM-001');
    });

    it('ADMIN dùng đúng damId trong query', async () => {
      await controller.findAll(undefined, undefined, 'DAM-002', makeAdmin());
      expect(nodeService.findAll).toHaveBeenCalledWith(undefined, undefined, 'DAM-002');
    });
  });

  describe('GET /api/nodes/:id', () => {
    it('OPERATOR xem node của đập khác → Forbidden', async () => {
      nodeService.findById.mockResolvedValue(nodeOfDamB);
      await denied(() => controller.findById('NOD-GW02-ESP01', makeOperator('DAM-001')));
    });

    it('OPERATOR xem node trong đập của mình → cho phép', async () => {
      await expect(
        controller.findById('NOD-GW01-ESP01', makeOperator('DAM-001')),
      ).resolves.toBeDefined();
    });

    it('khách vãng lai xem được (endpoint công khai)', async () => {
      nodeService.findById.mockResolvedValue(nodeOfDamB);
      await expect(controller.findById('NOD-GW02-ESP01', undefined)).resolves.toBeDefined();
    });
  });

  describe('PUT /api/nodes/:id', () => {
    it('OPERATOR sửa node của đập khác → Forbidden', async () => {
      nodeService.findById.mockResolvedValue(nodeOfDamB);
      await denied(() => controller.update('NOD-GW02-ESP01', {} as any, makeOperator('DAM-001')));
      expect(nodeService.update).not.toHaveBeenCalled();
    });

    it('ADMIN sửa được node ở mọi đập', async () => {
      nodeService.findById.mockResolvedValue(nodeOfDamB);
      await expect(
        controller.update('NOD-GW02-ESP01', {} as any, makeAdmin()),
      ).resolves.toBeDefined();
    });
  });

  describe('DELETE /api/nodes/:id', () => {
    it('OPERATOR xoá node của đập khác → Forbidden', async () => {
      nodeService.findById.mockResolvedValue(nodeOfDamB);
      await denied(() => controller.delete('NOD-GW02-ESP01', makeOperator('DAM-001')));
      expect(nodeService.delete).not.toHaveBeenCalled();
    });
  });

  describe('PUT /api/nodes/:id/map-camera', () => {
    it('OPERATOR gán camera cho node của đập khác → Forbidden', async () => {
      nodeService.findById.mockResolvedValue(nodeOfDamB);
      await denied(() =>
        controller.mapCamera('NOD-GW02-ESP01', { cameraId: 'CAM-CSI-ST02-01' } as any, makeOperator('DAM-001')),
      );
      expect(nodeService.mapCamera).not.toHaveBeenCalled();
    });
  });

  describe('CRUD cảm biến của node', () => {
    it('OPERATOR thêm cảm biến vào node của đập khác → Forbidden', async () => {
      nodeService.findById.mockResolvedValue(nodeOfDamB);
      await denied(() =>
        controller.addSensor('NOD-GW02-ESP01', { sensorType: 'VIB' } as any, makeOperator('DAM-001')),
      );
    });

    it('OPERATOR sửa cảm biến của đập khác → Forbidden', async () => {
      nodeService.findById.mockResolvedValue(nodeOfDamB);
      await denied(() =>
        controller.updateSensor('NOD-GW02-ESP01', 'SNR-VIB-ESP01-I2C1', {} as any, makeOperator('DAM-001')),
      );
    });

    it('OPERATOR xoá cảm biến của đập khác → Forbidden', async () => {
      nodeService.findById.mockResolvedValue(nodeOfDamB);
      await denied(() =>
        controller.removeSensor('NOD-GW02-ESP01', 'SNR-VIB-ESP01-I2C1', makeOperator('DAM-001')),
      );
    });

    // ⚠️ LỖ HỔNG: findSensors là method DUY NHẤT trong controller này không nhận
    // @CurrentUser và không kiểm assignedDamId — OPERATOR liệt kê được cảm biến
    // của node thuộc đập khác.
    it('LỖ HỔNG: liệt kê cảm biến KHÔNG kiểm tra quyền theo đập', async () => {
      await expect(controller.findSensors('NOD-GW02-ESP01')).resolves.toBeDefined();
      expect(nodeService.findSensorsByNode).toHaveBeenCalledWith('NOD-GW02-ESP01');
    });
  });
});
