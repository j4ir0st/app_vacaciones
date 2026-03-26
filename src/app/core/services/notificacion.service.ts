import { Injectable } from '@angular/core';
import { Subject, Observable } from 'rxjs';

/**
 * Tipo de notificación para el sistema
 */
export type TipoNotificacion = 'exito' | 'error' | 'info' | 'alerta';

/**
 * Interfaz para definir la estructura de una notificación
 */
export interface Notificacion {
    mensaje: string;
    tipo: TipoNotificacion;
    duracion?: number;
}

@Injectable({
    providedIn: 'root'
})
export class NotificacionService {
    private notificacionSubject = new Subject<Notificacion | null>();
    
    // Observable al que se suscribirá el componente de notificación
    notificacion$: Observable<Notificacion | null> = this.notificacionSubject.asObservable();

    /**
     * Muestra una notificación en la pantalla
     * @param mensaje Texto a mostrar
     * @param tipo Tipo de alerta (por defecto 'info')
     * @param duracion Tiempo en ms antes de desaparecer (por defecto 5000)
     */
    mostrar(mensaje: string, tipo: TipoNotificacion = 'info', duracion: number = 5000): void {
        this.notificacionSubject.next({ mensaje, tipo, duracion });
    }

    /**
     * Limpia la notificación actual
     */
    limpiar(): void {
        this.notificacionSubject.next(null);
    }
}
