// ============== SERVIDOR BACKEND VINTEX CLINIC (VERSIÓN 3.0.1 - COMPLETO) =============
//
// ARQUITECTURA:
// - FASE A: Modular (Compatible con frontend modular)
// - FASE B: Rate Limiting (express-rate-limit) y Carga por Rango (/citas-range)
// - FASE C: Storage (4 endpoints) y Real-time (hooks)
// - ESQUEMA: Validado para IDs BIGINT/SERIAL (z.number())
// - FIX: Incluye ruta GET / para Health Check (evita SIGTERM en EasyPanel)
//
// =======================================================================================

// 1. IMPORTACIÓN DE MÓDULOS
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const rateLimit = require('express-rate-limit'); // <--- FASE B (Requiere 'npm install express-rate-limit')

// 2. CONFIGURACIÓN INICIAL
const app = express();
// El puerto 80 es común en EasyPanel, o 3001 como fallback
const port = process.env.PORT || 3001; 

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) { console.error("Error: JWT_SECRET debe estar definida."); process.exit(1); }
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) { console.error("Error: SUPABASE_URL y SUPABASE_ANON_KEY deben estar definidas."); process.exit(1); }
const supabase = createClient(supabaseUrl, supabaseKey);

// 3. MIDDLEWARE
app.use(cors());
app.use(express.json());

// ==========================================================
// [FIX] RUTA DE HEALTH CHECK (Para EasyPanel / Plataformas)
// Responde a pings de "estás vivo?" en la ruta raíz.
// ==========================================================
app.get('/', (req, res) => {
    res.status(200).json({ 
        status: 'ok', 
        message: 'Servidor Vintex v3.0 (SCALABLE) está en línea.' 
    });
});
// ==========================================================

// ==========================================================
// [FIX] RUTA DE HEALTH CHECK (Para EasyPanel / Plataformas)
// Responde a pings de "estás vivo?" en la ruta raíz.
// ==========================================================
app.get('/', (req, res) => {
    res.status(200).json({ 
        status: 'ok', 
        message: 'Servidor Vintex v3.0 (SCALABLE) está en línea.' 
    });
});
// ==========================================================

// --- MIDDLEWARE DE SEGURIDAD (FASE B) ---
// Aplicar a todas las rutas API
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 200, // Límite de 200 peticiones por IP por ventana
    message: 'Demasiadas peticiones desde esta IP, por favor intente de nuevo en 15 minutos.',
});
app.use('/api/', apiLimiter);

// Aplicar un limitador más estricto al login
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 10, // Límite de 10 intentos de login por IP
    message: 'Demasiados intentos de login, por favor intente de nuevo en 15 minutos.',
});
// Nota: El limiter se aplica directamente en la ruta de login
// --- FIN MIDDLEWARE DE SEGURIDAD ---

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.status(401).json({ error: 'Token no proporcionado' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) { console.warn("Token JWT inválido:", err.message); return res.status(403).json({ error: 'Token inválido' }); }
        
        // Adjuntamos el payload completo del token (incluyendo user.id numérico)
        req.user = user; 
        next();
    });
};

// 4. ESQUEMAS DE VALIDACIÓN ZOD (Actualizados para BIGINT)

// TUS IDs SON 'SERIAL' (int4) o 'BIGINT' (int8), ambos son números.
const idSchema = z.number().int().positive("El ID debe ser un número positivo.");

// Regex de hora (HH:MM o HH:MM:SS) - Corregido del server.js original
const timeRegex = /^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;
// Regex de fecha-hora UTC (ISO-8601)
const fechaHoraRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?$/;

// Esquemas de Citas
const citaBaseSchema = z.object({
    fecha_hora: z.string().regex(fechaHoraRegex, "Formato ISO-8601 (UTC)"),
    timezone: z.string().optional(),
    descripcion: z.string().optional().nullable(),
    estado: z.enum(['programada', 'confirmada', 'cancelada', 'completada', 'no_asistio']).default('programada'),
    duracion_minutos: z.number().int().positive().default(30),
    doctor_id: idSchema, // <--- CORREGIDO (number)
});

