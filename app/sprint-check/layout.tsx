import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sprint Check',
};

const SprintCheckLayout = ({ children }: { children: React.ReactNode }) => {
  return children;
};

export default SprintCheckLayout;
