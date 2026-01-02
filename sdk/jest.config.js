/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: {
          target: "es2020",
          module: "commonjs",
          esModuleInterop: true,
          strict: true,
          resolveJsonModule: true,
          experimentalDecorators: true
        }
      }
    ]
  },
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/__tests__/**",
    "!src/**/*.d.ts",
    "!src/idl/**"
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  verbose: true,
  testTimeout: 30000
};
