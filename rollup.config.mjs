import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import terser from '@rollup/plugin-terser';

export default {
  input: 'src/awsSecretsManagerCache.ts', // Adjust if your entry file is different
  output: [
    {
      file: 'dist/index.cjs.js',
      format: 'cjs',
      sourcemap: true,
      exports: 'auto',
    },
    {
      file: 'dist/index.esm.js',
      format: 'esm',
      sourcemap: true,
    },
  ],
  plugins: [
    nodeResolve(), // Resolves node_modules dependencies
    commonjs(), // Converts CommonJS modules to ESM
    json(), // Handles JSON imports (useful for AWS SDK)
    typescript({
      tsconfig: './tsconfig.json',
      declaration: true,
      declarationDir: 'dist/types',
      sourceMap: true,
    }),
    terser(), // Minifies the output for smaller bundle size
  ],
  external: [
    '@aws-sdk/client-secrets-manager',
    'zod',
    'events',
  ], // Externalize dependencies
};