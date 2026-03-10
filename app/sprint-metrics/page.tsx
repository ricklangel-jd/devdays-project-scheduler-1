'use client';

import { Suspense } from 'react';
import SprintMetricsContent from './SprintMetricsContent';

const SprintMetricsPage = () => {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
      <SprintMetricsContent />
    </Suspense>
  );
};

export default SprintMetricsPage;
