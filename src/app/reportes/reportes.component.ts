import { Component, OnInit } from '@angular/core';
import { forkJoin, EMPTY, from, of } from 'rxjs';
import { expand, map, reduce, concatMap, toArray } from 'rxjs/operators';
import { AuthService } from '../core/services/auth.service';
import { SolicitudService } from '../core/services/solicitud.service';
import { UsuarioService } from '../core/services/usuario.service';
import { VacacionesService } from '../core/services/vacaciones.service';
import { Usuario } from '../core/models/usuario.model';
import { SolicitudVacaciones } from '../core/models/solicitud-vacaciones.model';

interface FilaReporte {
    nombre: string;
    username: string;
    area: string;
    fechaIngreso: string;
    totalAcumulado: number;
    diasUtilizados: number;
    diasTruncos: number;
    diasPendientes: number;
    diasProgramados: number;
    claseColor: string;
}

@Component({
    selector: 'app-reportes',
    templateUrl: './reportes.component.html',
    styleUrls: ['./reportes.component.css'],
    standalone: false
})
export class ReportesComponent implements OnInit {
    cargando = true;
    usuarioSeleccionado: string = ''; // Almacena el username para el filtro
    filtroArea = '';

    todasLasFilas: FilaReporte[] = [];
    areasDisponibles: string[] = [];
    usuariosParaFiltro: { nombre: string, username: string }[] = [];

    constructor(
        private authService: AuthService,
        private solicitudService: SolicitudService,
        private usuarioService: UsuarioService,
        public vacacionesService: VacacionesService
    ) { }

    ngOnInit(): void {
        this.cargarDatos();
    }

