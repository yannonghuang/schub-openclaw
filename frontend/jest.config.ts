import type { Config } from "jest";

const config: Config = {
  testEnvironment: "jsdom",
  testEnvironmentOptions: {
    customExportConditions: ["node", "node-addons"],
  },
  setupFiles: ["<rootDir>/jest.polyfills.ts"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  transform: {
    "^.+\\.(ts|tsx|js|mjs)$": ["ts-jest", { tsconfig: { jsx: "react-jsx", allowJs: true }, diagnostics: false }],
  },
  moduleNameMapper: {
    "\\.(css|less|scss|svg|png|jpg)$": "<rootDir>/__mocks__/fileMock.ts",
  },
  transformIgnorePatterns: [
    "node_modules/(?!(msw|@mswjs|until-async)/)",
  ],
  testMatch: ["**/__tests__/**/*.test.{ts,tsx}"],
};

export default config;