const citaCreateSchema = citaBaseSchema.extend({
    cliente_id: idSchema.optional().nullable(), // <--- CORREGIDO (number)
    new_client_name: z.string().optional().nullable(),
    new_client_dni: z.string().optional().nullable(),
    new_client_telefono: z.string().optional().nullable(),
});

const citaUpdateSchema = citaBaseSchema.partial().omit({ estado: true }).extend({
    estado: z.enum(['programada', 'confirmada', 'cancelada', 'completada', 'no_asistio']).optional()
});

// Esquemas de Doctores
const doctorSchema = z.object({
    nombre: z.string().min(2, "Nombre inválido"),
    especialidad: z.string().optional().nullable(),
    horario_inicio: z.string().regex(timeRegex, "Formato HH:MM o HH:MM:SS"),
    horario_fin: z.string().regex(timeRegex, "Formato HH:MM o HH:MM:SS"),
    activo: z.boolean().default(true)
});

// Esquemas de Clientes
const clienteUpdateSchema = z.object({
    activo: z.boolean().optional(),
    solicitud_de_secretaría: z.boolean().optional()
});

// Esquemas de Archivos (FASE C - Corregido para BIGINT)
const fileUploadUrlSchema = z.object({
    fileName: z.string().min(1, "El nombre de archivo es requerido"),
    fileType: z.string().min(1, "El tipo de archivo es requerido"),
    clienteId: idSchema, // <--- CORREGIDO (number)
});

const fileMetadataSchema = z.object({
    clienteId: idSchema, // <--- CORREGIDO (number)
    storagePath: z.string().min(1, "La ruta es requerida"),
    fileName: z.string().min(1, "El nombre de archivo es requerido"),
    fileType: z.string().min(1, "El tipo de archivo es requerido"),
    fileSizeKb: z.number().int().positive("El tamaño debe ser positivo"),
});

const fileDownloadSchema = z.object({
    storagePath: z.string().min(1, "La ruta del archivo es requerida"),
});


// 5. ENDPOINTS DE LA API

// --- Endpoint de Login ---
// Aplicamos el limitador estricto aquí
app.post('/api/login', loginLimiter, async (req, res) => {
    try {
        const schema = z.object({
            email: z.string().email({ message: "Email inválido" }),
            password: z.string().min(1, { message: "La contraseña es requerida" })
        });
        const validatedData = schema.safeParse(req.body);
        if (!validatedData.success) return res.status(400).json({ error: 'Datos de login inválidos', details: validatedData.error.errors });

        const { email, password } = validatedData.data;

        // Usamos la tabla 'usuarios' (SERIAL ID) como confirmó tu schema
        const { data: user, error } = await supabase
            .from('usuarios')
            .select('id, nombre, rol, password_hash')
            .eq('email', email)
            .single();

        if (error || !user) {
            console.error('Error en login (usuario no encontrado):', error?.message);
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password_hash);
        if (!isPasswordValid) return res.status(401).json({ error: 'Credenciales inválidas' });

        // Payload del JWT - Incluimos el ID (numérico)
        const tokenPayload = { 
            id: user.id, // <--- ID Numérico (de la tabla 'usuarios')
            rol: user.rol, 
            nombre: user.nombre 
        };
        const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '8h' });
        
        res.status(200).json({ 
            message: 'Login exitoso', 
            token: token, 
            user: { id: user.id, nombre: user.nombre, rol: user.rol } 
        });

    } catch (error) { 
        console.error("Error crítico en /api/login:", error.message); 
        res.status(500).json({ error: 'Error interno del servidor', details: error.message }); 
    }
});

