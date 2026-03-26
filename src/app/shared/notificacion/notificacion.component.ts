import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { Notificacion, NotificacionService } from '../../core/services/notificacion.service';

@Component({
    selector: 'app-notificacion',
    template: `
        <div *ngIf="notificacion" 
             class="notificacion-flotante" 
             [class]="'tipo-' + notificacion.tipo"
             (click)="cerrar()">
            <div class="contenido-notificacion">
                <span class="icono">
                    <i *ngIf="notificacion.tipo === 'exito'" class="fas fa-check-circle"></i>
                    <i *ngIf="notificacion.tipo === 'error'" class="fas fa-exclamation-circle"></i>
                    <i *ngIf="notificacion.tipo === 'alerta'" class="fas fa-exclamation-triangle"></i>
                    <i *ngIf="notificacion.tipo === 'info'" class="fas fa-info-circle"></i>
                </span>
                <span class="mensaje">{{ notificacion.mensaje }}</span>
            </div>
            <div class="barra-progreso" [style.animationDuration.ms]="notificacion.duracion"></div>
        </div>
    `,
    styles: [`
        .notificacion-flotante {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            min-width: 300px;
            max-width: 450px;
            padding: 16px;
            border-radius: 8px;
            background: white;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            display: flex;
            flex-direction: column;
            cursor: pointer;
            overflow: hidden;
            animation: slideIn 0.3s ease-out forwards;
        }

        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }

        .contenido-notificacion {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .icono {
            font-size: 20px;
        }

        .mensaje {
            font-size: 14px;
            font-weight: 500;
            color: #333;
        }

        /* Colores por tipo */
        .tipo-exito { border-left: 5px solid #28a745; }
        .tipo-exito .icono { color: #28a745; }
        
        .tipo-error { border-left: 5px solid #dc3545; }
        .tipo-error .icono { color: #dc3545; }
        
        .tipo-alerta { border-left: 5px solid #ffc107; }
        .tipo-alerta .icono { color: #ffc107; }
        
        .tipo-info { border-left: 5px solid #17a2b8; }
        .tipo-info .icono { color: #17a2b8; }

        .barra-progreso {
            position: absolute;
            bottom: 0;
            left: 0;
            height: 3px;
            background: rgba(0,0,0,0.1);
            width: 100%;
            transform-origin: left;
            animation: progress linear forwards;
        }

        @keyframes progress {
            from { transform: scaleX(1); }
            to { transform: scaleX(0); }
        }
    `],
    standalone: false
})
export class NotificacionComponent implements OnInit, OnDestroy {
    notificacion: Notificacion | null = null;
    private subscription: Subscription = new Subscription();
    private timeoutId: any;

    constructor(private notificacionService: NotificacionService) { }

    ngOnInit(): void {
        this.subscription = this.notificacionService.notificacion$.subscribe(notif => {
            this.notificacion = notif;
            
            if (this.timeoutId) {
                clearTimeout(this.timeoutId);
            }

            if (notif) {
                this.timeoutId = setTimeout(() => {
                    this.cerrar();
                }, notif.duracion || 5000);
            }
        });
    }

    cerrar(): void {
        this.notificacion = null;
        this.notificacionService.limpiar();
    }

    ngOnDestroy(): void {
        this.subscription.unsubscribe();
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
        }
    }
}
