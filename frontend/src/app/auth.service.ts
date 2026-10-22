import { Injectable, computed, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

export const API_URL = 'http://127.0.0.1:8000';

export interface User {
  id: number;
  name: string;
  email: string;
}

interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly storageKey = 'todo_auth';

  readonly token = signal<string | null>(null);
  readonly user = signal<User | null>(null);
  readonly isLoggedIn = computed(() => this.token() !== null);

  constructor(private http: HttpClient) {
    this.restore();
  }

  register(name: string, email: string, password: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${API_URL}/auth/register`, { name, email, password })
      .pipe(tap(response => this.start(response)));
  }

  login(email: string, password: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${API_URL}/auth/login`, { email, password })
      .pipe(tap(response => this.start(response)));
  }

  logout(): void {
    this.token.set(null);
    this.user.set(null);

    try {
      localStorage.removeItem(this.storageKey);
    } catch {
      // Storage can be blocked; the user is still logged out on screen.
    }
  }

  private start(response: AuthResponse): void {
    this.token.set(response.access_token);
    this.user.set(response.user);

    try {
      localStorage.setItem(
        this.storageKey,
        JSON.stringify({ token: response.access_token, user: response.user })
      );
    } catch {
      // Storage can be blocked; the user stays logged in until the page reloads.
    }
  }

  // Keep the user logged in after a page reload
  private restore(): void {
    try {
      const saved = localStorage.getItem(this.storageKey);

      if (!saved) {
        return;
      }

      const data = JSON.parse(saved) as { token?: string; user?: User };

      if (data.token && data.user) {
        this.token.set(data.token);
        this.user.set(data.user);
      }
    } catch {
      // Ignore broken or blocked storage and start logged out.
    }
  }
}