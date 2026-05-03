import React from 'react';
import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';

const Layout: React.FC = () => {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Navbar />
      <main className="flex-grow">
        <div className="page-container">
          <Outlet />
        </div>
      </main>
      <footer className="bg-slate-800 text-slate-400 py-4">
        <div className="container mx-auto px-4 text-center text-sm">
          <p>© 2026 ScriptSense. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default Layout;