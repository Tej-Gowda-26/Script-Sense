# ScriptSense 📝

> **AI-powered automated grading system for student answer sheets.**  
> Upload a question paper, let students submit handwritten or typed answers, and get instant AI-evaluated feedback — all in one unified platform.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Tech Stack](#tech-stack)
4. [Project Structure](#project-structure)
5. [Prerequisites](#prerequisites)
6. [Environment Variables](#environment-variables)
7. [Installation & Setup](#installation--setup)
8. [Running the Application](#running-the-application)
9. [API Reference](#api-reference)
10. [Backend Modules](#backend-modules)
11. [Frontend Apps](#frontend-apps)
12. [Contributing](#contributing)

---

## Overview

ScriptSense automates the traditionally manual process of grading student answer sheets. The system consists of three main services:

| Service | Role | Port |
|---|---|---|
| **Django Backend** | Core AI grading engine, REST API | `8000` |
| **Teacher Frontend** | Upload question papers, review results | `5173` |
| **Student Frontend** | Submit answers, view feedback | `5174` |

**Key capabilities:**
- 📄 **Question Paper Upload** — Teachers upload question papers (PDF or image) which are parsed and indexed for grading.
- 🖼️ **Image-to-Text OCR** — Converts handwritten/scanned student answer sheets into machine-readable text using Groq's vision model.
- 🤖 **AI Grading** — Evaluates extracted answers against model answers using a RAG (Retrieval-Augmented Generation) pipeline powered by Groq LLMs.
- 💬 **Student Feedback** — Generates detailed, subject-specific feedback and stores results in MongoDB.

---

## Architecture

![ScriptSense System Architecture](ScriptSense_System_Architecture.png)

---

## Tech Stack

### Backend
| Technology | Version | Purpose |
|---|---|---|
| Python | 3.10+ | Runtime |
| Django | ≥ 5.1.4 | Web framework & REST API |
| django-cors-headers | ≥ 4.3.1 | Cross-origin request support |
| python-dotenv | ≥ 1.0.1 | Environment variable loading |
| pymongo | ≥ 4.6.1 | MongoDB driver |
| groq | ≥ 0.7.0 | Groq LLM & vision API |
| requests | ≥ 2.31.0 | Internal HTTP calls |
| bcrypt | ≥ 4.1.2 | Password hashing |
| sentence-transformers | ≥ 2.6.1 | Text embeddings for RAG |
| faiss-cpu | ≥ 1.8.0 | Vector similarity search |
| numpy | ≥ 1.26.4 | Numerical operations |
| PyPDF2 | ≥ 3.0.1 | PDF parsing |

### Frontend (Both Apps)
| Technology | Version | Purpose |
|---|---|---|
| React | 18.x | UI library |
| TypeScript | 5.x | Type safety |
| Vite | 7.x | Build tool & dev server |
| Tailwind CSS | 3.x | Utility-first styling |
| React Router DOM | 6–7.x | Client-side routing |
| Lucide React | 0.344.x | Icon library |
| Axios | 1.x | HTTP client (Student app) |

---

## Project Structure

```
Script-Sense/
├── .env                        # Real secrets (git-ignored)
├── .env.example                # Template — copy this to .env
├── .gitignore
├── setup.bat                   # One-time dependency installer (Windows)
├── start_servers.bat           # Launches all three servers (Windows)
├── README.md
│
├── Backend/
│   ├── manage.py
│   ├── requirements.txt
│   ├── db.sqlite3              # SQLite DB (Django auth/admin)
│   ├── Grader/                 # Django project settings
│   │   ├── settings.py
│   │   ├── urls.py             # Root URL configuration
│   │   ├── wsgi.py
│   │   └── asgi.py
│   ├── Evaluate/               # AI grading logic
│   ├── ImagetoText/            # OCR (image → text via Groq vision)
│   ├── RagPipe/                # RAG pipeline (embeddings + FAISS)
│   ├── Student/                # Student feedback storage & retrieval
│   ├── UploadQP/               # Question paper upload & processing
│   ├── Textbooks/              # Reference material storage
│   └── venv/                   # Python virtual environment (git-ignored)
│
└── Frontend/
    ├── TeacherFrontend/        # Teacher-facing React app (port 5173)
    │   ├── src/
    │   ├── vite.config.ts
    │   └── package.json
    └── StudentFrontend/        # Student-facing React app (port 5174)
        ├── src/
        ├── vite.config.ts
        └── package.json
```

---

## Prerequisites

Before you begin, ensure the following are installed on your system:

| Requirement | Minimum Version | Notes |
|---|---|---|
| **Python** | 3.10+ | [python.org](https://www.python.org/downloads/) |
| **Node.js** | v18+ | [nodejs.org](https://nodejs.org/) — includes `npm` |
| **MongoDB** | 6.0+ | Running locally on `mongodb://localhost:27017` — [mongodb.com](https://www.mongodb.com/try/download/community) |
| **Groq API Key** | — | Free at [console.groq.com](https://console.groq.com) |

> **Windows note:** The provided `.bat` scripts require **CMD / PowerShell on Windows**. For Linux/macOS, the same steps can be run manually (see below).

---

## Environment Variables

All configuration lives in a single `.env` file at the project root.

### Setup

```bash
# Copy the example file
copy .env.example .env     # Windows
cp .env.example .env       # Linux / macOS
```

Then open `.env` and fill in your values.

### Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `SECRET_KEY` | ✅ Yes | — | Django secret key for cryptographic signing. Generate with: `python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"` |
| `DEBUG` | No | `True` | Set to `False` in production to disable debug pages |
| `GROQ_API_KEY` | ✅ Yes | — | Your Groq API key — used by the Django backend for OCR and grading. Get one free at [console.groq.com](https://console.groq.com) |
| `VITE_GROQ_API_KEY` | ✅ Yes | — | Same Groq key exposed to the Teacher Vite frontend. Must be prefixed with `VITE_` for Vite to bundle it |
| `MONGO_URI` | No | `mongodb://localhost:27017` | MongoDB connection string. For Atlas: `mongodb+srv://<user>:<pass>@cluster.mongodb.net/<db>` |
| `OTHER_DJANGO_APP_URL` | No | `http://127.0.0.1:8000/evaluate/script/` | Internal URL for the evaluate endpoint. Only change if Django runs on a different port |
| `OTHER_APP_URL` | No | `http://127.0.0.1:8000/student/feedback/` | Internal URL for the student feedback endpoint. Only change if Django runs on a different port |

> ⚠️ **Security**: Never commit your real `.env` file. It is listed in `.gitignore`. Only commit `.env.example`.

---

## Installation & Setup

### Quick Setup (Windows)

```bat
git clone https://github.com/Tej-Gowda-26/Script-Sense.git
cd Script-Sense
copy .env.example .env
```

Edit `.env` with your `GROQ_API_KEY`, then run:

```bat
setup.bat
```

`setup.bat` will:
1. Create a Python virtual environment in `Backend/venv/`
2. Install all Python dependencies from `Backend/requirements.txt`
3. Run `npm install` for the Teacher Frontend
4. Run `npm install` for the Student Frontend

### Manual Setup (Linux / macOS)

```bash
git clone https://github.com/Tej-Gowda-26/Script-Sense.git
cd Script-Sense

# Copy and configure environment
cp .env.example .env
# Edit .env with your values

# Backend
cd Backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cd ..

# Teacher Frontend
cd Frontend/TeacherFrontend
npm install
cd ../..

# Student Frontend
cd Frontend/StudentFrontend
npm install
cd ../..
```

---

## Running the Application

### Quick Start (Windows)

```bat
start_servers.bat
```

This opens three separate terminal windows — one per service.

### Manual Start

Open three separate terminals and run:

**Terminal 1 — Django Backend**
```bash
cd Backend
# Windows:
venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate

python manage.py runserver
```

**Terminal 2 — Teacher Frontend**
```bash
cd Frontend/TeacherFrontend
npm run dev
```

**Terminal 3 — Student Frontend**
```bash
cd Frontend/StudentFrontend
npm run dev
```

### Access the App

| Service | URL |
|---|---|
| Django Backend / Admin | http://127.0.0.1:8000 |
| Teacher Frontend | http://localhost:5173 |
| Student Frontend | http://localhost:5174 |

---

## API Reference

All API endpoints are served by the Django backend at `http://127.0.0.1:8000`.

| Method | Endpoint | Module | Description |
|---|---|---|---|
| `POST` | `/upload/` | UploadQP | Upload a question paper (PDF or image) |
| `POST` | `/evaluate/script/` | Evaluate | Submit and evaluate a student answer script |
| `POST` | `/imageto/` | ImagetoText | Convert an answer sheet image to text (OCR) |
| `GET/POST` | `/student/feedback/` | Student | Retrieve or save student feedback |
| `POST` | `/rag/` | RagPipe | Query the RAG pipeline for context retrieval |
| `GET` | `/admin/` | Django Admin | Built-in Django admin panel |

---

## Backend Modules

| Module | Path | Purpose |
|---|---|---|
| **Grader** | `Backend/Grader/` | Django project core — settings, root URLs, WSGI/ASGI |
| **UploadQP** | `Backend/UploadQP/` | Handles question paper uploads; parses PDFs and stores content |
| **ImagetoText** | `Backend/ImagetoText/` | Converts uploaded answer sheet images to text using Groq's vision LLM |
| **RagPipe** | `Backend/RagPipe/` | RAG pipeline — embeds text with `sentence-transformers`, indexes with FAISS, retrieves relevant context |
| **Evaluate** | `Backend/Evaluate/` | Core grading logic — compares student answers against model answers via Groq LLM |
| **Student** | `Backend/Student/` | Stores and retrieves per-student feedback in MongoDB |
| **Textbooks** | `Backend/Textbooks/` | Stores reference/textbook material used to augment grading context |

---

## Frontend Apps

### Teacher Frontend (`Frontend/TeacherFrontend`) — Port 5173

The teacher-facing interface where educators can:
- Upload question papers (PDF / image)
- Monitor grading jobs in real time
- Browse per-student evaluation results and scores
- Download grading reports

Built with **React + TypeScript + Vite + Tailwind CSS**.  
Uses `VITE_GROQ_API_KEY` from `.env` for any direct AI calls.

### Student Frontend (`Frontend/StudentFrontend`) — Port 5174

The student-facing portal where students can:
- Submit their handwritten or typed answer sheets
- View AI-generated feedback on their submissions
- Track marks and improvement suggestions

Built with **React + TypeScript + Vite + Tailwind CSS + Axios**.

---

## Contributing

1. **Fork** the repository.
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m "feat: add my feature"`
4. Push to your fork: `git push origin feature/my-feature`
5. Open a **Pull Request** against `main`.

### Development Notes

- Keep secrets out of source control — use `.env.example` for documentation.
- Backend CORS is currently open (`CORS_ALLOW_ALL_ORIGINS = True`) — restrict `ALLOWED_HOSTS` and CORS origins before deploying to production.
- Set `DEBUG=False` and rotate `SECRET_KEY` before any public deployment.
- Max upload size is **50 MB** (configurable via `DATA_UPLOAD_MAX_MEMORY_SIZE` in `settings.py`).

---

*Made with ❤️ by the ScriptSense team.*