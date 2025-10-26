// ============== SERVIDOR BACKEND VINTEX CLINIC (VERSIÓN 2.0 - SEGURA Y ROBUSTA) ==============\n
// --- IMPLEMENTA MEJORAS DE NIVEL 1 (JWT) Y NIVEL 3 (VALIDACIÓN Y RPC) ---

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

// 3. MIDDLEWARE GLOBAL
app.use(cors({ origin: '*' })); // En producción, deberías limitarlo: origin: 'https://tu-dominio-frontend.com'
app.use(express.json());

// 4. SCHEMAS DE VALIDACIÓN (NIVEL 3.1)
// ======================================
const doctorSchema = z.object({
    nombre: z.string().min(3, "El nombre debe tener al menos 3 caracteres"),
    especialidad: z.string().optional(),
    horario_inicio: z.string().regex(/^\d{2}:\d{2}$/, "Formato de hora debe ser HH:MM"),
    horario_fin: z.string().regex(/^\d{2}:\d{2}$/, "Formato de hora debe ser HH:MM"),
    activo: z.boolean().optional()
});

const clientPatchSchema = z.object({
    nombre: z.string().min(3).optional(),
    telefono: z.string().min(6).optional(),
    activo: z.boolean().optional(),
    solicitud_de_secretaría: z.boolean().optional()
});

const citaSchema = z.object({
    fecha_hora: z.string().datetime("Debe ser una fecha y hora ISO válida"),
    descripcion: z.string().optional(),
    estado: z.enum(['programada', 'confirmada', 'cancelada', 'completada']),
    duracion_minutos: z.number().int().positive("La duración debe ser un número positivo"),
    doctor_id: z.number().int(),
    // Datos del cliente (existente o nuevo)
    cliente_id: z.number().int().optional(),
    new_client_name: z.string().optional(),
    new_client_dni: z.string().optional(),
    new_client_telefono: z.string().optional()
});

const citaPatchSchema = z.object({
    fecha_hora: z.string().datetime().optional(),
    descripcion: z.string().optional(),
    estado: z.enum(['programada', 'confirmada', 'cancelada', 'completada']).optional(),
    duracion_minutos: z.number().int().positive().optional(),
    doctor_id: z.number().int().optional(),
});

const loginSchema = z.object({
    email: z.string().email("Debe ser un email válido"),
    password: z.string().min(6, "La contraseña es requerida")
});

// 5. MIDDLEWARE DE AUTENTICACIÓN (NIVEL 1.1)
// ==========================================
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Formato: "Bearer TOKEN"

    if (token == null) {
        return res.status(401).json({ error: 'Acceso no autorizado: Token no proporcionado.' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Acceso prohibido: Token no válido o expirado.' });
        }
        req.user = user; // Guarda la info del usuario (del token) en el request
        next(); // Pasa al siguiente middleware o a la ruta
    });
};

// 6. RUTAS DE LA API
// ==================

// --- Ruta de Login (Pública) ---
app.post('/api/login', async (req, res) => {
    try {
        // 1. Validar el input
        const { email, password } = loginSchema.parse(req.body);

        // 2. Buscar al usuario en la BD
        const { data: user, error } = await supabase
            .from('usuarios')
            .select('id, email, password_hash, nombre, rol')
            .eq('email', email)
            .single();

        if (error || !user) {
            return res.status(401).json({ error: 'Credenciales inválidas.' });
        }

        // 3. Comparar la contraseña
        const isPasswordValid = await bcrypt.compare(password, user.password_hash);

        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Credenciales inválidas.' });
        }

        // 4. Generar el JWT
        const tokenPayload = {
            id: user.id,
            email: user.email,
            nombre: user.nombre,
            rol: user.rol
        };
        const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '8h' }); // Token expira en 8 horas

        // 5. Enviar el token y datos del usuario
        res.json({
            message: 'Login exitoso',
            token: token,
            user: {
                nombre: user.nombre,
                email: user.email,
                rol: user.rol
            }
        });

    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Datos de login inválidos', details: error.errors });
        }
        console.error("Error en login:", error.message);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});


// --- RUTAS PROTEGIDAS (Requieren Token) ---
// Todas las rutas de aquí para abajo usarán el middleware 'authenticateToken'

