// ============== SERVIDOR BACKEND VINTEX CLINIC (VERSIÓN 2.3) =============
//
// CAMBIOS v2.3 (Oct 27, 2025):
// - Se actualizó el endpoint de /api/login para usar 'email' en lugar de 'username'.
// - Se cambió la llamada RPC a 'get_user_by_email' para alinearla con la BD.
//
// CAMBIOS v2.2 (Oct 26, 2025):
// - Corrección de zona horaria (UTC/Local) en creación/actualización de citas.
// - Endpoint GET /api/doctores implementado.
// - Endpoint PUT /api/doctores/:id implementado (editar horario, especialidad, estado).
//
// ========================================================================

// 1. IMPORTACIÓN DE MÓDULOS
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { z } = require('zod'); // Importar Zod para validación

// 2. CONFIGURACIÓN INICIAL
const app = express();
const port = 3001;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    console.error("Error: La variable de entorno JWT_SECRET debe estar definida.");
    process.exit(1);
}

// --- Conexión a Supabase ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
    console.error("Error: Las variables de entorno SUPABASE_URL y SUPABASE_ANON_KEY deben estar definidas.");
    process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

// 3. MIDDLEWARE
app.use(cors()); // Habilitar CORS para todas las rutas
app.use(express.json()); // Habilitar parsing de JSON

// --- Middleware de Autenticación (authenticateToken) ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Formato "Bearer TOKEN"

    if (token == null) {
        return res.status(401).json({ error: 'Token no proporcionado' }); // No hay token
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            console.warn("Token JWT inválido:", err.message);
            return res.status(403).json({ error: 'Token inválido' }); // Token inválido (expirado, etc.)
        }
        req.user = user; // Almacena info del usuario (ej. { id: 1, rol: 'admin' })
        next(); // Pasa al siguiente middleware o al endpoint
    });
};

// ============================================
// 4. ENDPOINTS DE LA API
// ============================================

// --- Endpoint de Login ---
// CAMBIO v2.3: Se actualizó para usar 'email' en lugar de 'username'
app.post('/api/login', async (req, res) => {
    try {
        // 1. Validar el cuerpo de la solicitud
        const schema = z.object({
            email: z.string().email({ message: "Email inválido" }), // CAMBIO: de username a email
            password: z.string().min(1, { message: "La contraseña es requerida" })
        });

        const validatedData = schema.safeParse(req.body);
        if (!validatedData.success) {
            return res.status(400).json({ error: 'Datos de login inválidos', details: validatedData.error.errors });
        }

        const { email, password } = validatedData.data; // CAMBIO: de username a email

        // 2. Usar RPC para obtener el usuario de forma segura
        // CAMBIO: de 'get_user_by_username' a 'get_user_by_email'
        const { data, error } = await supabase.rpc('get_user_by_email', { p_email: email });

        if (error) {
            console.error('Error RPC get_user_by_email:', error.message);
            return res.status(500).json({ error: 'Error al consultar la base de datos', details: error.message });
        }

        if (!data || data.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const user = data[0];

        // 3. Verificar la contraseña
        const isPasswordValid = await bcrypt.compare(password, user.password_hash);
        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        // 4. Generar el JWT
        const tokenPayload = {
            id: user.id,
            rol: user.rol,
            nombre: user.nombre
        };

        const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '8h' });

        // 5. Enviar respuesta exitosa
        res.status(200).json({
            message: 'Login exitoso',
            token: token,
            user: {
                id: user.id,
                nombre: user.nombre,
                rol: user.rol
            }
        });

    } catch (error) {
        console.error("Error crítico en /api/login:", error.message);
        res.status(500).json({ error: 'Error interno del servidor', details: error.message });
    }
});


