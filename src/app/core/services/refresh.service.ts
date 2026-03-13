import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class RefreshService {
    private refreshSubject = new Subject<void>();
    
    // Observable al que se suscribirán los componentes
    refresh$ = this.refreshSubject.asObservable();

    // Dispara el evento de refresco
    triggerRefresh(): void {
        this.refreshSubject.next();
    }
}