// --- Endpoint /initial-data (FASE B - Optimizado) ---
// Ya no envía 'appointments'. El frontend las pide por separado.
app.get('/api/initial-data', authenticateToken, async (req, res) => {
    try {
        const [
            { data: doctors, error: doctorsError },
            { data: clients, error: clientsError },
            { data: chatHistory, error: chatError }
        ] = await Promise.all([
            supabase.from('doctores').select('id, nombre, especialidad, horario_inicio, horario_fin, activo'),
            supabase.from('clientes').select('id, nombre, telefono, dni, activo, solicitud_de_secretaría'),
            supabase.from('n8n_chat_histories').select('id, session_id, message') // Opcional, si se sigue usando
        ]);

        if (doctorsError || clientsError || chatError) {
            console.error("Error en initial-data:", doctorsError || clientsError || chatError);
            throw (doctorsError || clientsError || chatError);
        }

        // NO enviamos 'appointments'
        res.status(200).json({ doctors, clients, chatHistory });

    } catch (error) {
        console.error("Error fatal al obtener initial-data:", error.message);
        res.status(500).json({ error: 'No se pudo obtener la data inicial.', details: error.message });
    }
});

// --- Endpoint de Carga de Citas (FASE B) ---
app.get('/api/citas-range', authenticateToken, async (req, res) => {
    try {
        const schema = z.object({
            start: z.string().regex(fechaHoraRegex, "Fecha 'start' inválida"),
            end: z.string().regex(fechaHoraRegex, "Fecha 'end' inválida")
        });
        const validatedData = schema.parse(req.query);
        const { start, end } = validatedData;

        const { data: appointments, error } = await supabase.from('citas')
            .select(`
                id, fecha_hora, timezone, descripcion, estado, duracion_minutos,
                cliente: clientes (id, nombre, dni),
                doctor: doctores (id, nombre, especialidad)
            `)
            .gte('fecha_hora', start)
            .lte('fecha_hora', end);
        
        if (error) throw error;
        res.status(200).json(appointments);

    } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: 'Rango de fechas inválido', details: error.errors });
        console.error("Error en /citas-range:", error.message);
        res.status(500).json({ error: 'Error al obtener citas.', details: error.message });
    }
});

// --- Endpoints de CLIENTES ---
app.patch('/api/clientes/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        // Validar que el ID del parámetro es un número
        const validatedId = idSchema.parse(Number(id));
        const validatedData = clienteUpdateSchema.parse(req.body);

        if (Object.keys(validatedData).length === 0) return res.status(400).json({ error: 'No se proporcionaron datos para actualizar.' });
        
        const { data, error } = await supabase.from('clientes').update(validatedData).eq('id', validatedId).select().single();
        if (error) throw error;
        res.status(200).json(data);
    } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: 'Datos inválidos', details: error.errors });
        console.error(`Error al hacer PATCH en cliente ${id}:`, error.message);
        res.status(500).json({ error: 'No se pudo actualizar el cliente.', details: error.message });
    }
});

// --- Endpoints de DOCTORES ---
app.post('/api/doctores', authenticateToken, async (req, res) => {
    // Solo Admin puede crear doctores (ejemplo de ROL)
    if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Acceso denegado.' });
    
    try {
        const validatedData = doctorSchema.parse(req.body);
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
    // Solo Admin puede editar doctores
    if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Acceso denegado.' });

    const { id } = req.params;
    try {
        const validatedId = idSchema.parse(Number(id));
        const validatedData = doctorSchema.partial().parse(req.body);

        const updateData = Object.fromEntries(Object.entries(validatedData).filter(([_, v]) => v !== null && v !== undefined));
        if (Object.keys(updateData).length === 0) return res.status(400).json({ error: 'No se proporcionaron datos válidos.' });
        
        const { data, error } = await supabase.from('doctores').update(updateData).eq('id', validatedId).select().single();
        if (error) throw error;
        res.status(200).json(data);
    } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: 'Datos de doctor inválidos', details: error.errors });
        console.error(`Error al actualizar doctor ${id}:`, error.message);
        res.status(500).json({ error: 'No se pudo actualizar el doctor.', details: error.message });
    }
});

// --- Endpoints de CITAS ---
app.post('/api/citas', authenticateToken, async (req, res) => {
    try {
        const validatedData = citaCreateSchema.parse(req.body);
        let clienteId = validatedData.cliente_id;

        // Lógica para crear nuevo cliente (si aplica)
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
                if (clientError.code === '23505') { // Error de DNI duplicado
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
        const validatedId = idSchema.parse(Number(id));
        const validatedData = citaUpdateSchema.parse(req.body);

        if (Object.keys(validatedData).length === 0) return res.status(400).json({ error: 'No se proporcionaron datos.' });
        
        const { data, error } = await supabase.from('citas').update(validatedData).eq('id', validatedId).select().single();
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
        const validatedId = idSchema.parse(Number(id));
        const { error } = await supabase.from('citas').delete().eq('id', validatedId);
        if (error) throw error;
        res.status(204).send();
    } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: 'ID de cita inválido', details: error.errors });
        console.error("Error al eliminar la cita:", error.message);
        res.status(500).json({ error: 'No se pudo eliminar la cita.', details: error.message });
    }
});