// --- [TEMP] Endpoint de Setup/Reset de Contraseña de Admin ---
// Este endpoint crea o actualiza un usuario admin con un hash de contraseña conocido.
// Es una herramienta temporal de "rescate".
app.post('/api/setup-admin', async (req, res) => {
    // ¡Asegura este endpoint en producción!
    // Por ahora, solo valida un 'secret_key' simple desde el body.
    const { email, password, secret_key } = req.body;

    // Clave simple para evitar ejecuciones accidentales.
    // En un mundo real, esto estaría protegido por IP o un token de admin maestro.
    if (secret_key !== "VINTEX_SETUP_2025") {
        return res.status(403).json({ error: "Clave de setup incorrecta." });
    }

    if (!email || !password) {
        return res.status(400).json({ error: "Email y password son requeridos." });
    }

    try {
        // Generar el hash de la contraseña
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        // Define los datos del usuario admin/secretaria
        const userData = {
            email: email,
            password_hash: password_hash,
            nombre: 'Admin Vintex',
            rol: 'admin' // O 'secretaria' según necesites
        };

        // Intenta insertar o actualizar (upsert) el usuario
        // 'onConflict: 'email'' significa que si ya existe un usuario con ese email,
        // se actualizarán los campos en lugar de crear uno nuevo.
        const { data, error } = await supabase
            .from('usuarios')
            .upsert(userData, { onConflict: 'email' })
            .select();

        if (error) {
            console.error("Error en setup-admin (upsert):", error.message);
            throw error;
        }

        res.status(201).json({ 
            message: `Usuario '${email}' creado/actualizado exitosamente.`,
            user: data 
        });

    } catch (error) {
        console.error("Error crítico en /api/setup-admin:", error.message);
        res.status(500).json({ error: 'Error interno del servidor', details: error.message });
    }
});


// ============================================
// ENDPOINTS PROTEGIDOS (Requieren JWT)
// ============================================

// --- Endpoints de CLIENTES ---

app.get('/api/clientes', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('clientes')
            .select('id, nombre, email, telefono, dni')
            .order('nombre', { ascending: true });
        if (error) throw error;
        res.status(200).json(data);
    } catch (error) {
        console.error("Error al obtener clientes:", error.message);
        res.status(500).json({ error: 'No se pudo obtener la lista de clientes.', details: error.message });
    }
});

app.post('/api/clientes', authenticateToken, async (req, res) => {
    try {
        const schema = z.object({
            nombre: z.string().min(3, "El nombre debe tener al menos 3 caracteres"),
            email: z.string().email("Email inválido").optional().nullable(),
            telefono: z.string().min(8, "Teléfono inválido").optional().nullable(),
            dni: z.string().min(7, "DNI inválido").optional().nullable()
        });
        const validatedData = schema.parse(req.body);

        const { data, error } = await supabase
            .from('clientes')
            .insert(validatedData)
            .select()
            .single();
        if (error) throw error;
        res.status(201).json(data);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Datos de cliente inválidos', details: error.errors });
        }
        console.error("Error al crear cliente:", error.message);
        res.status(500).json({ error: 'No se pudo crear el cliente.', details: error.message });
    }
});


// --- Endpoints de DOCTORES ---

// NUEVO (v2.2): Obtener todos los doctores
app.get('/api/doctores', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('doctores')
            .select('id, nombre, especialidad, inicio_jornada, fin_jornada, activo_agendame')
            .order('nombre', { ascending: true });
        if (error) throw error;
        res.status(200).json(data);
    } catch (error) {
        console.error("Error al obtener doctores:", error.message);
        res.status(500).json({ error: 'No se pudo obtener la lista de doctores.', details: error.message });
    }
});

// NUEVO (v2.2): Actualizar un doctor
app.put('/api/doctores/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    
    // Validación de seguridad: Solo un admin puede editar doctores
    if (req.user.rol !== 'admin') {
        return res.status(403).json({ error: 'Acceso denegado. Se requiere rol de administrador.' });
    }

    try {
        const timeRegex = /^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/; // Formato HH:MM

        const schema = z.object({
            especialidad: z.string().min(2, "Especialidad inválida").optional().nullable(),
            inicio_jornada: z.string().regex(timeRegex, "Formato de hora debe ser HH:MM").optional().nullable(),
            fin_jornada: z.string().regex(timeRegex, "Formato de hora debe ser HH:MM").optional().nullable(),
            activo_agendame: z.boolean().optional()
        });

        // Validamos solo los campos que se envían
        const validatedData = schema.parse(req.body);

        // Filtrar claves nulas o indefinidas (para no sobrescribir en Supabase)
        const updateData = Object.fromEntries(
            Object.entries(validatedData).filter(([_, v]) => v !== null && v !== undefined)
        );

        if (Object.keys(updateData).length === 0) {
             return res.status(400).json({ error: 'No se proporcionaron datos válidos para actualizar.' });
        }

        const { data, error } = await supabase
            .from('doctores')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();
        
        if (error) throw error;
        res.status(200).json(data);

    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Datos de doctor inválidos', details: error.errors });
        }
        console.error(`Error al actualizar doctor ${id}:`, error.message);
        res.status(500).json({ error: 'No se pudo actualizar el doctor.', details: error.message });
    }
});


// --- Endpoints de CITAS ---

