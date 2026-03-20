import { Component, OnInit } from '@angular/core';
import { forkJoin, EMPTY } from 'rxjs';
import { expand, map, reduce } from 'rxjs/operators';
import { AuthService } from '../core/services/auth.service';
import { SolicitudService } from '../core/services/solicitud.service';
import { UsuarioService } from '../core/services/usuario.service';
import { VacacionesService } from '../core/services/vacaciones.service';
import { Usuario } from '../core/models/usuario.model';
import { SolicitudVacaciones } from '../core/models/solicitud-vacaciones.model';
import { environment } from '../../environments/environment';

interface FilaReporte {
    nombre: string;
    area: string;
    fechaIngreso: string;
    totalAcumulado: number;
    diasUtilizados: number;
    diasTruncos: number;
    diasPendientes: number;
    diasProgramados: number;
}

@Component({
    selector: 'app-reportes',
    templateUrl: './reportes.component.html',
    styleUrls: ['./reportes.component.css'],
    standalone: false
})
export class ReportesComponent implements OnInit {
    cargando = true;
    textoBusqueda = '';
    filtroArea = '';
    
    todasFilas: FilaReporte[] = [];
    areas: string[] = [];

    constructor(
        private authService: AuthService,
        private solicitudService: SolicitudService,
        private usuarioService: UsuarioService,
        public vacacionesService: VacacionesService
    ) { }

    ngOnInit(): void {
        this.cargarDatos();
    }

    cargarDatos(): void {
        this.cargando = true;

        const reqSolicitudes = this.solicitudService.obtenerSolicitudes().pipe(
            expand((resp: any) => resp.next ? this.solicitudService.obtenerSolicitudes(resp.next) : EMPTY),
            map((resp: any) => Array.isArray(resp) ? resp : (resp.results || [])),
            reduce((acc: any[], curr: any[]) => acc.concat(curr), [])
        );

        const reqUsuarios = this.usuarioService.obtenerUsuarios().pipe(
            expand((resp: any) => resp.next ? this.usuarioService.obtenerUsuarios(resp.next) : EMPTY),
            map((resp: any) => Array.isArray(resp) ? resp : (resp.results || [])),
            reduce((acc: any[], curr: any[]) => acc.concat(curr), [])
        );

        forkJoin([reqSolicitudes, reqUsuarios]).subscribe({
            next: ([listaSolicitudes, listaUsuarios]: [SolicitudVacaciones[], Usuario[]]) => {
                this.todasFilas = listaUsuarios.map(user => {
                    const solUsuario = listaSolicitudes.filter(s => {
                        const solUrl = (s.usuario_id || '').toLowerCase().replace(/\/$/, '');
                        const userUrl = (user.url || '').toLowerCase().replace(/\/$/, '');
                        return solUrl === userUrl || solUrl.endsWith(userUrl) || userUrl.endsWith(solUrl);
                    });

                    const resumen = this.vacacionesService.calcularResumen(user.fecha_ingreso, solUsuario);
                    
                    // Días programados: Solicitudes en estado Pendiente (PD) o Aprobado Supervisor (AS)
                    const diasProgramados = solUsuario
                        .filter(s => {
                            const cod = this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud);
                            return cod === 'PD' || cod === 'AS';
                        })
                        .reduce((sum, s) => sum + (s.total_periodo || 0), 0);

                    return {
                        nombre: `${user.first_name} ${user.last_name}`.trim() || user.username,
                        area: user.area_id?.nombre || user.area || 'Sin Área',
                        fechaIngreso: user.fecha_ingreso,
                        totalAcumulado: resumen.diasAcumulados,
                        diasUtilizados: resumen.diasTomados,
                        diasTruncos: resumen.diasTruncos,
                        diasPendientes: resumen.diasPendientes,
                        diasProgramados: diasProgramados
                    };
                }).sort((a, b) => a.nombre.localeCompare(b.nombre));

                // Extraer áreas únicas para el filtro
                this.areas = Array.from(new Set(this.todasFilas.map(f => f.area))).sort();
                this.cargando = false;
            },
            error: (err) => {
                console.error('Error cargando datos de reporte:', err);
                this.cargando = false;
            }
        });
    }


    get filasFiltradas(): FilaReporte[] {
        return this.todasFilas.filter(f => {
            const matchNombre = f.nombre.toLowerCase().includes(this.textoBusqueda.toLowerCase());
            const matchArea = !this.filtroArea || f.area === this.filtroArea;
            return matchNombre && matchArea;
        });
    }

    descargarReporte(): void {
        if (this.filasFiltradas.length === 0) return;

        const headers = ['Nombre', 'Área', 'Fecha Ingreso', 'Total Acumulado', 'Días Utilizados', 'Días Truncos', 'Días Pendientes', 'Días Programados'];
        const rows = this.filasFiltradas.map(f => [
            f.nombre,
            f.area,
            f.fechaIngreso,
            f.totalAcumulado.toString().replace('.', ','),
            f.diasUtilizados.toString().replace('.', ','),
            f.diasTruncos.toString().replace('.', ','),
            f.diasPendientes.toString().replace('.', ','),
            f.diasProgramados.toString().replace('.', ',')
        ]);

        const csvContent = [
            headers.join(';'),
            ...rows.map(r => r.join(';'))
        ].join('\n');

        const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `Reporte_Vacaciones_${new Date().toISOString().slice(0,10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    refrescar(): void {
        this.cargarDatos();
    }
}
