import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { provideHttpClient, withInterceptorsFromDi, HTTP_INTERCEPTORS } from '@angular/common/http';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import { AppRoutingModule } from './app-routing-module';
import { App } from './app';
import { AuthInterceptor } from './core/interceptors/auth.interceptor';

// Componentes de autenticación
import { LoginComponent } from './auth/login/login.component';

// Componentes compartidos
import { NavbarComponent } from './shared/navbar/navbar.component';
import { HeaderComponent } from './shared/header/header.component';
import { LayoutComponent } from './shared/layout/layout.component';
import { ConfirmDialogComponent } from './shared/confirm-dialog/confirm-dialog.component';
import { NotificacionComponent } from './shared/notificacion/notificacion.component';

// Módulos de funcionalidades
import { DashboardComponent } from './dashboard/dashboard.component';
import { MisSolicitudesComponent } from './mis-solicitudes/mis-solicitudes.component';
import { NuevaSolicitudComponent } from './nueva-solicitud/nueva-solicitud.component';
import { CalendarioComponent } from './calendario/calendario.component';
import { AprobacionesComponent } from './aprobaciones/aprobaciones.component';
import { UsuariosComponent } from './usuarios/usuarios.component';
import { CrearUsuarioComponent } from './usuarios/crear-usuario/crear-usuario.component';
import { ReportesComponent } from './reportes/reportes.component';

// FullCalendar
import { FullCalendarModule } from '@fullcalendar/angular';

@NgModule({
  declarations: [
    App,
    LoginComponent,
    NavbarComponent,
    HeaderComponent,
    LayoutComponent,
    ConfirmDialogComponent,
    DashboardComponent,
    MisSolicitudesComponent,
    NuevaSolicitudComponent,
    CalendarioComponent,
    AprobacionesComponent,
    UsuariosComponent,
    CrearUsuarioComponent,
    ReportesComponent,
    NotificacionComponent,
  ],
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    FormsModule,
    ReactiveFormsModule,
    AppRoutingModule,
    FullCalendarModule,
  ],
  providers: [
    provideHttpClient(withInterceptorsFromDi()),
    // Registrar el interceptor de autenticación JWT
    {
      provide: HTTP_INTERCEPTORS,
      useClass: AuthInterceptor,
      multi: true
    }
  ],
  bootstrap: [App],
})
export class AppModule { }
