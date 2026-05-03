import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GraduationCap, Menu, X, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const Navbar: React.FC = () => {
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);
  const { logout, usn } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <nav className="bg-slate-800 text-white">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="flex justify-between items-center h-14">
          {/* Brand */}
          <Link to="/dashboard" className="flex items-center gap-2">
            <GraduationCap size={24} className="text-blue-400" />
            <span className="text-lg font-bold tracking-tight">ScriptSense</span>
          </Link>

          {/* Desktop menu */}
          <div className="hidden md:flex items-center gap-2">
            <Link
              to="/dashboard"
              className="px-3 py-1.5 rounded-md text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-700/50 transition-colors"
            >
              Dashboard
            </Link>
            <div className="flex items-center gap-5 ml-1 pl-3 border-l border-slate-600">
              <span className="text-sm text-slate-400">{usn}</span>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 text-sm font-medium text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded-md transition-colors"
              >
                <LogOut size={14} />
                Logout
              </button>
            </div>
          </div>

          {/* Mobile menu button */}
          <button
            className="md:hidden text-slate-300 hover:text-white"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            {isMenuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {isMenuOpen && (
        <div className="md:hidden border-t border-slate-700 bg-slate-800 pb-3 px-4">
          <Link
            to="/dashboard"
            className="block px-3 py-2 rounded-md text-sm font-medium text-slate-300 hover:bg-slate-700/50 mt-1"
            onClick={() => setIsMenuOpen(false)}
          >
            Dashboard
          </Link>
          <div className="mt-2 pt-2 border-t border-slate-700">
            <p className="text-sm text-slate-400 px-3 mb-2">{usn}</p>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm font-medium text-slate-300 hover:bg-slate-700/50"
            >
              <LogOut size={14} />
              Logout
            </button>
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;