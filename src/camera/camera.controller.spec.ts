import { CameraController } from './camera.controller';
import { makeCamera, makeGateway, makeOperator, makeStation, makeDam } from '../../test/helpers/factories';

/**
 * ⚠️ CameraController KHÔNG có bất kỳ kiểm tra assignedDamId nào — khác hẳn
 * DamController / GatewayController / NodeController. Mọi method chỉ dựa vào
 * @Roles('ADMIN','OPERATOR'), nghĩa là OPERATOR của đập A thao tác được trên
 * camera của đập B.
 *
 * Các test dưới đây khẳng định HÀNH VI HIỆN TẠI để lỗ hổng được ghi nhận rõ ràng.
 * Khi vá xong, chúng sẽ đỏ và cần đảo lại thành kiểm tra Forbidden.
 */
describe('CameraController — thiếu phân quyền theo đập', () => {
  let cameraService: any;
  let controller: CameraController;

  const cameraOfDamB = makeCamera({
    cameraId: 'CAM-CSI-ST02-01',
    gateway: makeGateway({ station: makeStation({ dam: makeDam({ damId: 'DAM-002' }) }) }),
  });

  const operatorOfDamA = makeOperator('DAM-001');

  beforeEach(() => {
    cameraService = {
      findAll: jest.fn().mockResolvedValue([cameraOfDamB]),
      findById: jest.fn().mockResolvedValue(cameraOfDamB),
      create: jest.fn().mockResolvedValue(cameraOfDamB),
      update: jest.fn().mockResolvedValue(cameraOfDamB),
      delete: jest.fn().mockResolvedValue({ ok: true }),
    };
    controller = new CameraController(cameraService);
  });

  it('LỖ HỔNG: danh sách camera không lọc theo đập của người dùng', async () => {
    const { cameras } = await controller.findAll();
    expect(cameras).toContain(cameraOfDamB);
    // Không có tham số @CurrentUser nào để lọc — service nhận đúng query thô.
    expect(cameraService.findAll).toHaveBeenCalledWith(undefined);
  });

  it('LỖ HỔNG: đọc được camera của đập khác', async () => {
    await expect(controller.findById('CAM-CSI-ST02-01')).resolves.toBeDefined();
  });

  it('LỖ HỔNG: sửa được camera của đập khác', async () => {
    await expect(
      controller.update('CAM-CSI-ST02-01', { name: 'Đổi tên' } as any),
    ).resolves.toBeDefined();
  });

  it('LỖ HỔNG: xoá được camera của đập khác', async () => {
    await expect(controller.delete('CAM-CSI-ST02-01')).resolves.toEqual({ ok: true });
  });

  it('LỖ HỔNG: tạo camera cho gateway thuộc đập khác', async () => {
    await expect(
      controller.create({ gatewayId: 'GTW-ST02-TX2A', cameraType: 'CSI', name: 'C' } as any),
    ).resolves.toBeDefined();
  });

  it('không method nào nhận tham số người dùng để kiểm quyền', () => {
    // Chữ ký hàm là bằng chứng trực tiếp: 0 hoặc 1 tham số, không có @CurrentUser.
    expect(controller.findAll.length).toBeLessThanOrEqual(1);
    expect(controller.findById.length).toBe(1);
    expect(controller.delete.length).toBe(1);
  });

  it('VIEWER bị chặn ở tầng RolesGuard, không phải ở controller', async () => {
    // Controller không tự kiểm role — bảo vệ hoàn toàn dựa vào @Roles + RolesGuard.
    // Test này ghi nhận ranh giới trách nhiệm đó (xem roles.guard.spec.ts).
    await expect(controller.findAll()).resolves.toBeDefined();
  });
});
