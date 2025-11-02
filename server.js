// ============== SERVIDOR BACKEND VINTEX CLINIC (VERSIÓN 3.0.2 - COMPLETO Y CORREGIDO) =============
//
// ARQUITECTURA:
// - FASE A: Modular (Compatible con frontend modular)
// - FASE B: Rate Limiting (express-rate-limit) y Carga por Rango (/citas-range)
// - FASE C: Storage (4 endpoints) y Real-time (hooks)
// - ESQUEMA: Validado para IDs BIGINT/SERIAL (z.number())
// - FIX: Incluye ruta GET / para Health Check (evita SIGTERM en EasyPanel)
// - FIX v3.0.2: Añadido 'trust proxy' para solucionar error de express-rate-limit en EasyPanel
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
const rateLimit = require('express-rate-limit');

// 2. CONFIGURACIÓN INICIAL
const app = express();
const port = process.env.PORT || 80; // EasyPanel usa el puerto 80 por defecto

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) { console.error("Error: JWT_SECRET debe estar definida."); process.exit(1); }
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY; // Usamos la ANON KEY para el servidor
if (!supabaseUrl || !supabaseKey) { console.error("Error: SUPABASE_URL y SUPABASE_ANON_KEY deben estar definidas."); process.exit(1); }

const supabase = createClient(supabaseUrl, supabaseKey);

// 3. MIDDLEWARES (Software intermedio)

// Habilitar CORS para permitir peticiones del frontend
app.use(cors());

// Permitir a Express entender JSON en el body de las peticiones
app.use(express.json());

// **LA CORRECCIÓN CRÍTICA PARA EASYPANEL**
// Confiar en el primer proxy. Esto es necesario para que express-rate-limit
// funcione correctamente en entornos como EasyPanel, Heroku, Render, etc.
app.set('trust proxy', 1);

// Seguridad: Limitación de Tasa (Rate Limiting) - FASE B
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // Límite de 100 peticiones por IP cada 15 min
    message: { error: 'Demasiadas peticiones desde esta IP, por favor intente de nuevo en 15 minutos.' },
    standardHeaders: true, // Devuelve info del límite en headers `RateLimit-*`
    legacyHeaders: false, // Deshabilita headers `X-RateLimit-*`
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 10, // Límite más estricto para intentos de login
    message: { error: 'Demasiados intentos de login, por favor intente de nuevo en 15 minutos.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Aplicar limitador general a todas las rutas /api
app.use('/api', apiLimiter);


// 4. ESQUEMAS DE VALIDACIÓN (ZOD)
// Validación robusta para evitar inyección SQL o datos malformados

// Esquema para IDs numéricos (BIGINT/SERIAL en Supabase)
const idSchema = z.number().int().positive();

// Esquema para login
const loginSchema = z.object({
    email: z.string().email({ message: "Email inválido" }),
    password: z.string().min(6, { message: "Contraseña debe tener al menos 6 caracteres" })
});

// Esquema para crear/actualizar citas
const citaSchema = z.object({
    cliente_id: idSchema,
    doctor_id: idSchema,
    fecha_cita: z.string().datetime({ message: "Formato de fecha inválido (ISO 8601)" }), // '2025-11-02T15:00:00Z'
    estado: z.enum(['PENDIENTE', 'CONFIRMADA', 'CANCELADA', 'COMPLETADA']),
    notas: z.string().optional().nullable(),
    duracion_minutos: idSchema.optional().default(30)
});

// Esquema para búsqueda de clientes
const searchSchema = z.object({
    query: z.string().min(2, { message: "Búsqueda requiere al menos 2 caracteres" })
});

// Esquema para carga de archivos (FASE C)
const fileUploadSchema = z.object({
    fileName: z.string().min(1),
    fileType: z.string().regex(/^[\w-]+\/[\w-.]+$/), // Ej: 'image/png', 'application/pdf'
    clienteId: idSchema
});

const fileConfirmSchema = z.object({
    storagePath: z.string().min(1),
    fileName: z.string().min(1),
    fileType: z.string().min(1),
    fileSizeKB: z.number().positive(),
    clienteId: idSchema,
    adminId: idSchema // El ID del admin que subió el archivo
});

const fileDownloadSchema = z.object({
    storagePath: z.string().min(1)
});

// Esquema para carga de citas por rango (FASE B)
const dateRangeSchema = z.object({
    start: z.string().datetime(),
    end: z.string().datetime()
});


// 5. MIDDLEWARE DE AUTENTICACIÓN (JWT)
// Protege las rutas que requieren que el usuario esté logueado
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Formato "Bearer TOKEN"

    if (token == null) {
        return res.status(401).json({ error: 'Token no proporcionado. Acceso denegado.' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            console.warn("Intento de token JWT inválido:", err.message);
            return res.status(403).json({ error: 'Token inválido o expirado.' });
        }
        
        // Adjuntamos el payload del usuario (ej. { id: 1, email: 'admin@vintex.com' })
        // a la petición para que las rutas posteriores puedan usarlo.
        req.user = user; 
        next();
    });
}


