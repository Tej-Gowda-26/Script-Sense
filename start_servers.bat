@echo off
echo ============================================
echo   ScriptSense - Starting All Servers
echo ============================================
echo.

set ROOT=%~dp0

:: Start Django backend in a new window (with venv activated)
echo Starting Backend (Django) on http://127.0.0.1:8000 ...
start "ScriptSense Backend" cmd /k "cd /d %ROOT%Backend && call venv\Scripts\activate && python manage.py runserver"

:: Start Teacher Frontend in a new window
echo Starting Teacher Frontend on http://localhost:5173 ...
start "ScriptSense Teacher" cmd /k "cd /d %ROOT%Frontend\TeacherFrontend && npm run dev"

:: Start Student Frontend in a new window
echo Starting Student Frontend on http://localhost:5174 ...
start "ScriptSense Student" cmd /k "cd /d %ROOT%Frontend\StudentFrontend && npm run dev"

echo.
echo ============================================
echo   All servers started in separate windows!
echo ============================================
echo.
echo   Backend:          http://127.0.0.1:8000
echo   Teacher Frontend: http://localhost:5173
echo   Student Frontend: http://localhost:5174
echo.
echo Close this window anytime. Server windows run independently.
pause
