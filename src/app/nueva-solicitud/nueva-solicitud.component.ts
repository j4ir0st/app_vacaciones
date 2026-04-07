import { Component, Output, EventEmitter, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AuthService } from '../core/services/auth.service';
import { SolicitudService } from '../core/services/solicitud.service';
import { VacacionesService } from '../core/services/vacaciones.service';
import { UsuarioService } from '../core/services/usuario.service';
import { Usuario } from '../core/models/usuario.model';

@Component({
    selector: 'app-nueva-solicitud',
    templateUrl: './nueva-solicitud.component.html',
    styleUrls: ['./nueva-solicitud.component.css'],
    standalone: false
})
export class NuevaSolicitudComponent implements OnInit {
    @Output() solicitudCreada = new EventEmitter<void>();
    @Output() cancelar = new EventEmitter<void>();

    // Stepper
    pasoActual = 1;
    totalPasos = 3;

    // Formulario de nueva solicitud
    formulario!: FormGroup;
    cargando = false;
    error = '';
    exito = false;
    diasCalculados = 0;
    procesandoDetalle = false;

    // Usuarios para selección (Jefes/Gerentes)
    usuarios: Usuario[] = [];
    cargandoUsuarios = false;

    get usuarioActual() {
        return this.authService.usuarioActual;
    }

    // Determina si el formulario ha sido modificado
    get esSucio(): boolean {
        return this.formulario?.dirty || false;
    }

    // Fecha mínima para la solicitud (vacía para permitir regularización de fechas pasadas)
    get fechaMinima(): string {
        return '';
    }

    // Determina si el paso actual es válido para habilitar el botón "Siguiente"
    get pasoValido(): boolean {
        if (this.pasoActual === 1) {
            const f = this.formulario.value;
            // Validamos que tenga fechas y días mayores a 0
            return !!f.fecha_inicio && !!f.fecha_final && this.diasCalculados > 0 && !!f.usuario_id;
        }
        if (this.pasoActual === 2) {
            return (this.formulario.get('motivo')?.value || '').length >= 5;
        }
        return true;
    }

    constructor(
        private fb: FormBuilder,
        public authService: AuthService,
        private solicitudService: SolicitudService,
        private vacacionesService: VacacionesService,
        private usuarioService: UsuarioService
    ) { }

    ngOnInit(): void {
        this.inicializarFormulario();
        if (this.authService.esJefeOGerente) {
            this.cargarUsuarios();
        }
    }

    // Inicializa el formulario reactivo con valores por defecto
    private inicializarFormulario(): void {
        const urlPropia = this.usuarioActual?.url || '';

        this.formulario = this.fb.group({
            usuario_id: [urlPropia, Validators.required],
            tipo_solicitud: ['AT', Validators.required],
            fecha_inicio: ['', Validators.required],
            fecha_final: ['', Validators.required],
            dias: [0, [Validators.required, Validators.min(1)]],
            motivo: ['', [Validators.required, Validators.minLength(5)]]
        });

        // Suscripciones para cálculos automáticos unidireccionales
        this.formulario.get('fecha_inicio')?.valueChanges.subscribe(() => {
            this.recalcularAlCambiarDias(this.formulario.get('dias')?.value);
        });

        this.formulario.get('dias')?.valueChanges.subscribe((val: number) => {
            this.recalcularAlCambiarDias(val);
        });
    }

    // Recalcula automáticamente la fecha final cuando cambian los días solicitados
    // Se asegura de que el primer día de vacaciones esté incluido en el cálculo
    private recalcularAlCambiarDias(cantDias: number): void {
        const inicio = this.formulario.get('fecha_inicio')?.value;
        if (inicio && cantDias > 0) {
            // Utilizamos el servicio de vacaciones para centralizar la lógica de negocio del calendario
            const nuevaFechaFin = this.vacacionesService.calcularFechaFinal(new Date(inicio), cantDias);

            // Ajuste manual de zona horaria para evitar desfases al convertir a formato ISO (YYYY-MM-DD)
            const fechaString = nuevaFechaFin.toISOString().split('T')[0];

            // Actualizamos el campo fecha_final sin disparar eventos circulares
            this.formulario.get('fecha_final')?.setValue(fechaString, { emitEvent: false });
            this.diasCalculados = cantDias;
        }
    }

