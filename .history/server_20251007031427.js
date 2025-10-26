// ============== SERVIDOR BACKEND PARA VINTEX CLINIC (CON FUNCIONES DE PACIENTES) ==============

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
if (!supabaseUrl || !supabaseKey) {
    console.error("Error: Las variables de entorno SUPABASE_URL y SUPABASE_ANON_KEY deben estar definidas.");
    process.exit(1);
}
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
            supabase.from('clientes').select('id, nombre, dni, telefono'), // Ahora pedimos el teléfono
            supabase.from('n8n_chat_histories').select('session_id, message').order('id', { ascending: true })
        ]);

        if (doctorsRes.error) throw doctorsRes.error;
        if (appointmentsRes.error) throw appointmentsRes.error;
        if (clientsRes.error) throw clientsRes.error;
        if (chatHistoryRes.error) throw chatHistoryRes.error;
        
        console.log(`Datos obtenidos: ${doctorsRes.data.length} doctores, ${appointmentsRes.data.length} citas, ${clientsRes.data.length} clientes, ${chatHistoryRes.data.length} mensajes de chat.`);
        
        res.status(200).json({
            doctors: doctorsRes.data,
            appointments: appointmentsRes.data,
            clients: clientsRes.data,
            chatHistory: chatHistoryRes.data
        });

    } catch (error) {
        console.error("Error en /api/initial-data:", error.message);
        res.status(500).json({ error: 'Error interno del servidor.', details: error.message });
    }
});

app.post('/api/send-message', async (req, res) => {
    const { sessionId, message } = req.body;
    if (!sessionId || !message) {
        return res.status(400).json({ error: 'Faltan sessionId o message.' });
    }

    const phone = sessionId.split('@')[0];
    console.log(`Intentando enviar mensaje a ${phone}: "${message}"`);

    try {
        // 1. Enviar a Z-API
        const zapiResponse = await fetch(zapi_endpoint, {
            method: 'POST',
            body: JSON.stringify({ phone, message }),
            headers: { 'Content-Type': 'application/json' }
        });

        if (!zapiResponse.ok) {
            const errorBody = await zapiResponse.text();
            throw new Error(`Error de Z-API: ${errorBody}`);
        }
        console.log("Mensaje enviado exitosamente vía Z-API.");

        // 2. Guardar en el historial de Supabase
        const secretaryMessage = { type: "ai", content: `[Secretaría]: ${message}` };
        const { error: insertError } = await supabase
            .from('n8n_chat_histories')
            .insert({ session_id: sessionId, message: secretaryMessage });

        if (insertError) throw insertError;

        console.log("Mensaje de secretaría guardado en el historial.");
        res.status(200).json({ success: true, message: "Mensaje enviado y guardado." });

    } catch (error) {
        console.error("Error en /api/send-message:", error.message);
        res.status(500).json({ error: 'No se pudo procesar el envío del mensaje.', details: error.message });
    }
});


// --- RUTAS DE CITAS (SIN CAMBIOS) ---
app.post('/api/citas', async (req, res) => {
    const { doctor_id, fecha_hora, descripcion, estado, cliente_id, new_client_name, new_client_dni } = req.body;
    let finalClientId = cliente_id;
    try {
        if (new_client_name && new_client_dni) {
            let { data: existingClient } = await supabase.from('clientes').select('id').eq('dni', new_client_dni).single();
            if (existingClient) {
                finalClientId = existingClient.id;
            } else {
                const { data: newClient, error: createError } = await supabase.from('clientes').insert({ nombre: new_client_name, dni: new_client_dni }).select('id').single();
                if (createError) throw createError;
                finalClientId = newClient.id;
            }
        }
        if (!finalClientId) return res.status(400).json({ error: 'Cliente no especificado.' });
        const citaData = { cliente_id: finalClientId, doctor_id, fecha_hora, descripcion, estado: estado || 'programada' };
        const { data: newAppointment, error: appointmentError } = await supabase.from('citas').insert(citaData).select().single();
        if (appointmentError) throw appointmentError;
        res.status(201).json(newAppointment);
    } catch (error) {
        res.status(500).json({ error: 'No se pudo procesar la cita.', details: error.message });
    }
});
app.patch('/api/citas/:id', async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    try {
        const { data, error } = await supabase.from('citas').update(updates).eq('id', id).select();
        if (error) throw error;
        res.status(200).json(data[0]);
    } catch (error) {
        res.status(500).json({ error: 'No se pudo actualizar la cita.' });
    }
});
app.delete('/api/citas/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const { error } = await supabase.from('citas').delete().eq('id', id);
        if (error) throw error;
        res.status(200).json({ message: 'Cita eliminada.' });
    } catch (error) {
        res.status(500).json({ error: 'No se pudo eliminar la cita.' });
    }
});


// 5. INICIO DEL SERVIDOR
app.listen(port, () => {
    console.log(`🚀 ¡Backend de Vintex Clinic está funcionando en http://localhost:${port}!`);
});

