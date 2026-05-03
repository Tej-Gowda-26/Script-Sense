import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, FileText, Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { studentService } from '../services/api';

interface Subject {
  subject: string;
  sem: string;
  paperTypes: string[];
}

const Dashboard: React.FC = () => {
  const { usn } = useAuth();
  const navigate = useNavigate();
  const [subjects, setSubjects] = useState<string[]>([]);
  const [subjectsData, setSubjectsData] = useState<Subject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSubjects = async () => {
      if (!usn) return;
      try {
        setIsLoading(true);
        const data = await studentService.getSubjects(usn);
        setSubjects(data.subjects || []);
        setSubjectsData(data.subjectsData || []);
      } catch (err) {
        setError('Failed to load subjects. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };
    fetchSubjects();
  }, [usn]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <Loader2 size={32} className="text-blue-600 animate-spin mb-3" />
        <p className="text-sm text-gray-500">Loading your subjects...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 px-5 py-4 rounded-lg">
          <AlertCircle size={20} />
          <div>
            <p className="font-medium text-sm">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="text-xs underline hover:text-red-900 mt-1"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Page header */}
      <div className="mb-6">
        <h1 className="page-title">My Subjects</h1>
      </div>

      {subjects.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
          <BookOpen size={36} className="mx-auto text-gray-300 mb-3" />
          <h3 className="text-base font-semibold text-gray-600 mb-1">No subjects found</h3>
          <p className="text-sm text-gray-400">You don't have any subjects registered yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {subjects.map((subject, index) => {
            const subjectData = subjectsData.find(s => s.subject === subject) || {
              subject,
              sem: 'Unknown',
              paperTypes: [],
            };

            return (
              <div
                key={index}
                className="card p-5 cursor-pointer hover:border-blue-300 transition-colors duration-150"
                onClick={() => navigate(`/subject/${subject}`)}
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="p-2 bg-blue-50 rounded-lg">
                    <FileText size={20} className="text-blue-600" />
                  </div>
                  {subjectData.sem && subjectData.sem !== 'Unknown' && (
                    <span className="status-badge bg-gray-100 text-gray-600">
                      Sem {subjectData.sem}
                    </span>
                  )}
                </div>

                <h3 className="text-base font-semibold text-gray-900 mb-1">{subject}</h3>
                <p className="text-sm text-gray-500 mb-3">
                  {subjectData.paperTypes.length > 0
                    ? `${subjectData.paperTypes.length} test${subjectData.paperTypes.length !== 1 ? 's' : ''} available`
                    : 'No tests available'}
                </p>

                <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                  <span className="text-xs text-gray-400">
                    {subjectData.paperTypes.join(', ') || '—'}
                  </span>
                  <span className="text-xs font-medium text-blue-600">View →</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Dashboard;