module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  },
  collectCoverageFrom: [
    '../lambda/**/*.{ts,js,py}',
    '!../lambda/**/node_modules/**',
    '!../lambda/**/dist/**',
    '!**/*.d.ts'
  ],
  coverageThresholds: {
    global: {
      statements: 90,
      branches: 85,
      functions: 90,
      lines: 90
    }
  },
  setupFilesAfterEnv: ['<rootDir>/setup.ts'],
  testTimeout: 30000,
  verbose: true,
  maxWorkers: '50%'
};
