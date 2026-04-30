# ScriptSense

# 1. Backend (Django)

## Navigate to backend
cd Backend

## Create & activate virtual environment (one-time)
python -m venv venv
venv\Scripts\activate

## Install dependencies (one-time)
pip install -r requirements.txt

## Run the server
python manage.py runserver

# 2. Teacher Frontend

## In a new terminal
cd Frontend/TeacherFrontend

## Install dependencies (one-time)
npm install

## Run dev server
npm run dev

# 3. Student Frontend

## In a new terminal
cd Frontend/StudentFrontend

## Install dependencies (one-time)
npm install

## Run dev server
npm run dev