app.get('/api/citas', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('citas')
            .select(`
                id, 
                fecha_hora, 
                descripcion, 
                estado, 
                duracion_minutos,
                cliente: clientes (id, nombre, dni),
                doctor: doctores (id, nombre, especialidad)
            `)
            .order('fecha_hora', { ascending: false }); // v2.2: Ordenar por más reciente primero
        
        if (error) throw error;
        res.status(200).json(data);
    } catch (error) {
        console.error("Error al obtener citas:", error.message);
        res.status(500).json({ error: 'No se pudo obtener la lista de citas.', details: error.message });
    }
});

app.post('/api/citas', authenticateToken, async (req, res) => {
    try {
        const schema = z.object({
            fecha_hora: z.string().datetime("La fecha y hora debe ser un string ISO 8601"),
            descripcion: z.string().optional().nullable(),
            estado: z.enum(['pendiente', 'confirmada', 'cancelada', 'completada']).default('pendiente'),
            duracion_minutos: z.number().int().positive().default(30),
            cliente_id: z.number().int().positive(),
            doctor_id: z.number().int().positive()
        });

        const validatedData = schema.parse(req.body);
        
        // v2.2 - Corrección UTC: La fecha_hora ya viene en ISO (UTC por defecto o con offset)
        // Supabase (PostgreSQL con timestamptz) la guardará correctamente en UTC.
        // No se necesita conversión manual si el frontend envía un string ISO válido.

        const { data, error } = await supabase
            .from('citas')
            .insert(validatedData)
            .select()
            .single();
        
        if (error) throw error;

        // Devolver datos completos (como en GET)
        const { data: fullCita, error: selectError } = await supabase
            .from('citas')
            .select(`id, fecha_hora, descripcion, estado, duracion_minutos, cliente: clientes (id, nombre, dni), doctor: doctores (id, nombre)`)
            .eq('id', data.id)
            .single();

        if (selectError) throw selectError;

        res.status(201).json(fullCita);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Datos de cita inválidos', details: error.errors });
        }
        console.error("Error al crear la cita:", error.message);
        res.status(500).json({ error: 'No se pudo crear la cita.', details: error.message });
    }
});

app.put('/api/citas/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        const schema = z.object({
            // v2.2 - Corrección UTC: Aceptar el string ISO 8601 directamente
            fecha_hora: z.string().datetime("Formato de fecha inválido").optional(),
            descripcion: z.string().optional().nullable(),
            estado: z.enum(['pendiente', 'confirmada', 'cancelada', 'completada']).optional(),
            duracion_minutos: z.number().int().positive().optional(),
            cliente_id: z.number().int().positive().optional(),
            doctor_id: z.number().int().positive().optional()
        });

        const validatedData = schema.parse(req.body);

        if (Object.keys(validatedData).length === 0) {
            return res.status(400).json({ error: 'No se proporcionaron datos para actualizar.' });
        }

        const { data, error } = await supabase
            .from('citas')
            .update(validatedData)
            .eq('id', id)
            .select() // Pedir que devuelva el registro actualizado
            .single(); // Esperamos solo uno
        
        if (error) {
            console.error(`Error al actualizar cita ${id}:`, error.message);
            throw error;
        }
        
        if (!data) return res.status(404).json({ error: 'Cita no encontrada o no se pudo actualizar.' });

        // 3. Devolver datos completos (como en GET)
        const { data: fullCita, error: selectError } = await supabase
            .from('citas')
            .select(`id, fecha_hora, descripcion, estado, duracion_minutos, cliente: clientes (id, nombre, dni), doctor: doctores (id, nombre)`)
            .eq('id', data.id)
            .single();

        if (selectError) throw selectError;

        res.status(200).json(fullCita);

    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Datos de actualización inválidos', details: error.errors });
        }
        console.error("Error al actualizar la cita:", error.message);
        res.status(500).json({ error: 'No se pudo actualizar la cita.', details: error.message });
    }
});

app.delete('/api/citas/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        const { error } = await supabase.from('citas').delete().eq('id', id);
        if (error) throw error;
        res.status(204).send(); // 204 No Content (Éxito sin cuerpo de respuesta)
    } catch (error) {
        console.error("Error al eliminar la cita:", error.message);
        res.status(500).json({ error: 'No se pudo eliminar la cita.', details: error.message });
    }
});

// ============================================
// 5. INICIAR SERVIDOR
// ============================================
// ESTA ES LA PARTE QUE PROBABLEMENTE SE BORRÓ
app.listen(port, () => {
    // Usar 0.0.0.0 para asegurar que sea accesible fuera del contenedor (como requiere Easypanel)
    // Aunque express por defecto escucha en 0.0.0.0 si no se especifica host.
    console.log(`Servidor Vintex v2.3 corriendo en http://localhost:${port}`);
});