    // Carga la lista de colaboradores bajo la supervisión del usuario actual
    // Implementa la lógica de filtrado por área heredada (fórmula PowerApps)
    private cargarUsuarios(): void {
        this.cargandoUsuarios = true;

        const user = this.usuarioActual;
        const nombreUser = `${user?.first_name} ${user?.last_name}`.trim();
        const username = user?.username?.toLowerCase() || '';
        const areaOriginal = (user?.area_id?.nombre || user?.area || '').trim();

        let areasAFiltar: string[] = [];

        // Lógica de filtrado compleja para Jefes y Gerentes
        if (this.authService.esAprobador) {
            if (areaOriginal === 'Operaciones') {
                // Usuarios de Operaciones ven áreas operativas específicas
                areasAFiltar = ["Distribución", "Atenciones", "Almacenes", "Facturación", "Desarrollo Software", "Logística Inversa"];
            } else if (username === 'klewis' || username === 'klewism' || nombreUser.toLowerCase().includes('katherine lewis')) {
                // Caso específico para Katherine Lewis (acceso multi-área)
                areasAFiltar = ["Contabilidad", "Mantenimiento", "Provincia", "Vigilancia", "Finanzas", "Neurocirugía", "Traumatología", "Heridas Y Quemados", "Regulatorios", "Terapia de Sueño y Apnea", "Ingeniería", "Marketing", "Licitaciones", "Equipos Médicos", "Casa", "CDC"];
            } else {
                // Por defecto, ven solo su propia área
                areasAFiltar = [areaOriginal];
            }
        } else {
            // Si no es aprobador (aunque esta función no debería llamarse), ve solo su área
            areasAFiltar = [areaOriginal];
        }

        const nombresArea = areasAFiltar.join(',');
        this.usuarioService.obtenerUsuariosPorNombreArea(nombresArea).subscribe({
            next: (res: any) => {
                this.usuarios = res || [];
                // Si el usuario actual es gerente de un área específica (ej. Software), 
                // ya el filtro 'Else' se encargó de traer solo su área.
                this.cargandoUsuarios = false;
            },
            error: (err: any) => {
                console.error('Error cargando usuarios filtrados:', err);
                this.cargandoUsuarios = false;
            }
        });
    }

    // Avanza al siguiente paso del formulario validando los campos del paso actual
    siguientePaso(): void {
        if (this.pasoActual === 1) {
            // Validar campos obligatorios del paso 1 (Colaborador, Tipo y Fechas)
            const camposAValidar = ['usuario_id', 'tipo_solicitud', 'fecha_inicio', 'fecha_final'];
            let esValido = true;

            camposAValidar.forEach(campo => {
                const control = this.formulario.get(campo);
                if (control?.invalid) {
                    control.markAsTouched(); // Marcamos como tocado para mostrar errores visuales
                    esValido = false;
                }
            });

            if (!esValido || this.diasCalculados <= 0) return;
        }

        if (this.pasoActual === 2) {
            // Validar que el motivo cumpla con la longitud mínima requerida
            const motivo = this.formulario.get('motivo');
            if (motivo?.invalid) {
                motivo.markAsTouched();
                return;
            }
        }

        // Si todas las validaciones pasan, avanzamos al siguiente paso del stepper
        if (this.pasoActual < this.totalPasos) {
            this.pasoActual++;
        }
    }

    // Retrocede al paso anterior del formulario
    anteriorPaso(): void {
        if (this.pasoActual > 1) {
            this.pasoActual--;
        }
    }

    // Obtiene el nombre completo del colaborador seleccionado para mostrarlo en el resumen
    getNombreUsuarioSeleccionado(): string {
        const urlVal = this.formulario.get('usuario_id')?.value;
        if (urlVal === this.usuarioActual?.url) return this.authService.nombreCompleto;

        const user = this.usuarios.find(u => u.url === urlVal);
        return user ? this.usuarioService.nombreCompleto(user) : 'Cargando...';
    }

    // Envía la solicitud de vacaciones a la API del servidor
    enviarSolicitud(): void {
        if (this.formulario.invalid || this.diasCalculados === 0) return;

        this.cargando = true;
        this.error = '';

        const datos = this.formulario.value;
        const esGerente = this.authService.esGerente;
        const esAprobador = this.authService.esAprobador;
        const fechaActual = new Date().toISOString();
        const urlUsuario = this.usuarioActual?.url || '';

        // Lógica de auto-aprobación por niveles
        let estado = 'PD';
        let jefe_id = null;
        let fecha_jefe = null;
        let gerente_id = null;
        let fecha_gerente = null;

        if (esGerente) {
            estado = 'AP';
            jefe_id = urlUsuario;
            fecha_jefe = fechaActual;
            gerente_id = urlUsuario;
            fecha_gerente = fechaActual;
        } else if (esAprobador) {
            estado = 'AS';
            jefe_id = urlUsuario;
            fecha_jefe = fechaActual;
        }

        const payload = {
            ...datos,
            total_periodo: this.diasCalculados,
            fecha_solicitud: fechaActual,
            estado_solicitud: estado as any,
            area_id: this.usuarioActual?.area_id?.url || '', // Se envía la URL del área para compatibilidad
            jefe_id: jefe_id,
            fecha_jefe: fecha_jefe,
            gerente_id: gerente_id,
            fecha_gerente: fecha_gerente,
            obs: ''
        };

        this.solicitudService.crearSolicitud(payload).subscribe({
            next: () => {
                this.cargando = false;
                this.exito = true;
            },
            error: (err: any) => {
                this.cargando = false;
                console.error('Error al crear solicitud:', err);
                this.error = 'Error al crear la solicitud. Por favor, inténtelo de nuevo.';
                if (err.error) {
                    console.table(err.error);
                }
            }
        });
    }

    // Emite el evento de finalización para cerrar el modal o refrescar la vista
    finalizar(): void {
        this.solicitudCreada.emit();
    }
}
