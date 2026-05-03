import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GraduationCap, AlertCircle, CheckCircle } from 'lucide-react';
import { authService } from '../services/api';

const Register: React.FC = () => {
  const [usn, setUsn] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();

  const validateForm = () => {
    if (!usn.trim()) { setError('USN is required'); return false; }
    if (!password)   { setError('Password is required'); return false; }
    if (password !== confirmPassword) { setError('Passwords do not match'); return false; }
    // USN format: YY + ET + DD + PPP + RRR  (e.g. 22ETCS018001)
    if (!/^\d{2}ET[A-Z]{2}\d{6}$/.test(usn)) {
      setError('Invalid USN format. Expected Format: Year + ET + Dept + ProgCode + Reg.No');
      return false;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters long');
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
      await authService.register(usn, password);
      setSuccess(true);
      setTimeout(() => navigate('/login'), 2000);
    } catch (err: any) {
      setError(
        err.response?.data?.error ||
        'Registration failed. Please try again later.'
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
          <h1 className="text-2xl font-bold text-gray-900">Create an Account</h1>
          <p className="text-sm text-gray-500 mt-1">Join ScriptSense to track your academic progress</p>
        </div>

        {/* Card */}
        <div className="card p-6">
          {success ? (
            <div className="flex items-center gap-2.5 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-5 text-sm">
              <CheckCircle size={16} className="flex-shrink-0" />
              <p>Registration successful! Redirecting to login...</p>
            </div>
          ) : error ? (
            <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-5 text-sm">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <p>{error}</p>
            </div>
          ) : null}

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
                disabled={isLoading || success}
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
                placeholder="Create a strong password"
                autoComplete="new-password"
                disabled={isLoading || success}
              />
            </div>

            <div className="form-group">
              <label htmlFor="confirmPassword" className="form-label">Confirm Password</label>
              <input
                type="password"
                id="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="input-field"
                placeholder="Confirm your password"
                autoComplete="new-password"
                disabled={isLoading || success}
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary w-full mt-2"
              disabled={isLoading || success}
            >
              {isLoading ? 'Registering...' : 'Register'}
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-gray-500">
            Already have an account?{' '}
            <Link to="/login" className="text-blue-600 hover:underline font-medium">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Register;