// 6. RUTAS (ENDPOINTS) DE LA API

// Ruta de "Health Check" para EasyPanel
// Responde a peticiones GET en la raíz (/)
app.get('/', (req, res) => {
    res.status(200).send('Servidor Vintex Clinic v3.0.2 - ¡Operacional!');
});

// === RUTAS DE AUTENTICACIÓN ===

// POST /api/login
// Endpoint público para iniciar sesión.
app.post('/api/login', loginLimiter, async (req, res) => {
    try {
        // 1. Validar datos de entrada
        const { email, password } = loginSchema.parse(req.body);

        // 2. Buscar al usuario (admin) en la BD
        // Usamos 'usuarios' en lugar de 'administradores'
        const { data: user, error: userError } = await supabase
            .from('usuarios')
            .select('*')
            .eq('email', email)
            .single();

        if (userError || !user) {
            return res.status(401).json({ error: 'Credenciales inválidas (email)' });
        }

        // 3. Verificar la contraseña hasheada
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Credenciales inválidas (pass)' });
        }

        // 4. Crear el Payload del JWT (SOLO info pública segura)
        const jwtPayload = {
            id: user.id,
            email: user.email,
            nombre: user.nombre,
            rol: user.rol // ej. 'admin', 'doctor'
        };

        // 5. Firmar y enviar el Token
        const token = jwt.sign(jwtPayload, JWT_SECRET, { expiresIn: '8h' });

        res.status(200).json({
            message: 'Login exitoso',
            token: token,
            user: jwtPayload
        });

    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Datos de login inválidos', details: error.errors });
        }
        console.error("Error en /api/login:", error.message);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});


// === RUTAS DE DATOS (Protegidas) ===

// GET /api/initial-data
// Carga los datos iniciales (Doctores y Clientes) para el frontend.
// Esta ruta es llamada una sola vez al cargar la app.
app.get('/api/initial-data', authenticateToken, async (req, res) => {
    try {
        const [doctoresRes, clientesRes] = await Promise.all([
            supabase.from('doctores').select('*').order('nombre'),
            supabase.from('clientes').select('*').order('nombre')
        ]);

        if (doctoresRes.error) throw doctoresRes.error;
        if (clientesRes.error) throw clientesRes.error;

        res.status(200).json({
            doctores: doctoresRes.data,
            clientes: clientesRes.data
        });
    } catch (error) {
        console.error("Error en /api/initial-data:", error.message);
        res.status(500).json({ error: 'Error al cargar datos iniciales.' });
    }
});

// GET /api/citas
// (Ruta solicitada por el frontend en el error 404)
// La implementamos para que devuelva TODAS las citas.
// ADVERTENCIA: Esto es ineficiente. Usar /api/citas-range es mejor.
app.get('/api/citas', authenticateToken, async (req, res) => {
    console.warn("Se está usando la ruta /api/citas (ineficiente). Considerar migrar a /api/citas-range.");
    try {
        const { data, error } = await supabase
            .from('citas')
            .select(`
                *,
                cliente:clientes (nombre, telefono),
                doctor:doctores (nombre, especialidad)
            `)
            .order('fecha_cita', { ascending: true });
        
        if (error) throw error;
        res.status(200).json(data);
    } catch (error) {
        console.error("Error en /api/citas:", error.message);
        res.status(500).json({ error: 'Error al obtener todas las citas.' });
    }
});


