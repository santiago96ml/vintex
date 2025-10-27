// ============== SERVIDOR BACKEND VINTEX CLINIC (VERSIÓN 2.5) =============
//
// CAMBIOS v2.5 (Oct 27, 2025):
// - Soporte para la UI v4 (la de la agenda-calendario).
// - Se añade el endpoint GET /api/initial-data que la UI v4 espera.
// - Se cambian los endpoints de PUT a PATCH para coincidir con la UI v4.
// - Se añade PATCH /api/clientes/:id para el 'toggleBotStatus'.
// - Se añade lógica a POST /api/citas para crear nuevos clientes.
//
// ========================================================================

// 1. IMPORTACIÓN DE MÓDULOS (Sin cambios)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { z } = require('zod');

// 2. CONFIGURACIÓN INICIAL (Sin cambios)
const app = express();
const port = 3001;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) { console.error("Error: JWT_SECRET debe estar definida."); process.exit(1); }
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) { console.error("Error: SUPABASE_URL y SUPABASE_ANON_KEY deben estar definidas."); process.exit(1); }
const supabase = createClient(supabaseUrl, supabaseKey);

// 3. MIDDLEWARE (Sin cambios)
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
// ENDPOINTS PROTEGIDOS (Adaptados a v2.5)
// ============================================

// --- (NUEVO) Endpoint /initial-data (para UI v4) ---
app.get('/api/initial-data', authenticateToken, async (req, res) => {
    try {
        const [
            { data: doctors, error: doctorsError },
            { data: appointments, error: appointmentsError },
            { data: clients, error: clientsError },
            { data: chatHistory, error: chatError }
        ] = await Promise.all([
            // Doctores (Alineado con v2.4)
            supabase.from('doctores').select('id, nombre, especialidad, horario_inicio, horario_fin, activo'),
            // Citas (Alineado con v2.4)
            supabase.from('citas').select(`
                id, fecha_hora, descripcion, estado, duracion_minutos,
                cliente: clientes (id, nombre, dni),
                doctor: doctores (id, nombre, especialidad)
            `),
            // Clientes (Alineado con v2.4)
            supabase.from('clientes').select('id, nombre, telefono, dni, activo, solicitud_de_secretaría'),
            // Historial de Chat (Necesario para UI v4)
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


// --- Endpoints de CLIENTES (Alineados con v2.4 + PATCH) ---
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

// (NUEVO) PATCH para clientes (para UI v4)
app.patch('/api/clientes/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        // Esquema flexible para 'activo' o 'solicitud_de_secretaría'
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


// --- Endpoints de DOCTORES (Alineados con v2.4 + PATCH) ---
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

// (ACTUALIZADO) De PUT a PATCH para doctores (para UI v4)
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


// --- Endpoints de CITAS (Alineados con v2.4 + PATCH + Creación de Cliente) ---
app.post('/api/citas', authenticateToken, async (req, res) => {
    try {
        // Esquema para la cita
        const fechaHoraRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?$/; // YYYY-MM-DDTHH:MM:SS.sss
        const citaSchema = z.object({
            fecha_hora: z.string().regex(fechaHoraRegex, "Formato YYYY-MM-DDTHH:MM:SS"),
            descripcion: z.string().optional().nullable(),
            estado: z.enum(['programada', 'confirmada', 'cancelada', 'completada', 'no_asistio']).default('programada'),
            duracion_minutos: z.number().int().positive().default(30),
            doctor_id: z.number().int().positive(),
            // Campos para nuevo cliente (opcionales)
            cliente_id: z.number().int().positive().optional().nullable(),
            new_client_name: z.string().optional().nullable(),
            new_client_dni: z.string().optional().nullable(),
            new_client_telefono: z.string().optional().nullable(),
        });

        const validatedData = citaSchema.parse(req.body);
        let clienteId = validatedData.cliente_id;

        // Lógica para crear nuevo cliente (de UI v4)
        if (!clienteId && validatedData.new_client_name && validatedData.new_client_dni) {
            const { data: newClient, error: clientError } = await supabase
                .from('clientes')
                .insert({
                    nombre: validatedData.new_client_name,
                    dni: validatedData.new_client_dni,
                    telefono: validatedData.new_client_telefono || '',
                    activo: true // Bot activado por defecto
                })
                .select('id')
                .single();
            
            if (clientError) {
                if (clientError.code === '23505') { // Violación de unicidad (DNI)
                    return res.status(409).json({ error: 'Ya existe un cliente con ese DNI.', details: clientError.message });
                }
                throw clientError;
            }
            clienteId = newClient.id;
        } else if (!clienteId) {
            return res.status(400).json({ error: 'Debe seleccionar un cliente existente o crear uno nuevo.' });
        }
        
        // Crear la cita
        const { data, error } = await supabase
            .from('citas')
            .insert({
                cliente_id: clienteId,
                doctor_id: validatedData.doctor_id,
                fecha_hora: validatedData.fecha_hora,
                descripcion: validatedData.descripcion,
                estado: validatedData.estado,
                duracion_minutos: validatedData.duracion_minutos
            })
            .select()
            .single();
        
        if (error) throw error;
        res.status(201).json(data); // La UI v4 no necesita los datos completos, solo confirma.

    } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: 'Datos de cita inválidos', details: error.errors });
        console.error("Error al crear la cita:", error.message);
        res.status(500).json({ error: 'No se pudo crear la cita.', details: error.message });
    }
});

// (ACTUALIZADO) De PUT a PATCH para citas (para UI v4)
app.patch('/api/citas/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        const fechaHoraRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?$/;
        const schema = z.object({
            fecha_hora: z.string().regex(fechaHoraRegex).optional(),
            descripcion: z.string().optional().nullable(),
            estado: z.enum(['programada', 'confirmada', 'cancelada', 'completada', 'no_asistio']).optional(),
            duracion_minutos: z.number().int().positive().optional(),
            doctor_id: z.number().int().positive().optional()
        });
        const validatedData = schema.parse(req.body);
        if (Object.keys(validatedData).length === 0) return res.status(400).json({ error: 'No se proporcionaron datos.' });
        
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
    console.log(`Servidor Vintex v2.5 (Soporte UI v4) corriendo en http://localhost:${port}`);
});

