// ============== SERVIDOR BACKEND VINTEX CLINIC (VERSIÓN 2.7.1 - FIX TIMEZONE) =============
//
// CAMBIOS v2.7.1 (Oct 27, 2025):
// - [CRÍTICO] Ajustada regex de fecha_hora en Zod para aceptar el formato ISO-8601 UTC (con 'Z').
// - [CRÍTICO] Se asume que el frontend SIEMPRE envía 'fecha_hora' como valor UTC para almacenamiento.
// - Mejorada consulta de conflicto de citas (excluye canceladas).
//
// NOTA IMPORTANTE: Para que este backend funcione correctamente con el frontend, 
// la columna 'fecha_hora' en la tabla 'citas' de Supabase DEBE ser de tipo 
// 'timestamp with time zone'.
//
// ========================================================================

// 1. IMPORTACIÓN DE MÓDULOS
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { z } = require('zod');

// 2. CONFIGURACIÓN INICIAL
const app = express();
// --- FIX v2.6: Usar el puerto de Easypanel o 3001 como default ---
const port = process.env.PORT || 3001;
// -------------------------------------------------------------

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) { console.error("Error: JWT_SECRET debe estar definida."); process.exit(1); }
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) { console.error("Error: SUPABASE_URL y SUPABASE_ANON_KEY deben estar definidas."); process.exit(1); }
const supabase = createClient(supabaseUrl, supabaseKey);

// 3. MIDDLEWARE
app.use(cors());
app.use(express.json());

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; 
    if (token == null) return res.status(401).json({ error: 'Token no proporcionado' });
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) { console.warn("Token JWT inválido:", err.message); return res.status(403).json({ error: 'Token inválido' }); }
        req.user = user; 
        next();
    });
};

// 4. ENDPOINTS DE LA API

// --- Endpoint de Login (v2.4 - Correcto) ---
app.post('/api/login', async (req, res) => {
    try {
        const schema = z.object({
            email: z.string().email({ message: "Email inválido" }),
            password: z.string().min(1, { message: "La contraseña es requerida" })
        });
        const validatedData = schema.safeParse(req.body);
        if (!validatedData.success) return res.status(400).json({ error: 'Datos de login inválidos', details: validatedData.error.errors });
        const { email, password } = validatedData.data;
        const { data, error } = await supabase.rpc('get_user_by_email', { p_email: email });
        if (error) { console.error('Error RPC get_user_by_email:', error.message); return res.status(500).json({ error: 'Error al consultar la base de datos', details: error.message }); }
        if (!data || data.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
        const user = data[0];
        const isPasswordValid = await bcrypt.compare(password, user.password_hash);
        if (!isPasswordValid) return res.status(401).json({ error: 'Credenciales inválidas' });
        const tokenPayload = { id: user.id, rol: user.rol, nombre: user.nombre };
        const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '8h' });
        res.status(200).json({ message: 'Login exitoso', token: token, user: { id: user.id, nombre: user.nombre, rol: user.rol } });
    } catch (error) { console.error("Error crítico en /api/login:", error.message); res.status(500).json({ error: 'Error interno del servidor', details: error.message }); }
});

// --- Endpoint de Setup (v2.4 - Correcto) ---
app.post('/api/setup-admin', async (req, res) => {
    const { email, password, secret_key } = req.body;
    if (secret_key !== "VINTEX_SETUP_2025") return res.status(403).json({ error: "Clave de setup incorrecta." });
    if (!email || !password) return res.status(400).json({ error: "Email y password son requeridos." });
    try {
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);
        const userData = { email: email, password_hash: password_hash, nombre: 'Admin Vintex', rol: 'admin' };
        const { data, error } = await supabase.from('usuarios').upsert(userData, { onConflict: 'email' }).select();
        if (error) throw error;
        res.status(201).json({ message: `Usuario '${email}' creado/actualizado.`, user: data });
    } catch (error) { console.error("Error crítico en /api/setup-admin:", error.message); res.status(500).json({ error: 'Error interno del servidor', details: error.message }); }
});

