/**
 * Cấu hình Jest cho UNIT TEST (*.spec.ts trong src/).
 * Integration test: test/jest-integration.json — E2E: test/jest-e2e.json
 */
module.exports = {
  rootDir: '.',
  roots: ['<rootDir>/src'],
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/test/setup-unit.ts'],

  // Chỉ đo coverage trên code có logic. Entity/DTO/module chỉ là khai báo,
  // gộp vào sẽ pha loãng con số và che mất vùng thực sự chưa được test.
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.entity.ts',
    '!src/**/*.dto.ts',
    '!src/**/*.module.ts',
    '!src/**/*.spec.ts',
    '!src/main.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary', 'json-summary', 'lcov'],

  // Unit test không được chạm hạ tầng thật -> phải nhanh.
  testTimeout: 10000,
  clearMocks: true,
  restoreMocks: true,
};