// GET /api/citas-range (Optimización FASE B)
// Carga solo las citas dentro de un rango de fechas específico.
app.get('/api/citas-range', authenticateToken, async (req, res) => {
    try {
        const { start, end } = dateRangeSchema.parse(req.query); // Vienen como query params

        const { data, error } = await supabase
            .from('citas')
            .select(`
                *,
                cliente:clientes (nombre, telefono),
                doctor:doctores (nombre, especialidad)
            `)
            .gte('fecha_cita', start) // Mayor o igual
            .lte('fecha_cita', end)   // Menor o igual
            .order('fecha_cita');

        if (error) throw error;
        res.status(200).json(data);

    } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: 'Rango de fechas inválido', details: error.errors });
        console.error("Error en /api/citas-range:", error.message);
        res.status(500).json({ error: 'Error al cargar citas por rango.' });
    }
});

// POST /api/citas
// Crea una nueva cita en la base de datos.
app.post('/api/citas', authenticateToken, async (req, res) => {
    try {
        const citaData = citaSchema.parse(req.body);

        const { data, error } = await supabase
            .from('citas')
            .insert([citaData])
            .select(`
                *,
                cliente:clientes (nombre, telefono),
                doctor:doctores (nombre, especialidad)
            `)
            .single(); // Devuelve el objeto creado

        if (error) throw error;
        res.status(201).json(data); // 201 Creado

    } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: 'Datos de cita inválidos', details: error.errors });
        console.error("Error en POST /api/citas:", error.message);
        res.status(500).json({ error: 'Error al crear la cita.' });
    }
});

// PUT /api/citas/:id
// Actualiza una cita existente.
app.put('/api/citas/:id', authenticateToken, async (req, res) => {
    try {
        const id = idSchema.parse(Number(req.params.id));
        const citaData = citaSchema.parse(req.body);

        const { data, error } = await supabase
            .from('citas')
            .update(citaData)
            .eq('id', id)
            .select(`
                *,
                cliente:clientes (nombre, telefono),
                doctor:doctores (nombre, especialidad)
            `)
            .single();

        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Cita no encontrada.' });
        
        res.status(200).json(data);

    } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: 'Datos o ID de cita inválidos', details: error.errors });
        console.error(`Error en PUT /api/citas/${req.params.id}:`, error.message);
        res.status(500).json({ error: 'Error al actualizar la cita.' });
    }
});

// DELETE /api/citas/:id
// Elimina una cita.
app.delete('/api/citas/:id', authenticateToken, async (req, res) => {
    try {
        const id = idSchema.parse(Number(req.params.id));

        const { data, error } = await supabase
            .from('citas')
            .delete()
            .eq('id', id)
            .select() // Devuelve el objeto eliminado
            .single();
        
        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Cita no encontrada.' });

        res.status(200).json({ message: 'Cita eliminada exitosamente', deleted: data });

    } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: 'ID de cita inválido', details: error.errors });
        console.error(`Error en DELETE /api/citas/${req.params.id}:`, error.message);
        res.status(500).json({ error: 'Error al eliminar la cita.' });
    }
});

// GET /api/search-clients
// Busca clientes por nombre o teléfono (para el modal)
app.get('/api/search-clients', authenticateToken, async (req, res) => {
    try {
        const { query } = searchSchema.parse(req.query);

        // Usamos 'ilike' para búsqueda insensible a mayúsculas
        // y 'or' para buscar en múltiples campos
        const { data, error } = await supabase
            .from('clientes')
            .select('*')
            .or(`nombre.ilike.%${query}%,telefono.ilike.%${query}%`)
            .limit(10); // Limitar resultados

        if (error) throw error;
        res.status(200).json(data);

    } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: 'Término de búsqueda inválido', details: error.errors });
        console.error("Error en /api/search-clients:", error.message);
        res.status(500).json({ error: 'Error al buscar clientes.' });
    }
});


// === RUTAS DE ALMACENAMIENTO (STORAGE) - FASE C ===

