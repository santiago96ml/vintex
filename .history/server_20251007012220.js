// ============== SERVIDOR BACKEND PARA VINTEX CLINIC (VERSIÓN FINAL VERIFICADA) ==============

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
            supabase.from('clientes').select('id, nombre')
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

app.post('/api/citas', async (req, res) => {
    const citaData = req.body;
    if (!citaData.cliente_id || !citaData.doctor_id || !citaData.fecha_hora) {
        return res.status(400).json({ error: 'Faltan campos obligatorios: cliente_id, doctor_id, fecha_hora.' });
    }
    console.log("Petición recibida: POST /api/citas con datos:", citaData);
    try {
        const { data, error } = await supabase.from('citas').insert([citaData]).select();
        if (error) throw error;
        console.log("Cita creada exitosamente:", data[0]);
        res.status(201).json(data[0]);
    } catch (error) {
        console.error("Error al crear la cita:", error.message);
        res.status(500).json({ error: 'No se pudo crear la cita.', details: error.message });
    }
});

app.patch('/api/citas/:id', async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    console.log(`Petición recibida: PATCH /api/citas/${id} con datos:`, updates);

    try {
        const { data, error } = await supabase.from('citas').update(updates).eq('id', id).select();
        if (error) throw error;
        if (data.length === 0) return res.status(404).json({ error: 'Cita no encontrada.' });
        console.log("Cita actualizada exitosamente:", data[0]);
        res.status(200).json(data[0]);
    } catch (error) {
        console.error("Error al actualizar la cita:", error.message);
        res.status(500).json({ error: 'No se pudo actualizar la cita.', details: error.message });
    }
});

app.delete('/api/citas/:id', async (req, res) => {
    const { id } = req.params;
    console.log(`Petición recibida: DELETE /api/citas/${id}`);

    try {
        const { error } = await supabase.from('citas').delete().eq('id', id);
        if (error) throw error;
        console.log(`Cita con ID ${id} eliminada exitosamente.`);
        res.status(200).json({ message: 'Cita eliminada exitosamente.' });
    } catch (error) {
        console.error("Error al eliminar la cita:", error.message);
        res.status(500).json({ error: 'No se pudo eliminar la cita.', details: error.message });
    }
});

// 5. INICIO DEL SERVIDOR
app.listen(port, () => {
    console.log('-------------------------------------------');
    console.log(`🚀 ¡Backend de Vintex Clinic está funcionando!`);
    console.log(`      Listo para recibir peticiones en http://localhost:${port}`);
    console.log('-------------------------------------------');
});

