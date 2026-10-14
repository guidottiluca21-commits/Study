import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/live/**/*.live.ts'], testTimeout: 60_000, fileParallelism: false } });