    /**
     * Carga inicial de datos de solicitudes y usuarios de manera asíncrona.
     */
    cargarDatos(): void {
        this.cargando = true;

        // Petición recursiva para obtener todas las solicitudes (DRF pagination)
        const peticionSolicitudes = this.solicitudService.obtenerSolicitudes().pipe(
            expand((resp: any) => resp.next ? this.solicitudService.obtenerSolicitudes(resp.next) : EMPTY),
            map((resp: any) => Array.isArray(resp) ? resp : (resp.results || [])),
            reduce((acc: any[], curr: any[]) => acc.concat(curr), [])
        );

        // Petición recursiva para obtener todos los usuarios (DRF pagination)
        const peticionUsuarios = this.usuarioService.obtenerUsuarios().pipe(
            expand((resp: any) => resp.next ? this.usuarioService.obtenerUsuarios(resp.next) : EMPTY),
            map((resp: any) => Array.isArray(resp) ? resp : (resp.results || [])),
            reduce((acc: any[], curr: any[]) => acc.concat(curr), [])
        );

        forkJoin([peticionSolicitudes, peticionUsuarios]).subscribe({
            next: ([listaSolicitudes, listaUsuarios]: [SolicitudVacaciones[], Usuario[]]) => {
                const usuarioActual = this.authService.usuarioActual;
                if (!usuarioActual) {
                    this.cargando = false;
                    return;
                }

                // Aplicar lógica de filtrado heredada de PowerApps
                const usuariosPermitidos = this.filtrarUsuariosSegunRol(usuarioActual, listaUsuarios);

                this.todasLasFilas = usuariosPermitidos.map(usuario => {
                    const solicitudesDelUsuario = listaSolicitudes.filter(s => {
                        const solUrl = (s.usuario_id || '').toLowerCase().replace(/\/$/, '');
                        const userUrl = (usuario.url || '').toLowerCase().replace(/\/$/, '');
                        return solUrl === userUrl || solUrl.endsWith(userUrl) || userUrl.endsWith(solUrl);
                    });

                    const resumen = this.vacacionesService.calcularResumen(usuario.fecha_ingreso, solicitudesDelUsuario);

                    // Días programados: Solicitudes en estado Pendiente (PD) o Aprobado Supervisor (AS)
                    const diasProgramados = solicitudesDelUsuario
                        .filter(s => {
                            const cod = this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud);
                            return cod === 'PD' || cod === 'AS';
                        })
                        .reduce((sum, s) => sum + (s.total_periodo || 0), 0);

                    // Lógica de color según días pendientes
                    let claseColor = 'color-blanco';
                    if (resumen.diasPendientes >= 60) {
                        claseColor = 'color-rojo-rechazado';
                    } else if (resumen.diasPendientes >= 30) {
                        claseColor = 'color-amarillo-pendiente';
                    }

                    return {
                        nombre: `${usuario.first_name} ${usuario.last_name}`.trim() || usuario.username,
                        username: usuario.username,
                        area: usuario.area_puesto?.area_nombre || usuario.area_id?.nombre || usuario.area || 'Sin Área',
                        fechaIngreso: usuario.fecha_ingreso,
                        totalAcumulado: resumen.diasAcumulados,
                        diasUtilizados: resumen.diasTomados,
                        diasTruncos: resumen.diasTruncos,
                        diasPendientes: resumen.diasPendientes,
                        diasProgramados: diasProgramados,
                        claseColor: claseColor
                    };
                }).sort((a, b) => a.nombre.localeCompare(b.nombre));

                // Preparar filtros
                this.areasDisponibles = Array.from(new Set(this.todasLasFilas.map(f => f.area))).sort();
                this.usuariosParaFiltro = this.todasLasFilas.map(f => ({ nombre: f.nombre, username: f.username }));

                this.cargando = false;
            },
            error: (err) => {
                console.error('Error cargando datos de reporte:', err);
                this.cargando = false;
            }
        });
    }

    /**
     * Implementa la lógica de PowerApps para filtrar usuarios visibles.
     */
    private filtrarUsuariosSegunRol(autor: Usuario, lista: Usuario[]): Usuario[] {
        const puesto = (autor.puesto_id?.nombre || '').toLowerCase();
        const area = (autor.area_id?.nombre || '').toLowerCase();
        const esGerenteOJefe = puesto.includes('gerente') || puesto.includes('jefe');

        if (esGerenteOJefe) {
            // Caso especial: Katherine Lewis (basado en username 'klewis')
            if (autor.username.toLowerCase() === 'klewis') {
                const areasKatherine = [
                    'contabilidad', 'mantenimiento', 'provincia', 'vigilancia', 'finanzas',
                    'neurocirugía', 'traumatología', 'heridas y quemados', 'regulatorios',
                    'terapia de sueño y apnea', 'ingeniería', 'marketing', 'licitaciones',
                    'equipos médicos', 'casa', 'cdc'
                ];
                return lista.filter(u => {
                    const areaU = (u.area_id?.nombre || '').toLowerCase();
                    return areasKatherine.includes(areaU);
                });
            }

            // Caso especial: Operaciones
            if (area === 'operaciones') {
                const areasOperaciones = [
                    'distribución', 'atenciones', 'almacenes', 'facturación',
                    'desarrollo software', 'logística inversa'
                ];
                return lista.filter(u => {
                    const areaU = (u.area_id?.nombre || '').toLowerCase();
                    return areasOperaciones.includes(areaU);
                });
            }

            // Gerente/Jefe estándar ve solo su área
            return lista.filter(u => {
                const areaU = (u.area_id?.nombre || '').toLowerCase();
                return areaU === area;
            });
        }

        // Otros roles ven solo su propia área
        return lista.filter(u => {
            const areaU = (u.area_id?.nombre || '').toLowerCase();
            return areaU === area;
        });
    }

    get filasFiltradas(): FilaReporte[] {
        return this.todasLasFilas.filter(f => {
            const coincideUsuario = !this.usuarioSeleccionado || f.username === this.usuarioSeleccionado;
            const coincideArea = !this.filtroArea || f.area === this.filtroArea;
            return coincideUsuario && coincideArea;
        });
    }

    descargarReporte(): void {
        if (this.filasFiltradas.length === 0) return;

        const cabeceras = ['Nombre', 'Área', 'Fecha Ingreso', 'Total Acumulado', 'Días Utilizados', 'Días Truncos', 'Días Pendientes', 'Días Programados'];
        const registros = this.filasFiltradas.map(f => [
            f.nombre,
            f.area,
            f.fechaIngreso,
            f.totalAcumulado.toString().replace('.', ','),
            f.diasUtilizados.toString().replace('.', ','),
            f.diasTruncos.toString().replace('.', ','),
            f.diasPendientes.toString().replace('.', ','),
            f.diasProgramados.toString().replace('.', ',')
        ]);

        const contenidoCsv = [
            cabeceras.join(';'),
            ...registros.map(r => r.join(';'))
        ].join('\n');

        const blob = new Blob(['\ufeff' + contenidoCsv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `Reporte_Vacaciones_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    resetearFiltros(): void {
        this.usuarioSeleccionado = '';
        this.filtroArea = '';
    }

    refrescar(): void {
        this.cargarDatos();
    }
}

