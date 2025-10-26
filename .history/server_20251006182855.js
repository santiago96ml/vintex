// ============== SERVIDOR BACKEND PARA VINTEX CLINIC (VERSIÓN FINAL Y COMPATIBLE) ==============

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
    console.error("Error: Las variables de entorno SUPABASE_URL y SUPABASE_ANON_KEY deben estar definidas en el archivo .env");
    process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

// 3. MIDDLEWARE
app.use(cors());
app.use(express.json());

// 4. RUTAS DE LA API

/**
 * @route   GET /api/initial-data
 * @desc    Obtiene todos los datos necesarios para inicializar la aplicación:
 * - La lista completa de doctores con sus horarios y estado.
 * - La lista de todas las citas.
 */
app.get('/api/initial-data', async (req, res) => {
    console.log("Petición recibida: GET /api/initial-data");
    try {
        // Petición 1: Obtener todos los doctores
        const { data: doctorsData, error: doctorsError } = await supabase
            .from('doctores')
            .select('id, nombre, activo, horario_inicio, horario_fin');

        if (doctorsError) throw doctorsError;

        // Petición 2: Obtener todas las citas con la información anidada
        const { data: appointmentsData, error: appointmentsError } = await supabase
            .from('citas')
            .select(`
                id, fecha_hora, descripcion, estado, duracion_minutos,
                cliente: clientes (id, nombre, dni),
                doctor: doctores (id, nombre)
            `);

        if (appointmentsError) throw appointmentsError;

        console.log(`Datos obtenidos: ${doctorsData.length} doctores y ${appointmentsData.length} citas.`);
        
        // Enviamos un único objeto con ambas listas
        res.status(200).json({
            doctors: doctorsData,
            appointments: appointmentsData
        });

    } catch (error) {
        console.error("Error en /api/initial-data:", error.message);
        res.status(500).json({ error: 'Error interno del servidor.', details: error.message });
    }
});


// --- EL RESTO DE RUTAS PARA MANEJAR CITAS INDIVIDUALES PERMANECEN IGUAL ---

/**
 * @route   POST /api/citas
 * @desc    Crea una nueva cita.
 */
app.post('/api/citas', async (req, res) => {
    const citaData = req.body;
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

/**
 * @route   PATCH /api/citas/:id
 * @desc    Actualiza una cita existente.
 */
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

/**
 * @route   DELETE /api/citas/:id
 * @desc    Elimina una cita.
 */
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

