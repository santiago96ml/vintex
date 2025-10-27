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

//
// --- CHANGELOG v2.2 ---
// - FIX (Doctores): Se actualizan esquemas Zod (POST y PUT) para incluir:
//   'especialidad', 'inicio_jornada', 'fin_jornada', 'activo_agenda'.
// - FIX (Doctores): Se actualiza el .select() en POST/PUT para devolver el objeto completo.
// - FEATURE (Citas): Se añade .order() en GET /api/citas para devolver
//   las más recientes primero.
//
// -------------------------------------------------------------------------

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
app.use(cors());
app.use(express.json()); // Middleware para parsear JSON

// --- Middleware de Autenticación JWT ---
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // "Bearer TOKEN"

    if (token == null) {
        return res.status(401).json({ error: 'Token no proporcionado' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            console.error("Error de verificación JWT:", err.message);
            return res.status(403).json({ error: 'Token inválido' });
        }
        req.user = user;
        next();
    });
}

// 4. ESQUEMAS DE VALIDACIÓN (ZOD)

// --- Esquema para Doctores (v2.2) ---
const doctorSchema = z.object({
    nombre: z.string().min(3, "El nombre debe tener al menos 3 caracteres"),
    email: z.string().email("Email inválido").optional().nullable(),
    telefono: z.string().min(8, "Teléfono inválido").optional().nullable(),
    // --- Nuevos campos v2.2 ---
    especialidad: z.string().optional().nullable(),
    inicio_jornada: z.string().regex(/^\d{2}:\d{2}$/, "Formato de hora debe ser HH:MM").optional().nullable(),
    fin_jornada: z.string().regex(/^\d{2}:\d{2}$/, "Formato de hora debe ser HH:MM").optional().nullable(),
    activo_agenda: z.boolean().default(true).optional(),
});
const partialDoctorSchema = doctorSchema.partial(); // Para PUT (todos los campos opcionales)

// --- Esquema para Clientes ---
const clienteSchema = z.object({
    nombre: z.string().min(3, "El nombre debe tener al menos 3 caracteres"),
    dni: z.string().min(7, "DNI inválido").optional().nullable(),
    telefono: z.string().min(8, "Teléfono inválido").optional().nullable(),
    email: z.string().email("Email inválido").optional().nullable(),
    // historial: z.string().optional().nullable(), // Se manejará por separado si crece
});
const partialClienteSchema = clienteSchema.partial();

// --- Esquema para Citas ---
const citaSchema = z.object({
    fecha_hora: z.string().datetime("Formato de fecha y hora inválido (ISO 8601)"),
    cliente_id: z.number().int().positive("ID de cliente inválido"),
    doctor_id: z.number().int().positive("ID de doctor inválido"),
    descripcion: z.string().optional().nullable(),
    estado: z.enum(['PENDIENTE', 'CONFIRMADA', 'COMPLETADA', 'CANCELADA']),
    duracion_minutos: z.number().int().positive("La duración debe ser positiva").default(30),
});
const partialCitaSchema = citaSchema.partial();

// 5. RUTAS DE AUTENTICACIÓN

app.post('/api/login', async (req, res) => {
    // ... (El código de login no necesita cambios para esta actualización) ...
    // ... (Mantenemos la lógica de login con bcrypt y JWT existente) ...
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }

    try {
        // Usamos RPC para llamar a la función 'get_user_by_username'
        const { data: user, error } = await supabase.rpc('get_user_by_username', {
            p_username: username
        });

        if (error) {
            console.error("Error RPC get_user_by_username:", error.message);
            return res.status(500).json({ error: 'Error interno del servidor' });
        }

        if (!user) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        // 2. Verificar la contraseña
        const isMatch = await bcrypt.compare(password, user.password_hash);

        if (!isMatch) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        // 3. Generar JWT
        const tokenPayload = {
            userId: user.id,
            username: user.username,
            rol: user.rol // 'admin' o 'recepcion'
        };

        const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '8h' });

        res.json({
            token: token,
            username: user.username,
            rol: user.rol
        });

    } catch (error) {
        console.error("Error en /api/login:", error.message);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// --- RUTA TEMPORAL DE SETUP (Opcional, mantener si aún es necesaria) ---
app.post('/api/setup-admin', async (req, res) => {
    // ... (Sin cambios) ...
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: "Faltan 'username' y 'password' en el body." });
    }
    try {
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);
        
        const { data, error } = await supabase
            .from('usuarios')
            .update({ password_hash: password_hash })
            .eq('username', username)
            .select();

        if (error) throw error;
        if (!data || data.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

        res.status(200).json({ message: 'Hash de contraseña actualizado para ' + username, data });
    } catch (error) {
        console.error("Error en setup-admin:", error.message);
        res.status(500).json({ error: 'No se pudo actualizar el hash.', details: error.message });
    }
});


// 6. RUTAS API (CRUD) PROTEGIDAS

// --- API DOCTORES ---

app.get('/api/doctores', authenticateToken, async (req, res) => {
    try {
        // Trae todos los campos
        const { data, error } = await supabase.from('doctores').select('*').order('nombre');
        if (error) throw error;
        res.status(200).json(data);
    } catch (error) {
        console.error("Error al obtener doctores:", error.message);
        res.status(500).json({ error: 'Error interno' });
    }
});

