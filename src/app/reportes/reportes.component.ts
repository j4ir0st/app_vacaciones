import { Component, OnInit } from '@angular/core';
import { EMPTY, from, of } from 'rxjs';
import { expand, map, reduce, concatMap, catchError } from 'rxjs/operators';
import * as XLSX from 'xlsx';
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
    puesto: string;
    empresa: string;
    fechaIngreso: string;
    totalAcumulado: number;
    diasUtilizados: number;
    diasTruncos: number;
    diasPendientes: number;
    diasProgramados: number;
    prog1: string;
    prog2: string;
    prog3: string;
    claseColor: string;
    cargandoRow: boolean; // Flag para carga individual
    solicitudes: SolicitudVacaciones[]; // Historial para el detalle
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

    // Filtro de área multi-selección
    filtroAreas: string[] = [];
    mostrarFiltroArea = false;

    // Filtro de oficina (visible solo para RR.HH. y Gerente Operaciones)
    filtroOficina: 'todas' | 'caminitos' | 'batallon' = 'todas';
    mostrarFiltroOficina = false;

    // Áreas que pertenecen a la oficina Batallón (igual que las áreas de klewis)
    readonly AREAS_BATALLON = [
        'contabilidad', 'mantenimiento', 'provincia', 'vigilancia', 'finanzas',
        'neurocirugía', 'traumatología', 'heridas y quemados', 'regulatorios',
        'terapia de sueño y apnea', 'ingeniería', 'marketing', 'licitaciones',
        'equipos médicos', 'casa', 'cdc'
    ];

    todasLasFilas: FilaReporte[] = [];
    areasDisponibles: string[] = [];
    filaSeleccionada: FilaReporte | null = null;

    // Combobox de usuario con buscador
    usuariosFiltrados: Usuario[] = [];
    textoBusquedaUsuario = '';
    mostrarResultadosUsuario = false;

    // Fecha de corte para el reporte completo (antes llamada "Hasta")
    fechaHasta = '';

    // Propiedades del calendario picker personalizado
    readonly DIAS_SEMANA = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
    readonly MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    calendarActivo: 'hasta' | null = null;
    mesVista = 0;
    anioVista = 0;
    diaTemp = '';

    constructor(
        private authService: AuthService,
        private solicitudService: SolicitudService,
        private usuarioService: UsuarioService,
        public vacacionesService: VacacionesService
    ) { }

    ngOnInit(): void {
        this.cargarDatos();
        this.usuarioService.inicializarMapa().subscribe();
    }

    /**
     * Carga inicial de usuarios y disparo de carga asíncrona de solicitudes por fila.
     */
    cargarDatos(): void {
        this.cargando = true;
        this.todasLasFilas = [];

        // 1. Obtenemos todos los usuarios activos (filtro backend is_active=true)
        this.usuarioService.obtenerUsuariosTodo(false, true).subscribe({
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
                    area: usuario.area_id?.nombre || 'Sin Área',
                    puesto: usuario.puesto_id?.nombre || 'Sin Puesto',
                    empresa: usuario.empr_id || 'Sin Empresa',
                    fechaIngreso: usuario.fecha_ingreso,
                    totalAcumulado: 0,
                    diasUtilizados: 0,
                    diasTruncos: 0,
                    diasPendientes: 0,
                    diasProgramados: 0,
                    prog1: '-',
                    prog2: '-',
                    prog3: '-',
                    claseColor: 'color-blanco',
                    cargandoRow: true,
                    solicitudes: []
                })).sort((a, b) => a.nombre.localeCompare(b.nombre));

                // Preparar filtros rápidos
                this.areasDisponibles = Array.from(new Set(this.todasLasFilas.map(f => f.area))).sort();
                this.usuariosFiltrados = usuariosPermitidos;

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

        // 1. Calcular el resumen oficial (mantiene la lógica de Pendientes original que resta todo lo aprobado)
        const resumen = this.vacacionesService.calcularResumen(usuario.fecha_ingreso, solicitudes);

        // 2. Identificar solicitudes aprobadas para el desglose temporal
        const solicitudesAprobadas = solicitudes.filter(s => {
            const cod = this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud);
            return cod === 'AP' || cod === 'AS';
        });

        // 3. Separar por tiempo usando fecha_inicio
        const diasProgramados = solicitudesAprobadas
            .filter(s => this.vacacionesService.esFechaFutura(s.fecha_inicio))
            .reduce((sum, s) => sum + (s.total_periodo || 0), 0);

        const diasGozados = solicitudesAprobadas
            .filter(s => !this.vacacionesService.esFechaFutura(s.fecha_inicio))
            .reduce((sum, s) => sum + (s.total_periodo || 0), 0);

        // Lógica de color según días pendientes (mantenemos el original del resumen)
        let claseColor = 'color-blanco';
        if (resumen.diasPendientes >= 60) {
            claseColor = 'color-rojo-rechazado';
        } else if (resumen.diasPendientes >= 30) {
            claseColor = 'color-amarillo-pendiente';
        }

        const sugerencias = this.vacacionesService.calcularSugerenciasProgramacion(resumen.diasPendientes, usuario.fecha_ingreso);

        this.todasLasFilas[index] = {
            ...this.todasLasFilas[index],
            totalAcumulado: resumen.diasAcumulados,
            diasUtilizados: diasGozados, // Solo Gozados (<= hoy) en esta columna
            diasTruncos: resumen.diasTruncos,
            diasPendientes: resumen.diasPendientes, // Mantenemos cálculo original (Resta todo)
            diasProgramados: diasProgramados, // Solo Programados (> hoy)
            prog1: sugerencias.prog1,
            prog2: sugerencias.prog2,
            prog3: sugerencias.prog3,
            claseColor: claseColor,
            cargandoRow: false,
            solicitudes: solicitudes
        };
    }

    verDetalle(fila: FilaReporte): void {
        if (fila.cargandoRow) return;
        this.filaSeleccionada = fila;
    }

    cerrarDetalle(): void {
        this.filaSeleccionada = null;
    }

    claseEstado(estado: any): string {
        const cod = this.vacacionesService.obtenerCodigoEstado(estado);
        switch (cod) {
            case 'AP': return 'status-aprobado';
            case 'RC': return 'status-rechazado';
            case 'PD': return 'status-pendiente';
            case 'AS': return 'status-supervisor';
            case 'CN': return 'status-cancelado';
            default: return 'status-pendiente';
        }
    }

    /**
     * Implementa la lógica de PowerApps para filtrar usuarios visibles.
     */
    private filtrarUsuariosSegunRol(autor: Usuario, lista: Usuario[]): Usuario[] {
        // Filtro base obligatorio: excluye inactivos, sin fecha de ingreso y sin área.
        // Aplica a TODOS los perfiles antes de cualquier lógica de rol.
        const listaValida = lista.filter(u =>
            u.is_active === true &&
            !!u.fecha_ingreso &&
            u.area_id != null
        );

        // Personal de Recursos Humanos: ve todos los colaboradores para reportes
        if (this.authService.esRecursosHumanos) {
            return listaValida;
        }

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
                return listaValida.filter(u => {
                    const areaU = (u.area_id?.nombre || '').toLowerCase();
                    return areasKatherine.includes(areaU);
                });
            }

            // Caso especial: Gerente de Operaciones ve todo el personal
            if (area === 'operaciones') {
                return listaValida;
            }

            // Gerente/Jefe estándar ve solo su área
            return listaValida.filter(u => {
                const areaU = (u.area_id?.nombre || '').toLowerCase();
                return areaU === area;
            });
        }

        // Otros roles ven solo su propia área
        return listaValida.filter(u => {
            const areaU = (u.area_id?.nombre || '').toLowerCase();
            return areaU === area;
        });
    }

    get filasFiltradas(): FilaReporte[] {
        return this.todasLasFilas.filter(f => {
            // Filtro por colaborador
            if (this.usuarioSeleccionado && f.username !== this.usuarioSeleccionado) return false;

            // Filtro por oficina (Caminitos / Batallón)
            if (this.filtroOficina !== 'todas') {
                const areaNorm = (f.area || '').toLowerCase();
                const esBatallon = this.AREAS_BATALLON.includes(areaNorm);
                if (this.filtroOficina === 'batallon' && !esBatallon) return false;
                if (this.filtroOficina === 'caminitos' && esBatallon) return false;
            }

            // Filtro por áreas seleccionadas (multi-selección)
            if (this.filtroAreas.length > 0 && !this.filtroAreas.includes(f.area)) return false;

            return true;
        });
    }

    // ¿Puede este usuario ver el filtro de Oficina?
    get puedeVerFiltroOficina(): boolean {
        if (this.authService.esRecursosHumanos) return true;
        const usuario = this.authService.usuarioActual;
        if (!usuario) return false;
        const puesto = (usuario.puesto_id?.nombre || '').toLowerCase();
        const area = (usuario.area_id?.nombre || '').toLowerCase();
        return (puesto.includes('gerente') || puesto.includes('jefe')) && area === 'operaciones';
    }

    // Texto resumen de las áreas seleccionadas para mostrar en el botón del filtro
    get textoFiltroAreas(): string {
        if (this.filtroAreas.length === 0) return 'Todas las áreas';
        if (this.filtroAreas.length === 1) return this.filtroAreas[0];
        return `${this.filtroAreas.length} áreas seleccionadas`;
    }

    // Alterna la selección de un área en el filtro multi-selección
    toggleFiltroArea(area: string): void {
        const idx = this.filtroAreas.indexOf(area);
        if (idx >= 0) {
            this.filtroAreas.splice(idx, 1);
        } else {
            this.filtroAreas.push(area);
        }
    }

    // Devuelve true si el área está en la lista activa del filtro oficina
    areaEnOficinaActiva(area: string): boolean {
        if (this.filtroOficina === 'todas') return true;
        const areaNorm = area.toLowerCase();
        const esBatallon = this.AREAS_BATALLON.includes(areaNorm);
        if (this.filtroOficina === 'batallon') return esBatallon;
        return !esBatallon; // caminitos
    }

    // true cuando ninguna área disponible pertenece a la oficina activa (para el mensaje vacío)
    get sinAreasEnOficina(): boolean {
        return this.areasDisponibles.every(a => !this.areaEnOficinaActiva(a));
    }

    // Getter para el combobox buscador de usuarios
    get usuariosBuscados(): Usuario[] {
        const busqueda = this.textoBusquedaUsuario.toLowerCase().trim();
        let base = this.usuariosFiltrados;

        // Aplicar filtro de oficina
        if (this.filtroOficina !== 'todas') {
            base = base.filter(u => this.areaEnOficinaActiva(u.area_id?.nombre || ''));
        }

        // Aplicar filtro de áreas seleccionadas
        if (this.filtroAreas.length > 0) {
            base = base.filter(u => this.filtroAreas.includes(u.area_id?.nombre || ''));
        }

        if (!busqueda) return base;
        return base.filter(u => {
            const nombreCompleto = `${u.first_name} ${u.last_name}`.toLowerCase();
            return nombreCompleto.includes(busqueda);
        });
    }

    // Obtiene el nombre del usuario seleccionado para mostrar en el Combobox
    getNombreUsuarioSeleccionado(): string {
        if (!this.usuarioSeleccionado) return 'Filtrar por Colaborador';
        const user = this.usuariosFiltrados.find(u => u.username === this.usuarioSeleccionado);
        return user ? `${user.first_name} ${user.last_name}` : 'Filtrar por Colaborador';
    }

    // Selecciona un usuario del combobox
    seleccionarUsuarioCombobox(u: Usuario): void {
        this.usuarioSeleccionado = u.username || '';
        this.textoBusquedaUsuario = '';
        this.mostrarResultadosUsuario = false;
    }

    // Limpia la selección de usuario
    limpiarSeleccionUsuario(): void {
        this.usuarioSeleccionado = '';
        this.textoBusquedaUsuario = '';
        this.mostrarResultadosUsuario = false;
    }

    // Genera iniciales para el avatar
    obtenerIniciales(nombre: string): string {
        if (!nombre) return 'U';
        return nombre.split(' ')
            .filter(n => n)
            .map(n => n[0])
            .join('')
            .substring(0, 2)
            .toUpperCase();
    }

    private obtenerNombreEmpresa(id: number): string {
        const empresas: { [key: number]: string } = {
            1: 'Surgicorp',
            2: 'Surgivision',
            3: 'Surgilab',
            4: 'Surgimed'
        };
        return empresas[id] || 'N/A';
    }

    descargarDetallesFila(fila: FilaReporte): void {
        if (!fila || fila.solicitudes.length === 0) return;

        const cabeceras = [
            'id_solicitud', 'fecha_solicitud', 'tipo_solicitud', 'estado_solicitud',
            'jefe', 'fecha_jefe', 'gerente', 'fecha_gerente',
            'fecha_inicio', 'fecha_final', 'total_periodo', 'motivo', 'observaciones'
        ];

        const registros = fila.solicitudes.map(sol => {
            const tipoMap: Record<string, string> = { 'AT': 'Autorizado', 'AD': 'Adelanto' };

            const idSolicitud = sol.url?.split('?')[0].split('/').filter(x => x).pop() || '';

            return [
                idSolicitud,
                this.vacacionesService.formatearFechaHora(sol.fecha_solicitud || ''),
                tipoMap[sol.tipo_solicitud || ''] || sol.tipo_solicitud || '',
                this.vacacionesService.obtenerLabelEstado(sol.estado_solicitud),
                this.usuarioService.resolverNombrePorUrl(sol.jefe_id),
                this.vacacionesService.formatearFechaHora(sol.fecha_jefe || ''),
                this.usuarioService.resolverNombrePorUrl(sol.gerente_id),
                this.vacacionesService.formatearFechaHora(sol.fecha_gerente || ''),
                this.vacacionesService.formatearFechaCompleta(sol.fecha_inicio || ''),
                this.vacacionesService.formatearFechaCompleta(sol.fecha_final || ''),
                sol.total_periodo.toString(),
                (sol.motivo || '').replace(/;/g, '-').replace(/\n/g, ' '),
                (sol.obs || '').replace(/;/g, '-').replace(/\n/g, ' ')
            ];
        });

        const contenido = [cabeceras, ...registros].map(e => e.join(';')).join('\n');
        const blob = new Blob(['\ufeff' + contenido], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `Detalle_Vacaciones_${fila.nombre.replace(/ /g, '_')}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    private exportarCSV(cabeceras: string[], filas: any[][], nombreArchivo: string): void {
        const contenidoCsv = [
            cabeceras.join(';'),
            ...filas.map(r => r.join(';'))
        ].join('\n');

        const blob = new Blob(['\ufeff' + contenidoCsv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `${nombreArchivo}_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    descargarReporte(): void {
        if (this.filasFiltradas.length === 0) return;

        const aplicarFiltroFechas = this.fechaHasta;
        const cabeceras = ['Nombre', 'Área', 'Puesto', 'Empresa', 'Fecha Ingreso', 'Total Acumulado', 'Días Gozados', 'Días Truncos', 'Días Pendientes', 'Días Programados'];
        let registros: string[][];
        let nombreArchivo: string;

        if (!aplicarFiltroFechas) {
            // Sin filtro de fechas: descarga lo que está en pantalla tal cual
            registros = this.filasFiltradas.map(f => [
                f.nombre, f.area, f.puesto, f.empresa, f.fechaIngreso,
                f.totalAcumulado.toString().replace('.', ','),
                f.diasUtilizados.toString().replace('.', ','),
                f.diasTruncos.toString().replace('.', ','),
                f.diasPendientes.toString().replace('.', ','),
                f.diasProgramados.toString().replace('.', ',')
            ]);
            nombreArchivo = 'Reporte_Vacaciones_Completo';
        } else {
            // Con filtro de fechas: todos los usuarios en pantalla se incluyen,
            // los campos se recalculan usando fechaHasta como fecha de corte
            const hasta = this.fechaHasta ? new Date(this.fechaHasta + 'T00:00:00') : new Date();
            hasta.setHours(23, 59, 59, 999);

            registros = this.filasFiltradas.map(f => {
                const corte = this.calcularResumenConCorte(f.fechaIngreso, f.solicitudes, hasta);
                return [
                    f.nombre, f.area, f.puesto, f.empresa, f.fechaIngreso,
                    corte.totalAcumulado.toString().replace('.', ','),
                    corte.diasGozados.toString().replace('.', ','),
                    corte.diasTruncos.toString().replace('.', ','),
                    corte.diasPendientes.toString().replace('.', ','),
                    corte.diasProgramados.toString().replace('.', ',')
                ];
            });

            nombreArchivo = `Reporte_Vacaciones_Corte_${this.fechaHasta}`;
        }

        this.exportarCSV(cabeceras, registros, nombreArchivo);
    }

    /**
     * Recalcula todos los campos de vacaciones usando una fecha de corte personalizada.
     * Replica la fórmula PowerApps de calcularResumen() con fecha configurable en vez de hoy.
     */
    private calcularResumenConCorte(
        fechaIngreso: string,
        solicitudes: SolicitudVacaciones[],
        fechaCorte: Date
    ): { totalAcumulado: number; diasGozados: number; diasTruncos: number; diasPendientes: number; diasProgramados: number } {

        const ingreso = new Date(fechaIngreso + 'T00:00:00');

        // Meses cumplidos hasta la fecha de corte (misma fórmula que VacacionesService)
        let mesesCompletos = (fechaCorte.getFullYear() - ingreso.getFullYear()) * 12
            + (fechaCorte.getMonth() - ingreso.getMonth());
        if (fechaCorte.getDate() < ingreso.getDate()) mesesCompletos--;
        const mesesCumplidos = Math.max(0, mesesCompletos);

        // Total acumulado al corte (2.5 días por mes)
        const totalAcumulado = mesesCumplidos * 2.5;

        // Separar solicitudes AP/AS en gozadas (<=corte) y programadas (>corte)
        const aprobadas = solicitudes.filter(s => {
            const cod = this.vacacionesService.obtenerCodigoEstado(s.estado_solicitud);
            return cod === 'AP' || cod === 'AS';
        });

        const diasGozados = aprobadas
            .filter(s => s.fecha_inicio && new Date(s.fecha_inicio + 'T00:00:00') <= fechaCorte)
            .reduce((sum, s) => sum + (s.total_periodo || 0), 0);

        const diasProgramados = aprobadas
            .filter(s => s.fecha_inicio && new Date(s.fecha_inicio + 'T00:00:00') > fechaCorte)
            .reduce((sum, s) => sum + (s.total_periodo || 0), 0);

        // Pendientes y Truncos con la misma fórmula de PowerApps
        const diasDeAniosCompletos = Math.floor(totalAcumulado / 30) * 30;
        const diasPendientesPotencial = diasDeAniosCompletos - diasGozados;
        const diasPendientes = Math.max(0, diasPendientesPotencial);

        const remanenteAnual = totalAcumulado % 30;
        const diasTruncosCalc = diasPendientesPotencial > 0
            ? remanenteAnual
            : remanenteAnual + diasPendientesPotencial;
        const diasTruncos = Math.max(0, diasTruncosCalc);

        return { totalAcumulado, diasGozados, diasTruncos, diasPendientes, diasProgramados };
    }

    descargarReportePendientes(): void {
        if (this.filasFiltradas.length === 0) return;

        const cabeceras = ['Nombre', 'Área', 'Puesto', 'Empresa', 'Fecha Ingreso', 'Total Acumulado', 'Días Truncos', 'Días Pendientes'];
        const registros = this.filasFiltradas.map(f => [
            f.nombre, f.area, f.puesto, f.empresa, f.fechaIngreso,
            f.totalAcumulado.toString().replace('.', ','),
            f.diasTruncos.toString().replace('.', ','),
            f.diasPendientes.toString().replace('.', ',')
        ]);

        this.exportarCSV(cabeceras, registros, 'Reporte_Vacaciones_Pendientes');
    }

    descargarReporteGozados(): void {
        if (this.filasFiltradas.length === 0) return;

        const hoy = new Date();
        hoy.setHours(23, 59, 59, 999);

        // Hoja 1: Resumen de Días Gozados
        const cabecerasResumen = ['Nombre', 'Área', 'Puesto', 'Empresa', 'Fecha Ingreso', 'Total Acumulado', 'Días Gozados'];
        const filasResumen = this.filasFiltradas.map(f => [
            f.nombre, f.area, f.puesto, f.empresa, f.fechaIngreso,
            parseFloat(f.totalAcumulado.toString().replace(',', '.')),
            f.diasUtilizados
        ]);

        // Hoja 2: Detalle de todas las solicitudes gozadas (AP o AS, fecha_inicio <= hoy)
        // Ordenadas por nombre del colaborador
        const cabecerasDetalle = [
            'Nombre', 'Área', 'Estado', 'Tipo',
            'Fecha Solicitud', 'Fecha Inicio', 'Fecha Final',
            'Días', 'Aprobado por Jefe', 'Aprobado por Gerente', 'Motivo', 'Observaciones'
        ];

        const filasDetalle: any[][] = [];
        // Ordenar colaboradores por nombre antes de iterar
        const filasOrdenadas = [...this.filasFiltradas].sort((a, b) => a.nombre.localeCompare(b.nombre));

        for (const f of filasOrdenadas) {
            const solicitudesGozadas = f.solicitudes
                .filter(sol => {
                    const cod = this.vacacionesService.obtenerCodigoEstado(sol.estado_solicitud);
                    if (cod !== 'AP' && cod !== 'AS') return false;
                    if (!sol.fecha_inicio) return false;
                    return new Date(sol.fecha_inicio + 'T00:00:00') <= hoy;
                })
                .sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio));

            for (const sol of solicitudesGozadas) {
                const tipoMap: Record<string, string> = { 'AT': 'Autorizada', 'AD': 'Adelanto' };
                filasDetalle.push([
                    f.nombre,
                    f.area,
                    this.vacacionesService.obtenerLabelEstado(sol.estado_solicitud),
                    tipoMap[sol.tipo_solicitud || ''] || sol.tipo_solicitud || '',
                    this.vacacionesService.formatearFechaCompleta(sol.fecha_solicitud || ''),
                    this.vacacionesService.formatearFechaCompleta(sol.fecha_inicio),
                    this.vacacionesService.formatearFechaCompleta(sol.fecha_final),
                    sol.total_periodo,
                    this.usuarioService.resolverNombrePorUrl(sol.jefe_id),
                    this.usuarioService.resolverNombrePorUrl(sol.gerente_id),
                    (sol.motivo || '').replace(/\n/g, ' '),
                    (sol.obs || '').replace(/\n/g, ' ')
                ]);
            }
        }

        this.exportarExcel(
            [
                { nombre: 'Resumen Días Gozados', cabeceras: cabecerasResumen, filas: filasResumen },
                { nombre: 'Detalle Solicitudes', cabeceras: cabecerasDetalle, filas: filasDetalle }
            ],
            `Reporte_Vacaciones_Gozados_${new Date().toISOString().slice(0, 10)}`
        );
    }

    resetearFiltros(): void {
        this.usuarioSeleccionado = '';
        this.filtroAreas = [];
        this.filtroOficina = 'todas';
        this.fechaHasta = '';
    }

    refrescar(): void {
        this.cargarDatos();
    }

    /**
     * Genera y descarga un archivo .xlsx con múltiples hojas.
     */
    private exportarExcel(
        hojas: { nombre: string; cabeceras: string[]; filas: any[][] }[],
        nombreArchivo: string
    ): void {
        const libro = XLSX.utils.book_new();

        for (const hoja of hojas) {
            const datos = [hoja.cabeceras, ...hoja.filas];
            const hojaCsv = XLSX.utils.aoa_to_sheet(datos);

            // Ajustar ancho de columnas automáticamente al contenido
            const anchos = hoja.cabeceras.map((col, i) => {
                const maxLong = Math.max(
                    col.length,
                    ...hoja.filas.map(r => String(r[i] ?? '').length)
                );
                return { wch: Math.min(maxLong + 4, 60) };
            });
            hojaCsv['!cols'] = anchos;

            XLSX.utils.book_append_sheet(libro, hojaCsv, hoja.nombre);
        }

        XLSX.writeFile(libro, `${nombreArchivo}.xlsx`);
    }

    // ========================================
    // Calendario Picker personalizado
    // ========================================

    abrirCalendario(tipo: 'hasta'): void {
        const base = this.fechaHasta ? new Date(this.fechaHasta + 'T00:00:00') : new Date();
        this.mesVista = base.getMonth();
        this.anioVista = base.getFullYear();
        this.diaTemp = this.fechaHasta || '';
        this.calendarActivo = 'hasta';
    }

    cerrarCalendario(): void {
        this.calendarActivo = null;
        this.diaTemp = '';
    }

    navegarMes(delta: number): void {
        let m = this.mesVista + delta;
        let a = this.anioVista;
        if (m > 11) { m = 0; a++; }
        if (m < 0) { m = 11; a--; }
        this.mesVista = m;
        this.anioVista = a;
    }

    // Genera las 42 celdas del calendario (6 semanas) con días del mes anterior, actual y siguiente
    get diasCalendario(): { fecha: string; dia: number; esOtroMes: boolean }[] {
        const primerDia = new Date(this.anioVista, this.mesVista, 1);
        const diaSemana = primerDia.getDay(); // 0=Dom, 1=Lun...
        const offset = diaSemana === 0 ? 6 : diaSemana - 1; // ajuste a semana lunes-domingo
        const dias: { fecha: string; dia: number; esOtroMes: boolean }[] = [];

        // Días del mes anterior para completar primera semana
        for (let i = offset; i > 0; i--) {
            const d = new Date(this.anioVista, this.mesVista, 1 - i);
            dias.push({ fecha: this.formatFechaISO(d), dia: d.getDate(), esOtroMes: true });
        }

        // Días del mes actual
        const ultimoDia = new Date(this.anioVista, this.mesVista + 1, 0).getDate();
        for (let i = 1; i <= ultimoDia; i++) {
            const d = new Date(this.anioVista, this.mesVista, i);
            dias.push({ fecha: this.formatFechaISO(d), dia: i, esOtroMes: false });
        }

        // Días del mes siguiente para completar 6 filas (42 celdas)
        const restantes = 42 - dias.length;
        for (let i = 1; i <= restantes; i++) {
            const d = new Date(this.anioVista, this.mesVista + 1, i);
            dias.push({ fecha: this.formatFechaISO(d), dia: d.getDate(), esOtroMes: true });
        }

        return dias;
    }

    seleccionarDiaTemp(fecha: string): void {
        this.diaTemp = fecha;
    }

    confirmarFecha(): void {
        if (!this.diaTemp) { this.cerrarCalendario(); return; }
        this.fechaHasta = this.diaTemp;
        this.cerrarCalendario();
    }

    // Atajos rápidos: Ayer, Hoy, Mañana
    atajoDia(atajo: 'ayer' | 'hoy' | 'maniana'): void {
        const hoy = new Date();
        const d = new Date(hoy);
        if (atajo === 'ayer') d.setDate(hoy.getDate() - 1);
        else if (atajo === 'maniana') d.setDate(hoy.getDate() + 1);
        this.mesVista = d.getMonth();
        this.anioVista = d.getFullYear();
        this.diaTemp = this.formatFechaISO(d);
    }

    get fechaHoy(): string {
        return this.formatFechaISO(new Date());
    }

    get tituloCalendario(): string {
        return `${this.MESES[this.mesVista]} ${this.anioVista}`;
    }

    private formatFechaISO(d: Date): string {
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${d.getFullYear()}-${mm}-${dd}`;
    }
}
