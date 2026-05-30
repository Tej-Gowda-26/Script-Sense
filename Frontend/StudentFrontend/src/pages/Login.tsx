import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GraduationCap, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { authService } from '../services/api';

const Login: React.FC = () => {
  const [usn, setUsn] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { login } = useAuth();
  const navigate = useNavigate();

  const validateForm = () => {
    if (!usn.trim()) { setError('USN is required'); return false; }
    if (!password)   { setError('Password is required'); return false; }
    // USN format: YY + ET + DD + PPP + RRR  (e.g. 22ETIS411050)
    if (!/^\d{2}ET[A-Z]{2}\d{6}$/.test(usn)) {
      setError('Invalid USN format');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!validateForm()) return;

    setIsLoading(true);
    try {
      await authService.login(usn, password);
      login(usn);
      navigate('/dashboard');
    } catch (err: any) {
      setError(
        err.response?.data?.error ||
        'Login failed. Please check your credentials and try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center">
      <div className="max-w-sm w-full mx-auto px-4">
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-3">
            <GraduationCap size={40} className="text-blue-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Sign in to ScriptSense</h1>
          <p className="text-sm text-gray-500 mt-1">Access your academic performance and feedback</p>
        </div>

        {/* Card */}
        <div className="card p-6">
          {error && (
            <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-5 text-sm">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <p>{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="usn" className="form-label">USN</label>
              <input
                type="text"
                id="usn"
                value={usn}
                onChange={(e) => setUsn(e.target.value.toUpperCase())}
                className="input-field"
                placeholder="e.g. 22ETIS411050"
                autoComplete="username"
                disabled={isLoading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="password" className="form-label">Password</label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-field"
                placeholder="Enter your password"
                autoComplete="current-password"
                disabled={isLoading}
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary w-full mt-2"
              disabled={isLoading}
            >
              {isLoading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-gray-500">
            Don't have an account?{' '}
            <Link to="/register" className="text-blue-600 hover:underline font-medium">
              Register
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;