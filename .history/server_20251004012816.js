// ============== SERVIDOR BACKEND PARA VINTEX CLINIC (VERSIÓN CON SOLUCIÓN thread_id) ==============

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
 * @route   GET /api/data
 * @desc    Obtiene todos los datos necesarios para inicializar la aplicación.
 */
app.get('/api/data', async (req, res) => {
    console.log("Petición recibida: GET /api/data");
    try {
        const { data, error } = await supabase
            .from('citas')
            .select(`
                id,
                fecha_hora,
                descripcion,
                estado: estado_cita,
                duracion_minutos,
                cliente: clientes (
                    id,
                    nombre: nombre_completo,
                    dni,
                    telefono,
                    correo,
                    historial: historial_conversacion
                ),
                doctor: doctores (
                    id,
                    nombre
                )
            `);

        if (error) throw error;
        console.log(`Datos obtenidos exitosamente: ${data.length} citas.`);
        res.status(200).json(data);

    } catch (error) {
        console.error("Error en /api/data:", error.message);
        res.status(500).json({ error: 'Error interno del servidor.', details: error.message });
    }
});

/**
 * @route   POST /api/citas
 * @desc    Crea una nueva cita.
 */
app.post('/api/citas', async (req, res) => {
    const citaData = req.body;
    console.log("Petición recibida: POST /api/citas con datos:", citaData);

    try {
        const { data, error } = await supabase
            .from('citas')
            .insert([citaData])
            .select();

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
        const { data, error } = await supabase
            .from('citas')
            .update(updates)
            .eq('id', id)
            .select();

        if (error) throw error;
        if (data.length === 0) {
            return res.status(404).json({ error: 'Cita no encontrada.' });
        }
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
        const { error } = await supabase
            .from('citas')
            .delete()
            .eq('id', id);

        if (error) throw error;

        console.log(`Cita con ID ${id} eliminada exitosamente.`);
        res.status(200).json({ message: 'Cita eliminada exitosamente.' });

    } catch (error) {
        console.error("Error al eliminar la cita:", error.message);
        res.status(500).json({ error: 'No se pudo eliminar la cita.', details: error.message });
    }
});

/**
 * @route   PATCH /api/clientes/:id
 * @desc    Actualiza el historial de un cliente.
 */
app.patch('/api/clientes/:id', async (req, res) => {
    const { id } = req.params;
    const { historial_conversacion } = req.body;
    console.log(`Petición recibida: PATCH /api/clientes/${id}`);

    if (typeof historial_conversacion === 'undefined') {
        return res.status(400).json({ error: 'El campo "historial_conversacion" es requerido.' });
    }

    try {
        const { data, error } = await supabase
            .from('clientes')
            .update({ historial_conversacion: historial_conversacion })
            .eq('id', id)
            .select();

        if (error) throw error;
        if (data.length === 0) {
            return res.status(404).json({ error: 'Cliente no encontrado.' });
        }
        console.log(`Historial del cliente ${id} actualizado.`);
        res.status(200).json(data[0]);

    } catch (error) {
        console.error("Error al actualizar el historial:", error.message);
        res.status(500).json({ error: 'No se pudo actualizar el historial del cliente.', details: error.message });
    }
});


// 5. INICIO DEL SERVIDOR
app.listen(port, () => {
    console.log('-------------------------------------------');
    console.log(`🚀 ¡Backend de Vintex Clinic está funcionando!`);
    console.log(`      Listo para recibir peticiones en http://localhost:${port}`);
    console.log('-------------------------------------------');
});