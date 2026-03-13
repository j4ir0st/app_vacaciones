import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { HttpClientModule, HTTP_INTERCEPTORS } from '@angular/common/http';
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

// Módulos de funcionalidades
import { DashboardComponent } from './dashboard/dashboard.component';
import { MisSolicitudesComponent } from './mis-solicitudes/mis-solicitudes.component';
import { NuevaSolicitudComponent } from './mis-solicitudes/nueva-solicitud/nueva-solicitud.component';
import { CalendarioComponent } from './calendario/calendario.component';
import { AdminComponent } from './admin/admin.component';

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
    AdminComponent,
  ],
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    HttpClientModule,
    FormsModule,
    ReactiveFormsModule,
    AppRoutingModule,
    FullCalendarModule,
  ],
  providers: [
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
