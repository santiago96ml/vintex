// ============== SERVIDOR BACKEND PARA VINTEX CLINIC (FINAL CON PACIENTES Y CHAT) ==============

// 1. IMPORTACIÓN DE MÓDULOS
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

// 2. CONFIGURACIÓN INICIAL
const app = express();
const port = process.env.PORT || 3001;

// --- Conexión a Supabase ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) { console.error("Error: Faltan variables de entorno de Supabase."); process.exit(1); }
const supabase = createClient(supabaseUrl, supabaseKey);

// --- Credenciales de Z-API ---
const zapi_id = "3E55F69D4856218094667AA5FC67D982";
const zapi_token = "D27098F6E443334F470644A7";
const zapi_endpoint = `https://api.z-api.io/instances/${zapi_id}/token/${zapi_token}/send-text`;

// 3. MIDDLEWARE
app.use(cors());
app.use(express.json());

// 4. RUTAS DE LA API

app.get('/api/initial-data', async (req, res) => {
    console.log("Petición recibida: GET /api/initial-data");
    try {
        const [doctorsRes, appointmentsRes, clientsRes, chatHistoryRes] = await Promise.all([
            supabase.from('doctores').select('id, nombre, activo, horario_inicio, horario_fin'),
            supabase.from('citas').select(`id, fecha_hora, descripcion, estado, duracion_minutos, cliente: clientes (id, nombre, dni), doctor: doctores (id, nombre)`),
            supabase.from('clientes').select('id, nombre, dni, telefono'), // Pedimos el teléfono
            supabase.from('n8n_chat_histories').select('session_id, message').order('id', { ascending: true })
        ]);

        if (doctorsRes.error) throw doctorsRes.error;
        if (appointmentsRes.error) throw appointmentsRes.error;
        if (clientsRes.error) throw clientsRes.error;
        if (chatHistoryRes.error) throw chatHistoryRes.error;
        
        res.status(200).json({
            doctors: doctorsRes.data,
            appointments: appointmentsRes.data,
            clients: clientsRes.data,
            chatHistory: chatHistoryRes.data
        });
    } catch (error) {
        res.status(500).json({ error: 'Error interno del servidor.', details: error.message });
    }
});

app.post('/api/send-message', async (req, res) => {
    const { sessionId, message } = req.body;
    if (!sessionId || !message) { return res.status(400).json({ error: 'Faltan sessionId o message.' }); }
    const phone = sessionId.split('@')[0];
    try {
        const zapiResponse = await fetch(zapi_endpoint, {
            method: 'POST',
            body: JSON.stringify({ phone, message }),
            headers: { 'Content-Type': 'application/json' }
        });
        if (!zapiResponse.ok) { const errorBody = await zapiResponse.text(); throw new Error(`Error de Z-API: ${errorBody}`); }
        
        const secretaryMessage = { type: "ai", content: `[Secretaría]: ${message}` };
        const { error: insertError } = await supabase.from('n8n_chat_histories').insert({ session_id: sessionId, message: secretaryMessage });
        if (insertError) throw insertError;
        
        res.status(200).json({ success: true, message: "Mensaje enviado y guardado." });
    } catch (error) {
        console.error("Error en /api/send-message:", error.message);
        res.status(500).json({ error: 'No se pudo procesar el envío del mensaje.', details: error.message });
    }
});

app.post('/api/citas', async (req, res) => { /* ... (código sin cambios) ... */ });
app.patch('/api/citas/:id', async (req, res) => { /* ... (código sin cambios) ... */ });
app.delete('/api/citas/:id', async (req, res) => { /* ... (código sin cambios) ... */ });

// 5. INICIO DEL SERVIDOR
app.listen(port, () => { console.log(`🚀 ¡Backend de Vintex Clinic está funcionando en http://localhost:${port}!`); });

