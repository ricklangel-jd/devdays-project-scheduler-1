import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'PI Status',
};

const PiStatusLayout = ({ children }: { children: React.ReactNode }) => {
  return children;
};

export default PiStatusLayout;
