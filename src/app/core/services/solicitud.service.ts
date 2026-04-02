import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SolicitudVacaciones } from '../models/solicitud-vacaciones.model';

@Injectable({
    providedIn: 'root'
})
export class SolicitudService {
    public readonly URL_SOLICITUDES = `${environment.apiUrl}/SolicitudVacaciones/?format=json`;

    constructor(private http: HttpClient) { }

    // Genera el objeto de filtros para nombres de área basado en los permisos del usuario
    obtenerFiltroArea(areas: string[]): any {
        if (!areas || areas.length === 0) return {};
        return { area_nombre: areas.join(',') };
    }

    // Obtiene solicitudes con soporte opcional para filtros (query params)
    obtenerSolicitudes(url: string = this.URL_SOLICITUDES, params?: any): Observable<any> {
        let urlFinal = this.fixUrl(url);
        
        // Si hay parámetros adicionales, los agregamos conservando los existentes
        if (params) {
            const currentUrl = new URL(urlFinal, window.location.origin);
            Object.keys(params).forEach(key => {
                if (params[key] !== undefined && params[key] !== null) {
                    currentUrl.searchParams.set(key, params[key]);
                }
            });
            urlFinal = currentUrl.toString().replace(window.location.origin, '');
        }

        console.log('Solicitando solicitudes:', urlFinal);
        return this.http.get<any>(urlFinal);
    }

    // Obtiene el historial completo de un usuario por su username
    obtenerHistorialPorUsername(username: string): Observable<SolicitudVacaciones[]> {
        return this.obtenerSolicitudes(this.URL_SOLICITUDES, { username: username });
    }

    // Asegura que la URL del avatar sea absoluta
    obtenerUrlAvatar(path: string | null | undefined): string | null {
        if (!path) return null;
        if (path.startsWith('http')) return path;
        // Limpiamos el path si tiene prefijos redundantes
        const cleanPath = path.startsWith('/') ? path : `/${path}`;
        return `${environment.apiUrl}${cleanPath}`;
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

    // Envía la notificación de aprobación por correo (Gerente)
    enviarNotificacion(url: string): Observable<any> {
        const base = this.fixUrl(this.cleanUrl(url));
        return this.http.post<any>(`${base}enviar-notificacion/?format=json`, {});
    }

    // Descarga el PDF oficial de la solicitud
    descargarPDF(url: string): Observable<Blob> {
        const base = this.fixUrl(this.cleanUrl(url));
        return this.http.get(`${base}descargar-pdf/`, { responseType: 'blob' });
    }

    // Limpia la URL de parámetros de consulta y asegura el slash final
    private cleanUrl(url: string): string {
        if (!url) return '';
        let clean = url.split('?')[0];
        if (!clean.endsWith('/')) {
            clean += '/';
        }
        return clean;
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
