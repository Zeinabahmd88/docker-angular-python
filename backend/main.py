# =====================================================================
# main.py  -  the BACKEND of the To-Do app (FastAPI)
#
# What this file does:
#   1. Creates the web server (the "API").
#   2. Lets users register and log in (authentication).
#   3. Lets a logged-in user create, read, edit and delete THEIR tasks.
#
# Angular (the frontend) sends HTTP requests to these routes, and this
# file answers with JSON data.
# =====================================================================


# ---------------------------------------------------------------------
# 1. IMPORTS - tools we use from other files and libraries
# ---------------------------------------------------------------------
from datetime import date          # to work with dates (today, due date)
from typing import Literal         # to allow only a fixed list of values

from fastapi import Depends, FastAPI, HTTPException
#   FastAPI       = the web framework that creates the server
#   Depends       = lets a route "depend" on a helper (login check, database)
#   HTTPException = stops a request and sends an error (404, 401, ...)

from fastapi.middleware.cors import CORSMiddleware   # CORS (explained below)
from pydantic import BaseModel, Field                # checks incoming data
from sqlalchemy.exc import IntegrityError            # database "duplicate" error
from sqlalchemy.orm import Session                   # a database conversation

from ai import router as ai_router      # the AI route (/ai/suggest) from ai.py
from auth import (                      # security helpers from auth.py
    authenticate,                       #   checks email + password
    create_access_token,                #   creates the login token (JWT)
    get_current_user,                   #   reads the token, finds the user
    get_db,                             #   opens and closes a database session
    hash_password,                      #   turns a password into a safe hash
)
from database import engine, Base       # database connection (database.py)
from models import Task, User           # the tables: Task and User (models.py)


# ---------------------------------------------------------------------
# 2. START THE APP
# ---------------------------------------------------------------------

# Create any table that does not exist yet.
# (It does NOT change tables that already exist.)
Base.metadata.create_all(bind=engine)

# The application object. All routes below are attached to it.
app = FastAPI()

# CORS: browsers block a page on one address (Angular, localhost:4200) from
# calling a server on another address (FastAPI, port 8000) unless the server
# allows it. These lines say: "Angular on port 4200 is allowed to call me".
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:4200",
        "http://127.0.0.1:4200",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# AI routes: POST /ai/suggest
# A router is a group of routes kept in another file (ai.py).
# This line plugs that group into our app.
app.include_router(ai_router)


# ---------------------------------------------------------------------
# 3. TYPES AND REQUEST MODELS
#    A request model describes the data we EXPECT from Angular.
#    Pydantic checks it automatically. If the data is wrong, FastAPI
#    answers with error 422 and our code never runs.
# ---------------------------------------------------------------------

# Only these values are allowed (anything else is rejected)
Priority = Literal["low", "medium", "high"]
Category = Literal["Work", "Study", "Personal", "Shopping", "Other"]

# A simple pattern for an email: text @ text . text
EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


# Data needed to create an account
class RegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: str = Field(pattern=EMAIL_PATTERN, max_length=255)
    password: str = Field(min_length=8, max_length=128)   # at least 8 characters


# Data needed to log in
class LoginRequest(BaseModel):
    email: str = Field(max_length=255)
    password: str = Field(max_length=128)


# Data needed to create a task. Priority, due date and category are optional
# because they have default values.
class TaskRequest(BaseModel):
    title: str
    priority: Priority = "medium"
    due_date: date | None = None
    category: Category = "Personal"


# One small model for each kind of change:
class TaskEdit(BaseModel):              # change the title
    title: str


class TaskUpdate(BaseModel):            # mark done / not done
    completed: bool


class TaskPriorityUpdate(BaseModel):    # change the priority
    priority: Priority


class TaskDueDateUpdate(BaseModel):     # change the due date (or remove it)
    due_date: date | None = None


class TaskCategoryUpdate(BaseModel):    # change the category
    category: Category


# ---------------------------------------------------------------------
# 4. HELPER FUNCTIONS - small functions used by many routes,
#    so we do not repeat the same code
# ---------------------------------------------------------------------

# Remove spaces around the title and refuse an empty one.
def clean_title(title: str) -> str:
    title = title.strip()

    if not title:
        raise HTTPException(status_code=400, detail="Task title cannot be empty")

    return title


# Find ONE task by its id, but only if it belongs to the logged-in user.
# If the task does not exist OR belongs to someone else, we answer "not found",
# so nobody can discover or touch another user's task.
def get_task_or_404(db: Session, task_id: int, user: User) -> Task:
    task = (
        db.query(Task)
        .filter(Task.id == task_id, Task.user_id == user.id)
        .first()
    )

    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    return task


# Save the change in the database, reload the task, and return it as JSON.
#   commit()  = really save the change
#   refresh() = read the task again from the database (to get the final values)
def save_and_return(db: Session, task: Task) -> dict:
    db.commit()
    db.refresh(task)
    return task_to_dict(task)


# Turn a database Task object into a plain dictionary, which FastAPI sends
# to Angular as JSON.
def task_to_dict(task: Task) -> dict:
    # A task is overdue when it has a due date in the past and is not done.
    is_overdue = (
        task.due_date is not None
        and task.due_date < date.today()
        and not task.completed
    )

    return {
        "id": task.id,
        "title": task.title,
        "completed": task.completed,
        "priority": task.priority,
        "due_date": task.due_date.isoformat() if task.due_date else None,
        "is_overdue": is_overdue,
        "category": task.category or "Personal",
    }