// ============================================
// ENDPOINTS PROTEGIDOS (Adaptados a v2.7.1)
// ============================================

// --- Endpoint /initial-data (Actualizado para v2.7.1) ---
app.get('/api/initial-data', authenticateToken, async (req, res) => {
    try {
        const [
            { data: doctors, error: doctorsError },
            { data: appointments, error: appointmentsError },
            { data: clients, error: clientsError },
            { data: chatHistory, error: chatError }
        ] = await Promise.all([
            // Doctores
            supabase.from('doctores').select('id, nombre, especialidad, horario_inicio, horario_fin, activo'),
            // Citas (incluye timezone)
            supabase.from('citas').select(`
                id, fecha_hora, timezone, descripcion, estado, duracion_minutos,
                cliente: clientes (id, nombre, dni),
                doctor: doctores (id, nombre, especialidad)
            `),
            // Clientes
            supabase.from('clientes').select('id, nombre, telefono, dni, activo, solicitud_de_secretaría'),
            // Historial de Chat
            supabase.from('n8n_chat_histories').select('id, session_id, message')
        ]);

        if (doctorsError || appointmentsError || clientsError || chatError) {
            console.error("Error en initial-data:", doctorsError || appointmentsError || clientsError || chatError);
            throw (doctorsError || appointmentsError || clientsError || chatError);
        }

        res.status(200).json({ doctors, appointments, clients, chatHistory });
    } catch (error) {
        console.error("Error fatal al obtener initial-data:", error.message);
        res.status(500).json({ error: 'No se pudo obtener la data inicial.', details: error.message });
    }
});

// --- Endpoints de CLIENTES (Sin cambios) ---
app.post('/api/clientes', authenticateToken, async (req, res) => {
    try {
        const schema = z.object({
            nombre: z.string().min(3, "El nombre debe tener al menos 3 caracteres"),
            telefono: z.string().min(8, "Teléfono inválido").default(''),
            dni: z.string().min(7, "DNI inválido"),
            activo: z.boolean().default(true).optional(),
            solicitud_de_secretaría: z.boolean().optional().nullable()
        });
        const validatedData = schema.parse(req.body);
        const { data, error } = await supabase.from('clientes').insert(validatedData).select().single();
        if (error) throw error;
        res.status(201).json(data);
    } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: 'Datos de cliente inválidos', details: error.errors });
        console.error("Error al crear cliente:", error.message);
        res.status(500).json({ error: 'No se pudo crear el cliente.', details: error.message });
    }
});

app.patch('/api/clientes/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        const schema = z.object({
            activo: z.boolean().optional(),
            solicitud_de_secretaría: z.boolean().optional()
        });
        const validatedData = schema.parse(req.body);
        if (Object.keys(validatedData).length === 0) return res.status(400).json({ error: 'No se proporcionaron datos para actualizar.' });
        
        const { data, error } = await supabase.from('clientes').update(validatedData).eq('id', id).select().single();
        if (error) throw error;
        res.status(200).json(data);
    } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: 'Datos inválidos', details: error.errors });
        console.error(`Error al hacer PATCH en cliente ${id}:`, error.message);
        res.status(500).json({ error: 'No se pudo actualizar el cliente.', details: error.message });
    }
});

// --- Endpoints de DOCTORES (Sin cambios) ---
app.post('/api/doctores', authenticateToken, async (req, res) => {
    if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Acceso denegado.' });
    try {
        const timeRegex = /^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/;
        const schema = z.object({
            nombre: z.string().min(2, "Nombre inválido"),
            especialidad: z.string().optional().nullable(),
            horario_inicio: z.string().regex(timeRegex, "Formato HH:MM"),
            horario_fin: z.string().regex(timeRegex, "Formato HH:MM"),
            activo: z.boolean().default(true)
        });
        const validatedData = schema.parse(req.body);
        const { data, error } = await supabase.from('doctores').insert(validatedData).select().single();
        if (error) throw error;
        res.status(201).json(data);
    } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: 'Datos de doctor inválidos', details: error.errors });
        console.error("Error al crear doctor:", error.message);
        res.status(500).json({ error: 'No se pudo crear el doctor.', details: error.message });
    }
});

