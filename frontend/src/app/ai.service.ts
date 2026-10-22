import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { API_URL } from './auth.service';

// The shape of the answer from POST /ai/suggest
export interface Suggestion {
  category: 'Work' | 'Study' | 'Personal' | 'Shopping' | 'Other';
  priority: 'low' | 'medium' | 'high';
  subtasks: string[];
}

@Injectable({ providedIn: 'root' })
export class AiService {
  constructor(private http: HttpClient) {}

  // The auth interceptor adds the login token to this request automatically
  suggest(title: string): Observable<Suggestion> {
    return this.http.post<Suggestion>(`${API_URL}/ai/suggest`, { title });
  }
}