# Turn a User object into a dictionary.
# NOTE: the password hash is NOT included. It never leaves the server.
def user_to_dict(user: User) -> dict:
    return {"id": user.id, "name": user.name, "email": user.email}


# The answer we send after register / login: a token + the user's info.
# Angular saves the token and sends it with every later request.
def auth_response(user: User) -> dict:
    return {
        "access_token": create_access_token(user.id),
        "token_type": "bearer",
        "user": user_to_dict(user),
    }


# ---------------------------------------------------------------------
# 5. AUTH ROUTES - create an account and log in (no login needed here)
# ---------------------------------------------------------------------

# POST /auth/register  -> create a new account
# "db: Session = Depends(get_db)" means: FastAPI gives this function a
# database session and closes it when the request ends.
@app.post("/auth/register", status_code=201)       # 201 = "Created"
def register(data: RegisterRequest, db: Session = Depends(get_db)):
    name = data.name.strip()
    email = data.email.strip().lower()    # lowercase, so A@x.com = a@x.com

    if not name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")

    # Email already used? Answer 409 "Conflict".every 
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(
            status_code=409,
            detail="An account with this email already exists",
        )

    # We store a HASH of the password, never the password itself.
    user = User(name=name, email=email, password_hash=hash_password(data.password))
    db.add(user)

    try:
        db.commit()
    except IntegrityError:
        # Two people registered the same email at the same moment:
        # the database refused the second one, so we undo and answer 409.
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="An account with this email already exists",
        )

    db.refresh(user)
    return auth_response(user)     # the user is logged in right after registering


# POST /auth/login  -> check email + password, return a token
@app.post("/auth/login")
def login(data: LoginRequest, db: Session = Depends(get_db)):
    user = authenticate(db, data.email.strip().lower(), data.password)

    if user is None:
        # We do not say which one was wrong (email or password).
        # That protects the accounts from guessing.
        raise HTTPException(status_code=401, detail="Incorrect email or password")

    return auth_response(user)


# GET /auth/me  -> who am I? (needs a valid token)
# "user: User = Depends(get_current_user)" is the LOGIN CHECK:
# FastAPI first runs get_current_user. If the token is missing, wrong or
# expired, it stops with 401 and this function never runs.
@app.get("/auth/me")
def me(user: User = Depends(get_current_user)):
    return user_to_dict(user)


# ---------------------------------------------------------------------
# 6. TASK ROUTES - route below needs login
#    Every query filters by user_id, so each person sees ONLY their tasks.
#
#    HTTP methods used:
#      GET    = read data          POST   = create data
#      PUT    = edit (the title)   PATCH  = change ONE field
#      DELETE = remove data
# ---------------------------------------------------------------------

# GET /  -> a simple check that the server is running (no login)
@app.get("/")
def home():
    return {"message": "To-Do API is running!"}


# GET /tasks  -> all tasks of the logged-in user, newest first
@app.get("/tasks")
def get_tasks(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    tasks = (
        db.query(Task)
        .filter(Task.user_id == user.id)     # only MY tasks
        .order_by(Task.id.desc())            # newest first
        .all()
    )
    return [task_to_dict(task) for task in tasks]


# POST /tasks  -> create a task for the logged-in user
@app.post("/tasks")
def create_task(
    data: TaskRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    new_task = Task(
        user_id=user.id,                     # the task belongs to this user
        title=clean_title(data.title),
        priority=data.priority,
        due_date=data.due_date,
        category=data.category,
    )

    db.add(new_task)                         # prepare to insert
    return save_and_return(db, new_task)     # commit, reload, return


# PUT /tasks/{task_id}  -> change the title
@app.put("/tasks/{task_id}")
def edit_task(
    task_id: int,
    data: TaskEdit,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    task = get_task_or_404(db, task_id, user)    # 404 if not mine
    task.title = clean_title(data.title)
    return save_and_return(db, task)


# PATCH /tasks/{task_id}  -> mark a task done / not done
@app.patch("/tasks/{task_id}")
def update_task_status(
    task_id: int,
    data: TaskUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    task = get_task_or_404(db, task_id, user)
    task.completed = data.completed
    return save_and_return(db, task)


# PATCH /tasks/{task_id}/category  -> change the category
@app.patch("/tasks/{task_id}/category")
def update_task_category(
    task_id: int,
    data: TaskCategoryUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    task = get_task_or_404(db, task_id, user)
    task.category = data.category
    return save_and_return(db, task)


# PATCH /tasks/{task_id}/priority  -> change the priority
@app.patch("/tasks/{task_id}/priority")
def update_task_priority(
    task_id: int,
    data: TaskPriorityUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    task = get_task_or_404(db, task_id, user)
    task.priority = data.priority
    return save_and_return(db, task)


# PATCH /tasks/{task_id}/due-date  -> change or remove the due date
@app.patch("/tasks/{task_id}/due-date")
def update_task_due_date(
    task_id: int,
    data: TaskDueDateUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    task = get_task_or_404(db, task_id, user)
    task.due_date = data.due_date
    return save_and_return(db, task)


# DELETE /tasks/{task_id}  -> delete a task
@app.delete("/tasks/{task_id}")
def delete_task(
    task_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # The filter includes user_id, so you can only delete your own tasks.
    task = (
        db.query(Task)
        .filter(Task.id == task_id, Task.user_id == user.id)
        .first()
    )

    # If the task is already gone, we still answer OK (nothing left to delete).
    if task is not None:
        db.delete(task)
        db.commit()

    return {"message": "Task deleted"}