import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Component suites render into a shared document; leaving one mounted makes
// the next suite's queries ambiguous in ways that look like real failures.
afterEach(cleanup);