app.patch('/api/doctores/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Acceso denegado.' });
    try {
        const timeRegex = /^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/;
        const schema = z.object({
            especialidad: z.string().min(2).optional().nullable(),
            horario_inicio: z.string().regex(timeRegex).optional().nullable(),
            horario_fin: z.string().regex(timeRegex).optional().nullable(),
            activo: z.boolean().optional()
        });
        const validatedData = schema.parse(req.body);
        const updateData = Object.fromEntries(Object.entries(validatedData).filter(([_, v]) => v !== null && v !== undefined));
        if (Object.keys(updateData).length === 0) return res.status(400).json({ error: 'No se proporcionaron datos válidos.' });
        
        const { data, error } = await supabase.from('doctores').update(updateData).eq('id', id).select().single();
        if (error) throw error;
        res.status(200).json(data);
    } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: 'Datos de doctor inválidos', details: error.errors });
        console.error(`Error al actualizar doctor ${id}:`, error.message);
        res.status(500).json({ error: 'No se pudo actualizar el doctor.', details: error.message });
    }
});

// --- Endpoints de CITAS (Actualizados para v2.7.1) ---
app.post('/api/citas', authenticateToken, async (req, res) => {
    try {
        // Esquema para la cita - Ajustado para aceptar el valor UTC del frontend
        // Acepta YYYY-MM-DDTHH:MM:SSZ o YYYY-MM-DDTHH:MM:SS.sssZ
        const fechaHoraRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?$/;
        const citaSchema = z.object({
            fecha_hora: z.string().regex(fechaHoraRegex, "Formato ISO-8601 (UTC)"), 
            timezone: z.string().optional(),
            descripcion: z.string().optional().nullable(),
            estado: z.enum(['programada', 'confirmada', 'cancelada', 'completada', 'no_asistio']).default('programada'),
            duracion_minutos: z.number().int().positive().default(30),
            doctor_id: z.number().int().positive(),
            cliente_id: z.number().int().positive().optional().nullable(),
            new_client_name: z.string().optional().nullable(),
            new_client_dni: z.string().optional().nullable(),
            new_client_telefono: z.string().optional().nullable(),
        });

        const validatedData = citaSchema.parse(req.body);
        let clienteId = validatedData.cliente_id;

        // Validar conflictos de horario
        // Usamos el valor UTC enviado por el frontend, que es el correcto para la base de datos.
        const startTime = new Date(validatedData.fecha_hora);
        const endTime = new Date(startTime.getTime() + validatedData.duracion_minutos * 60000);
        
        // Filtro de conflicto: Excluir citas canceladas en la validación
        const { data: conflictingAppointments, error: conflictError } = await supabase
            .from('citas')
            .select('id')
            .eq('doctor_id', validatedData.doctor_id)
            .neq('estado', 'cancelada') // Excluye citas canceladas
            .gte('fecha_hora', validatedData.fecha_hora) // Compara con la hora UTC enviada (inicio)
            .lte('fecha_hora', endTime.toISOString()); // Compara con la hora UTC calculada (fin)
        
        if (conflictError) throw conflictError;
        if (conflictingAppointments.length > 0) {
            return res.status(409).json({ error: 'Conflicto de horario con otra cita.' });
        }

        // Lógica para crear nuevo cliente (Sin cambios)
        if (!clienteId && validatedData.new_client_name && validatedData.new_client_dni) {
            const { data: newClient, error: clientError } = await supabase
                .from('clientes')
                .insert({
                    nombre: validatedData.new_client_name,
                    dni: validatedData.new_client_dni,
                    telefono: validatedData.new_client_telefono || '',
                    activo: true
                })
                .select('id')
                .single();
            
            if (clientError) {
                if (clientError.code === '23505') {
                    return res.status(409).json({ error: 'Ya existe un cliente con ese DNI.', details: clientError.message });
                }
                throw clientError;
            }
            clienteId = newClient.id;
        } else if (!clienteId) {
            return res.status(400).json({ error: 'Debe seleccionar un cliente existente o crear uno nuevo.' });
        }
        
        // Crear la cita (Sin cambios en la estructura)
        const { data, error } = await supabase
            .from('citas')
            .insert({
                cliente_id: clienteId,
                doctor_id: validatedData.doctor_id,
                fecha_hora: validatedData.fecha_hora, // Almacena el valor UTC enviado
                timezone: validatedData.timezone || null, 
                descripcion: validatedData.descripcion,
                estado: validatedData.estado,
                duracion_minutos: validatedData.duracion_minutos
            })
            .select()
            .single();
        
        if (error) throw error;
        res.status(201).json(data);
    } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: 'Datos de cita inválidos', details: error.errors });
        console.error("Error al crear la cita:", error.message);
        res.status(500).json({ error: 'No se pudo crear la cita.', details: error.message });
    }
});