// ============================================
// ENDPOINTS DE ARCHIVOS (FASE C - 100% COMPLETO)
// ============================================

/**
 * Endpoint 1: Generar URL de subida pre-firmada.
 */
app.post('/api/files/generate-upload-url', authenticateToken, async (req, res) => {
    try {
        const { fileName, fileType, clienteId } = fileUploadUrlSchema.parse(req.body);

        // El ID del admin/usuario que está autenticado (viene del JWT)
        const adminId = req.user.id; 
        const filePath = `privado/cliente_${clienteId}/admin_${adminId}/${Date.now()}-${fileName}`;

        // Bucket: 'archivos-pacientes'
        const { data, error } = await supabase.storage
            .from('archivos-pacientes') 
            .createSignedUploadUrl(filePath, 60); // Válida por 60 segundos

        if (error) throw error;

        res.status(200).json({ 
            uploadUrl: data.signedUrl, 
            filePath: data.path 
        });

    } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: 'Datos de archivo inválidos', details: error.errors });
        console.error("Error al generar URL de subida:", error.message);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

/**
 * Endpoint 2: Registrar metadatos (post-subida).
 */
app.post('/api/files/record-metadata', authenticateToken, async (req, res) => {
    try {
        const { clienteId, storagePath, fileName, fileType, fileSizeKb } = fileMetadataSchema.parse(req.body);
        const adminId = req.user.id; // ID del usuario autenticado (es numérico)

        const { data, error } = await supabase
            .from('archivos_adjuntos')
            .insert({
                cliente_id: clienteId, // BIGINT
                storage_path: storagePath,
                file_name: fileName,
                file_type: fileType,
                file_size_kb: fileSizeKb,
                subido_por_admin_id: adminId // SERIAL (int4)
            })
            .select()
            .single();

        if (error) throw error;
        res.status(201).json(data); // Devolver el registro creado

    } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: 'Metadatos de archivo inválidos', details: error.errors });
        console.error("Error al registrar metadatos:", error.message);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

/**
 * Endpoint 3: Listar archivos de un cliente.
 */
app.get('/api/files/:clientId', authenticateToken, async (req, res) => {
    try {
        const validatedId = idSchema.parse(Number(req.params.clientId));

        // Hacemos un join con la tabla 'usuarios' (donde subido_por_admin_id = usuarios.id)
        const { data, error } = await supabase
            .from('archivos_adjuntos')
            .select(`
                id, 
                created_at, 
                file_name, 
                file_type, 
                file_size_kb, 
                storage_path,
                admin:usuarios (nombre) 
            `)
            .eq('cliente_id', validatedId);

        if (error) throw error;
        res.status(200).json(data);

    } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: 'ID de cliente inválido', details: error.errors });
        console.error("Error al listar archivos:", error.message);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

/**
 * Endpoint 4: Generar URL de descarga pre-firmada.
 */
app.post('/api/files/generate-download-url', authenticateToken, async (req, res) => {
    try {
        const { storagePath } = fileDownloadSchema.parse(req.body);

        const { data, error } = await supabase.storage
            .from('archivos-pacientes')
            .createSignedUrl(storagePath, 300); // Válida por 300 segundos (5 minutos)

        if (error) throw error;

        res.status(200).json({ downloadUrl: data.signedUrl });

    } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: 'Ruta de archivo inválida', details: error.errors });
        console.error("Error al generar URL de descarga:", error.message);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});


// 7. INICIAR SERVIDOR
app.listen(port, () => {
    console.log(`Servidor Vintex v3.0 (SCALABLE) corriendo en http://localhost:${port}`);
});


