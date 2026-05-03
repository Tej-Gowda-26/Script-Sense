@echo off
echo ============================================
echo   ScriptSense - One-Time Setup
echo ============================================
echo.

:: Get the directory where this script lives
set ROOT=%~dp0

:: Backend (Python) 
echo [1/3] Setting up Backend...
cd /d "%ROOT%Backend"

:: Create virtual environment if it doesn't exist
if not exist "venv" (
    echo       Creating virtual environment...
    python -m venv venv
)

:: Activate venv and install dependencies
call venv\Scripts\activate
echo       Installing Python dependencies...
pip install -r requirements.txt
if %ERRORLEVEL% neq 0 (
    echo ERROR: Backend install failed.
    pause
    exit /b 1
)
echo       Backend done.
echo.

:: Teacher Frontend (Node) 
echo [2/3] Installing Teacher Frontend dependencies...
cd /d "%ROOT%Frontend\TeacherFrontend"
call npm install
if %ERRORLEVEL% neq 0 (
    echo ERROR: Teacher Frontend install failed.
    pause
    exit /b 1
)
echo       Teacher Frontend done.
echo.

:: Student Frontend (Node)
echo [3/3] Installing Student Frontend dependencies...
cd /d "%ROOT%Frontend\StudentFrontend"
call npm install
if %ERRORLEVEL% neq 0 (
    echo ERROR: Student Frontend install failed.
    pause
    exit /b 1
)
echo       Student Frontend done.
echo.

echo ============================================
echo   All dependencies installed successfully!
echo ============================================
echo.