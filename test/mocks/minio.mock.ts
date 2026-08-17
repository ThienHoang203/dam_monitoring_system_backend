/**
 * Mock cho package `minio`.
 *
 * EvidenceService khởi tạo `new Minio.Client(...)` trong onModuleInit, không qua DI.
 */

export const minioClientMock = {
  bucketExists: jest.fn().mockResolvedValue(true),
  makeBucket: jest.fn().mockResolvedValue(undefined),
  setBucketPolicy: jest.fn().mockResolvedValue(undefined),
  putObject: jest.fn().mockResolvedValue({ etag: 'test-etag', versionId: null }),
  getObject: jest.fn(),
  removeObject: jest.fn().mockResolvedValue(undefined),
  presignedGetObject: jest.fn().mockResolvedValue('http://minio.test/presigned-url'),
};

export const MinioClientCtorMock = jest.fn().mockImplementation(() => minioClientMock);

export const minioModuleMock = {
  Client: MinioClientCtorMock,
};

export function resetMinioMock(): void {
  MinioClientCtorMock.mockClear();
  minioClientMock.bucketExists.mockClear().mockResolvedValue(true);
  minioClientMock.makeBucket.mockClear().mockResolvedValue(undefined);
  minioClientMock.setBucketPolicy.mockClear().mockResolvedValue(undefined);
  minioClientMock.putObject.mockClear().mockResolvedValue({ etag: 'test-etag', versionId: null });
}