app.patch('/api/citas/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        // Esquema para la cita - Ajustado para aceptar el valor UTC del frontend
        const fechaHoraRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?$/;
        const schema = z.object({
            fecha_hora: z.string().regex(fechaHoraRegex).optional(),
            timezone: z.string().optional(),
            descripcion: z.string().optional().nullable(),
            estado: z.enum(['programada', 'confirmada', 'cancelada', 'completada', 'no_asistio']).optional(),
            duracion_minutos: z.number().int().positive().optional(),
            doctor_id: z.number().int().positive().optional()
        });
        const validatedData = schema.parse(req.body);
        if (Object.keys(validatedData).length === 0) return res.status(400).json({ error: 'No se proporcionaron datos.' });
        
        // Validar conflictos de horario si se actualiza fecha_hora o duracion_minutos
        if (validatedData.fecha_hora || validatedData.duracion_minutos) {
            const { data: currentAppointment, error: fetchError } = await supabase
                .from('citas')
                .select('fecha_hora, duracion_minutos, doctor_id')
                .eq('id', id)
                .single();
            if (fetchError) throw fetchError;
            if (!currentAppointment) return res.status(404).json({ error: 'Cita no encontrada.' });

            const startTime = validatedData.fecha_hora ? new Date(validatedData.fecha_hora) : new Date(currentAppointment.fecha_hora);
            const duration = validatedData.duracion_minutos || currentAppointment.duracion_minutos;
            const doctorId = validatedData.doctor_id || currentAppointment.doctor_id;
            const endTime = new Date(startTime.getTime() + duration * 60000);
            
            // Filtro de conflicto: Excluir la cita actual y las canceladas
            const { data: conflictingAppointments, error: conflictError } = await supabase
                .from('citas')
                .select('id')
                .eq('doctor_id', doctorId)
                .neq('estado', 'cancelada')
                .gte('fecha_hora', startTime.toISOString())
                .lte('fecha_hora', endTime.toISOString())
                .neq('id', id); // Excluye la cita actual

            if (conflictError) throw conflictError;
            if (conflictingAppointments.length > 0) {
                return res.status(409).json({ error: 'Conflicto de horario con otra cita.' });
            }
        }

        const { data, error } = await supabase.from('citas').update(validatedData).eq('id', id).select().single();
        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Cita no encontrada.' });
        res.status(200).json(data);
    } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: 'Datos de actualización inválidos', details: error.errors });
        console.error("Error al actualizar la cita:", error.message);
        res.status(500).json({ error: 'No se pudo actualizar la cita.', details: error.message });
    }
});

app.delete('/api/citas/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        const { error } = await supabase.from('citas').delete().eq('id', id);
        if (error) throw error;
        res.status(204).send();
    } catch (error) {
        console.error("Error al eliminar la cita:", error.message);
        res.status(500).json({ error: 'No se pudo eliminar la cita.', details: error.message });
    }
});

// 5. INICIAR SERVIDOR
app.listen(port, () => {
    console.log(`Servidor Vintex v2.7.1 (FIX TIMEZONE) corriendo en http://localhost:${port}`);
});