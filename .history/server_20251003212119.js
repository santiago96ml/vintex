// ============== SERVIDOR BACKEND PARA VINTEX CLINIC (con Supabase) ==============

// 1. IMPORTACIÓN DE MÓDULOS
require('dotenv').config(); // Carga las variables de entorno desde el archivo .env
const express = require('express'); // Framework para construir el servidor
const cors = require('cors'); // Middleware para permitir peticiones desde otros dominios (tu frontend)
const { createClient } = require('@supabase/supabase-js'); // Cliente oficial de Supabase

// 2. CONFIGURACIÓN INICIAL
const app = express();
const port = process.env.PORT || 3001; // Elige un puerto para el backend (ej. 3001)

// --- Conexión a Supabase ---
// Las claves se toman de forma segura desde tu archivo .env
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
    throw new Error("Las variables de entorno de Supabase (SUPABASE_URL y SUPABASE_ANON_KEY) son obligatorias.");
}
const supabase = createClient(supabaseUrl, supabaseKey);

// 3. MIDDLEWARE
// Estos son "plugins" que se ejecutan en cada petición
app.use(cors()); // Habilita CORS para que tu `clinica.html` pueda comunicarse con este servidor
app.use(express.json()); // Permite que el servidor entienda y procese datos en formato JSON enviados en el cuerpo de las peticiones

// 4. RUTAS DE LA API (ENDPOINTS)
// Aquí es donde tu frontend enviará las peticiones

/**
 * @route   GET /api/data
 * @desc    Obtiene todos los datos necesarios para inicializar la aplicación de la clínica.
 * Realiza una única consulta a Supabase para traer citas, clientes y doctores relacionados,
 * lo cual es mucho más eficiente que hacer múltiples llamadas desde el frontend.
 */
app.get('/api/data', async (req, res) => {
    console.log("Petición recibida: GET /api/data");
    try {
        const { data, error } = await supabase
            .from('citas') // La tabla principal de la consulta
            .select(`
                id,
                fecha_hora,
                descripcion,
                estado: estado_cita,
                duracion_minutos,
                cliente: clientes (
                    id,
                    thread_id,
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

        if (error) {
            // Si Supabase devuelve un error, lo lanzamos para que sea capturado por el bloque catch
            throw error;
        }

        console.log(`Datos obtenidos exitosamente: ${data.length} citas combinadas.`);
        res.status(200).json(data); // Envía los datos al frontend con un estado 200 (OK)

    } catch (error) {
        console.error("Error al obtener datos de Supabase:", error.message);
        res.status(500).json({ error: 'No se pudieron obtener los datos de Supabase.', details: error.message });
    }
});

/**
 * @route   POST /api/citas
 * @desc    Crea una nueva cita en la base de datos.
 * @body    { cliente_id, doctor_id, fecha_hora, ... }
 */
app.post('/api/citas', async (req, res) => {
    const citaData = req.body;
    console.log("Petición recibida: POST /api/citas con datos:", citaData);

    try {
        const { data, error } = await supabase
            .from('citas')
            .insert([citaData]) // `insert` espera un array de objetos
            .select(); // `.select()` devuelve el registro recién creado

        if (error) throw error;

        console.log("Cita creada exitosamente:", data[0]);
        res.status(201).json(data[0]); // Envía la nueva cita con un estado 201 (Created)

    } catch (error) {
        console.error("Error al crear la cita:", error.message);
        res.status(500).json({ error: 'No se pudo crear la cita.', details: error.message });
    }
});

/**
 * @route   PATCH /api/citas/:id
 * @desc    Actualiza una cita existente por su ID.
 * @param   {string} id - El ID de la cita a actualizar.
 * @body    { fecha_hora, doctor_id, ... } - Campos a actualizar
 */
app.patch('/api/citas/:id', async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    console.log(`Petición recibida: PATCH /api/citas/${id} con datos:`, updates);

    try {
        const { data, error } = await supabase
            .from('citas')
            .update(updates)
            .eq('id', id) // Condición: donde el 'id' coincida
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
 * @desc    Elimina una cita por su ID.
 * @param   {string} id - El ID de la cita a eliminar.
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
 * @desc    Actualiza la información de un cliente, específicamente el historial de conversación.
 * @param   {string} id - El ID del cliente a actualizar.
 * @body    { historial_conversacion: "..." }
 */
app.patch('/api/clientes/:id', async (req, res) => {
    const { id } = req.params;
    const { historial_conversacion } = req.body;
    console.log(`Petición recibida: PATCH /api/clientes/${id} para actualizar historial.`);

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
        console.error("Error al actualizar el historial del cliente:", error.message);
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