app.post('/api/doctores', authenticateToken, async (req, res) => {
    try {
        // 1. Validar
        const doctorData = doctorSchema.parse(req.body);

        // 2. Insertar
        const { data, error } = await supabase
            .from('doctores')
            .insert(doctorData)
            .select('*') // v2.2: Devolver todos los campos
            .single();

        if (error) throw error;
        res.status(201).json(data);

    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Datos de doctor inválidos', details: error.errors });
        }
        console.error("Error al crear doctor:", error.message);
        res.status(500).json({ error: 'No se pudo crear el doctor.', details: error.message });
    }
});

app.put('/api/doctores/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        // 1. Validar
        const doctorUpdateData = partialDoctorSchema.parse(req.body);

        // 2. Actualizar
        const { data, error } = await supabase
            .from('doctores')
            .update(doctorUpdateData)
            .eq('id', id)
            .select('*') // v2.2: Devolver todos los campos
            .single();

        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Doctor no encontrado' });
        res.status(200).json(data);

    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Datos de actualización inválidos', details: error.errors });
        }
        console.error("Error al actualizar doctor:", error.message);
        res.status(500).json({ error: 'No se pudo actualizar el doctor.', details: error.message });
    }
});

// (DELETE Doctores no se implementa por seguridad de datos, se prefiere 'desactivar')

// --- API CLIENTES ---

app.get('/api/clientes', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabase.from('clientes').select('*').order('nombre');
        if (error) throw error;
        res.status(200).json(data);
    } catch (error) {
        console.error("Error al obtener clientes:", error.message);
        res.status(500).json({ error: 'Error interno' });
    }
});

app.post('/api/clientes', authenticateToken, async (req, res) => {
    // ... (Sin cambios v2.2) ...
    try {
        const clienteData = clienteSchema.parse(req.body);
        const { data, error } = await supabase.from('clientes').insert(clienteData).select().single();
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

app.put('/api/clientes/:id', authenticateToken, async (req, res) => {
    // ... (Sin cambios v2.2) ...
    const { id } = req.params;
    try {
        const clienteUpdateData = partialClienteSchema.parse(req.body);
        const { data, error } = await supabase.from('clientes').update(clienteUpdateData).eq('id', id).select().single();
        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Cliente no encontrado' });
        res.status(200).json(data);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Datos de actualización inválidos', details: error.errors });
        }
        console.error("Error al actualizar cliente:", error.message);
        res.status(500).json({ error: 'No se pudo actualizar el cliente.', details: error.message });
    }
});

app.delete('/api/clientes/:id', authenticateToken, async (req, res) => {
    // ... (Sin cambios v2.2) ...
    const { id } = req.params;
    // Opcional: Verificar que el cliente no tenga citas futuras antes de borrar
    try {
        const { error } = await supabase.from('clientes').delete().eq('id', id);
        if (error) throw error;
        res.status(204).send();
    } catch (error) {
        console.error("Error al eliminar cliente:", error.message);
        res.status(500).json({ error: 'No se pudo eliminar el cliente.', details: error.message });
    }
});


// --- API CITAS ---

const SELECT_CITAS_QUERY = `
    id, 
    fecha_hora, 
    descripcion, 
    estado, 
    duracion_minutos, 
    cliente: clientes (id, nombre, dni), 
    doctor: doctores (id, nombre)
`;

app.get('/api/citas', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('citas')
            .select(SELECT_CITAS_QUERY)
            .order('fecha_hora', { ascending: false }); // v2.2: Ordenar por más reciente

        if (error) throw error;
        res.status(200).json(data);
    } catch (error) {
        console.error("Error al obtener citas:", error.message);
        res.status(500).json({ error: 'Error interno' });
    }
});

app.post('/api/citas', authenticateToken, async (req, res) => {
    // ... (Sin cambios v2.2) ...
    try {
        // 1. Validar
        const citaData = citaSchema.parse(req.body);

        // 2. Insertar
        const { data, error } = await supabase
            .from('citas')
            .insert(citaData)
            .select(SELECT_CITAS_QUERY) // Devolver datos completos
            .single();

        if (error) throw error;
        res.status(201).json(data);

    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Datos de cita inválidos', details: error.errors });
        }
        console.error("Error al crear la cita:", error.message);
        res.status(500).json({ error: 'No se pudo crear la cita.', details: error.message });
    }
});

app.put('/api/citas/:id', authenticateToken, async (req, res) => {
    // ... (Sin cambios v2.2 en la lógica del backend, el fix de UTC es en el frontend) ...
    const { id } = req.params;
    try {
        // 1. Validar
        const updateData = partialCitaSchema.parse(req.body);

        // 2. Actualizar
        const { data, error } = await supabase
            .from('citas')
            .update(updateData)
            .eq('id', id)
            .select(SELECT_CITAS_QUERY) // Devolver datos completos (como en GET)
            .single();
        
        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Cita no encontrada' });

        res.status(200).json(data);

    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Datos de actualización inválidos', details: error.errors });
        }
        console.error("Error al actualizar la cita:", error.message);
        res.status(500).json({ error: 'No se pudo actualizar la cita.', details: error.message });
    }
});

app.delete('/api/citas/:id', authenticateToken, async (req, res) => {
    // ... (Sin cambios v2.2) ...
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


// 7. INICIAR SERVIDOR
app.listen(port, () => {
    console.log(`Servidor Vintex v2.2 corriendo en http://localhost:${port}`);
});

