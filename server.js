// ============== SERVIDOR BACKEND VINTEX CLINIC (VERSIÓN 2.4) =============
//
// CAMBIOS v2.4 (Oct 27, 2025):
// - ALINEACIÓN COMPLETA CON ESQUEMA DE BD:
// - CLIENTES: Eliminada la columna 'email' de GET y POST.
// - DOCTORES: Renombradas columnas a 'horario_inicio', 'horario_fin', 'activo'.
// - CITAS:
//   - Renombrado estado 'pendiente' a 'programada' (y añadido 'no_asistio').
//   - Cambiado Zod schema de 'fecha_hora' para aceptar un string sin timezone
//     (para coincidir con la columna 'timestamp without time zone').
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
app.use(express.json());

// --- Middleware de Autenticación (authenticateToken) ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; 

    if (token == null) {
        return res.status(401).json({ error: 'Token no proporcionado' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            console.warn("Token JWT inválido:", err.message);
            return res.status(403).json({ error: 'Token inválido' });
        }
        req.user = user; 
        next();
    });
};

// ============================================
// 4. ENDPOINTS DE LA API
// ============================================

// --- Endpoint de Login ---
app.post('/api/login', async (req, res) => {
    try {
        const schema = z.object({
            email: z.string().email({ message: "Email inválido" }),
            password: z.string().min(1, { message: "La contraseña es requerida" })
        });

        const validatedData = schema.safeParse(req.body);
        if (!validatedData.success) {
            return res.status(400).json({ error: 'Datos de login inválidos', details: validatedData.error.errors });
        }

        const { email, password } = validatedData.data;

        // Usar RPC (get_user_by_email)
        const { data, error } = await supabase.rpc('get_user_by_email', { p_email: email });

        if (error) {
            console.error('Error RPC get_user_by_email:', error.message);
            return res.status(500).json({ error: 'Error al consultar la base de datos', details: error.message });
        }

        if (!data || data.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        const user = data[0];

        const isPasswordValid = await bcrypt.compare(password, user.password_hash);
        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const tokenPayload = { id: user.id, rol: user.rol, nombre: user.nombre };
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


// --- [TEMP] Endpoint de Setup/Reset de Contraseña de Admin ---
app.post('/api/setup-admin', async (req, res) => {
    const { email, password, secret_key } = req.body;
    if (secret_key !== "VINTEX_SETUP_2025") {
        return res.status(403).json({ error: "Clave de setup incorrecta." });
    }
    if (!email || !password) {
        return res.status(400).json({ error: "Email y password son requeridos." });
    }
    try {
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);
        const userData = {
            email: email,
            password_hash: password_hash,
            nombre: 'Admin Vintex',
            rol: 'admin' 
        };
        const { data, error } = await supabase
            .from('usuarios')
            .upsert(userData, { onConflict: 'email' })
            .select();
        if (error) throw error;
        res.status(201).json({ message: `Usuario '${email}' creado/actualizado.`, user: data });
    } catch (error) {
        console.error("Error crítico en /api/setup-admin:", error.message);
        res.status(500).json({ error: 'Error interno del servidor', details: error.message });
    }
});


// ============================================
// ENDPOINTS PROTEGIDOS (Requieren JWT)
// ============================================

// --- Endpoints de CLIENTES ---
// CAMBIO v2.4: Eliminada la columna 'email'. Añadidas 'activo' y 'solicitud_de_secretaría'.
app.get('/api/clientes', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('clientes')
            .select('id, nombre, telefono, dni, activo, solicitud_de_secretaría') // Columna 'email' eliminada
            .order('nombre', { ascending: true });
        if (error) throw error;
        res.status(200).json(data);
    } catch (error) {
        console.error("Error al obtener clientes:", error.message);
        res.status(500).json({ error: 'No se pudo obtener la lista de clientes.', details: error.message });
    }
});

// CAMBIO v2.4: Eliminada la columna 'email' de la validación.
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
// CAMBIO v2.4: Renombradas columnas a 'horario_inicio', 'horario_fin', 'activo'.
app.get('/api/doctores', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('doctores')
            .select('id, nombre, especialidad, horario_inicio, horario_fin, activo') // Nombres de columnas actualizados
            .order('nombre', { ascending: true });
        if (error) throw error;
        res.status(200).json(data);
    } catch (error) {
        console.error("Error al obtener doctores:", error.message);
        res.status(500).json({ error: 'No se pudo obtener la lista de doctores.', details: error.message });
    }
});

// CAMBIO v2.4: Renombradas columnas a 'horario_inicio', 'horario_fin', 'activo'.
app.put('/api/doctores/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    
    if (req.user.rol !== 'admin') {
        return res.status(403).json({ error: 'Acceso denegado. Se requiere rol de administrador.' });
    }

    try {
        const timeRegex = /^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/; // Formato HH:MM

        const schema = z.object({
            especialidad: z.string().min(2, "Especialidad inválida").optional().nullable(),
            // Nombres de columnas actualizados
            horario_inicio: z.string().regex(timeRegex, "Formato de hora debe ser HH:MM").optional().nullable(),
            horario_fin: z.string().regex(timeRegex, "Formato de hora debe ser HH:MM").optional().nullable(),
            activo: z.boolean().optional()
        });

        const validatedData = schema.parse(req.body);

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
            .order('fecha_hora', { ascending: false }); 
        
        if (error) throw error;
        res.status(200).json(data);
    } catch (error) {
        console.error("Error al obtener citas:", error.message);
        res.status(500).json({ error: 'No se pudo obtener la lista de citas.', details: error.message });
    }
});

app.post('/api/citas', authenticateToken, async (req, res) => {
    try {
        // CAMBIO v2.4: Regex para 'timestamp without time zone' y Enums actualizados.
        const fechaHoraRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?$/; // YYYY-MM-DDTHH:MM:SS.sss

        const schema = z.object({
            fecha_hora: z.string().regex(fechaHoraRegex, "Formato de fecha debe ser YYYY-MM-DDTHH:MM:SS"),
            descripcion: z.string().optional().nullable(),
            // Enums actualizados para coincidir con la DB
            estado: z.enum(['programada', 'confirmada', 'cancelada', 'completada', 'no_asistio']).default('programada'),
            duracion_minutos: z.number().int().positive().default(30),
            cliente_id: z.number().int().positive(),
            doctor_id: z.number().int().positive()
        });

        const validatedData = schema.parse(req.body);
        
        const { data, error } = await supabase
            .from('citas')
            .insert(validatedData)
            .select()
            .single();
        
        if (error) throw error;

        // Devolver datos completos
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
        // CAMBIO v2.4: Regex para 'timestamp without time zone' y Enums actualizados.
        const fechaHoraRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?$/; // YYYY-MM-DDTHH:MM:SS.sss

        const schema = z.object({
            fecha_hora: z.string().regex(fechaHoraRegex, "Formato de fecha debe ser YYYY-MM-DDTHH:MM:SS").optional(),
            descripcion: z.string().optional().nullable(),
            // Enums actualizados
            estado: z.enum(['programada', 'confirmada', 'cancelada', 'completada', 'no_asistio']).optional(),
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
            .select()
            .single();
        
        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Cita no encontrada.' });

        // Devolver datos completos
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
        res.status(204).send();
    } catch (error) {
        console.error("Error al eliminar la cita:", error.message);
        res.status(500).json({ error: 'No se pudo eliminar la cita.', details: error.message });
    }
});

// ============================================
// 5. INICIAR SERVIDOR
// ============================================
app.listen(port, () => {
    console.log(`Servidor Vintex v2.4 (Schema-Aligned) corriendo en http://localhost:${port}`);
});

