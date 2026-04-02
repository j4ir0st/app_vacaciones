import { Component, OnInit } from '@angular/core';
import { forkJoin, EMPTY, from, of } from 'rxjs';
import { expand, map, reduce, concatMap, toArray, catchError } from 'rxjs/operators';
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
    cargandoRow: boolean; // Flag para carga individual
}

@Component({
    selector: 'app-reportes',
    templateUrl: './reportes.component.html',
    styleUrls: ['./reportes.component.css'],
    standalone: false
})
export class ReportesComponent implements OnInit {
    cargando = false;
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
     * Carga inicial de usuarios y disparo de carga asíncrona de solicitudes por fila.
     */
    cargarDatos(): void {
        this.cargando = true;
        this.todasLasFilas = [];

        // 1. Obtenemos todos los usuarios (aprovecha la caché de 24h)
        this.usuarioService.obtenerUsuariosTodo().subscribe({
            next: (listaUsuarios: Usuario[]) => {
                const usuarioActual = this.authService.usuarioActual;
                if (!usuarioActual) {
                    this.cargando = false;
                    return;
                }

                // 2. Filtrar usuarios según lógica de roles
                const usuariosPermitidos = this.filtrarUsuariosSegunRol(usuarioActual, listaUsuarios);

                // 3. Inicializar tabla con valores en cero y estado "cargando"
                this.todasLasFilas = usuariosPermitidos.map(usuario => ({
                    nombre: `${usuario.first_name} ${usuario.last_name}`.trim() || usuario.username,
                    username: usuario.username,
                    area: usuario.area_id?.nombre || usuario.area || 'Sin Área',
                    fechaIngreso: usuario.fecha_ingreso,
                    totalAcumulado: 0,
                    diasUtilizados: 0,
                    diasTruncos: 0,
                    diasPendientes: 0,
                    diasProgramados: 0,
                    claseColor: 'color-blanco',
                    cargandoRow: true
                })).sort((a, b) => a.nombre.localeCompare(b.nombre));

                // Preparar filtros rápidos
                this.areasDisponibles = Array.from(new Set(this.todasLasFilas.map(f => f.area))).sort();
                this.usuariosParaFiltro = this.todasLasFilas.map(f => ({ nombre: f.nombre, username: f.username }));

                // 4. Iniciar la carga asíncrona de solicitudes para cada usuario
                this.procesarCargaPorFila(usuariosPermitidos);
            },
            error: (err) => {
                console.error('Error cargando usuarios para reporte:', err);
                this.cargando = false;
            }
        });
    }

    /**
     * Procesa las solicitudes de cada usuario de forma independiente para no bloquear la UI.
     */
    private procesarCargaPorFila(usuarios: Usuario[]): void {
        // Usamos from() para convertir el array en un stream y procesar cada uno
        from(usuarios).pipe(
            concatMap(u => {
                // Filtramos por el ID numérico proporcionado por el backend
                const params = `&usuario_id=${u.id}`;
                
                // Construimos la URL inicial con el filtro de usuario
                const urlInicial = `${this.solicitudService.URL_SOLICITUDES}${params}`;
                
                return this.solicitudService.obtenerSolicitudes(urlInicial).pipe(
                    // Lógica para obtener todas las páginas de solicitudes del usuario específico
                    expand((resp: any) => resp.next ? this.solicitudService.obtenerSolicitudes(resp.next + params) : EMPTY),
                    // Nota: El backend de DRF a veces pierde los filtros en el 'next' si no están bien configurados,
                    // por eso concatenamos el params si no existe en la URL de next.
                    map((resp: any) => {
                        const results = Array.isArray(resp) ? resp : (resp.results || []);
                        return results.filter((s: any) => {
                            // usuario_id puede ser un objeto o un string
                            const idParaComparar = typeof s.usuario_id === 'string' ? s.usuario_id : '';
                            if (!idParaComparar && typeof s.usuario_id === 'object') return true;

                            const solUrl = idParaComparar.toLowerCase().replace(/\/$/, '');
                            const userUrl = (u.url || '').toLowerCase().replace(/\/$/, '');
                            return solUrl === userUrl || solUrl.endsWith(userUrl) || userUrl.endsWith(solUrl);
                        });
                    }),
                    reduce((acc: any[], curr: any[]) => acc.concat(curr), []),
                    map(solicitudes => ({ usuario: u, solicitudes })),
                    catchError(err => {
                        console.error(`Error cargando solicitudes para ${u.username}:`, err);
                        return of({ usuario: u, solicitudes: [] });
                    })
                );
            })
        ).subscribe({
            next: (resultado) => {
                this.actualizarFilaConDatos(resultado.usuario, resultado.solicitudes);
                // Si ya no quedan filas cargando, detenemos el spinner general
                if (!this.todasLasFilas.some(f => f.cargandoRow)) {
                    this.cargando = false;
                }
            },
            complete: () => {
                this.cargando = false;
            }
        });
    }

    /**
     * Realiza los cálculos de vacaciones para un usuario específico y actualiza su fila.
     */
    private actualizarFilaConDatos(usuario: Usuario, solicitudes: SolicitudVacaciones[]): void {
        const index = this.todasLasFilas.findIndex(f => f.username === usuario.username);
        if (index === -1) return;

        const resumen = this.vacacionesService.calcularResumen(usuario.fecha_ingreso, solicitudes);

        // Días programados: Solicitudes en estado Pendiente (PD) o Aprobado Supervisor (AS)
        const diasProgramados = solicitudes
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

        this.todasLasFilas[index] = {
            ...this.todasLasFilas[index],
            totalAcumulado: resumen.diasAcumulados,
            diasUtilizados: resumen.diasTomados,
            diasTruncos: resumen.diasTruncos,
            diasPendientes: resumen.diasPendientes,
            diasProgramados: diasProgramados,
            claseColor: claseColor,
            cargandoRow: false
        };
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