// POST /api/files/generate-upload-url
// Paso 1: El frontend pide una URL segura para subir un archivo.
app.post('/api/files/generate-upload-url', authenticateToken, async (req, res) => {
    try {
        const { fileName, fileType, clienteId } = fileUploadSchema.parse(req.body);

        // Crear una ruta única en Supabase Storage
        // ej: 'public/123-cliente/radiografia-2025-11-02T150000Z.png'
        const uniqueFileName = `${Date.now()}-${fileName}`;
        const storagePath = `public/${clienteId}/${uniqueFileName}`;

        // Generar una "URL firmada" (Signed URL) para SUBIR
        const { data, error } = await supabase.storage
            .from('archivos-pacientes') // Nombre del Bucket
            .createSignedUploadUrl(storagePath, {
                // Opciones de upsert:
                // upsert: true, // Deshabilitado para forzar archivos únicos
            });

        if (error) throw error;

        // Devolver la URL firmada y la ruta al frontend
        res.status(200).json({
            uploadUrl: data.signedUrl, // La URL a la que el frontend subirá el archivo
            storagePath: data.path      // La ruta que guardaremos en la BD
        });

    } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: 'Datos de archivo inválidos', details: error.errors });
        console.error("Error al generar URL de subida:", error.message);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// POST /api/files/confirm-upload
// Paso 2: El frontend confirma que la subida fue exitosa y guardamos la metadata en la BD.
app.post('/api/files/confirm-upload', authenticateToken, async (req, res) => {
    try {
        // El adminId lo sacamos del token JWT (usuario logueado)
        const adminId = req.user.id;
        
        // Validamos el body que envía el frontend
        const { storagePath, fileName, fileType, fileSizeKB, clienteId } = fileConfirmSchema.parse({
            ...req.body,
            adminId: adminId // Inyectamos el adminId para validación
        });

        // Insertar el registro en nuestra tabla 'archivos_adjuntos'
        const { data, error } = await supabase
            .from('archivos_adjuntos')
            .insert({
                cliente_id: clienteId,
                subido_por_admin_id: adminId,
                file_name: fileName,
                file_type: fileType,
                file_size_kb: fileSizeKB,
                storage_path: storagePath
            })
            .select()
            .single();

        if (error) throw error;
        res.status(201).json({ message: 'Archivo registrado exitosamente', metadata: data });

    } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: 'Metadata de archivo inválida', details: error.errors });
        console.error("Error al confirmar subida:", error.message);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// GET /api/files/:clienteId
// Paso 3: Listar todos los archivos de un cliente específico.
app.get('/api/files/:clienteId', authenticateToken, async (req, res) => {
    try {
        const validatedId = idSchema.parse(Number(req.params.clienteId));

        const { data, error } = await supabase
            .from('archivos_adjuntos')
            .select(`
                id,
                created_at,
                cliente_id,
                file_name,
                file_type,
                file_size_kb,
                storage_path,
                admin:usuarios (nombre)
            `)
            .eq('cliente_id', validatedId)
            .order('created_at', { ascending: false }); // Mostrar más nuevos primero

        if (error) throw error;
        res.status(200).json(data);

    } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: 'ID de cliente inválido', details: error.errors });
        console.error("Error al listar archivos:", error.message);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// POST /api/files/generate-download-url
// Paso 4: Obtener una URL segura para DESCARGAR un archivo.
app.post('/api/files/generate-download-url', authenticateToken, async (req, res) => {
    try {
        const { storagePath } = fileDownloadSchema.parse(req.body);

        // Generar una "URL firmada" (Signed URL) para DESCARGAR
        const { data, error } = await supabase.storage
            .from('archivos-pacientes')
            .createSignedUrl(storagePath, 300); // Válida por 5 minutos (300 segundos)

        if (error) throw error;
        res.status(200).json({ downloadUrl: data.signedUrl });

    } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: 'Ruta de archivo inválida', details: error.errors });
        console.error("Error al generar URL de descarga:", error.message);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});


// 7. INICIO DEL SERVIDOR
app.listen(port, () => {
    console.log(`Servidor Vintex v3.0 (SCALABLE) corriendo en http://localhost:${port}`);
});
