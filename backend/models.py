from datetime import date

from sqlalchemy import Boolean, Column, Date, ForeignKey, Integer, String

from database import Base


class User(Base):
    # New table name, so it does not clash with an older "users" table
    __tablename__ = "app_users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)


class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    completed = Column(Boolean, default=False)
    day = Column(Date, default=date.today)
    priority = Column(String, default="medium")
    due_date = Column(Date, nullable=True)
    category = Column(String, default="Personal")

    # The owner of the task
    user_id = Column(
        Integer,
        ForeignKey("app_users.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )