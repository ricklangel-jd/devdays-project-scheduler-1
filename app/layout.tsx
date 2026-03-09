import type { Metadata } from 'next';
import { ThemeRegistry } from '@/frontend/theme';
import './globals.css';

export const metadata: Metadata = {
  title: 'DevDays GaNTT Chart',
  description: 'JIRA-powered GANTT chart for project estimation',
};

const RootLayout = ({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) => {
  return (
    <html lang="en">
      <body>
        <ThemeRegistry>
          {children}
        </ThemeRegistry>
      </body>
    </html>
  );
};

export default RootLayout;
