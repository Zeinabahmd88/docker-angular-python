import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Observable, concatMap, from } from 'rxjs';

import { API_URL, AuthService } from './auth.service';
import { Login } from './login';
import { AiService, Suggestion } from './ai.service';

type Priority = 'low' | 'medium' | 'high';
type Filter = 'all' | 'active' | 'done';
type Category = 'Work' | 'Study' | 'Personal' | 'Shopping' | 'Other';
type ReminderState = NotificationPermission | 'unsupported';

interface Task {
  id: number;
  title: string;
  completed: boolean;
  priority: Priority;
  due_date: string | null;
  is_overdue: boolean;
  category: Category;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormsModule, Login],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit, OnDestroy {
  // State that changes after HTTP responses lives in signals,
  // so Angular redraws the screen automatically.
  tasks = signal<Task[]>([]);
  errorMessage = signal('');
  filter = signal<Filter>('all');
  editingTaskId = signal<number | null>(null);
  reminderState = signal<ReminderState>(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  );

  // AI suggestion
  suggestion = signal<Suggestion | null>(null);
  suggesting = signal(false);
  suggestionError = signal('');
  suggestionApplied = signal(false);
  selectedSteps = signal<number[]>([]); // positions of the checked steps
  addingSteps = signal(false);

  addStepsLabel = computed(() => {
    if (this.addingSteps()) {
      return 'Adding…';
    }

    const count = this.selectedSteps().length;
    return `Add ${count} ${count === 1 ? 'step' : 'steps'} as tasks`;
  });

  // Form fields (plain properties are fine with ngModel)
  newTask = '';
  newPriority: Priority = 'medium';
  newDueDate = '';
  newCategory: Category = 'Personal';
  editedTitle = '';

  readonly categories: Category[] = ['Work', 'Study', 'Personal', 'Shopping', 'Other'];

  readonly filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'To do' },
    { key: 'done', label: 'Done' }
  ];

  today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  });

  // Derived values
  completedCount = computed(() => this.tasks().filter(task => task.completed).length);

  progress = computed(() => {
    const total = this.tasks().length;
    return total === 0 ? 0 : Math.round((this.completedCount() / total) * 100);
  });

  visibleTasks = computed(() => {
    const filter = this.filter();
    const tasks = this.tasks();

    if (filter === 'active') {
      return tasks.filter(task => !task.completed);
    }

    if (filter === 'done') {
      return tasks.filter(task => task.completed);
    }

    return tasks;
  });

  private readonly apiUrl = `${API_URL}/tasks`;
  private pending = new Set<number>();
  private reminderTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private http: HttpClient,
    public auth: AuthService,
    private ai: AiService
  ) {}

  ngOnInit(): void {
    // Already logged in from an earlier visit
    if (this.auth.isLoggedIn()) {
      this.onLoggedIn();
    }
  }

  ngOnDestroy(): void {
    this.stopReminders();
  }

  // ---------- Account ----------

  // Runs after a successful login, register, or page reload while logged in
  onLoggedIn(): void {
    this.tasks.set([]);
    this.pending.clear();
    this.errorMessage.set('');
    this.filter.set('all');
    this.cancelEdit();
    this.loadTasks();
    this.startReminders();
  }

  logout(): void {
    this.auth.logout();
    this.stopReminders();
    this.dismissSuggestion();
    this.tasks.set([]);
    this.pending.clear();
    this.errorMessage.set('');
    this.cancelEdit();
  }

  // ---------- Helpers ----------

  private normalizePriority(value: unknown): Priority {
    return value === 'high' || value === 'low' ? value : 'medium';
  }

  private normalizeCategory(value: unknown): Category {
    return this.categories.includes(value as Category)
      ? (value as Category)
      : 'Personal';
  }

  // Convert whatever the API returns into a clean Task
  private toTask(raw: Task): Task {
    return {
      id: raw.id,
      title: raw.title,
      completed: raw.completed === true,
      priority: this.normalizePriority(raw.priority),
      due_date: raw.due_date ?? null,
      is_overdue: raw.is_overdue === true,
      category: this.normalizeCategory(raw.category)
    };
  }

  // Change some fields of one task on the screen
  private patchLocal(id: number, changes: Partial<Task>): void {
    this.tasks.update(tasks =>
      tasks.map(task => (task.id === id ? { ...task, ...changes } : task))
    );
  }

  // Replace one task with the version returned by the server
  private replaceTask(raw: Task): void {
    const updated = this.toTask(raw);
    this.tasks.update(tasks =>
      tasks.map(task => (task.id === updated.id ? updated : task))
    );
  }

  // Shared logic for every update:
  // 1. update the screen immediately
  // 2. send the request
  // 3. use the server response, or roll back on error
  private save(
    task: Task,
    changes: Partial<Task>,
    request$: Observable<Task>,
    failMessage: string,
    onSuccess?: () => void
  ): void {
    if (this.pending.has(task.id)) {
      return;
    }

    const snapshot = { ...task };
    this.pending.add(task.id);
    this.patchLocal(task.id, changes);

    request$.subscribe({
      next: (updatedTask) => {
        this.replaceTask(updatedTask);
        this.pending.delete(task.id);
        this.errorMessage.set('');
        onSuccess?.();
      },
      error: (error) => {
        console.error(failMessage, error);
        this.patchLocal(task.id, snapshot);
        this.pending.delete(task.id);
        this.errorMessage.set(failMessage);
      }
    });
  }

  // ---------- Load ----------

  loadTasks(): void {
    this.http.get<Task[]>(this.apiUrl).subscribe({
      next: (data) => {
        this.tasks.set(data.map(task => this.toTask(task)));
        this.errorMessage.set('');
        this.checkReminders();
      },
      error: (error) => {
        console.error('Could not load tasks:', error);
        this.errorMessage.set('Could not load tasks. Check that the backend is running.');
      }
    });
  }

  // ---------- Add ----------

  addTask(): void {
    const title = this.newTask.trim();

    if (!title) {
      return;
    }

    this.http.post<Task>(this.apiUrl, {
      title,
      priority: this.newPriority,
      due_date: this.newDueDate || null,
      category: this.newCategory
    }).subscribe({
      next: (task) => {
        this.tasks.update(tasks => [this.toTask(task), ...tasks]);

        this.newTask = '';
        this.newPriority = 'medium';
        this.newDueDate = '';
        this.newCategory = 'Personal';
        this.errorMessage.set('');
        this.dismissSuggestion();
        this.checkReminders();
      },
      error: (error) => {
        console.error('Could not add task:', error);
        this.errorMessage.set('Could not add the task. Try again.');
      }
    });
  }

  // ---------- AI suggestion ----------

  // Ask the backend for a category, a priority and steps for the typed title
  suggestWithAi(): void {
    const title = this.newTask.trim();

    if (!title || this.suggesting()) {
      return;
    }

    this.suggesting.set(true);
    this.suggestion.set(null);
    this.suggestionError.set('');

    this.ai.suggest(title).subscribe({
      next: (result) => {
        this.suggestion.set(result);
        this.suggestionApplied.set(false);
        this.selectedSteps.set(result.subtasks.map((_, index) => index)); // all checked
        this.suggesting.set(false);
      },
      error: (error) => {
        console.error('AI suggestion failed:', error);
        this.suggestionError.set(this.aiErrorMessage(error));
        this.suggesting.set(false);
      }
    });
  }

  dismissSuggestion(): void {
    this.suggestion.set(null);
    this.suggestionError.set('');
    this.suggestionApplied.set(false);
    this.selectedSteps.set([]);
  }

  // Step 3: copy the suggested category and priority into the add-task form
  applySuggestion(): void {
    const result = this.suggestion();

    if (!result) {
      return;
    }

    this.newCategory = result.category;
    this.newPriority = result.priority;
    this.suggestionApplied.set(true);
  }

  // Step 4: choose which suggested steps to add
  isStepSelected(index: number): boolean {
    return this.selectedSteps().includes(index);
  }

  toggleStep(index: number): void {
    this.selectedSteps.update(selected =>
      selected.includes(index)
        ? selected.filter(item => item !== index)
        : [...selected, index]
    );
  }

  // Step 4: add the checked steps as normal tasks, one after another.
  // The list shows the newest task first, so we create them last-to-first.
  // That way step 1 ends up on top.
  addSelectedSteps(): void {
    const result = this.suggestion();

    if (!result || this.addingSteps()) {
      return;
    }

    const chosen = this.selectedSteps();
    const steps = result.subtasks.filter((_, index) => chosen.includes(index));

    if (steps.length === 0) {
      return;
    }

    this.addingSteps.set(true);
    this.errorMessage.set('');

    from([...steps].reverse())
      .pipe(
        concatMap(title =>
          this.http.post<Task>(this.apiUrl, {
            title,
            priority: this.newPriority,
            due_date: this.newDueDate || null,
            category: this.newCategory
          })
        )
      )
      .subscribe({
        // Show each task as soon as the server saves it
        next: (task) => this.tasks.update(tasks => [this.toTask(task), ...tasks]),
        error: (error) => {
          console.error('Could not add the steps:', error);
          this.errorMessage.set('Could not add all the steps. Some of them may have been added.');
          this.addingSteps.set(false);
        },
        complete: () => {
          this.addingSteps.set(false);
          this.dismissSuggestion();
          this.checkReminders();
        }
      });
  }

  // FastAPI sends errors as { detail: "..." }
  private aiErrorMessage(error: { status?: number; error?: { detail?: unknown } }): string {
    if (error.status === 0) {
      return 'Cannot reach the server. Check that the backend is running.';
    }

    const detail = error.error?.detail;
    return typeof detail === 'string' ? detail : 'Could not get a suggestion. Try again.';
  }

  // ---------- Edit title ----------

  startEdit(task: Task): void {
    this.editingTaskId.set(task.id);
    this.editedTitle = task.title;
  }

  saveEdit(task: Task): void {
    const title = this.editedTitle.trim();

    if (!title) {
      return;
    }

    this.save(
      task,
      { title },
      this.http.put<Task>(`${this.apiUrl}/${task.id}`, { title }),
      'Could not save the edited task.',
      () => this.cancelEdit()
    );
  }

  cancelEdit(): void {
    this.editingTaskId.set(null);
    this.editedTitle = '';
  }

  // ---------- Priority, due date, category, completed ----------

  updatePriority(task: Task, priority: Priority): void {
    if (task.priority === priority) {
      return;
    }

    this.save(
      task,
      { priority },
      this.http.patch<Task>(`${this.apiUrl}/${task.id}/priority`, { priority }),
      'Could not save task priority.'
    );
  }

  updateDueDate(task: Task, dueDate: string): void {
    const newDate = dueDate || null;

    if (newDate === task.due_date) {
      return;
    }

    this.save(
      task,
      { due_date: newDate },
      this.http.patch<Task>(`${this.apiUrl}/${task.id}/due-date`, { due_date: newDate }),
      'Could not save the due date.',
      () => this.checkReminders()
    );
  }

  updateCategory(task: Task, category: Category): void {
    if (task.category === category) {
      return;
    }

    this.save(
      task,
      { category },
      this.http.patch<Task>(`${this.apiUrl}/${task.id}/category`, { category }),
      'Could not save the category.'
    );
  }

  toggleTask(task: Task): void {
    const completed = !task.completed;

    this.save(
      task,
      { completed },
      this.http.patch<Task>(`${this.apiUrl}/${task.id}`, { completed }),
      'Could not update the task. Try again.'
    );
  }

  // ---------- Delete ----------

  deleteTask(task: Task): void {
    if (this.pending.has(task.id)) {
      return;
    }

    this.pending.add(task.id);

    const originalTasks = this.tasks();
    this.tasks.update(tasks => tasks.filter(current => current.id !== task.id));

    this.http.delete(`${this.apiUrl}/${task.id}`).subscribe({
      next: () => {
        this.pending.delete(task.id);
        this.errorMessage.set('');
      },
      error: (error) => {
        console.error('Could not delete task:', error);
        this.tasks.set(originalTasks);
        this.pending.delete(task.id);
        this.errorMessage.set('Could not delete the task. Try again.');
      }
    });
  }

  clearCompleted(): void {
    this.tasks()
      .filter(task => task.completed)
      .forEach(task => this.deleteTask(task));
  }

  // ---------- Filter counts ----------

  countFor(key: Filter): number {
    if (key === 'active') {
      return this.tasks().length - this.completedCount();
    }

    if (key === 'done') {
      return this.completedCount();
    }

    return this.tasks().length;
  }

  // ---------- Reminders (browser notifications) ----------
  // These work while the app is open in a browser tab.

  enableReminders(): void {
    if (typeof Notification === 'undefined') {
      return;
    }

    Notification.requestPermission().then((permission) => {
      this.reminderState.set(permission);

      if (permission === 'granted') {
        this.checkReminders();
      }
    });
  }

  private startReminders(): void {
    this.stopReminders();
    this.reminderTimer = setInterval(() => this.checkReminders(), 60_000);
  }

  private stopReminders(): void {
    if (this.reminderTimer !== null) {
      clearInterval(this.reminderTimer);
      this.reminderTimer = null;
    }
  }

  // Each task is announced at most once a day for each status
  // (overdue, due today, due tomorrow).
  private checkReminders(): void {
    if (this.reminderState() !== 'granted' || !this.auth.isLoggedIn()) {
      return;
    }

    const today = this.localDate(0);
    const tomorrow = this.localDate(1);
    const userId = this.auth.user()?.id;

    this.pruneReminders(today);

    for (const task of this.tasks()) {
      if (task.completed || !task.due_date) {
        continue;
      }

      let heading: string | null = null;

      if (task.due_date < today) {
        heading = 'Overdue';
      } else if (task.due_date === today) {
        heading = 'Due today';
      } else if (task.due_date === tomorrow) {
        heading = 'Due tomorrow';
      }

      if (!heading) {
        continue;
      }

      const key = `reminded:${userId}:${task.id}:${heading}:${today}`;

      if (this.alreadyReminded(key)) {
        continue;
      }

      this.markReminded(key);
      this.showNotification(heading, task);
    }
  }

  private showNotification(heading: string, task: Task): void {
    try {
      const notification = new Notification(heading, {
        body: task.title,
        tag: `task-${task.id}`
      });

      notification.onclick = () => window.focus();
    } catch (error) {
      // Some mobile browsers only allow notifications through a service worker.
      console.error('Could not show the reminder:', error);
    }
  }

  // Local date as YYYY-MM-DD (not UTC), so "today" matches the user's clock
  private localDate(offsetDays: number): string {
    const date = new Date();
    date.setDate(date.getDate() + offsetDays);

    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${date.getFullYear()}-${month}-${day}`;
  }

  private alreadyReminded(key: string): boolean {
    try {
      return localStorage.getItem(key) !== null;
    } catch {
      return false;
    }
  }

  private markReminded(key: string): void {
    try {
      localStorage.setItem(key, '1');
    } catch {
      // Without storage the reminder may repeat after a reload.
    }
  }

  // Remove records from earlier days
  private pruneReminders(today: string): void {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);

        if (key?.startsWith('reminded:') && !key.endsWith(`:${today}`)) {
          localStorage.removeItem(key);
        }
      }
    } catch {
      // Ignore blocked storage.
    }
  }
}