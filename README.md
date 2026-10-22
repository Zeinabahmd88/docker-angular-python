# Task Manager

A full-stack task manager with secure user accounts and an AI assistant that suggests a category, a priority and steps for each task. Every user sees only their own tasks.

![Angular](https://img.shields.io/badge/Angular-DD0031?logo=angular&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)

<!--
![Task list](docs/screenshots/tasks.png)
![AI suggestion](docs/screenshots/ai-suggestion.png)
-->

## Features

- Register and log in with JWT tokens; passwords are stored as Argon2 hashes
- Create, edit, complete and delete tasks, with categories, priorities and due dates
- Overdue detection, filters and browser reminders
- AI helper (Google Gemini free tier): suggests a category, a priority and steps for a task
- Responsive design with dark mode

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Angular (standalone components, signals), TypeScript |
| Backend | FastAPI, SQLAlchemy, Pydantic |
| Database | PostgreSQL in Docker |
| Auth | JWT (PyJWT), Argon2 (pwdlib) |
| AI | Google Gemini API |

## Getting started

Requirements: Git, Docker Desktop, Python 3.12+, Node.js and the Angular CLI.

```bash
git clone https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
cd YOUR-REPOSITORY
docker compose up -d                      # start PostgreSQL
```

Backend:

```bash
cd backend
python -m venv venv
venv\Scripts\activate                     # macOS / Linux: source venv/bin/activate
pip install -r requirements.txt
copy .env.example .env                    # macOS / Linux: cp .env.example .env
uvicorn main:app --reload --env-file .env
```

Frontend (second terminal):

```bash
cd frontend
npm install
ng serve
```

Open http://localhost:4200. The API docs are at http://127.0.0.1:8000/docs.

## Environment variables

Set these in `backend/.env` (template: `backend/.env.example`).

| Variable | Description |
|---|---|
| `SECRET_KEY` | Long random text used to sign login tokens |
| `GEMINI_API_KEY` | Free key from [Google AI Studio](https://aistudio.google.com) |
| `AI_PROVIDER` | Optional: `gemini` (default) or `anthropic` |

## Security

- Passwords are hashed; tokens expire after 24 hours
- Every task query filters by the owner, so users cannot access each other's tasks
- Secrets live in environment variables; `.env` is not committed
- AI replies are validated, and each user is limited to 20 AI requests per hour

## Roadmap

Automated tests and CI, database migrations (Alembic), email reminders, search and sorting.

## License

MIT. See [LICENSE](LICENSE).

## Author

**Zeinab Ahmad**, full-stack developer, Beirut, Lebanon.
[GitHub](https://github.com/YOUR-USERNAME) · [LinkedIn](https://www.linkedin.com/in/YOUR-PROFILE)
