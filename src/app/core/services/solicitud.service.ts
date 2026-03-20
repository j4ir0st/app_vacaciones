import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SolicitudVacaciones } from '../models/solicitud-vacaciones.model';

@Injectable({
    providedIn: 'root'
})
export class SolicitudService {
    private readonly URL_SOLICITUDES = `${environment.apiUrl}/SolicitudVacaciones/?format=json`;

    constructor(private http: HttpClient) { }

    // Obtiene todas las solicitudes de vacaciones manejando la paginación recursivamente
    obtenerSolicitudes(url: string = this.URL_SOLICITUDES): Observable<any> {
        const urlFinal = this.fixUrl(url);
        console.log('Solicitando página de solicitudes:', urlFinal);
        return this.http.get<any>(urlFinal);
    }

    // Método de utilidad para cargar todas las páginas y emitir resultados parciales
    // Se recomienda usar este método cuando se necesite procesar los datos de forma acumulativa
    obtenerTodasLasSolicitudes(): Observable<SolicitudVacaciones[]> {
        // Esta implementación delega la carga recursiva al componente para un mejor control visual
        return this.obtenerSolicitudes();
    }

    // Crea una nueva solicitud de vacaciones enviando los datos al servidor DRF
    // Se omiten los campos 'id' y 'url' ya que son generados automáticamente por el backend
    crearSolicitud(datos: Omit<SolicitudVacaciones, 'id' | 'url'>): Observable<SolicitudVacaciones> {
        return this.http.post<SolicitudVacaciones>(this.URL_SOLICITUDES, datos);
    }

    // Actualiza los campos de una solicitud existente mediante el método PATCH
    // Recibe la URL completa de la solicitud y un objeto con los campos a modificar
    actualizarSolicitud(url: string, datos: Partial<SolicitudVacaciones>): Observable<SolicitudVacaciones> {
        // Aseguramos que la petición pida formato JSON explícitamente sin duplicar el parámetro
        let urlConFormato = this.fixUrl(url);
        if (!urlConFormato.includes('format=json')) {
            urlConFormato = urlConFormato.includes('?') ? `${urlConFormato}&format=json` : `${urlConFormato}?format=json`;
        }
        return this.http.patch<SolicitudVacaciones>(urlConFormato, datos);
    }

    // Elimina una solicitud (solo pendientes propias)
    eliminarSolicitud(url: string): Observable<void> {
        return this.http.delete<void>(this.fixUrl(url));
    }

    // Ajusta la URL para usar el proxy en lugar del dominio absoluto (evita CORS)
    private fixUrl(url: string): string {
        if (!url) return '';
        // Si la URL empieza por http, reemplazamos el dominio por el proxy
        if (url.startsWith('http')) {
            return url.replace(/^https?:\/\/[^\/]+/, environment.apiUrl);
        }
        return url.startsWith('/') ? url : `${environment.apiUrl}/${url}`;
    }
}
