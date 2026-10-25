import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

/** components/bits/** is vendored from the ReactBits registry and kept as published. */
const config = [...nextVitals, ...nextTs, { ignores: ['.next/**', 'node_modules/**', 'playwright-report/**', 'test-results/**', 'components/bits/**'] }];
export default config;
