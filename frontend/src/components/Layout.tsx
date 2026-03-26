import React from 'react';
import Sidebar from './Sidebar';
import Header from './Header';

const Layout = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-background p-4 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
};

export default Layout;
