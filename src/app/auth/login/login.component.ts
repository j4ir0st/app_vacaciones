import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
    selector: 'app-login',
    templateUrl: './login.component.html',
    styleUrls: ['./login.component.css'],
    standalone: false
})
export class LoginComponent implements OnInit {
    // Formulario de inicio de sesión
    formulario!: FormGroup;
    cargando = false;
    error = '';
    mostrarPassword = false;

    constructor(
        private fb: FormBuilder,
        private authService: AuthService,
        private router: Router
    ) { }

    ngOnInit(): void {
        // Redirigir al dashboard si ya está autenticado
        if (this.authService.estaAutenticado) {
            this.router.navigate(['/dashboard']);
            return;
        }

        this.formulario = this.fb.group({
            username: ['', [Validators.required]],
            password: ['', [Validators.required, Validators.minLength(4)]]
        });
    }

    // Envía el formulario de login
    iniciarSesion(): void {
        if (this.formulario.invalid) return;

        this.cargando = true;
        this.error = '';

        const { username, password } = this.formulario.value;
        console.log('LoginComponent: Iniciando proceso de autenticación...');

        this.authService.iniciarSesion(username, password).subscribe({
            next: () => {
                console.log('LoginComponent: Autenticación exitosa. Redirigiendo a /dashboard...');
                this.cargando = false;
                this.router.navigate(['/dashboard']).then(success => {
                    if (success) {
                        console.log('LoginComponent: Navegación a /dashboard exitosa.');
                    } else {
                        console.error('LoginComponent: La navegación a /dashboard fue cancelada o falló.');
                    }
                });
            },
            error: (err) => {
                console.error('LoginComponent: Error capturado:', err);
                this.cargando = false;
                this.error = err.message || 'Error al iniciar sesión. Verifica tus credenciales.';
            }
        });
    }

    // Alterna la visibilidad de la contraseña
    togglePassword(): void {
        this.mostrarPassword = !this.mostrarPassword;
    }
}
