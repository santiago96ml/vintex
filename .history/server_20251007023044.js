// ============== SERVIDOR BACKEND PARA VINTEX CLINIC (CON CHAT Y Z-API) ==============

// 1. IMPORTACIÓN DE MÓDULOS
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

// 2. CONFIGURACIÓN INICIAL
const app = express();
const port = process.env.PORT || 3001;

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

// 4. RUTAS DE LA API

app.get('/api/initial-data', async (req, res) => {
    console.log("Petición recibida: GET /api/initial-data");
    try {
        const [doctorsRes, appointmentsRes, clientsRes] = await Promise.all([
            supabase.from('doctores').select('id, nombre, activo, horario_inicio, horario_fin'),
            supabase.from('citas').select(`
                id, fecha_hora, descripcion, estado, duracion_minutos,
                cliente: clientes (id, nombre, dni),
                doctor: doctores (id, nombre)
            `),
            supabase.from('clientes').select('id, nombre, dni')
        ]);

        if (doctorsRes.error) throw doctorsRes.error;
        if (appointmentsRes.error) throw appointmentsRes.error;
        if (clientsRes.error) throw clientsRes.error;

        console.log(`Datos obtenidos: ${doctorsRes.data.length} doctores, ${appointmentsRes.data.length} citas, ${clientsRes.data.length} clientes.`);
        
        res.status(200).json({
            doctors: doctorsRes.data,
            appointments: appointmentsRes.data,
            clients: clientsRes.data
        });

    } catch (error) {
        console.error("Error en /api/initial-data:", error.message);
        res.status(500).json({ error: 'Error interno del servidor.', details: error.message });
    }
});

// --- NUEVA RUTA: OBTENER HISTORIAL DE CHAT ---
app.get('/api/chat-history/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    console.log(`Petición recibida para historial de chat de: ${sessionId}`);
    try {
        const { data, error } = await supabase
            .from('n8n_chat_histories')
            .select('message')
            .eq('session_id', sessionId)
            .order('id', { ascending: true });

        if (error) throw error;
        res.status(200).json(data);
    } catch (error) {
        console.error("Error al obtener historial de chat:", error.message);
        res.status(500).json({ error: 'No se pudo obtener el historial de chat.', details: error.message });
    }
});

// --- NUEVA RUTA: ENVIAR MENSAJE (SIMULADO) ---
app.post('/api/send-message', async (req, res) => {
    const { sessionId, message } = req.body;
    console.log(`Petición recibida para enviar mensaje a ${sessionId}: "${message}"`);

    // --- IMPORTANTE: LÓGICA DE Z-API ---
    // Aquí es donde iría la lógica real para llamar a la API de Z-API.
    // Como no tenemos las credenciales ni la estructura exacta, simularemos una respuesta exitosa.
    console.log('--- SIMULACIÓN DE ENVÍO A Z-API ---');
    console.log(`   - Endpoint: https://api.z-api.io/...`);
    console.log(`   - Body: { "phone": "${sessionId.split('@')[0]}", "message": "${message}" }`);
    console.log('--- FIN DE SIMULACIÓN ---');
    
    // Suponiendo que el envío fue exitoso, guardamos el mensaje en nuestra base de datos
    try {
        // Creamos un objeto de mensaje similar al de n8n para mantener la consistencia
        const botMessage = {
            type: "ai",
            content: `[Mensaje enviado por secretaria]: ${message}`
        };

        const { error } = await supabase
            .from('n8n_chat_histories')
            .insert({ session_id: sessionId, message: botMessage });

        if (error) throw error;
        
        console.log("Mensaje de la secretaria guardado en el historial.");
        res.status(200).json({ success: true, message: "Mensaje enviado y guardado en el historial." });

    } catch (error) {
        console.error("Error al guardar mensaje en el historial:", error.message);
        res.status(500).json({ error: 'El mensaje se envió (simulado), pero no se pudo guardar en el historial.', details: error.message });
    }
});


// --- RUTAS DE CITAS (SIN CAMBIOS) ---
app.post('/api/citas', async (req, res) => {
    // ... código sin cambios ...
});
app.patch('/api/citas/:id', async (req, res) => {
    // ... código sin cambios ...
});
app.delete('/api/citas/:id', async (req, res) => {
    // ... código sin cambios ...
});


// 5. INICIO DEL SERVIDOR
app.listen(port, () => {
    console.log(`🚀 ¡Backend de Vintex Clinic está funcionando en http://localhost:${port}!`);
});

