// ============== SERVIDOR BACKEND PARA VINTEX CLINIC (VERSIÓN FINAL COMPLETA) ==============

// 1. IMPORTACIÓN DE MÓDULOS
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

// 2. CONFIGURACIÓN INICIAL
const app = express();
const port = 3001; 

// --- Conexión a Supabase ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
    console.error("Error: Las variables de entorno SUPABASE_URL y SUPABASE_ANON_KEY deben estar definidas.");
    process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

// 3. MIDDLEWARE
app.use(cors({ origin: '*' }));
app.use(express.json());

// 4. RUTAS DE LA API

app.get('/api/initial-data', async (req, res) => {
    try {
        const [doctorsRes, appointmentsRes, clientsRes, chatHistoryRes] = await Promise.all([
            supabase.from('doctores').select('*').order('id', { ascending: true }),
            supabase.from('citas').select(`id, fecha_hora, descripcion, estado, duracion_minutos, cliente: clientes (id, nombre, dni), doctor: doctores (id, nombre)`),
            // --- CORRECCIÓN: Seleccionamos todos los campos de clientes ---
            supabase.from('clientes').select('*').order('id', { ascending: true }),
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
        console.error("Error en /api/initial-data:", error.message);
        res.status(500).json({ error: 'Error interno del servidor.', details: error.message });
    }
});

// --- Rutas para Doctores ---
app.post('/api/doctors', async (req, res) => {
    const { nombre, especialidad, activo, horario_inicio, horario_fin } = req.body;
    
    if (!nombre || !especialidad || !horario_inicio || !horario_fin) {
        return res.status(400).json({ error: 'Faltan campos obligatorios.' });
    }

    try {
        const { data, error } = await supabase
            .from('doctores')
            .insert([{ nombre, especialidad, activo, horario_inicio, horario_fin }])
            .select()
            .single();

        if (error) throw error;
        res.status(201).json(data);

    } catch (error) {
        console.error("Error al crear doctor:", error.message);
        res.status(500).json({ error: 'No se pudo crear el doctor.', details: error.message });
    }
});

app.patch('/api/doctors/:id', async (req, res) => {
    const { id } = req.params;
    const { especialidad, horario_inicio, horario_fin, activo } = req.body;
    const updates = { especialidad, horario_inicio, horario_fin, activo };

    try {
        const { data, error } = await supabase
            .from('doctores')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Doctor no encontrado.' });
        res.status(200).json(data);

    } catch (error) {
        console.error(`Error al actualizar doctor con ID ${id}:`, error.message);
        res.status(500).json({ error: 'No se pudo actualizar el doctor.', details: error.message });
    }
});

// --- ACTUALIZACIÓN: Ahora acepta 'activo' y 'solicitud_de_secretaría' ---
app.patch('/api/clients/:id', async (req, res) => {
    const { id } = req.params;
    const { activo, solicitud_de_secretaría } = req.body;

    const updates = {};

    // Validamos y añadimos los campos que SÍ vengan en el request
    if (typeof activo === 'boolean') {
        updates.activo = activo;
    }
    if (typeof solicitud_de_secretaría === 'boolean') {
        updates.solicitud_de_secretaría = solicitud_de_secretaría;
    }

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No se proporcionaron campos válidos para actualizar (se esperaba 'activo' o 'solicitud_de_secretaría')." });
    }

    try {
        const { data, error } = await supabase
            .from('clientes')
            .update(updates)
            .eq('id', id)
            .select()
            .single();
        
        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Cliente no encontrado.' });

        console.log(`Cliente ${id} actualizado:`, updates);
        res.status(200).json(data);

    } catch(error) {
        console.error(`Error al actualizar cliente ${id}:`, error.message);
        res.status(500).json({ error: 'No se pudo actualizar el cliente.', details: error.message });
    }
});


// --- Rutas para Citas ---
app.post('/api/citas', async (req, res) => {
    const { doctor_id, fecha_hora, descripcion, estado, cliente_id, new_client_name, new_client_dni, new_client_telefono } = req.body;
    let finalClientId = cliente_id;

    try {
        if (new_client_name && new_client_dni) {
            let { data: existingClient } = await supabase.from('clientes').select('id').eq('dni', new_client_dni).single();
            if (existingClient) {
                finalClientId = existingClient.id;
            } else {
                const { data: newClient, error: createError } = await supabase.from('clientes').insert({ nombre: new_client_name, dni: new_client_dni, telefono: new_client_telefono || '' }).select('id').single();
                if (createError) throw createError;
                finalClientId = newClient.id;
            }
        }

        if (!finalClientId) {
            return res.status(400).json({ error: 'Cliente no especificado.' });
        }
        
        const citaData = { 
            cliente_id: finalClientId, 
            doctor_id, 
            fecha_hora,
            descripcion, 
            estado: estado || 'programada' 
        };

        const { data: newAppointment, error: appointmentError } = await supabase.from('citas').insert(citaData).select().single();
        if (appointmentError) throw appointmentError;
        
        res.status(201).json(newAppointment);

    } catch (error) {
        console.error("Error al procesar la cita:", error.message);
        res.status(500).json({ error: 'No se pudo procesar la cita.', details: error.message });
    }
});

app.patch('/api/citas/:id', async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    delete updates.cliente_id;
    delete updates.new_client_name;
    delete updates.new_client_dni;
    delete updates.new_client_telefono;

    try {
        const { data, error } = await supabase
            .from('citas')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        
        if (!data) {
            return res.status(404).json({ error: 'No se encontró la cita para actualizar.' });
        }

        res.status(200).json(data);
    } catch (error) {
        console.error("Error al actualizar la cita:", error.message);
        res.status(500).json({ error: 'No se pudo actualizar la cita.', details: error.message });
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