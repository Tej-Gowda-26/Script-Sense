# ScriptSense

AI-powered automated grading system for student answer sheets.

---

## Prerequisites

- **Python** 3.10+
- **Node.js** v18+
- **MongoDB** running locally on `mongodb://localhost:27017`
- **Groq API key** — get one free at [console.groq.com](https://console.groq.com)

---

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/Tej-Gowda-26/Script-Sense.git
cd Script-Sense
```

### 2. Configure environment variables

Open `.env` and set your Groq API key:

```
GROQ_API_KEY=gsk_your_actual_key_here
VITE_GROQ_API_KEY=gsk_your_actual_key_here
```

### 3. Install all dependencies

```bash
setup.bat
```

### 4. Start all servers

```bash
start_servers.bat
```

| Service | URL |
|---|---|
| Django Backend | http://127.0.0.1:8000 |
| Teacher Frontend | http://localhost:5173 |
| Student Frontend | http://localhost:5174 |