app.get('/api/initial-data', authenticateToken, async (req, res) => {
    try {
        // req.user está disponible gracias al middleware
        console.log(`Usuario ${req.user.email} solicitando datos iniciales.`);
        
        const [doctorsRes, appointmentsRes, clientsRes, chatHistoryRes] = await Promise.all([
            supabase.from('doctores').select('*').order('id', { ascending: true }),
            supabase.from('citas').select(`id, fecha_hora, descripcion, estado, duracion_minutos, cliente: clientes (id, nombre, dni), doctor: doctores (id, nombre)`).order('fecha_hora', { ascending: true }),
            supabase.from('clientes').select('*').order('nombre', { ascending: true }),
            supabase.from('n8n_chat_histories').select('session_id, message').order('id', { ascending: false }).limit(200)
        ]);

        if (doctorsRes.error) throw doctorsRes.error;
        if (appointmentsRes.error) throw appointmentsRes.error;
        if (clientsRes.error) throw clientsRes.error;
        if (chatHistoryRes.error) throw chatHistoryRes.error;

        res.json({
            doctors: doctorsRes.data,
            appointments: appointmentsRes.data,
            clients: clientsRes.data,
            chatHistory: chatHistoryRes.data
        });
    } catch (error) {
        console.error("Error al obtener datos iniciales:", error.message);
        res.status(500).json({ error: 'No se pudieron cargar los datos iniciales.', details: error.message });
    }
});

// --- Doctores ---
app.post('/api/doctors', authenticateToken, async (req, res) => {
    try {
        // 1. Validar (Nivel 3.1)
        const doctorData = doctorSchema.parse(req.body);

        // 2. Insertar
        const { data, error } = await supabase
            .from('doctores')
            .insert(doctorData)
            .select()
            .single();

        if (error) throw error;
        res.status(201).json(data);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Datos del doctor inválidos', details: error.errors });
        }
        console.error("Error al crear doctor:", error.message);
        res.status(500).json({ error: 'No se pudo crear el doctor.', details: error.message });
    }
});

// --- Clientes ---
app.patch('/api/clients/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        // 1. Validar (Nivel 3.1)
        const updates = clientPatchSchema.parse(req.body);

        // 2. Actualizar
        const { data, error } = await supabase
            .from('clientes')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Cliente no encontrado.' });
        res.status(200).json(data);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Datos de actualización inválidos', details: error.errors });
        }
        console.error("Error al actualizar cliente:", error.message);
        res.status(500).json({ error: 'No se pudo actualizar el cliente.', details: error.message });
    }
});


// --- Citas ---
app.post('/api/citas', authenticateToken, async (req, res) => {
    try {
        // 1. Validar (Nivel 3.1)
        const { 
            fecha_hora, descripcion, doctor_id, duracion_minutos,
            cliente_id, new_client_name, new_client_dni, new_client_telefono 
        } = citaSchema.parse(req.body);

        let citaData;

        // 2. Lógica de negocio (Nivel 3.2 - RPC)
        if (cliente_id) {
            // Caso 1: Cita para cliente existente
            const { data, error } = await supabase
                .from('citas')
                .insert({
                    fecha_hora,
                    descripcion,
                    estado: 'programada',
                    duracion_minutos,
                    doctor_id,
                    cliente_id
                })
                .select()
                .single();
            if (error) throw error;
            citaData = data;
        } else if (new_client_dni) {
            // Caso 2: Cita para cliente nuevo o existente por DNI (USA LA FUNCIÓN RPC)
            const { data, error } = await supabase.rpc('crear_cita_con_cliente', {
                p_fecha_hora: fecha_hora,
                p_descripcion: descripcion,
                p_doctor_id: doctor_id,
                p_duracion: duracion_minutos,
                p_cliente_dni: new_client_dni,
                p_cliente_nombre: new_client_name,
                p_cliente_telefono: new_client_telefono
            });
            
            if (error) throw error;
            if (!data || data.length === 0) throw new Error("La función RPC no devolvió la cita creada.");
            
            // rpc devuelve un array, tomamos el primer elemento
            citaData = data[0]; 
        } else {
            return res.status(400).json({ error: 'Debe proporcionar un cliente_id o datos de nuevo cliente (DNI).' });
        }
        
        // 3. Obtener datos completos para devolver al frontend
        // (La cita devuelta por RPC o insert ya es completa, pero si no lo fuera, aquí la buscaríamos)
        const { data: fullCita, error: selectError } = await supabase
            .from('citas')
            .select(`id, fecha_hora, descripcion, estado, duracion_minutos, cliente: clientes (id, nombre, dni), doctor: doctores (id, nombre)`)
            .eq('id', citaData.id)
            .single();

        if (selectError) throw selectError;

        res.status(201).json(fullCita);

    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Datos de la cita inválidos', details: error.errors });
        }
        console.error("Error al procesar la cita:", error.message);
        res.status(500).json({ error: 'No se pudo procesar la cita.', details: error.message });
    }
});

app.patch('/api/citas/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        // 1. Validar (Nivel 3.1)
        const updates = citaPatchSchema.parse(req.body);

        // 2. Actualizar
        const { data, error } = await supabase
            .from('citas')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'No se encontró la cita para actualizar.' });

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


// 7. INICIAR SERVIDOR
app.listen(port, () => {
    console.log(`Servidor de Vintex Clinic (Seguro) escuchando en http://localhost:${port}`);
});
