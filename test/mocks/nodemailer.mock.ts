/**
 * Mock cho package `nodemailer`.
 *
 * AuthService.sendApprovalEmail và SensorService.sendEmailAlert đều gọi
 * `nodemailer.createTransport()` ngay trong thân method, nên chỉ mock được ở cấp module.
 */

export const sendMailMock = jest.fn().mockResolvedValue({
  messageId: 'test-message-id',
  accepted: ['test@example.test'],
});

export const transportMock = {
  sendMail: sendMailMock,
  verify: jest.fn().mockResolvedValue(true),
  close: jest.fn(),
};

export const nodemailerModuleMock = {
  createTransport: jest.fn(() => transportMock),
};

export function resetNodemailerMock(): void {
  sendMailMock.mockClear();
  sendMailMock.mockResolvedValue({ messageId: 'test-message-id', accepted: ['test@example.test'] });
  nodemailerModuleMock.createTransport.mockClear();
}

/** Nội dung email cuối cùng được gửi (hoặc null nếu chưa gửi lần nào). */
export function lastSentMail(): any | null {
  const calls = sendMailMock.mock.calls;
  return calls.length ? calls[calls.length - 1][0] : null;
}
