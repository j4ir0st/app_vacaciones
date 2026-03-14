import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Area } from '../models/area.model';

@Injectable({
    providedIn: 'root'
})
export class AreaService {
    private readonly URL_AREAS = `${environment.apiUrl}/EU_Area/?format=json`;

    constructor(private http: HttpClient) { }

    // Obtiene la lista completa de áreas
    obtenerAreas(): Observable<Area[]> {
        return this.http.get<any>(this.URL_AREAS).pipe(
            map(resp => Array.isArray(resp) ? resp : (resp.results || []))
        );
    }
}
