import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';

import { API_URL, AuthService } from './auth.service';

// Adds "Authorization: Bearer <token>" to every request sent to our API,
// and logs the user out if the server says the token is no longer valid.
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.token();

  const request =
    token && req.url.startsWith(API_URL)
      ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
      : req;

  return next(request).pipe(
    catchError((error) => {
      if (error.status === 401 && token) {
        auth.logout();
      }

      return throwError(() => error);
    })
  );
};