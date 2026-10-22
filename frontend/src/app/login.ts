import { Component, EventEmitter, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { AuthService } from './auth.service';

type Mode = 'login' | 'register';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  template: `
    <main class="auth-page">
      <section class="auth-card">
        <h1>{{ mode() === 'login' ? 'Welcome back' : 'Create your account' }}</h1>
        <p class="subtitle">
          {{ mode() === 'login'
            ? 'Log in to see your tasks.'
            : 'Your tasks stay private to your account.' }}
        </p>

        @if (error()) {
          <div class="error" role="alert">{{ error() }}</div>
        }

        <form (ngSubmit)="submit()">
          @if (mode() === 'register') {
            <label for="auth-name">Name</label>
            <input
              id="auth-name"
              name="name"
              type="text"
              [(ngModel)]="name"
              autocomplete="name"
            />
          }

          <label for="auth-email">Email</label>
          <input
            id="auth-email"
            name="email"
            type="email"
            [(ngModel)]="email"
            autocomplete="email"
            required
          />

          <label for="auth-password">Password</label>
          <input
            id="auth-password"
            name="password"
            type="password"
            [(ngModel)]="password"
            [attr.autocomplete]="mode() === 'login' ? 'current-password' : 'new-password'"
            required
          />

          @if (mode() === 'register') {
            <p class="hint">Use at least 8 characters.</p>
          }

          <button type="submit" class="primary" [disabled]="loading()">
            {{ loading()
              ? 'Please wait…'
              : (mode() === 'login' ? 'Log in' : 'Create account') }}
          </button>
        </form>

        <p class="switch">
          {{ mode() === 'login' ? "Don't have an account?" : 'Already have an account?' }}
          <button type="button" class="link" (click)="switchMode()">
            {{ mode() === 'login' ? 'Create one' : 'Log in' }}
          </button>
        </p>
      </section>
    </main>
  `,
  styles: [`
    :host {
      display: block;
    }

    *, *::before, *::after {
      box-sizing: border-box;
    }

    .auth-page {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px 16px;
    }

    .auth-card {
      width: 100%;
      max-width: 400px;
      padding: clamp(24px, 5vw, 36px);
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 16px;
      box-shadow: 0 14px 36px -18px rgba(20, 32, 46, 0.25);
    }

    h1 {
      margin: 0;
      font-family: var(--font-display);
      font-size: 1.9rem;
      font-weight: 700;
      letter-spacing: -0.03em;
      line-height: 1.1;
    }

    .subtitle {
      margin: 8px 0 24px;
      color: var(--muted);
      font-size: 0.95rem;
    }

    .error {
      margin-bottom: 16px;
      padding: 12px 14px;
      border-left: 4px solid var(--danger);
      border-radius: var(--radius);
      background: var(--danger-soft);
      color: var(--danger);
      font-size: 0.925rem;
      font-weight: 500;
    }

    label {
      display: block;
      margin: 14px 0 6px;
      font-size: 0.85rem;
      font-weight: 600;
    }

    input {
      width: 100%;
      padding: 12px 14px;
      font: inherit;
      font-size: 1rem;
      color: var(--ink);
      background: var(--field);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      transition: border-color 0.15s;
    }

    input:hover {
      border-color: color-mix(in srgb, var(--ink) 28%, var(--line));
    }

    input:focus-visible,
    button:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    .hint {
      margin: 6px 0 0;
      font-size: 0.8rem;
      color: var(--muted);
    }

    .primary {
      width: 100%;
      margin-top: 22px;
      padding: 13px;
      font: inherit;
      font-size: 1rem;
      font-weight: 600;
      color: var(--on-accent);
      background: var(--accent);
      border: 0;
      border-radius: var(--radius);
      cursor: pointer;
      transition: filter 0.15s;
    }

    .primary:hover:not(:disabled) {
      filter: brightness(1.08);
    }

    .primary:disabled {
      opacity: 0.6;
      cursor: progress;
    }

    .switch {
      margin: 20px 0 0;
      text-align: center;
      font-size: 0.9rem;
      color: var(--muted);
    }

    .link {
      padding: 0;
      font: inherit;
      font-weight: 600;
      color: var(--accent);
      background: none;
      border: 0;
      cursor: pointer;
    }

    .link:hover {
      text-decoration: underline;
    }
  `]
})
export class Login {
  @Output() loggedIn = new EventEmitter<void>();

  mode = signal<Mode>('login');
  error = signal('');
  loading = signal(false);

  name = '';
  email = '';
  password = '';

  constructor(private auth: AuthService) {}

  switchMode(): void {
    this.mode.set(this.mode() === 'login' ? 'register' : 'login');
    this.error.set('');
  }

  submit(): void {
    if (this.loading()) {
      return;
    }

    const email = this.email.trim().toLowerCase();
    const name = this.name.trim();

    if (!email || !this.password) {
      this.error.set('Enter your email and password.');
      return;
    }

    if (this.mode() === 'register') {
      if (!name) {
        this.error.set('Enter your name.');
        return;
      }

      if (this.password.length < 8) {
        this.error.set('Your password needs at least 8 characters.');
        return;
      }
    }

    this.loading.set(true);
    this.error.set('');

    const request$ =
      this.mode() === 'register'
        ? this.auth.register(name, email, this.password)
        : this.auth.login(email, this.password);

    request$.subscribe({
      next: () => {
        this.loading.set(false);
        this.password = '';
        this.loggedIn.emit();
      },
      error: (error) => {
        this.loading.set(false);
        this.error.set(this.messageFrom(error));
      }
    });
  }

  private messageFrom(error: { status?: number }): string {
    switch (error.status) {
      case 0:
        return 'Cannot reach the server. Check that the backend is running.';
      case 401:
        return 'Incorrect email or password.';
      case 409:
        return 'An account with this email already exists.';
      case 422:
        return 'Check your details: use a valid email and a password of at least 8 characters.';
      default:
        return 'Something went wrong. Try again.';
    }
  }
}