import { Component, Output, EventEmitter, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';
import { SolicitudService } from '../../core/services/solicitud.service';
import { VacacionesService } from '../../core/services/vacaciones.service';
import { UsuarioService } from '../../core/services/usuario.service';
import { Usuario } from '../../core/models/usuario.model';

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

    // Usuarios para selección (Jefes/Gerentes)
    usuarios: Usuario[] = [];
    cargandoUsuarios = false;

    get usuarioActual() {
        return this.authService.usuarioActual;
    }

    get esJefeOGerente(): boolean {
        const puesto = this.usuarioActual?.puesto_id?.nombre?.toLowerCase() || '';
        return puesto === 'jefe' || puesto === 'gerente';
    }

    get esGerente(): boolean {
        return (this.usuarioActual?.puesto_id?.nombre?.toLowerCase() || '') === 'gerente';
    }

    get esSucio(): boolean {
        return this.formulario?.dirty || false;
    }

    // Fecha mínima: hoy
    get fechaMinima(): string {
        return new Date().toISOString().split('T')[0];
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
        if (this.esJefeOGerente) {
            this.cargarUsuarios();
        }
    }

    // Inicializa el formulario reactivo
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

        this.formulario.get('dias')?.valueChanges.subscribe((val) => {
            this.recalcularAlCambiarDias(val);
        });
    }

    private recalcularAlCambiarFechas(): void {
        // Método simplificado para priorizar Días -> Fecha Fin
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

    private cargarUsuarios(): void {
        this.cargandoUsuarios = true;

        if (this.esGerente) {
            this.usuarioService.obtenerUsuarios().subscribe({
                next: (res) => {
                    this.usuarios = res;
                    this.cargandoUsuarios = false;
                },
                error: () => this.cargandoUsuarios = false
            });
        } else {
            // Es Jefe, filtrar por URL del área o ID si el servicio lo soporta
            const areaUrl = this.usuarioActual?.area_id?.url || '';
            this.usuarioService.obtenerUsuariosPorArea(areaUrl).subscribe({
                next: (res) => {
                    this.usuarios = res;
                    this.cargandoUsuarios = false;
                },
                error: () => this.cargandoUsuarios = false
            });
        }
    }

    // Avanza al siguiente paso del formulario validando los campos del paso actual
    siguientePaso(): void {
        if (this.pasoActual === 1) {
            // Validar campos obligatorios del paso 1 (Fechas y Tipo)
            const camposAValidar = ['usuario_id', 'tipo_solicitud', 'fecha_inicio', 'fecha_final'];
            let esValido = true;

            camposAValidar.forEach(campo => {
                const control = this.formulario.get(campo);
                if (control?.invalid) {
                    control.markAsTouched(); // Marcamos como tocado para mostrar errores en el HTML
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

        // Si todas las validaciones pasan, avanzamos al siguiente nivel del "stepper"
        if (this.pasoActual < this.totalPasos) {
            this.pasoActual++;
        }
    }

    anteriorPaso(): void {
        if (this.pasoActual > 1) {
            this.pasoActual--;
        }
    }

    private calcularDias(): void {
        // Método eliminado en favor de recalcularAlCambiarFechas
    }

    getNombreUsuarioSeleccionado(): string {
        const urlVal = this.formulario.get('usuario_id')?.value;
        if (urlVal === this.usuarioActual?.url) return this.authService.nombreCompleto;

        const user = this.usuarios.find(u => u.url === urlVal);
        return user ? this.usuarioService.nombreCompleto(user) : 'Cargando...';
    }

    // Envía la solicitud de vacaciones a la API
    enviarSolicitud(): void {
        if (this.formulario.invalid || this.diasCalculados === 0) return;

        this.cargando = true;
        this.error = '';

        const datos = this.formulario.value;
        const estado = this.esJefeOGerente ? 'AP' : 'PD';

        const payload = {
            ...datos,
            total_periodo: this.diasCalculados,
            fecha_solicitud: new Date().toISOString(),
            estado_solicitud: estado as any,
            area_id: this.usuarioActual?.area_id?.url || '', // Enviamos la URL del área, no el objeto ni el nombre
            jefe_id: null,
            fecha_jefe: null,
            gerente_id: null,
            fecha_gerente: null,
            obs: ''
        };

        this.solicitudService.crearSolicitud(payload).subscribe({
            next: () => {
                this.cargando = false;
                this.exito = true;
            },
            error: (err) => {
                this.cargando = false;
                console.error('Error 400 detallado:', err);
                this.error = 'Error al crear la solicitud. Inténtalo nuevamente.';
                if (err.error) {
                    // Si el servidor devuelve errores de validación específicos, los mostramos en consola
                    console.table(err.error);
                }
            }
        });
    }

    finalizar(): void {
        this.solicitudCreada.emit();
    }
}
