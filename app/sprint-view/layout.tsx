import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'View Sprint',
};

const SprintViewLayout = ({ children }: { children: React.ReactNode }) => {
  return children;
};

export default SprintViewLayout;
